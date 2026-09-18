# Production — frontend

How the Purrenade frontend runs in production, and the boundary between it and
the API. Start here, then go to [deployment.md](deployment.md) to ship a release
or [operations.md](operations.md) to run the one that is already there.

The backend half of this documentation lives in the other repository, at
[`purrenade-api/docs/production/`](https://github.com/fvarli/purrenade-api/tree/main/docs/production).
The two are written to be read together: this document owns the browser-facing
half of the request path, and the API document owns everything past the BFF.

> **Public repository.** This documentation describes the system design and the
> operating procedure. It deliberately does **not** publish host identity,
> addresses, capacity, firewall state or any credential — see
> [§9](#9-what-never-goes-in-this-repository). Values that are specific to one
> machine appear as `<placeholder>`; an operator reads the real value from the
> server, never from Git.

---

## 1. What runs in production

| Component | What it is | Exposure |
| --- | --- | --- |
| nginx | TLS termination and reverse proxy, **shared with unrelated applications** | Public, 80 → 443 |
| `purrenade-web.service` | The Nuxt/Nitro production server, run from a built artifact | **Loopback only**, `127.0.0.1:4310` |
| Shared session store | Server-side BFF session records, outside every release | Filesystem, owner-only |
| Laravel API | A separate deployment, separate virtual host | Public, its own HTTPS origin |

The frontend is **not a static site.** `nuxt build` produces a Node server —
`.output/server/index.mjs` — and that server is what runs. There is no CDN
origin bucket, no `nuxt generate`, and no build step on the production host.

### Public endpoints

| | |
| --- | --- |
| Frontend | `https://purrenade.ferzendervarli.com` |
| API | `https://api.purrenade.ferzendervarli.com` |

There is deliberately **no `www` hostname**. DNS is managed through Cloudflare
and the Purrenade records are **DNS-only, not proxied** — Cloudflare is a name
server here and nothing more. Nothing in the current traffic architecture
depends on a Cloudflare edge, and no document should describe one.

## 2. The request path

```
Browser
   │  HTTPS
   ▼
nginx (frontend virtual host)          TLS terminates here
   │  HTTP/1.1 to loopback
   ▼
Nitro — purrenade-web.service          127.0.0.1:4310, never public
   │
   ├── server-rendered pages and static assets
   │
   └── the BFF: /api/auth/*, /api/admin/*
          │  HTTPS, server-to-server, with the bearer token
          ▼
       nginx (backend virtual host) → Laravel via PHP 8.4 FPM → PostgreSQL
```

Two properties of that diagram carry the security model, and both are covered
in [§4](#4-the-bff-is-the-authentication-boundary).

## 3. Runtime versions in production

Observed at the first production deployment, 2026-09-15. These are **current
facts, not pins** — the authority for what the repository requires is
`package.json` and `package-lock.json`.

| | Production | Declared in the repository |
| --- | --- | --- |
| Node | 24.21.0, a **dedicated installation** | `engines.node` `^24.11.0`, `.nvmrc` `24` |
| npm | 11.19.0 | not pinned |
| Nuxt | 4.5.2 | `4.5.2` |
| Nitro | 2.13.4 | transitive, `2.13.4` in the lockfile |

**The Node runtime is isolated on purpose.** The host serves unrelated
applications on their own Node versions, and Purrenade must not move theirs.
The systemd unit therefore names an **absolute path** to a Node 24.21.0
installation reserved for Purrenade rather than resolving `node` from `PATH`.
Deploying Purrenade never changes a system Node install, an `nvm` default, or
an alternatives link.

## 4. The BFF is the authentication boundary

The browser never holds a Laravel credential. It holds an **opaque session
cookie**; the Sanctum bearer token lives in the Nitro session record on the
server, and the BFF attaches it to upstream calls.

The full design — cookie names, CSRF, rotation, the token's lifecycle — is
[`../architecture/bff-and-session.md`](../architecture/bff-and-session.md),
which is authoritative. This section covers only what is specific to
**operating** it.

### The session store outlives releases

```
releases/<sha-A> ──┐
releases/<sha-B> ──┼──→  shared/session-store        (one store, all releases)
releases/<sha-C> ──┘

current ─────────→  releases/<active-sha>
```

The store sits in `shared/`, **outside every release directory**. Repointing
`current` from one release to another therefore does not sign anybody out: the
new process opens the same store the old one was using. That is a deliberate
operational property, not an accident of layout, and it is what makes a rollback
survivable for signed-in players.

It holds `apiToken` — a live bearer credential — for every signed-in device, so
it is treated as a secret store: owner-only (`0700`), owned by the deployment
identity, never inside an artifact, never served by nginx, never copied into a
diagnostic or a backup that is not handled as secret-bearing.

### Filesystem sessions are a single-instance decision

The store is filesystem-backed **because production runs exactly one Nitro
instance.** With two, each would have its own store and a player would be
signed in or out depending on which one answered.

So this is correct today and is a **prerequisite to fix before any horizontal
scaling or HA**: move the store to shared infrastructure such as Redis or
Valkey first. Tracked as **OPS-2** in
[`../product/open-decisions.md`](../product/open-decisions.md).

### The driver is chosen at build time, not at runtime

`NUXT_SESSION_DRIVER` and `NUXT_SESSION_FS_BASE` are **build-time Nitro storage
configuration.** `nitro.storage` is not part of `runtimeConfig`, so the driver
is compiled into the server bundle and setting either variable on the production
host does nothing at all.

This is the one piece of production configuration most likely to be got wrong,
because the failure is silent: the operator sets the variable, sees no error,
and the store has not moved. Changing the driver requires a **rebuild** with the
variable present and the driver's package installed.

`PURRENADE_ALLOW_FS_SESSIONS=1` **is** a runtime variable, and a different thing
entirely: the server refuses to start in production on a filesystem store unless
it is set. It is the deliberate, recorded acknowledgement that this deployment's
single-instance filesystem store is intended. See
[operations.md §2](operations.md#2-the-frontend-service).

## 5. Filesystem model

Under the application's own base directory on the deployment host:

| Path | What it holds |
| --- | --- |
| `repository/` | A production clone of this repository. Reference only — see below. |
| `releases/<git-sha>` | One extracted build artifact per release. Effectively immutable. |
| `shared/session-store/` | The persistent BFF session store. Never inside a release. |
| `current` | A symlink to the active release. |

**`repository/` is not where the running code comes from.** Releases are built
on a developer machine, verified, and transferred; the production host runs no
`npm install` and no `npm run build`. Keeping a clone there is convenient for
reading history on the box, and it is exactly that — a deployment target is not
a development workstation.

The initial production release was frontend revision
`3d3909da9b3f44c4c8074c2da742321ffb0a2757`, which is the M7 freeze commit.

## 6. Health and smoke verification

There is no dedicated frontend health endpoint. The frontend is healthy when it
serves its pages and its BFF can reach the API, so verification is a smoke test
rather than a probe — the sequence is in
[operations.md §6](operations.md#6-verifying-a-deployment).

The API's own probe is `GET /api/v1/health`. Laravel's `/up` was removed and is
**not** a Purrenade health endpoint.

## 7. Known deviations and technical debt

Each is a deliberate, recorded position — not an oversight.

| # | Current state | Position |
| --- | --- | --- |
| 1 | Filesystem session store | Correct for one instance; **blocks** multi-instance (OPS-2) |
| 2 | No automatic-on-push production deployment | **OPS-3 is complete:** the controlled frontend and backend deployment paths have been proven end-to-end. Production deployment remains `workflow_dispatch`/operator-controlled; manual deployment stays the fallback. |
| 3 | Reboot-survival not yet verified | Units are enabled; a controlled restart drill is outstanding (OPS-5) |
| 4 | Large client bundle and a large Phaser server chunk | Build warnings, non-blocking; separate performance work |
| 5 | Vue test warnings (`onUnmounted`, no active component) | Pre-existing, non-blocking; separate engineering work |
| 6 | No product analytics or gameplay telemetry | Deliberately undesigned (OPS-4) |

PostgreSQL's version deviation is a backend concern and is recorded in the API
repository's production documentation.

## 8. Future observability and product analytics

Deliberately **not** designed in this milestone, and deliberately kept distinct
from the operational logging in [operations.md §7](operations.md#7-logs-and-troubleshooting).

Three separate concerns, which must not be collapsed into one vendor decision:

1. **Infrastructure and operational observability** — is the service up, is it
   slow, is the queue draining. Exists today as logs and the health endpoint.
2. **Product analytics** — registrations, verified registrations, logins, active
   players, retention, tutorial completion and drop-off, character selection.
3. **Gameplay telemetry** — runs, run duration, score distribution, deaths and
   obstacle interactions, Paw Token collection, Loli and SLAYYY activations,
   client errors and performance.

**Server-authoritative gameplay facts are not client analytics events.** A score
that decides a leaderboard cannot come from the same channel as a UI event; the
anti-cheat trust boundary (ADR-0006) has to be settled before any of this is
built. Privacy, consent, retention, minimization and aggregation must be
designed before implementation, and no vendor is chosen here — explicitly
including not assuming a general web-analytics product could serve as the
gameplay data source. Tracked as **OPS-4**.

## 9. What never goes in this repository

Committing any of these is a security incident, not a mistake to tidy up later.

- Production `.env` files or the contents of the host-side environment file
- `APP_KEY`, database passwords, the SMTP App Password, bearer tokens
- Session store files or their contents, recovery codes, private keys
- Database dumps or any secret-bearing backup
- Host identity, addresses, capacity, firewall or Fail2ban state, SSH details
- Developer-specific absolute local paths

Secrets live on the host, readable by the runtime identity and nobody else. The
repository holds `.env.example` with non-secret examples, and nothing more.

---

| Document | Contents |
| --- | --- |
| [deployment.md](deployment.md) | **★** Building, shipping and activating a release; rollback; CI/CD invariants |
| [operations.md](operations.md) | **★** systemd, nginx, TLS, logs, health, restart checklist |
