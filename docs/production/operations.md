# Frontend operations

Running the release that is already deployed: services, nginx, TLS, logs,
verification. Shipping a new one is [deployment.md](deployment.md).

Host-specific values appear as `<placeholder>`. Read the real value from the
server — this is a public repository and it does not carry the machine's
identity, addresses or capacity.

---

## 1. The host is shared

The production machine serves **unrelated applications**. Every rule below
follows from that one fact:

- Purrenade owns its own nginx virtual hosts, its own systemd units, its own
  runtime installations and its own directories. It touches nothing else.
- **Never change a global default to suit Purrenade** — not the system PHP
  alternative, not the system Node, not a shared nginx default server.
- `nginx`, PostgreSQL and PHP-FPM are persistent system services. Purrenade
  reloads what it must and never assumes it may stop them.

The isolation is real and deliberate: the host's generic PHP stays on the 8.3
family for other applications while Purrenade's API runs on **PHP 8.4**, and
Purrenade's Node 24.21.0 is a dedicated installation referenced by absolute
path. Both are described from the API side in
[`purrenade-api/docs/production/`](https://github.com/fvarli/purrenade-api/tree/main/docs/production).

## 2. The frontend service

`purrenade-web.service` — a **system** unit, enabled, running the built Nitro
server.

| | |
| --- | --- |
| Identity | a dedicated unprivileged deployment account, `<deployment-user>` |
| Working directory | the `current` symlink, so a release switch is a restart away |
| Command | the dedicated Node 24 binary, by absolute path, running `.output/server/index.mjs` |
| Binding | `127.0.0.1:4310` — loopback only, never Internet-facing |
| Environment | a protected host-side env file, outside Git, root-owned and group-readable by the runtime identity |

```bash
sudo systemctl status  purrenade-web.service
sudo systemctl restart purrenade-web.service
sudo systemctl enable  purrenade-web.service   # survives reboot
```

### Runtime environment

The env file holds no secrets today, but it is protected as though it does —
it is the file an attacker would read to learn the deployment's shape, and the
place a secret would first be added. Non-secret values it carries:

```ini
NODE_ENV=production
NITRO_HOST=127.0.0.1
NITRO_PORT=4310
PURRENADE_ALLOW_FS_SESSIONS=1
NUXT_API_BASE=https://api.purrenade.ferzendervarli.com
NUXT_API_TIMEOUT_MS=10000
NUXT_TRUSTED_ORIGINS=https://purrenade.ferzendervarli.com
```

`PURRENADE_ALLOW_FS_SESSIONS=1` is required. Without it the server **refuses to
start** in production on a filesystem session store — it exits rather than
warning, because the failure it guards against is silent by nature: everything
works and the bearer tokens are simply readable. Setting it is the operator's
explicit, recorded statement that this single-instance store is intended.

`NUXT_SESSION_DRIVER` and `NUXT_SESSION_FS_BASE` are **absent from this file on
purpose.** They are build-time values; putting them here would suggest they do
something. They do not. See [README.md §4](README.md#the-driver-is-chosen-at-build-time-not-at-runtime).

## 3. The session store

Lives in `shared/session-store/`, outside every release, owned by the
deployment identity, mode `0700`.

```bash
ls -ld <app-base>/shared/session-store     # expect drwx------, deployment identity
```

The application enforces this itself at boot: it creates the directory `0700`,
narrows its umask, and tightens existing records to `0600`. If the mode is ever
found wider than `0700`, treat it as an incident — every file in there is a
live bearer credential named after a session cookie.

**Never** back it up alongside ordinary files, copy it into a diagnostic, serve
it through nginx, or include it in an artifact. If a session store must be moved
or inspected, handle it as a secret store.

## 4. nginx

Purrenade has two dedicated virtual hosts on the shared nginx. nginx terminates
TLS; everything behind it is plain HTTP on loopback.

| | Frontend | Backend |
| --- | --- | --- |
| `server_name` | `purrenade.ferzendervarli.com` | `api.purrenade.ferzendervarli.com` |
| Upstream | `http://127.0.0.1:4310` (Nitro) | PHP 8.4 FPM, Laravel `public/` |
| Logs | dedicated Purrenade access and error logs | dedicated Purrenade access and error logs |

The frontend proxy contract — the headers Nitro relies on to know the request
was HTTPS and where it came from:

```nginx
proxy_http_version 1.1;
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

`X-Forwarded-Proto` is the one that matters most: without it the application
believes the request arrived over plain HTTP and generates `http://` URLs for a
browser that is on HTTPS.

Validate before reloading, always — a bad config takes down every application on
the host, not just Purrenade:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 5. TLS

Certificates are managed by **Certbot / Let's Encrypt** and integrated with the
Purrenade nginx virtual hosts. Separate certificates cover the frontend and the
API hostname. HTTP redirects to HTTPS with a 301. Automatic renewal scheduling
is enabled.

```bash
sudo certbot certificates          # current paths, names and expiry
sudo systemctl list-timers | grep -i certbot
```

Read the current paths and expiry from `certbot certificates` rather than from
any document. Serial numbers and expiry dates change at every renewal, so a
document that hardcodes them is wrong within ninety days; certificate file paths
are host-specific and deliberately not published here.

## 6. Verifying a deployment

The verified production lifecycle, end to end, is the baseline. It was proven
manually at the first deployment and it exercises every component in the chain:

1. The homepage loads over valid HTTPS.
2. A new player registers.
3. The verification email **arrives** — this proves Laravel → database queue →
   the PHP 8.4 worker → SMTP → a real mailbox.
4. The verification code is accepted.
5. Authenticated access works.
6. Log out.
7. Log in again, and authenticated access is restored.

Shorter checks, in increasing order of coverage:

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4310/     # Nitro itself
curl -fsS -o /dev/null -w '%{http_code}\n' https://purrenade.ferzendervarli.com/
curl -fsS https://api.purrenade.ferzendervarli.com/api/v1/health      # API + PostgreSQL
```

A **200 from loopback but a failure through HTTPS** points at nginx or TLS. A
failure at loopback points at the service. The API health endpoint is
`GET /api/v1/health`; Laravel's `/up` was removed and is not a Purrenade health
endpoint.

## 7. Logs and troubleshooting

```bash
sudo journalctl -u purrenade-web.service -f
sudo journalctl -u purrenade-web.service --since '10 min ago'
```

Plus the dedicated Purrenade nginx access and error logs for the frontend
virtual host. Backend, queue and mail logs are documented on the API side.

| Symptom | Look first at |
| --- | --- |
| 502 from the public URL | The service is down — `systemctl status`, then the journal |
| Service exits immediately at boot | The session-store refusal: is `PURRENADE_ALLOW_FS_SESSIONS=1` set? |
| Everyone signed out after a release | Did the session store move, or did `NUXT_SESSION_FS_BASE` change at build time? |
| Pages load, sign-in fails | The BFF cannot reach the API — check `NUXT_API_BASE` and the API's own health |
| Redirects to `http://` | `X-Forwarded-Proto` missing from the proxy configuration |

**Never log or paste** authentication tokens, passwords, verification codes,
recovery codes, session contents or personal data. Application logging is built
to avoid them, and a diagnostic paste is the usual way that protection gets
bypassed.

## 8. Restart and reboot checklist

Both Purrenade units are **enabled**, so they are expected to return by
themselves after a reboot. That expectation has **not yet been verified by a
controlled restart** — the host reported a pending restart at the initial
deployment and none was performed. Until the drill is done, treat reboot
survival as expected rather than proven. Tracked as **OPS-5**.

When the drill is run, or after any unplanned restart:

```bash
systemctl is-enabled purrenade-web.service purrenade-queue.service
systemctl is-active  purrenade-web.service purrenade-queue.service
sudo nginx -t
```

1. Both units enabled and active.
2. nginx serving both virtual hosts; TLS valid.
3. Session store still `0700` and owned by the deployment identity.
4. `GET /api/v1/health` returns 200.
5. The full lifecycle in [§6](#6-verifying-a-deployment), including a real
   verification email.
6. A previously signed-in browser session still works — or, if the store was
   cleared, that this was expected.

Because the host is small and shared, watch resource pressure after a restart;
several applications starting at once is the moment contention shows.
