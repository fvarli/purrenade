# The BFF, Sessions and CSRF

How the browser half of authentication works, as implemented at **M2**.

**Status legend:** APPROVED / **IMPLEMENTED** / PROPOSED / OPEN.

This repository owns the browser boundary. The API's side of the same design is
in `purrenade-api/docs/architecture/auth-architecture.md`, and the decision both
implement is
[ADR-0005](../decisions/ADR-0005-authentication-and-2fa-strategy.md).

---

## 1. What the browser holds — IMPLEMENTED

Exactly two cookies, and nothing else.

| Cookie | Attributes | Contents |
| --- | --- | --- |
| `__Host-purrenade_session` | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` | An opaque 256-bit identifier. Nothing else. |
| `__Host-purrenade_csrf` | `Secure`, `SameSite=Lax`, `Path=/` — **readable** | The synchroniser CSRF token. |

**No bearer token. Not in `localStorage`, not in `sessionStorage`, not in a
variable.** That is the whole point of the design: a token the browser can read
is a token a single script-injection defect can exfiltrate, and an exfiltrated
bearer token is complete, portable account takeover. A CI gate greps the built
client bundle for one.

The CSRF cookie is readable **by design** — the client must send it back in a
header, and a header is the one thing a cross-site form cannot set. It is not a
credential: without the session cookie it grants nothing.

### Why `__Host-`

The prefix is enforced by the browser itself: it *requires* `Secure`, *requires*
`Path=/`, and *forbids* `Domain`. So no subdomain — including one an attacker
manages to control — can overwrite these cookies. ADR-0005 §3 asks for a
host-prefixed cookie; this makes it a browser guarantee rather than a convention.

The cost: the cookies are not set over plain HTTP. Browse `https://purrenade.test`
locally, not `http://127.0.0.1:4310`.

### Why `SameSite=Lax` and not `Strict`

`Strict` would break the return-from-email flows the product depends on. Clicking
a password-reset link is a cross-site navigation, and under `Strict` the session
cookie is not sent — so the player would arrive logged out on a page that needs
their session. `Lax` still blocks cross-site POSTs, and the CSRF token is the
actual control either way.

---

## 2. Where the real session lives — IMPLEMENTED

In **Nitro storage**, server-side. The cookie is a pointer.

```ts
interface SessionRecord {
  apiToken?: string          // the upstream Sanctum token — never leaves this process
  userId?: number
  csrfToken: string
  createdAt: number
  lastSeenAt: number
  pendingTwoFactor?: { challengeToken, expiresAt, recoveryCodesAvailable }
}
```

### The session during a server render — IMPLEMENTED

Nuxt renders every route but `/run` on the server, and that render resolves the session the
same way the browser does. Four facts make it work, and the absence of this section is why
they were once written down backwards in a code comment:

- **The cookie is there.** `SameSite=Lax` means the browser sends it on a top-level
  navigation, which is exactly what a page render is.
- **The record is here.** It lives in this process's `sessions` mount, so `readSession` is a
  local lookup, not a call to anywhere.
- **The internal call is not a request.** On the server `$fetch` is Nitro's in-process
  fetcher: a path beginning `/` is dispatched straight to the handler, with no socket and no
  TLS. The render asks `GET /api/auth/me` exactly as the browser would, and gets the same
  credential-free projection.
- **There is no ambient credential to pick up by mistake.** Nitro keeps no cookie jar. The
  only cookie in play is the one on the event being rendered, and it is forwarded explicitly
  — just the `Cookie` header, nothing else.

Three rules follow, and they are enforced by tests rather than by convention:

1. **`unknown` is not `guest`.** A render that cannot reach the BFF leaves the status
   `unknown` and says so once, with the reason. It never concludes that the visitor is signed
   out, because the browser is the only party that gets to re-ask.
2. **A render never changes anything.** State-changing BFF requests are refused during SSR.
   That is also what keeps the CSRF cache client-only: the only path that populates it is
   unreachable on the server.
3. **The wait is bounded.** 2.5 s, not `apiTimeoutMs` — this is time-to-first-byte, so a slow
   API degrades the page's auth state rather than the page.

Because the store is resolved during the render, it is **serialised into `__NUXT_DATA__`** —
visible in view-source and in the browser's cache. That does not change what may be held in
it; it raises the cost of getting it wrong. An E2E case and a CI gate both assert that no
Sanctum token, session pointer, recovery code, TOTP secret or CSRF secret appears in
server-rendered HTML. See [ADR-0009](../decisions/ADR-0009-server-rendered-session-awareness.md).

### Why not h3's `useSession`

h3's built-in session is a **sealed cookie**: the payload is encrypted and sent
to the browser. That would put the API token in the browser — encrypted, but
there — which ADR-0005 §1 forbids in as many words ("the API credential never
reaches the browser") and §3 rules out again ("the session is a server-side
record, the cookie only a reference").

It also cannot be revoked. The holder keeps a usable credential until it expires,
whatever the server decides. With a storage record, deleting the record ends the
session immediately.

### The store is a deployment choice

| Environment | Driver | Why |
| --- | --- | --- |
| Development | `fs`, under `.data/sessions` | Nothing extra to run, no Docker, and it survives a dev-server restart — which a memory driver would not. |
| Production | **OPEN (OPS-1)** | Needs a store shared across instances, so any instance can resolve any session. A **rebuild**, not a configuration change — see below. |

`.data/` is git-ignored: it holds live session records, which contain
credentials.

#### The driver is a build-time choice — APPROVED

An earlier version of this section said changing the store was "a configuration
change here, not a code change anywhere". That was **wrong**, and wrong in the
dangerous direction.

`nitro.storage` is not part of `runtimeConfig`. The driver named in
`nuxt.config.ts` is compiled into the server bundle — the built output contains
a literal `mount('sessions', fs({ base: '.data/sessions' }))`, and the string
`NUXT_SESSION_DRIVER` does not appear in it at all. Setting that variable in a
production environment therefore does **nothing**. The process keeps writing to
the local disk while the operator believes the store has moved.

What is on that disk is the point: each record holds `apiToken`, the raw Sanctum
bearer token for a signed-in device, as plaintext JSON, in a file **named after
the session cookie value**. Listing the directory yields cookies; reading it
yields credentials.

So changing the store needs a rebuild with the variable set and the driver's
package installed, and `server/plugins/session-store-guard.ts` refuses to start
a production process whose **resolved** sessions mount is filesystem-backed. It
inspects the mount rather than the environment variable, because the variable is
what lied. `PURRENADE_ALLOW_FS_SESSIONS=1` is the deliberate opt-out for a
single-instance deployment.

The same guard creates the store directory `0700` and rewrites its records
`0600` at startup. Unstorage writes at whatever the process umask allows — 0644
on a typical machine — which left live bearer tokens readable by every other
local account.

---

## 3. Two timeouts — IMPLEMENTED

| Timeout | Default | Enforced |
| --- | --- | --- |
| **Idle** | 7 days | Here. The BFF is the layer that observes browser activity, and idle expiry is what matters for a shared or stolen device. |
| **Absolute** | 30 days | Here **and** upstream (`sanctum.expiration`), so a session cannot outlive its credential even if this layer is bypassed. |

The idle clock is refreshed at most once a minute: writing the record on every
request turns a page of parallel calls into a burst of storage writes for a value
that needs minute-level resolution.

Both are environment-driven. Nothing about `.test` or these defaults is a
production policy.

---

## 4. Rotation, and why it cannot be forgotten — IMPLEMENTED

**Every privilege change mints a new session identifier**: login, a passed
two-factor challenge, a password change.

This is the session-fixation defence — an attacker who plants a known session id
in a victim's browser must not end up holding the victim's authenticated session.
It is guaranteed structurally rather than by discipline: `startSession()` always
generates a new identifier, and it is the only function that can write a
credential into a session. There is no code path that upgrades one in place.

(`touchSession()` also writes, but only `lastSeenAt`, and only to a record that
already exists — it cannot introduce a token or change whose session it is. An
earlier version of this paragraph said `startSession()` was the only writer at
all, which was not true; the property that matters is the narrower one.)

A fresh CSRF token is minted with it. Carrying one across a privilege change
would let a token issued to an anonymous visitor act on an authenticated session.

---

## 5. CSRF — IMPLEMENTED (resolves ADR-0005 q3)

**Synchroniser token.** The expected value lives in the server-side session; the
client sends it in an `X-CSRF-Token` header.

Double-submit was the alternative: compare a header against a cookie and trust
that only our own page could have set the cookie. That trust fails if any
subdomain can write cookies for the parent domain. Having a real session store
makes the stronger pattern free, so there is no reason to accept the weaker one.

The **header** is load-bearing. A cross-site form, image or navigation can make
the browser send cookies; none of them can set a custom header.

Three layers, checked in this order so a request is refused as cheaply as
possible:

1. **Origin.** `Origin`, falling back to `Referer`'s origin, must appear in
   `NUXT_TRUSTED_ORIGINS`. Defence in depth — the browser sets it and page
   script cannot forge it, but it is absent on some legitimate requests, so it is
   tolerated for safe methods and required for unsafe ones.
2. **CSRF token**, compared in constant time. `===` on a secret leaks its prefix
   through timing.
3. **Session**, loaded only once the first two pass.

**Why CSRF matters here and not upstream:** cookies are attached by the browser
automatically, so cookie authentication is inherently CSRF-exposed. The BFF hop
does not remove that — it *relocates* it. The Laravel hop is not exposed, because
the BFF is not a browser and attaches its credential explicitly.

### A session before authentication

`GET /api/auth/csrf` starts a session for a visitor who has none. That is not a
contradiction: login and register are themselves state-changing, so they need a
token, so they need somewhere server-side to compare it against. That
pre-authentication session carries only the token and is replaced — with a new
identifier — the moment a real one is issued.

The client refreshes a stale token **once** on a `419` and retries. The session
rotates on every privilege change, so a token cached across a login is stale by
design; a second failure is surfaced rather than retried, because that would be a
loop.

---

## 6. The upstream client — IMPLEMENTED

Everything the BFF sends to the API goes through `server/utils/upstream.ts`, and
that is what makes the following true by construction rather than by review.

**It is not an open proxy.** The caller names an endpoint from a closed table; it
never supplies a path, a host or a method. There is deliberately no
`/api/proxy/[...path]` route, because that route is an SSRF primitive: whoever
can name the path can reach the API's administrative surface, a cloud metadata
endpoint, or any host the server can resolve.

The one endpoint with a variable segment — revoking a session — builds its path
through `sessionRevokePath()`, which refuses anything that is not a UUID. An
unvalidated segment escapes the closed set: `../..` addresses a different
endpoint entirely.

**Only intended headers cross.** Every header is constructed by name. A blanket
forward would carry the browser's `Cookie`, `Origin`, `Authorization` and
`X-Forwarded-*` upstream, where the API would treat some of them as trustworthy.

Three browser-supplied values do cross, each for a stated reason and each
length-capped and character-filtered — because all three reach a log line on the
other side:

| Header | Why |
| --- | --- |
| `Accept-Language` | So the API localises its messages and sends mail in the player's language. |
| `User-Agent` | So the API can derive the session's device label. Without it the API sees *this process's* agent and every session reads "Unknown device", which defeats the one thing the device list is for. The raw value is not stored anywhere; the API keeps only a coarse label. |
| `X-Correlation-Id` | So one id spans browser, BFF and API. Accepted only if it matches a strict shape — it is echoed in headers and written to logs, so arbitrary bytes would permit header injection and log forging. |

**Nothing is unbounded.** Every call has a timeout (10s by default). Without one,
an API that accepts connections and never answers exhausts this process's sockets
and takes the frontend down with it.

**Upstream detail does not leak.** A response is matched against the problem
contract and reduced to an **allow-list** of members. An allow-list, not a
deny-list: forgetting to exclude a new field would disclose it, whereas
forgetting to include one is merely visible. A gateway's HTML error page or a
stack trace never reaches a browser as though it were an API error.

**Request bodies are not forwarded wholesale.** Each route names the fields it
means to send, so a caller cannot smuggle `role` or `email_verified_at` into an
upstream payload by adding it to the JSON. The API guards its own columns too;
this is the second lock on the same door.

---

## 7. What the browser is never told — IMPLEMENTED

| Kept server-side | Why it matters |
| --- | --- |
| The upstream Sanctum token | The entire reason for the BFF. |
| The two-factor **challenge token** | A challenge token in a page is one XSS defect away from undoing the second factor: it proves the first factor is already satisfied. The browser learns only *that* a code is owed, when the window closes, and whether a recovery code is an option. |
| The API origin | Private runtime config. Moving it to `runtimeConfig.public` would expose it and quietly invert ADR-0005. |
| Trusted origins, timeouts, the session driver | Private runtime config. |

Recovery codes *are* sent to the browser — once, when generated — because the
player has to be able to save them. They are never stored by the BFF, never
logged, and there is no endpoint that can show them again.

---

## 8. The BFF is not an authorization authority — IMPLEMENTED

No BFF route makes a role check. `GET /api/admin/overview` forwards and relays;
Laravel refuses it with a distinct code for each of the four possible reasons.

That is not an oversight. Authorization has exactly one implementation, and it is
the API's. A role check here would be a second place for the rule to be wrong,
and the two would eventually disagree.

The same applies to the client-side route guards in `app/middleware/`: they
choose a *destination*, so an unverified player lands on verification rather than
on a denial. Remove them and nothing is exposed —
`docs/product/screen-inventory.md` §3 is explicit that no screen's presence or
absence is a security control.

---

## 9. Error handling — IMPLEMENTED

Every BFF route is wrapped by `defineBffHandler`, which guarantees three things
once rather than per route:

1. **Every failure is RFC 9457**, with the right status and
   `application/problem+json`, so the browser sees one error shape from the whole
   surface.
2. **An unexpected throw does not leak.** Anything that is not a recognised
   problem becomes a bare 500 whose detail comes from us. A raw Nitro error page
   carries a stack trace and file paths, and in development the source of the
   file that threw.
3. **Failures are logged server-side.** The problem the browser receives is
   deliberately thin; the reason has to be somewhere, and that somewhere is the
   process log — the journal, under the systemd user service.

Problems the BFF originates are namespaced `bff_`, so it is always obvious which
layer refused. The one exception is `unauthenticated`: an unauthenticated BFF
request and an unauthenticated API request are the same condition to a client,
and two codes would make every caller handle both.

---

## 10. Browser state — IMPLEMENTED

`app/stores/auth.ts` holds a **projection** of who the session belongs to. Six
states, and each one has exactly one screen:

| State | Meaning |
| --- | --- |
| `unknown` | Nobody has answered yet — either before the first `/api/auth/me`, or because the server render could not reach the BFF. Distinct from `guest`, which is a *conclusion*: rendering a login screen to somebody who turns out to be signed in is a visible flash on every page load, and concluding `guest` on the server would make it permanent, because the client only asks again from `unknown`. |
| `guest` | No session. |
| `two_factor_required` | Password accepted, code owed. **Not authenticated** — no credential exists yet. |
| `unverified` | Signed in, address unconfirmed. |
| `admin_two_factor_setup_required` | An administrator who has not enrolled. A real, reachable state: an operator can promote a player who has no second factor. |
| `authenticated` | Fully signed in. |

**The status is derived, never received.** The server sends *facts* — is the
address verified, is 2FA enabled, did this session pass a challenge — and the
store computes the state from them. A state name sent by the server would be one
the client had to trust.

Nothing is persisted to web storage, and no persistence plugin is installed. A
test watches the storage APIs during a full bootstrap-and-reset cycle and asserts
no write occurs; CI greps `app/` and the built bundle for one too.

`GET /api/auth/me` answers `guest` rather than `401` when there is no session: a
refresh on a public page is not an error, and a 401 there would make every first
paint log an authentication failure.

---

## 11. Configuration

All private. None of it reaches the browser.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NUXT_API_BASE` | `https://api.purrenade.test` | Upstream origin |
| `NUXT_API_TIMEOUT_MS` | `10000` | Upstream timeout |
| `NUXT_TRUSTED_ORIGINS` | `https://purrenade.test` | Comma-separated origin allow-list |
| `NUXT_SESSION_COOKIE` | `__Host-purrenade_session` | |
| `NUXT_CSRF_COOKIE` | `__Host-purrenade_csrf` | |
| `NUXT_SESSION_IDLE_MINUTES` | `10080` (7 days) | |
| `NUXT_SESSION_ABSOLUTE_MINUTES` | `43200` (30 days) | |
| `NUXT_SESSION_DRIVER` | `fs` | unstorage driver. **Build-time**: read when the server is built, ignored at runtime. |
| `NUXT_SESSION_FS_BASE` | `.data/sessions` | **Build-time**, as above. |
| `PURRENADE_ALLOW_FS_SESSIONS` | unset | Runtime. `1` permits a production boot on the filesystem store. |

---

## 12. Threat assumptions for M2

What this design defends against, and what it does not.

**Defended:**

| Threat | Control |
| --- | --- |
| XSS exfiltrating a portable credential | No token in the browser. An XSS defect can act *as* the session while the page is open; it cannot export a credential to use later, elsewhere. |
| Cross-site request forgery | Synchroniser token in a header, plus an origin check, plus `SameSite=Lax`. |
| Session fixation | A new identifier on every privilege change, guaranteed by having one writer. |
| Cookie overwrite from a subdomain | `__Host-` prefix, enforced by the browser. |
| SSRF through the BFF | A closed endpoint table; the one variable segment is UUID-validated. |
| Credential stuffing | Two-dimensional rate limits and optional 2FA upstream. |
| Account enumeration | Identical responses from login and forgot-password; a hash comparison even for an unknown address. |
| Upstream detail disclosure | Allow-listed problem members; a non-problem body is replaced. |
| Stolen session | Idle and absolute timeouts; real revocation from the device list. |

**Not defended, and knowingly so:**

| Threat | Why not, and what would change it |
| --- | --- |
| XSS acting as the session in-page | A token-free design bounds the damage; it does not eliminate it. The answer is not storing credentials differently but not having XSS — CSP is a PWA/hardening task (**OPEN**). |
| A compromised BFF host | The BFF holds every live session token. It is inside the security boundary and must be operated as such — ADR-0005's stated cost, recorded in `SECURITY.md`. |
| Mailbox compromise | Grants password reset by design. It does **not** grant 2FA, which is exactly why the reset-never-touches-2FA invariant exists. |
| Losing both factors | **OPEN (2FA-3).** Support-mediated recovery is itself an attack path and must be designed deliberately. |
| Malicious admin | Out of scope for v1. The audit log (M13) is the mitigation. |

---

## 13. Open questions

| Ref | Question |
| --- | --- |
| OPS-1 | Production session store, and operating the BFF as a security-relevant stateful component |
| — | Content Security Policy. Would bound in-page XSS; belongs with PWA and hardening work. |
| — | Generating client types from the OpenAPI document. `api-client.md` §1 requires it; `server/utils/contracts.ts` is hand-written until then, and is checked against the contract by hand whenever either changes. |
