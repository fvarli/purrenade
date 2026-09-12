# Local Development

Purrenade runs on dedicated local hostnames behind trusted HTTPS. **No Docker** — every
component runs natively.

## The shape of it

```
  browser
     │  https://purrenade.test          https://api.purrenade.test
     ▼                                            │
  ┌──────────────── native Nginx (TLS terminates here) ────────────────┐
  │   purrenade.test      → http://127.0.0.1:4310   (Nuxt dev server)  │
  │   api.purrenade.test  → http://127.0.0.1:8410   (Laravel dev srv)  │
  └────────────────────────────────────────────────────────────────────┘
```

**Certificates** come from **mkcert**, whose local CA is already trusted by the system store and
by browsers — so `curl` and Chrome accept them with no warning and no `-k`.

**Internal ports bind to `127.0.0.1` only.** Nothing listens on `0.0.0.0`, and port **8000 is
deliberately avoided** — it is a frequent collision and is already occupied on some machines.

## One-time setup

**Hostnames** — both must resolve to loopback:

```
127.0.0.1 purrenade.test
127.0.0.1 api.purrenade.test
```

**Certificates** — generate with mkcert and install where Nginx expects them. If `mkcert -CAROOT`
already contains a `rootCA.pem`, the CA exists; otherwise run `mkcert -install` once.

```bash
mkcert -cert-file purrenade.test.pem     -key-file purrenade.test-key.pem     purrenade.test
mkcert -cert-file api.purrenade.test.pem -key-file api.purrenade.test-key.pem api.purrenade.test
```

Generate them in a private directory, install the certificates readable and the **keys as
`root:root 600`**, then delete the staged copies. **Private keys never enter a repository.**

**Nginx** — one site per host, each redirecting `:80` to `:443` and proxying to the internal
port. The frontend site additionally needs the websocket upgrade headers, or HMR silently dies.
Both sites forward `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`,
`X-Forwarded-Host` and `X-Forwarded-Port`.

## Two ways to run the stack

Pick one. **Never both at once** — they bind the same two ports.

| | **Persistent** *(default)* | **Foreground** |
| --- | --- | --- |
| Start | `bin/install-service` in each repository, once | `npm run dev:stack` |
| Lifetime | Starts with your desktop session, survives closing every terminal | Lives in the terminal you started it in |
| Logs | `journalctl --user -u …` | Straight to the terminal |
| Stop | `systemctl --user stop …` | **Ctrl+C** stops both |
| Good for | Day-to-day work — the URLs just answer | Watching a boot sequence, or debugging the launcher itself |

If the ports are already taken, `npm run dev:stack` says so and **starts nothing** rather than
leaving a half-running stack. Almost always that means the services are up and you did not need
the launcher.

### Persistent: systemd user services

Two **user** services — not system services. They run as you, need no root, and stop when your
session ends. Install each once, from its own repository:

```bash
bin/install-service          # in this repository → purrenade-frontend.service
bin/install-service          # in the API repository → purrenade-api.service
```

Each script resolves its own absolute paths, installs the unit into
`~/.config/systemd/user/`, reloads the manager and enables the service. The tracked templates in
`deploy/systemd/` contain **no machine-specific paths**; the installed units express everything
under your home directory with systemd's `%h` specifier.

```bash
systemctl --user status  purrenade-frontend purrenade-api
systemctl --user restart purrenade-frontend purrenade-api
systemctl --user stop    purrenade-frontend purrenade-api
systemctl --user start   purrenade-frontend purrenade-api

journalctl --user -u purrenade-frontend -f     # follow
journalctl --user -u purrenade-api --since '10 min ago'

bin/install-service --uninstall                # stop, disable, remove
```

Both run the **dev server**, not a production build: HMR and instant reloads, exactly as
`npm run dev` gives you. `Restart=on-failure` brings a crashed server back; a deliberate
`systemctl --user stop` is left alone.

**Lingering is deliberately off.** Without it a user manager starts at login and stops at logout,
which is exactly what is wanted: dev servers have no business running while you are logged out.
Nothing here enables it, and nothing needs it. (`loginctl enable-linger $USER` would, if you ever
had a reason.)

### Foreground: the launcher

```bash
npm run dev:stack     # starts BOTH dev servers
```

**Ctrl+C stops both.** Nothing is left holding a port.

One-time setup: the API lives in a separate repository, so the launcher has to be told where it
is. Put the path in the git-ignored `.env`:

```
PURRENADE_API_DIR=/path/to/purrenade-api
```

See `.env.example`. It is deliberately not hardcoded anywhere tracked — **no file in this
repository names a path inside the other one** (ADR-0001).

If `PURRENADE_API_DIR` is missing, points somewhere that does not exist, points at something that
is not the API, or either port is already busy, the launcher says so and **starts nothing**.

## What is always running, and what is not

| Component | Lifetime |
| --- | --- |
| **Nginx** | **Always running.** A persistent system service. You never start or stop it per session. |
| **PostgreSQL** | **Always running.** Also a system service. |
| **Nuxt dev server** | Your session (persistent mode) or your terminal (foreground mode). |
| **Laravel dev server** | Same. |

Neither the launcher nor the user services touch Nginx or PostgreSQL. Those are system services
and none of their business.

**A 502 from either URL means the upstream for that host is not running.** That is the expected
response, not a broken configuration: Nginx is up and answering, but has nothing to proxy to.
Start the stack and it becomes 200.

### Running just one side

| | Command | Result |
| --- | --- | --- |
| Frontend only | `npm run dev` | `https://purrenade.test` |
| Backend only | `composer run serve` *(in the API repo)* | `https://api.purrenade.test` |

Neither command takes a port argument — the ports live in configuration:

- **Nuxt** reads `devServer` in `nuxt.config.ts`.
- **Laravel** reads `SERVER_HOST` / `SERVER_PORT` from `.env`, which is why `artisan dev` binds
  correctly too and not to its default 8000.

Neither has the launcher's port check, so stop the corresponding service first.

## Verifying

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://purrenade.test           # 200, no -k needed
curl -s https://api.purrenade.test/                                        # API-only signpost
curl -s https://api.purrenade.test/api/v1/health                           # readiness
```

The API answers its web root with a JSON signpost rather than a 404, and `/api/v1/health`
reports whether it can actually reach PostgreSQL — **503 when it cannot**. Both are documented in
the API repository's `local-development.md` and in its OpenAPI contract.

## Two things that will bite you otherwise

**Node does not trust the system CA store by default.** It ships its own bundle, so a
server-side `fetch()` from Nitro to `https://api.purrenade.test` fails with *"unable to verify
the first certificate"*. The `dev` script therefore runs with `NODE_OPTIONS=--use-system-ca`.
This matters from M2 onward, when the BFF starts calling the API server-side.

**Vite blocks unrecognised `Host` headers** as DNS-rebinding protection. `purrenade.test` is
allowlisted explicitly in `nuxt.config.ts` rather than the check being disabled.

## HMR through the proxy

The Vite HMR client connects to the page origin, so behind TLS termination it must be told to use
`wss` on 443 rather than plain `ws` on the internal port. That is configured in `nuxt.config.ts`.

The trade-off: browsing `http://127.0.0.1:4310` **directly** then has no HMR, because the client
still dials `wss://purrenade.test`. Use the `.test` domain. If you genuinely need the direct
port, override `NUXT_HMR_PROTOCOL=ws`, `NUXT_HMR_HOST=127.0.0.1`, `NUXT_HMR_PORT=4310`.

## Overridable environment

| Variable | Default |
| --- | --- |
| `NUXT_DEV_HOST` / `NUXT_DEV_PORT` | `127.0.0.1` / `4310` |
| `NUXT_HMR_PROTOCOL` / `NUXT_HMR_HOST` / `NUXT_HMR_PORT` | `wss` / `purrenade.test` / `443` |
| `NUXT_ALLOWED_HOSTS` | `purrenade.test` |
| `NUXT_API_BASE` | `https://api.purrenade.test` |

## The API origin is server-side only

`NUXT_API_BASE` populates **private** runtime config, which only Nitro reads. Per
[ADR-0005](../decisions/ADR-0005-authentication-and-2fa-strategy.md) the browser talks to
`https://purrenade.test` and nothing else; Nitro, acting as the BFF, is what talks to the API.
Moving this into `runtimeConfig.public` would expose the API origin to the browser and quietly
invert that decision.

## Production is unaffected

Everything here is local development only. `.test` is not a public TLD, mkcert certificates are
trusted only on this machine, and no deployment assumption is implied by any of it.
