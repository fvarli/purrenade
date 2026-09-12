# API Client

How the frontend talks to `purrenade-api`.

**Status legend:** APPROVED / PROPOSED / OPEN.

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

## 2. Transport and authentication — APPROVED

**Decided in [ADR-0005](../decisions/ADR-0005-authentication-and-2fa-strategy.md) (M0.5):**
a **Nuxt BFF with server-managed session cookies** over a token-capable Laravel API.

| Rule | Detail |
| --- | --- |
| The browser talks to **one origin** — the Nuxt application | **No CORS**, no cross-origin credentialed requests |
| The browser's only credential is an **`HttpOnly`, `Secure`, `SameSite=Lax` session cookie** | Set by the BFF and unreachable from JavaScript |
| **No bearer token is ever stored in `localStorage` or `sessionStorage`** | This is the point of the design; a token in web storage is exfiltrable by XSS |
| Every state-changing request carries a **CSRF token** | The BFF is the CSRF boundary. The hop relocates the problem; it does not remove it. |
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
| **Idempotency** | State-changing operations that must not double-apply — notably run submission — carry an idempotency key. See the backend's `docs/api/api-conventions.md` |
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
| `429` | Honour the retry signal; show a calm message |
| `5xx` | Generic failure plus the correlation ID |
| Network error | Offline/connection message with retry. **A run in progress is never destroyed by a network error.** |

---

## 6. Run submission — PROPOSED

Run submission is the most consequential call in the product, because it is where
the client asks the server to change durable, ranked state.

| Rule | Reason |
| --- | --- |
| The client **proposes**; the server **decides** | Score and progression are server-authoritative |
| Submission is **idempotent** | Retries, flaky networks and double taps must not double-count |
| A failed submission is retried with the **same idempotency key** | Retrying with a new key would create a duplicate run |
| The client displays the **server's** returned values | Never its own optimistic values once the response arrives |
| A rejected or flagged run is surfaced honestly | Never silently discarded, never silently accepted |

**OPEN:** whether an unsubmitted run may be queued for later submission — this is
the same decision as "is a run playable offline" (PWA-1), and it has direct
anti-cheat consequences.

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
