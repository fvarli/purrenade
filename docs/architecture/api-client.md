# API Client

How the frontend talks to `purrenade-api`.

**Status legend:** APPROVED / PROPOSED / OPEN.

---

## 0. Implementation status — M2

The **authentication** half of this document is implemented. The transport lives
behind one module as §2 requires:

| Concern | Where |
| --- | --- |
| The browser's only HTTP door | `app/composables/useBffClient.ts` |
| Error normalisation to a stable `code` | `app/composables/useApiProblem.ts` |
| BFF routes, session, CSRF, upstream client | `server/` — see [bff-and-session.md](bff-and-session.md) |

### Since M9

Both items that were outstanding after M2 are implemented.

- **Generated types** — §1A. `server/utils/contracts.ts` aliases the generated contract for
  every shape M9 introduced or touched; the remaining auth envelopes move when they are next
  changed.
- **The run lifecycle, its retries and its idempotency key** — §6, "As implemented".

| Concern | Where |
| --- | --- |
| Contract snapshot and provenance | `contracts/openapi/purrenade-api.openapi.yaml`, `contracts/openapi/SOURCE.json` |
| Generated types | `shared/contracts/api.generated.ts` (never edited by hand) |
| Run start, finish, pending, progression — BFF | `server/api/game-runs/**`, `server/api/progression/index.get.ts` |
| The pending finish (stable retry payload + key) | `server/utils/run-finish.ts`, stored beside the session record (`server/utils/session.ts`) |
| The browser's run lifecycle | `app/stores/run-session.ts` |

---

## 1. Contract-first — APPROVED

The API contract is authored in the backend repository
(`docs/api/openapi.draft.yaml`) and is the single source of truth for request and
response shapes.

- Client types are **generated from the contract**, never hand-written.
- A contract change that breaks the client surfaces as a **type error at build
  time**, not as a runtime failure in production.
- **A contract change updates both repositories.** The backend's
  `docs/api/contract-change-process.md` defines the procedure.

---

## 1A. Contract generation is M9 foundation work — APPROVED

§1 has required generated types since M0, and the repository has been carrying hand-written
ones since M2. M9 introduces roughly five substantial new schemas at once — the run start and
finish contracts, the run result, and progression — and duplicating those by hand is how the
two repositories drift on the most security-sensitive surface in the product.

**So the generation path is established before or as part of introducing those schemas.** This
is engineering foundation work inside M9, **not a separate product milestone**.

### What the path must satisfy

| Requirement | Why |
| --- | --- |
| The backend's `docs/api/openapi.draft.yaml` is the **only** source | §1. A second hand-maintained shape is the thing being removed. |
| The frontend consumes a **pinned snapshot**, not a live fetch | [ADR-0001](../decisions/ADR-0001-separate-frontend-backend-repositories.md): the repositories never share Git state, and a build must not depend on another repository being reachable |
| The snapshot records **which backend revision it came from** | Otherwise "the contract" means whatever someone last copied |
| Generated types are **committed**, and a CI gate regenerates and diffs them | A generator nobody runs is a hand-written file with extra steps |
| A contract change that breaks the client fails at **build time** | §1, and the whole point of generating |
| Migration of `server/utils/contracts.ts` is **incremental** | Types the new contracts need come from the generator; the rest move when they are touched. No unrelated churn. |

### Selected during M9 planning

The generator itself — `openapi-typescript` is the obvious candidate, since it targets OpenAPI
3.1 and emits types with no runtime — plus the snapshot mechanism and the gate's wiring. Per
the repository's version policy, the tool's current stable version is re-verified at install
time rather than pinned from a document.

This does not change what §1 already requires. It records how the requirement is finally met.

### As implemented at M9

| Step | Command | What it does |
| --- | --- | --- |
| Sync | `npm run contract:sync -- <path-to-purrenade-api> <40-char sha>` | `git show <sha>:docs/api/openapi.draft.yaml` → the snapshot, byte for byte; writes `SOURCE.json` (repository, commit, path, sha256, generator); regenerates. Refuses a SHA not on the backend's `origin/main`; `--allow-unpublished` exists only for a backend commit that has not been pushed yet, and warns. |
| Generate | `npm run contract:generate` | `openapi-typescript` over the snapshot → `shared/contracts/api.generated.ts`, unformatted, excluded from ESLint |
| Check (CI, before typecheck) | `npm run contract:check` | Snapshot sha256 must match `SOURCE.json`; the installed generator must be the recorded one; regenerating must reproduce the committed file byte for byte. Reads nothing outside this repository. `tests/unit/contract-check.spec.ts` proves each failure. |

**Generator:** `openapi-typescript` **7.13.0**, pinned exactly. It declares a TypeScript peer
of `^5.x`; this repository pins TS `~6.0.3` for Nuxt (versions-and-runtime §1A). An npm
`overrides` entry points the generator at the project's own TypeScript instead of loosening
peer resolution globally; generation was verified deterministic and its output typechecks
under TS 6.

**A drift found while migrating is fixed at the source.** The first one: `AuthenticatedUser`
declared `email_verified_at`, `created_at`, `session` and `session.created_at` optional,
although the API always returns them. The backend OpenAPI now marks them required.

---

## 2. Transport and authentication — APPROVED

**Decided in [ADR-0005](../decisions/ADR-0005-authentication-and-2fa-strategy.md) (M0.5):**
a **Nuxt BFF with server-managed session cookies** over a token-capable Laravel API.

| Rule | Detail |
| --- | --- |
| The browser talks to **one origin** — the Nuxt application | **No CORS**, no cross-origin credentialed requests |
| The browser's only credential is an **`HttpOnly`, `Secure`, `SameSite=Lax` session cookie** | Set by the BFF and unreachable from JavaScript |
| **No bearer token is ever stored in `localStorage` or `sessionStorage`** | This is the point of the design; a token in web storage is exfiltrable by XSS |
| Every state-changing request carries a **CSRF token** | **IMPLEMENTED** as a synchroniser token in an `X-CSRF-Token` header, compared against the BFF's server-side session. A header is the load-bearing detail: a cross-site form can make the browser send cookies, but it cannot set one. |
| The API credential lives **server-side in the BFF session** | It never reaches the browser |
| Laravel + Fortify + Sanctum remains the **authentication authority** | The BFF is a client of it, never a second source of truth |

**This also resolves ARCH-3:** Nitro *is* the BFF. That makes the Nuxt server a stateful,
security-relevant component — see the repository `SECURITY.md`.

**Future native clients** authenticate **directly against the Laravel API** with a bearer-token
flow, bypassing the BFF entirely. **Not implemented in v1.**

Even with the transport decided, it stays behind a **single swappable module**: one place
attaches credentials, one place handles 401, one place holds the CSRF token. No component,
store, or service knows how authentication works.

---

## 3. Layering — PROPOSED

```
  UI / stores
      │  intent  ("load leaderboard page")
      ▼
  Service        domain-shaped functions, mapping, error translation
      │
      ▼
  HTTP client    base URL, credentials, headers, correlation ID, retries
```

Components never call HTTP directly. Services never contain UI concerns.

---

## 4. Standard request behavior — PROPOSED

| Concern | Rule |
| --- | --- |
| **Correlation ID** | Every request carries a client-generated correlation ID, logged on both sides, and surfaced to the player on an unexpected failure so a report is traceable |
| **Locale** | Every request carries the active locale, so server-generated copy and emails match the player |
| **Idempotency** | State-changing operations that must not double-apply — notably run submission — carry an idempotency key. The key is **stable for the life of the attempt**, not regenerated per retry. See the backend's `docs/api/api-conventions.md` |
| **Timeouts** | Every request has one. No unbounded request. |
| **Retries** | Only for idempotent requests, only on network errors and 5xx, with exponential backoff and jitter. **Never** on 4xx. **Never** in a tight loop. |
| **Rate limiting** | Respect the server's retry signal; surface a calm message rather than hammering |
| **Cancellation** | In-flight requests are cancelled on route leave |

---

## 5. Error handling — PROPOSED

The client maps from **stable machine-readable error codes**, never from
human-readable message text. Message text is for display; codes are for logic.

| Server response | Client behavior |
| --- | --- |
| `401` | Clear session state, route to login, preserve intent |
| `403` | Explicit permission error; never a silently empty view |
| `404` | Not-found view; never an empty success state |
| `409` | Reconcile — usually a stale local value; refetch and inform |
| `422` | Map field errors onto the form by field name and code |
| `429` | **IMPLEMENTED** — `retry_after` arrives both as a problem member and as a `Retry-After` header, and drives the verification countdown rather than a bare error |
| `5xx` | Generic failure plus the correlation ID |
| Network error | Offline/connection message with retry. **A run in progress is never destroyed by a network error.** |

---

## 6. Run lifecycle — APPROVED (ADR-0006)

Run submission is the most consequential call in the product, because it is where
the client asks the server to change durable, ranked state.

### Starting

| Rule | Reason |
| --- | --- |
| A run is **started server-side before gameplay begins** | The server records the start, issues the seed and owns the run's state |
| **Connectivity is required to start** | PWA-1. There is no offline-start path in v1. |
| The client **initializes the deterministic domain from the server's seed** | A browser-generated seed is never authoritative (RNG-1) |
| Starting while a run is already open **resumes it** | The server returns the same run rather than creating a second (GR-4). A client that lost its local state recovers this way — and must not present a resumed run as a fresh one. |
| There is **no run token** to hold | The run is the opaque `run_id` plus the authenticated session. Nothing run-related is stored in the browser. |

### Finishing

| Rule | Reason |
| --- | --- |
| The client **proposes**; the server **decides** | Score and progression are server-authoritative |
| Submission is **idempotent** | Retries, flaky networks and double taps must not double-count |
| A failed submission is retried with the **same idempotency key** | Retrying with a new key would create a duplicate run |
| The key is **generated once per run attempt** and reused across every retry of it | Including retries that span a reload. This is what makes deferred submission safe. |
| The client displays the **server's** returned values | Never its own optimistic values once the response arrives |
| A rejected or flagged run is surfaced honestly | Never silently discarded, never silently accepted |
| **No input log is sent** | RNG-2. The payload is the compact untrusted hints the server's validation actually consumes. |

### Losing the connection mid-run — APPROVED

**PWA-1 is resolved**, and this is the shape it takes in the client:

1. The run is already started, so the server knows about it. Nothing is lost.
2. The player **keeps playing locally**. A network error never destroys a run in progress.
3. The finish is **retried when connectivity returns**, under the same idempotency identity.
4. The identity **never expires** server-side, so a late retry is still safe.

This is ordinary request retry with a stable key — not an offline-first queue, and not
background creation of runs. See [`pwa-and-mobile.md`](pwa-and-mobile.md) §3.

### Telling the player the truth — APPROVED

The server answers with one of three outcomes, and the client must distinguish them.

| Outcome | What the player is shown |
| --- | --- |
| `accepted` | The authoritative score and the resulting progression |
| `flagged` | The run happened, but honestly: it was **not accepted** for competitive or progression purposes. No progression, paw, personal-best or run-count change is shown, because none occurred. |
| `rejected` | An explicit, honest response. Never dressed up as a success, never silently dropped. |

**The client never infers an outcome from a status code**, and never presents its own
optimistic numbers once a response has arrived. All three outcomes, and every flag-reason
class, ship in **tr / en / es** (ADR-0007).

### As implemented at M9

**Start.** `run.vue` mounts nothing for a normal run until `runSession.begin()` has a server
run: `POST /api/game-runs` → `{ run: StartedRun, resumed }`. The engine is mounted from the
run's `seed` and `loli_cycle_paws`; there is no local seed anywhere (`useRunSurface` has no
platform RNG left), and a failed start offers a retry, never a local run. A `200` resume is
shown as such ("your unfinished run restarts on the same course") and replays from its start —
there is no input log to restore mid-run state from (RNG-2). A restart from the pause screen
asks the server too, which resumes the still-active run. The tutorial mounts from a fixed
seed `0` and never calls any of this.

**Finish.** `run_ended` carries the run's summary; the store proposes it once as three
integers. The BFF generates the `Idempotency-Key` (a UUID), stores key and payload **beside
the session record, before** calling Laravel, and on every later attempt resends exactly what
it stored — whatever the browser sends. The stored payload is a **stable retry payload**, a
copy of an untrusted proposal; Laravel alone classifies it.

| Answer | BFF keeps the payload? | Browser |
| --- | --- | --- |
| `200` (any outcome) | cleared | shows the server's outcome and numbers |
| `403` / `404` / `409` / `422` | cleared | "this run could no longer be recorded" — never retried |
| `401`, `429`, `5xx`, timeout, unreachable | kept | retries: 2, 4, 8, 16, 30, 60 s (cap), ±20 % jitter, never sooner than `retry_after`; at once on `online`; "try now" by hand |

**Reload.** `begin()` first asks `GET /api/game-runs/pending`; a finish the BFF is holding is
delivered before any new run starts, and while it cannot be, the page says so and waits.

**Account boundary.** The pending payload is keyed to the BFF session and destroyed with it
(sign-out, rotation on a privilege change, expiry); the store resets on `auth.reset()` and
when a different user appears. One session holds at most one pending finish, and no new run
starts while it exists (`409 bff_run_finish_pending`).

**Known limit (accepted, PWA-1).** A proposal that never reached the BFF — the device was
offline from the moment the run ended until the tab was closed — is lost. The run stays
`active` server-side; the next start resumes it within 24 h of its start or replaces it after
that. Solving this is service-worker scope (M12), not M9.

---

## 7. Caching — PROPOSED

| Data | Policy |
| --- | --- |
| Profile, progression | Cached in the store, invalidated on run submission and on relevant mutations |
| Leaderboard | Short TTL; the player's own row always fresh |
| Achievements, characters | Cached; invalidated on unlock |
| Anything security-relevant | Never cached client-side |

---

## 8. What the client must never do — APPROVED

- Treat a client-side check as authorization.
- Send a score, paw count, or unlock the server has not agreed to.
- Store credentials in a place readable by arbitrary scripts if the transport
  decision offers a safer option.
- Log or transmit personal data beyond what the request requires.
- Parse human-readable error text to make a decision.
