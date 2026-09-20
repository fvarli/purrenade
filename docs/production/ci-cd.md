# CI/CD — frontend

How the frontend reaches production, what the pipeline may and may not do, and
the durable production configuration it requires.

Deploying by hand is [deployment.md](deployment.md); that procedure is what this
pipeline automates, and it remains the fallback when the pipeline is unavailable.
The API half is
[`purrenade-api/docs/production/ci-cd.md`](https://github.com/fvarli/purrenade-api/blob/main/docs/production/ci-cd.md).

> **OPS-3 is complete.** The controlled frontend and backend production
> deployment paths have both been proven end-to-end. This does **not** enable
> automatic deployment: the frontend production path remains
> `workflow_dispatch`/operator-controlled, and the manual procedure remains the
> fallback.

---

## 1. Two workflows, and why they are separate

| | `ci.yml` | `deploy.yml` |
| --- | --- | --- |
| Trigger | `push` / `pull_request` on `main` | **`workflow_dispatch` only** |
| Secrets | none | environment-scoped, deploy job only |
| Environment | none | `production` |
| Concurrency | per-ref, cancels stale runs | `purrenade-web-production`, **never cancels** |

**Deployment is operator-controlled on purpose.** Automatic deployment on every
green push would mean a documentation merge restarts a live service on a host
that runs unrelated applications. The successful proof does not remove the
moment where a person decides to deploy.

Concurrency never cancels a run in flight: a deployment interrupted between
transfer and activation is worse than one that waits.

## 2. What the pipeline proves before it touches anything

`deploy.yml` takes one input — a **full 40-character commit SHA** — and proves
three things in a job holding **no secrets and no environment**, so untrusted
input is never parsed while production credentials are in scope:

1. **It is a full lowercase SHA**, not a ref or branch name. `workflow_dispatch`
   lets the launcher choose the ref, so accepting a branch name would be a way
   to deploy unreviewed code.
2. **It is reachable from `origin/main`.**
3. **CI concluded `success` for those exact bytes.**

## 3. The artifact, and why it is built here

The deployment workflow **builds the artifact itself**, from the validated SHA,
rather than downloading one an earlier CI run produced. That makes "the artifact
came from a different commit than the one requested" structurally impossible,
for the price of one rebuild.

```
validate (no secrets)  →  build (no secrets)  →  deploy (production secrets)
```

The build job re-runs lint, typecheck and the unit suite. A deployment that
skipped them because CI already passed would be trusting a record rather than a
result.

### The build-time trap

`nitro.storage` is resolved **when the bundle is built**, not when the server
starts. `NUXT_SESSION_DRIVER` and `NUXT_SESSION_FS_BASE` set on the production
host do nothing at all — the built server carries a literal mount.

So the build job sets them, and the next step **proves** it did, by grepping the
built server for the production session-store path. Without that assertion a
mistake here is silent: the artifact would write live bearer tokens into the
release directory instead of the shared store, and every session would vanish at
the next release. The build fails rather than shipping that.

The tarball contains `.output` and nothing else — no `.env`, no `.data` session
records, no repository `node_modules`, no design references. `.output/server` is
self-contained, so the host installs nothing.

Integrity is a SHA256 manifest computed at build, verified on the runner after
download, and verified **again on the host against the bytes that arrived**
before anything is extracted. A filename containing a SHA proves nothing.

**What the manifest does and does not prove.** It proves transfer integrity and
binds the artifact to the release identifier this run is deploying: the bytes
that reach the host are the bytes the build job produced, in this run. It does
**not** prove a reproducible build and is not independent provenance — the
manifest travels alongside the artifact rather than being attested separately.
Two runs of the same commit will produce byte-different archives, which is
normal for a bundler.

**Rerun semantics follow from immutability.** If `releases/<sha>` already
exists, installation is a no-op and **the first installed bytes remain
authoritative**; the rebuild is discarded rather than written over a release
that may be serving traffic. Re-running a deployment therefore re-activates and
re-verifies what is already there. To ship genuinely different bytes, ship a
different commit.

## 4. Release mechanics

`deploy/bin/release.sh` runs on the host — piped over SSH from the reviewed
revision, so the script that executes is never a stale copy on the server. Every
remote call goes through `deploy/bin/remote-exec.sh`; see [§5](#5-security-model).

```
releases/<sha>.incoming   extraction in progress — never activatable
releases/<sha>            complete, immutable
shared/session-store/     persistent BFF state — never inside a release
current -> releases/<sha>
```

- **Immutable releases.** Re-deploying an installed SHA leaves the bytes alone;
  a rerun cannot mean something different from the run it repeats.
- **Atomic activation.** `ln -sfn` beside the live link, then `mv -Tf` over it.
  `rename(2)` is atomic, so `current` is never absent — not for an instant.
- **Partial transfers are not releases.** Extraction happens in `.incoming` and
  is renamed into place only on success, so a dead transfer leaves something
  that neither activation nor pruning will mistake for a release.
- **The archive's shape is validated before extraction.** Provenance and a
  checksum prove the bytes; they say nothing about the layout, and the
  extraction target sits beside `shared/session-store`. Members must all live
  under `.output/`, with no absolute path and no `..` component, and must all be
  plain files or directories — a symlink, hard link or device node is refused.
  Extraction uses `--no-same-owner --no-same-permissions`, and the entrypoint
  must be a **regular file, not a symlink**.
- **Pruning protects three things**: the active release, the recorded rollback
  target, and everything under `shared/`. `--keep` below 2 is refused, because
  it would leave nothing to roll back to.

### What counts as healthy

`deploy/bin/health-check.sh` is one implementation used in three places: the
loopback check on the host, the public HTTPS check from the runner, and rollback
verification. It asserts the status is **exactly 200** — redirects are neither
followed nor accepted — that the body carries the guest-home marker below, and
that it does **not** carry the unresolved-session marker. The earlier
`curl -fsS` check passed on a 301.

### The health contract

| | Value | Where it lives |
| --- | --- | --- |
| Expect | `data-purrenade-health="guest-home"` | the guest `<section>` in `app/pages/index.vue` |
| Reject | `home__resolving` | the unresolved-session branch of the same file |

**This is a contract, not a detail of the markup.** Renaming or removing the
attribute rolls the next release back. It is checked from both ends — the
browser job runs the real script against the built server, and
`tests/deploy/health-check.test.sh` asserts the marker the gate wants is the
marker the page serves, on the guest branch, with no style rule.

**Why an attribute.** The contract used to be the class `home__play`. A
production build inlines the stylesheet, so that string sat in the `<head>` as a
CSS rule whether or not anything rendered — and `home__play` belonged to the
*signed-in* play button, which an unauthenticated check can never legitimately
see. The gate was matching a stylesheet rather than a page: it passed while
proving nothing about the body, and went on passing until the approved product
shell replaced the home page and took the rule with it. The deployment that
followed rolled back a healthy release, which was the first accurate thing the
gate had said.

Two properties follow, and both are tested. The marker must carry **no style
rule**, so it cannot reappear in the inlined head; and it must sit on the
**guest branch**, so matching it proves an anonymous request rendered the real
entry screen rather than merely proving something Purrenade-shaped answered.

The E2E interaction hook `home__play` still exists on the signed-in play button
and is deliberately *not* the health contract. An unauthenticated gate must
never depend on a signed-in control.

### Failure boundaries

| When it fails | What happens |
| --- | --- |
| Before activation | `current` never moved. Production is untouched. |
| After activation, health fails | **Automatic rollback** to the recorded previous release, restart, re-verify. |

Rollback is eligible whenever **anything after activation** fails — the restart
included. An earlier revision bundled activation and restart into one step and
gated rollback on it, so a failed restart left `current` already switched with
no rollback attempted. Activation, restart and verification are now three
separately-gated steps.

Rollback then restarts and **independently re-verifies** with the same health
assertion the deployment used, and says so loudly if it cannot: a rollback that
quietly fails is worse than no rollback.

It keeps the failed release on disk — deleting the evidence during an incident is
how the same incident happens twice — and **consumes the rollback marker**. One
rollback is one step back; a second `rollback` fails explicitly rather than
reporting a transition that did not occur. Stepping further back is a deliberate
act naming a release.

**Sessions survive both paths**, because the store lives outside every release.

A frontend rollback does **not** roll the API back. If the withdrawn release
depended on an API change, coordinate both.

## 5. Security model

**Workflow permissions** are explicit and minimal: `contents: read`, with
`actions: read` added only to the validation job.

**Every external action is pinned to a full commit SHA** with the release in a
trailing comment. A tag is a moving pointer; the SHA is the contract.

**Host verification is real.** `PROD_SSH_KNOWN_HOSTS` is provisioned
out-of-band; `StrictHostKeyChecking=yes` is explicit on every `ssh` and `scp`.
**`ssh-keyscan` is never run at deploy time.**

**Secrets never enter script text** — they arrive as environment variables and
are referenced as `"$VAR"`. Nothing is printed, no `set -x` near a credential,
no environment dump. The artifact contains no secret.

**Injection defences.** Every `ssh` and `scp` goes through
`deploy/bin/remote-exec.sh`, which is the only place in the repository that
builds a remote command:

- **No caller value is ever remote shell source.** ssh has no argv — whatever it
  is given is joined into one string and handed to a shell. So each argument is
  base64-encoded here and decoded there. The base64 alphabet carries no quote,
  `$`, `;`, newline or leading `-`, so the interpolated text cannot change how
  the remote shell parses anything. An earlier revision interpolated repository
  variables into single-quoted strings, and `/var/www/x'; id; '` was proven to
  execute.
- **Host, user and port are ssh's own arguments**, not remote source, and are
  validated against strict grammars *and* passed after `--`. A user of
  `-oProxyCommand=…` would otherwise be read as an option and execute on the
  runner, where the private key is.
- **ssh and scp get independent option arrays.** Deriving one from the other
  with `${ssh_opts[@]/-p/-P}` rewrote every element, silently corrupting any
  identity path containing `-p`.

The SHA input is pattern-tested before use, and `release.sh` re-tests it before
letting it become a path segment: 40 lowercase hex characters cannot traverse.

**Artifact attestations are deferred.** The artifact never leaves the
GitHub→host path and is already proven by a checksum verified before activation.
Attestations would add `id-token`/`attestations` permissions and a `gh`
dependency on the production host without covering a threat the manifest misses.
Revisit if artifacts are ever distributed more widely.

## 6. Production bootstrap and configuration

The initial production configuration is complete and the path has been proven.
The pipeline nevertheless **cannot bootstrap itself**: the following is the
durable configuration contract for a replacement or recovery environment.

1. **Create the deployment account** — unprivileged, owning the web deployment
   directory including `releases/` and `shared/`.
2. **Install the sudoers contract**, narrow to one command:
   ```
   # /etc/sudoers.d/purrenade-deploy
   <deploy-user> ALL=(root) NOPASSWD: /usr/bin/systemctl restart purrenade-web.service
   ```
3. **Generate a deployment SSH keypair** on a trusted machine; add the public
   key to the deployment account. The private key never enters chat, email or
   this repository.
4. **Capture the host key out-of-band** and verify it against the host's own
   `/etc/ssh/ssh_host_*_key.pub`.
5. **Create the `production` Environment** with required reviewers and a
   deployment branch policy limited to `main`.
6. **Add the secrets and variables** in §7.
7. Keep [deployment.md](deployment.md) usable as the manual fallback for a
   pipeline outage or a deliberate operator-directed deployment.

## 7. Environment configuration

Names only. **No value belongs in this repository.**

**Secrets** (environment-scoped to `production`)

| Name | What it is |
| --- | --- |
| `PROD_HOST` | Deployment host address |
| `PROD_USER` | Deployment account name |
| `PROD_SSH_PRIVATE_KEY` | Private key for the deployment account |
| `PROD_SSH_KNOWN_HOSTS` | Trusted host key line, captured out-of-band |

**Variables** (non-secret, environment-scoped)

| Name | What it is |
| --- | --- |
| `PROD_SSH_PORT` | SSH port; defaults to 22 when unset |
| `PROD_WEB_ROOT` | Web deployment directory containing `releases/` and `shared/` |
| `PROD_SESSION_STORE_PATH` | **Build-time.** Absolute path of `shared/session-store` |
| `PROD_API_BASE` | `https://api.purrenade.ferzendervarli.com` |
| `PROD_TRUSTED_ORIGINS` | `https://purrenade.ferzendervarli.com` |
| `PROD_LOOPBACK_URL` | `http://127.0.0.1:4310/` |
| `PROD_PUBLIC_URL` | `https://purrenade.ferzendervarli.com` |

`PROD_SESSION_STORE_PATH` is consumed **at build time**. Changing it requires a
rebuild; changing it on the host does nothing. See §3.

The host address and account name are secrets rather than variables — not
because they are cryptographic, but because this repository is public and they
are reconnaissance an attacker would otherwise be handed.

## 8. Testing the deployment logic

`tests/deploy/release.test.sh` drives the real `release.sh` against temporary
release trees — the logic that switches production traffic is the logic under
test, not a paraphrase of it. Twenty-two assertions cover first release,
subsequent release, atomic switch, checksum refusal, failure before activation
leaving `current` intact, rollback and its refusal without a target, release
immutability, partial `.incoming` directories, artifacts missing the entrypoint,
unsafe release ids, prune protecting the active release and the rollback target,
and — twice, because it matters most — **session-store survival**.

`tests/deploy/health-check.test.sh` drives the real `health-check.sh` against a
canned loopback origin — a guest home, a bare 200, a page still resolving its
session, a 301, a 500, a closed port — and then asserts the contract above
against `app/pages/index.vue` itself.

All four harnesses run in CI's **`deploy-scripts`** job. Until that job existed
they ran only when a person remembered to run them, which is how the gate and
the application were able to drift apart in the first place.

```bash
tests/deploy/release.test.sh
tests/deploy/remote-exec.test.sh
tests/deploy/workflow.test.sh
tests/deploy/health-check.test.sh
bash -n deploy/bin/release.sh
```

## 9. Troubleshooting

| Symptom | Cause |
| --- | --- |
| Validation refuses a SHA on main | No **push-event** CI run concluded success for that exact commit |
| Build fails on the session-store assertion | `PROD_SESSION_STORE_PATH` is unset or wrong. It is build-time; setting it on the host does nothing. |
| `Host key verification failed` | `PROD_SSH_KNOWN_HOSTS` missing, stale, or the host key changed. **Investigate before updating it.** |
| `sudo: a password is required` | The sudoers contract in §6 is missing or does not match exactly |
| Service exits immediately after restart | `PURRENADE_ALLOW_FS_SESSIONS=1` is missing from the host env file |
| Everyone signed out after a release | The artifact was built with the wrong session-store path — see §3 |
| Deployment rolled back automatically | The post-activation health check failed. The failed release is still on disk; read its journal. |
| Health check says the guest marker is missing | The home page no longer serves `data-purrenade-health="guest-home"`. It is a contract — see [§4](#the-health-contract). Fix the page or change both ends together; never loosen the gate to make a release green. |
