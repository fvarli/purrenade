# State Management

Who owns what, and what must never become global mutable state.

**Status legend:** APPROVED / PROPOSED / OPEN.

---

## 1. Ownership map — PROPOSED

| State | Owner | Lifetime | Persisted |
| --- | --- | --- | --- |
| Session / auth status | **`auth` store** (`app/stores/auth.ts`) — **IMPLEMENTED at M2** | App | Server-side in the BFF. The store holds only a *projection* of who the session belongs to: no token, no challenge token, no password, and **nothing written to web storage**. The status is derived from the server's facts, never received as a state name. |
| Player profile (username, avatar, favourite character, best score, run count) | `profile` store | App | Server |
| Progression (`lifetimePaws`, `loliCyclePaws`, achievements, unlocks, `tutorialCompletedAt`) | `progression` store | App | **Server — authoritative.** **At M8** there is no `progression` store: the only field of it that exists is tutorial completion, and it arrives as a boolean on the `auth` store's user projection because first-run routing has to decide during SSR. Progression still **owns** the write (`POST /api/progression/tutorial`); the `auth` store cannot change it. The store arrives with M9, when there are run-derived counters to put in it. |
| Settings (locale, music, effects, reduced motion) | `settings` store | App | Server profile **and** device mirror |
| Leaderboard page data | **`leaderboard` store** (`app/stores/leaderboard.ts`) — **IMPLEMENTED at M10** | View — reset when the screen unmounts | **Not persisted and not cached**: every visit, tab switch and refresh asks the server, and every rank shown is the server's |
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

### 2.4 What M7 added — confirmed

`RunState` grew the scoring layer: `score` (three integer accumulators in
thousandths), `pawTokens`, `nextPawTokenId`, `nextPawAtUnits`, `runPaws`,
`loliCyclePaws`, `loli`, `slayyy`, `loliActivations` and `slayyyActivations`.
The approved run-scoped queue is `loli.queuedLoliBonuses` — grouped with the
rest of the companion's state, but carrying the identifier §2.4 approves rather
than a shorter one that would have read the same in context and been harder to
grep for.
Still no store, still nothing reactive, still nothing persisted — `loliCyclePaws`
is the run-scoped counter only, and the server-owned persistent counterpart in
§2.2 remains entirely absent from this repository.

The nested M7 structures are frozen explicitly by `sealState`, each one named:
the freeze walk is hand-written rather than recursive, so a new nested object
that nobody remembered to seal is a visible omission rather than a silent one.
Paw tokens are frozen individually, exactly as obstacles are.

What crosses to the app stays coarse. Seven new events — `score_changed`,
`paws_changed`, `loli_started`, `loli_ended`, `slayyy_ready`, `slayyy_activated`
and `slayyy_ended` — drive the HUD. `score_changed` fires only when the
**floored** total changes, so a counter accumulating in thousandths does not
wake Vue 120 times a second; at the base rate it fires about ten times a second
and never once per step.

### 2.3 What M6 added — confirmed

`RunState` grew the world: `obstacles`, `hearts`, `invulnRemainingMs`, `distanceUnits`,
`nextObstacleId`, `spawn` and `nearMissCount`. None of it is reactive and none of it reaches a
store. The obstacle array and every obstacle in it are frozen with the state, so a renderer
holding a snapshot cannot edit the world it is drawing — asserted by a test that expects the
write to throw.

What crosses to the app is still coarse: `heart_lost` carries the new count, `near_miss` and
`run_ended` carry nothing. The run route's heart row is driven by those events, never by reading
run state, so nothing re-renders Vue at the simulation rate.

### 2.2 As built at M5 — confirmed

The game core shipped without a run store, and nothing about it wanted one.

`RunState` is created by `createRunLoop` in `game/bridge/loop.ts`, threaded through
`step()`, and never leaves the loop. What the app layer receives is deliberately thin:

| Crossing | What it carries |
| --- | --- |
| App → loop | Normalized `InputEvent`s, and explicit `pause()` / `resume()` |
| Loop → renderer | A frozen `RenderSnapshot` — ten primitive fields in lane units plus a frozen obstacle list, never pixels, never the state object |
| Loop → app | Coarse `RunEvent`s (`run_started`, `run_interactive`, `phase_changed`) |

The run route holds four reactive fields — `phase`, `loading`, `failed`, and `isPaused`
derived from `phase` — so it can label a button and say what went wrong. **None of them
is a gameplay field**, which is the part that matters: nothing in `RunState` is reactive,
nothing re-renders at 120 Hz, and `app/**` cannot import `game/domain` at all, statically
or dynamically, because ESLint rejects both. The rule in §2 is enforced rather than
trusted.

---

### 2.5 What M9 added — confirmed

`app/stores/run-session.ts` — the normal run's **server** lifecycle: the server run to mount
(`StartedRun`), whether it was resumed, the submission's progress and the server's
`RunResult`. It never holds `RunState`, a seed of its own, or an outcome it inferred, and it
writes nothing to browser storage. It resets on sign-out and on a change of account.

`useRunSurface` gained `summary` (the client's proposal, from `run_ended`) and takes its seed
and starting `loliCyclePaws` as inputs rather than generating them.

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

## 6. Hydration and SSR safety — IMPLEMENTED

| Rule | Why |
| --- | --- |
| Stores are created per request on the server | A module-level singleton leaks one user's state into another's response. `@pinia/nuxt` creates one Pinia per Nuxt app and one Nuxt app per request. |
| **The auth store is resolved during SSR, from the visitor's own session** | The BFF session is a server-side record in this process and the cookie only a pointer (ADR-0005 §3), so the render *can* resolve it — and must. Not doing so left `status === 'unknown'` for the whole render, and the home page, the layout nav and the `guest`/`verified`/`admin` guards all disagreed with the client. See [ADR-0009](../decisions/ADR-0009-server-rendered-session-awareness.md). |
| **It resolves through the same `GET /api/auth/me`** | One projection, one code path, one place a field can be added or removed. During SSR the call is dispatched in-process with the visitor's `Cookie` forwarded — no socket, and no second upstream call. |
| **Only the `Cookie` header is forwarded** | Not the whole inbound set. An inbound `Authorization` must not reach the BFF, and an inbound `content-length` must not be attached to a bodyless internal GET. |
| **`unknown` is not `guest`** | `guest` is a conclusion. A failed SSR resolution leaves `unknown`, because the client only re-asks from `unknown` — concluding `guest` on the server strands a signed-in visitor with no retry. Degraded availability is not evidence about the visitor. |
| **The SSR resolution is bounded and observable** | 2.5 s, not `apiTimeoutMs`: this is time-to-first-byte, so a slow API must degrade the page's auth state rather than the page. A failure logs once, with the reason. |
| **A render never changes anything** | State-changing BFF requests are refused during SSR. That is also what keeps the client-only CSRF cache client-only: the only path that populates it is unreachable on the server. |
| **Only a credential-free projection crosses into the render** | The Sanctum token stays in the session record. What SSR receives is what the browser already received; the change is *when*, not *what*. Enforced by an E2E check and a CI gate over the server-rendered HTML. |
| **No SSR page may be cached** | The HTML is user-specific now. No `swr`, no `isr`, no `cache` route rule, and no proxy cache in front of a page route. |
| Device-mirrored settings are read **client-side only** | They do not exist on the server and would cause a hydration mismatch |
| Nothing gameplay-related is touched during SSR | The run route is client-only; see [frontend-architecture.md](frontend-architecture.md) §2 |

---

## 7. Cross-tab behavior — APPROVED

Two tabs, one account, two runs in progress was a real scenario with real
consequences for the paw ledger and for run validation.
[ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md) imposed the
stricter rule this section anticipated, and it resolves the question at the only layer that
can resolve it.

**One authenticated user may hold at most one active authoritative run**, enforced as a
database invariant rather than an application check (GR-4). A second tab that asks to start a
run does not get a second run — it gets **the one already open**, with the same identity,
seed and server-recorded start.

| Concern | Resolution |
| --- | --- |
| Two tabs racing to start | The database refuses the second; the caller is handed the existing run |
| Two tabs racing to finish | Idempotent submission on `(user_id, idempotency_key)`; the second is either the same effective request, and returns the original result, or a different one, and is a `409` |
| The paw ledger | Only an `accepted` run touches it, and only through an atomic database operation |
| Signing out in one tab | Still propagates to the others |

**The client still makes no attempt to lock tabs.** It does not need to: the invariant lives
where it cannot be bypassed, and a client-side lock would be exactly the kind of frontend
check that is never a control. What the client *does* owe the player is honesty — a second
tab that resumes an already-running run must not present itself as a fresh one.

`RunState` remains run-scoped and per-mount (§2). Nothing here makes it shared across tabs.
