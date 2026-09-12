# State Management

Who owns what, and what must never become global mutable state.

**Status legend:** APPROVED / PROPOSED / OPEN.

---

## 1. Ownership map — PROPOSED

| State | Owner | Lifetime | Persisted |
| --- | --- | --- | --- |
| Session / auth status | `session` store | App | Server-side session or token; never plaintext in local storage |
| Player profile (username, avatar, favourite character, best score, run count) | `profile` store | App | Server |
| Progression (`lifetimePaws`, `loliCyclePaws`, achievements, unlocks, `tutorialCompletedAt`) | `progression` store | App | **Server — authoritative** |
| Settings (locale, music, effects, reduced motion) | `settings` store | App | Server profile **and** device mirror |
| Leaderboard page data | `leaderboard` store | View | Not persisted; cached briefly |
| **Run state** (lane, hearts, score, SLAYYY charge, timers, spawns, RNG cursor, **`queuedLoliBonuses`**, near-miss events) | **`game/domain` `RunState`** | Run | **Never persisted.** Not in a store. |
| Run summary (final score, `runPaws`, achievement deltas) | `run` store | Between run end and submission | Submitted to the server |
| Engine handles (Phaser instance, scenes, textures) | Engine adapter | Route | Never |

---

## 2. `RunState` is not application state — APPROVED

The single most important rule here: **run state does not live in a store.**

It lives inside the pure game domain and is threaded through `step()`. Putting it
in a reactive store would:

- make every gameplay field reactive at 120 Hz, which is a performance problem
  and a correctness hazard;
- let UI code mutate gameplay state from outside the rules;
- destroy determinism, because the order of reactive effects would become part
  of the simulation.

The app layer receives a **small projected view model** for the HUD and
**coarse run events**. Nothing more crosses.

---

### 2.1 `queuedLoliBonuses` is run-scoped — APPROVED

The Loli Bonus queue lives in `RunState` and nowhere else.

| Lives in | Does **not** live in |
| --- | --- |
| `RunState` | Any Pinia store |
| Run telemetry submitted at run end | Persistent progression |
| — | The API `Progression` schema |
| — | Any database column |

The Loli Bonus is a **run-scoped gameplay reward, not a bankable meta-progression currency**.
When the run ends, active and queued bonus state ends with it. There is no `owedLoliBonuses`
field anywhere in either repository. See
[`../product/scoring-and-progression.md`](../product/scoring-and-progression.md) §2.4.

`loliCyclePaws` is the persistent counterpart and remains server-owned.

## 3. Server-authoritative progression — APPROVED

The client displays progression; the **server decides** it.

| Rule | Consequence |
| --- | --- |
| The client never invents a progression value the server must accept | A tampered client changes nothing durable |
| Optimistic UI is allowed, reconciliation is mandatory | Show `+18 🐾` immediately, then reconcile with the server's response |
| A conflict is resolved in the server's favour, visibly | Never silently keep a local value the server rejected |

---

## 4. Settings: server and device — PROPOSED

Settings live in two places on purpose:

- **Server profile** — so the choice follows the account to a new device.
- **Device mirror** — so the locale and reduced-motion setting apply *before*
  the session is known (the language switcher appears on the login screen).

On sign-in, the server value wins and the device mirror is updated. On change
while signed in, both are written.

---

## 5. What must never be global mutable state — APPROVED

- **Game rules state.** See §2.
- **The Phaser instance**, its scenes, or its textures. They belong to the route
  that created them and must be destroyed on leave.
- **Ambient time and randomness.** Both enter the domain explicitly; neither is
  read from a global.
- **Anything that would make two browser tabs of the same account interfere.**

---

## 6. Hydration and SSR safety — PROPOSED

| Rule | Why |
| --- | --- |
| Stores are created per request on the server | A module-level singleton leaks one user's state into another's response |
| Device-mirrored settings are read **client-side only** | They do not exist on the server and would cause a hydration mismatch |
| Nothing gameplay-related is touched during SSR | The run route is client-only; see [frontend-architecture.md](frontend-architecture.md) §2 |

---

## 7. Cross-tab behavior — OPEN

Two tabs, one account, two runs in progress is a real scenario with real
consequences for the paw ledger and for run validation.

**PROPOSED:** the server treats each run as an independent, idempotent
submission and resolves progression in the order it accepts them; the client
makes no attempt to lock tabs. Signing out in one tab propagates to others.

Recorded as OPEN because the anti-cheat model may impose a stricter rule — see
[ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md).
