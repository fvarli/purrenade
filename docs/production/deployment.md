# Frontend deployment

The manual procedure that is actually in use. **There is no CI/CD yet** —
automating this is the next infrastructure milestone, and [§6](#6-what-future-cicd-must-preserve)
records what that automation has to keep.

Read [README.md](README.md) first for the architecture these steps assume.

---

## 1. The model, and why it is shaped this way

```
developer machine                          production host
─────────────────                          ───────────────
exact reviewed revision
clean dependency install
lint · typecheck · tests
production build
package .output  ──→  SHA256  ──→ transfer ──→ SHA256 verified
                                                    │
                                          extract into releases/<git-sha>
                                                    │
                                          atomically repoint current
                                                    │
                                          restart purrenade-web.service
                                                    │
                                          loopback smoke → public HTTPS smoke
```

**The production host never builds.** It runs no `npm install` and no
`npm run build`. Two reasons, both load-bearing: a build needs devDependencies
and a toolchain that a deployment target has no business carrying, and a build
that happens on the server cannot be verified before it lands there. Shipping a
hashed artifact means what was tested is byte-for-byte what runs.

The host is a **deployment target, not a development workstation.** A production
clone exists and could technically commit, but editing source on the server is
exceptional hotfix behaviour — it creates drift that the next deploy silently
reverts, and the drift is invisible from the repository.

## 2. Before you build

The artifact is built from a **clean, exact, already-pushed revision**. Not a
dirty tree, not a local branch, not "the same thing plus one fix".

```bash
git status --porcelain     # must be empty
git rev-parse HEAD         # this SHA names the release directory
git rev-list --left-right --count origin/main...HEAD   # must be 0 0
```

**Stop the local dev service first, if you run one.** Removing or reinstalling
`node_modules` underneath a running Nuxt dev process corrupts the dependency
tree for both — the dev server holds open handles into the directory being
replaced, and the failure surfaces later as an inexplicable build error. The
sequence is: stop the dev service → clean install → build → test → smoke the
artifact → start the dev service again.

## 3. Build and verify locally

```bash
npm ci                  # exact lockfile install, never `npm install`
npm run lint
npm run typecheck
npm run test
npm audit               # 0 vulnerabilities at the initial deployment
npm run build           # produces .output/
```

The build must be told what it is being built **for**, because two of these are
compiled into the bundle and cannot be changed afterwards:

| Build variable | Initial production value | Runtime-changeable? |
| --- | --- | --- |
| `NODE_ENV` | `production` | — |
| `NUXT_API_BASE` | the public API origin | yes, also a runtime value |
| `NUXT_TRUSTED_ORIGINS` | the public frontend origin | yes, also a runtime value |
| `NUXT_SESSION_DRIVER` | `fs` | **no — build time only** |
| `NUXT_SESSION_FS_BASE` | the shared session-store path | **no — build time only** |

The last two are the trap. See
[README.md §4](README.md#the-driver-is-chosen-at-build-time-not-at-runtime):
setting them on the host does nothing, silently.

Smoke the artifact before it leaves the machine — this is what CI already does
in its browser job:

```bash
PURRENADE_ALLOW_FS_SESSIONS=1 PORT=4399 NITRO_PORT=4399 \
  node .output/server/index.mjs
```

There is deliberately **no `npm start` script**; the entrypoint is the built
server, invoked directly.

At the initial deployment this stage reported **38 test files, 1214 tests
passing, `npm audit` clean**, alongside known non-blocking warnings (a large
client chunk, a large Phaser-related server chunk, and Vue `onUnmounted`
warnings in tests). Those are separate engineering work and do not block a
deployment.

## 4. Package, transfer, activate

Package `.output` and record its hash. The hash is the artifact's identity —
it is what makes "the thing I tested" and "the thing that is running" the same
provable object.

```bash
tar -czf purrenade-web-<git-sha>.tar.gz .output
sha256sum purrenade-web-<git-sha>.tar.gz     # record this
```

Transfer it, then **verify the hash again on the host before extracting.** A
mismatch means stop, not retry.

Extract into a release directory named by the revision, so the running code is
always traceable to a commit:

```
releases/<git-sha>/
```

Normalize permissions so the artifact is readable by the runtime identity and
writable by nobody who does not need it.

### Activating atomically

`current` must **never be missing**, not even for a moment — a request arriving
in that window gets an error from a service whose working directory has
vanished. So do not `rm` then `ln`. Create the new link beside it and rename
over the old one; `rename(2)` is atomic:

```bash
ln -sfn releases/<git-sha> current.new
mv -Tf current.new current
```

Then restart the service so the new working directory is picked up:

```bash
sudo systemctl restart purrenade-web.service
```

The session store is untouched by all of this. Players stay signed in.

## 5. Rollback

The release model exists for this. A previous release is still on disk, so a
code rollback is the activation step pointed at an older SHA:

```bash
ln -sfn releases/<previous-good-sha> current.new
mv -Tf current.new current
sudo systemctl restart purrenade-web.service
```

Then run the verification in [operations.md §6](operations.md#6-verifying-a-deployment).

**Sessions survive a rollback** as long as the session record format is
compatible between the two releases. That is normally true and is not
automatically true: a release that changes the shape of a session record cannot
be rolled back without signing everybody out, and that should be called out in
its own changelog entry when it happens.

Rolling the frontend back does **not** roll the API back. If the release being
withdrawn depended on an API change, coordinate with
[the backend rollback principles](https://github.com/fvarli/purrenade-api/blob/main/docs/production/deployment.md)
— backend rollback is the harder half, because code and schema move together.

## 6. The automated pipeline, and the invariants it keeps

**This procedure is now automated** — see [ci-cd.md](ci-cd.md) for the workflow,
the security model and the operator setup it depends on. The manual steps above
remain correct and remain the fallback when the pipeline is unavailable, so they
are maintained rather than archived.

The pipeline **automates this proven procedure** rather than inventing a
different production model. Everything below was already true of the manual
process and is now enforced by `.github/workflows/deploy.yml` and
`deploy/bin/release.sh`; a change that drops any of it is a regression.

**Must preserve**

- A reviewed, exact, pushed Git revision — never a dirty tree
- A clean lockfile dependency install
- Lint, typecheck and the test suite, all passing, before any artifact exists
- A production build performed **off** the production host
- Artifact identity and integrity — hash computed at build, verified before extract
- The `releases/<sha>` layout, so what runs is traceable to a commit
- The persistent shared session store, untouched across releases
- An **atomic** `current` switch
- A service restart, then a loopback smoke and a public HTTPS smoke
- The ability to roll back to a previous release

**Must not**

- Build on the production host
- Overwrite, relocate or clear the shared session store
- Expose session records, bearer tokens or any server-side auth state in logs or artifacts
- Mutate the host's generic Node installation, `nvm` defaults or alternatives links
- Deploy an artifact whose hash was never verified
- Leave `current` absent at any instant
- Print secrets into build logs, job output or stored artifacts

Deployment is **`workflow_dispatch` only**: no push to `main`, however green,
reaches production on its own. The `production` environment, its protection
rules and its secrets are operator-configured and are listed in
[ci-cd.md §7](ci-cd.md#7-environment-configuration).

`tests/deploy/release.test.sh` holds the release mechanics to the invariants
above — including, twice, that the session store survives.
