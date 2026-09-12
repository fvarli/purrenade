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

## Authentication, locally

The full flow works end to end on the local stack. The one thing that is not
"real" is mail delivery: the API writes it to a log instead of sending it, so
verification codes and reset links are read from there.

### Reading a verification code or reset link

```bash
# In the API repository.
tail -200 storage/logs/laravel.log | tr -d '\r' | grep -aoE '^[0-9]{6}$' | tail -1
```

The API repository's `local-development.md` has the reset-link variant and
explains the `tr -d '\r'` — a MIME message uses CRLF, so an anchored `$` will
not match.

### Session state on disk

The BFF keeps its sessions in `.data/sessions/`, which is git-ignored because
those records contain the upstream API token. Deleting the directory signs
everyone out; it is the quickest way to get back to a clean state.

```bash
rm -rf .data/sessions            # every local session ends immediately
```

Each record is plaintext JSON holding `apiToken`, in a file **named after the
session cookie value** — so a directory listing yields cookies and reading it
yields credentials. `server/plugins/session-store-guard.ts` therefore creates the
directory `0700` and rewrites its records `0600` at every boot; unstorage
otherwise writes at whatever the process umask allows, which on a typical machine
left live bearer tokens readable by every other account on the machine.

The same plugin **refuses to start** a production process whose resolved session
store is filesystem-backed. That is not a development concern, but the reason it
exists is: `NUXT_SESSION_DRIVER` is read when the server is *built*, not when it
runs, so setting it in a production environment does nothing at all and the
failure would be silent. `PURRENADE_ALLOW_FS_SESSIONS=1` is the deliberate
opt-out for a single-instance deployment.

Expired records are swept hourly, and once at startup. Nothing else collects
them: a session is otherwise only ever cleaned up when the identifier naming it
is presented again, and `GET /api/auth/csrf` creates one for any visitor who
arrives without a cookie.

### Cookies you should see

Two, and only two, both `__Host-` prefixed:

| Cookie | Attributes |
| --- | --- |
| `__Host-purrenade_session` | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` |
| `__Host-purrenade_csrf` | `Secure`, `SameSite=Lax`, `Path=/` — readable, by design |

**No bearer token, anywhere.** Not in a cookie, not in `localStorage`, not in
`sessionStorage`. If you find one, that is a bug in the BFF, not a configuration
difference.

> The `__Host-` prefix requires `Secure`, so **the cookies are not set over
> plain HTTP**. Browse `https://purrenade.test`, not `http://127.0.0.1:4310` —
> on the direct port you will appear permanently signed out.

### Rate limits will refuse you

They are deliberately tight: five login attempts a minute per account, five
verification resends an hour. A scripted flow trips them almost immediately,
which is the limiter working. Clear the buckets rather than loosening the limits:

```bash
# In the API repository.
php artisan cache:clear
```

### Two-factor codes from the command line

```bash
# In the API repository, with the secret from the enrolment response.
php -r "require 'vendor/autoload.php'; \$a=require 'bootstrap/app.php';
  \$a->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
  echo app(PragmaRX\Google2FA\Google2FA::class)->getCurrentOtp('YOURSECRET').PHP_EOL;"
```

**Wait for a fresh 30-second step between uses.** A code from a step already
accepted is refused — replay rejection is per account and durable, so reusing one
looks like a failure and is not.

## Testing

```bash
npm test          # unit (node) + component (happy-dom)
npm run test:e2e  # responsive and accessibility, against the RUNNING local stack
```

`npm run test:e2e` is **not** a CI gate and not part of `npm test`. It drives a
real browser against `https://purrenade.test`, which needs Nginx, the local
certificate and the `.test` hostname — none of which CI has. It uses the system
Chrome rather than a bundled Chromium, so it adds no browser download to the
toolchain.

It covers the standing responsive requirement at **360×640, 360×800 and
desktop**: the primary action stays reachable and inside the viewport, nothing
scrolls horizontally, every input has a bound label, the form is keyboard
navigable to submit, focus is visible, and reduced motion collapses the motion
tokens.

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
