# Open and Proposed Decision Register

The single live list of everything not yet decided, and everything recommended
but not yet authoritative — **across both repositories**.

Sections 1–3 hold the decisions that block or shape milestones. Section 4 holds
the proposals awaiting review. **Section 6 indexes every remaining open question**
raised so far, so nothing is recorded only in a document nobody rereads.

**Last reviewed:** 2026-09-24 (**M10 leaderboard decisions** — M10 unblocked, LB-5 moved to
SEC-3/M14, LB-9 recorded; see §0AJ).

| Status | Meaning |
| --- | --- |
| **OPEN** | Unresolved. Requires a product-owner decision. **Must not be implemented or guessed.** |
| **PROPOSED** | A recommendation written so it can be reviewed. **Not authoritative.** May be implemented as a named tuning parameter, never presented as decided. |

**Neither is ever silently promoted to APPROVED.**

---

## 0AJ. Resolved — M10 leaderboard decisions (2026-09-24)

M9 is **closed** (production api `e9c7ebc`, web `f9fb8e3`). Planning M10 surfaced one false
blocker and several unspecified details; the owner decided them as follows.

| Decision | Outcome | Owning document |
| --- | --- | --- |
| **D1 — M10 is not blocked by account deletion** | Leaderboard projections store **no duplicated public identity** (the display name is joined live) and are derived, rebuildable data. **LB-5 stays OPEN** and moves to gate **SEC-3 / account deletion (M14)**, which must treat run history and projections consistently. D1 sets **no** delete behaviour. | [leaderboards](leaderboards.md) §5.3 |
| **D2 — `achieved_at`** | The run's **server-recorded finish**. Weekly attribution still uses the server-recorded start. | [leaderboards](leaderboards.md) §4.1 |
| **D3 — M10/M12 boundary** | M10 ships the working board 15 (this week and all time) and its entry points; M12 keeps cross-screen desktop, accessibility and PWA polish. Previous weeks are **retained permanently**; **viewing** them is new **OPEN LB-9**. No third tab. | [milestones](milestones.md) M10 · [leaderboards](leaderboards.md) §3.3 |
| **Stable identifier** (engineering specification) | Tie-break rule 4 is the entry's **representative run id**, so one comparator both selects each player's best run and orders the board. Never exposed. | [leaderboards](leaderboards.md) §4.1 |
| **Pagination consistency** (engineering specification) | Each response is snapshot-consistent; a multi-page traversal is live, not frozen — entries moving above the cursor are shown after a refresh, ranks may skip, no duplicates while positions only move up (invariant M). | [leaderboards](leaderboards.md) §4.3 |
| **Banned-player enforcement** | Still APPROVED as product behaviour; **enforced from M13**, when ban state exists. M10 keeps a single visibility point and hides nobody. | [leaderboards](leaderboards.md) §5.2 |
| **Projection storage** (was DM-2, CACHE-3, BA-3, CACHE-4) | Maintained **PostgreSQL** ranking tables, updated **inside** the run-acceptance transaction, with **no cache** in M10. | `purrenade-api/docs/architecture/data-model.md` §5 |

---

## 0AI. Resolved — ADR-0006 accepted: the run validation and anti-cheat boundary

**[ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md) is Accepted
(2026-09-22).** It was the largest architectural risk in v1 and the last thing blocking **M9**
and **M10**. The model is **Layer 1 + Layer 2**: structural and plausibility validation, plus
server-owned run identity with a server-recorded start and a server-issued seed. **Layer 3**
deterministic replay is deferred beyond v1 with the domain kept portable; full
server-authoritative simulation stays rejected.

| Ref | Decision | Owning document |
| --- | --- | --- |
| **PWA-1** | **Connectivity is required to *start* a run.** The server creates the run before gameplay begins. An already-started run survives a transient loss — the player continues locally and the finish is retried under the **same idempotency identity**. Starting a brand-new authoritative run fully offline is **out of scope for v1**. The tutorial stays isolated and submits nothing. | [`../architecture/pwa-and-mobile.md`](../architecture/pwa-and-mobile.md) §3 |
| **ANTI-1** | **Layers 1 and 2 ship in v1.** Layer 3 is deferred beyond v1; the pure domain stays portable so adding it later is a deployment decision, not a rewrite. **No duplicate PHP simulation** of the game rules is written to obtain it. | `purrenade-api/docs/security/anti-cheat.md` §3 |
| **RNG-1** | **The run seed is server-issued.** The frontend initializes the deterministic domain from it; a browser-generated seed is never authoritative. | [`../game/determinism-and-rng.md`](../game/determinism-and-rng.md) §3 |
| **RNG-2** | **No gameplay input log** is submitted or retained in v1. It belongs to the deferred Layer 3 design. | [`../game/determinism-and-rng.md`](../game/determinism-and-rng.md) §3.0B |
| **ANTI-5 · DM-1 · GR-5** | **Data minimization.** **No `run_events` table**, and no raw per-event gameplay history. Validate at submission time; persist only the run record, compact authoritative derived facts, the minimum validation metadata, and approved progression state. Any future raw-event retention is a **separate** privacy decision. | `purrenade-api/docs/architecture/data-model.md` §3 |
| **ANTI-4** | **Structural rejection is separated from tuning-dependent flagging.** Only impossibilities provable without an unresolved tuning value — and without assuming prompt submission — may reject. Plausibility anomalies bounded by still-PROPOSED tuning may only **flag**. **No legitimate run is rejected on an unresolved tuning number.** Tightening later requires an explicit decision. | `purrenade-api/docs/security/anti-cheat.md` §3A |
| **ANTI-2 · GR-1** | **Three outcomes: `ACCEPTED`, `FLAGGED`, `REJECTED`.** Only `ACCEPTED` mutates anything. `FLAGGED` is retained with the metadata explaining it but changes **no** progression, paw ledger, personal best, accepted `run_count`, leaderboard eligibility or achievement progress, and the player is told honestly. `REJECTED` keeps only minimum attempt information. Never silently accepted, discarded or converted; **no automatic promotion from flagged to accepted**. | `purrenade-api/docs/api/endpoints/game-runs.md` |
| **ANTI-3 · GR-2** | **No player appeal workflow and no actively serviced review queue in M9.** M13 may introduce administrative review tooling for flagged runs. | `purrenade-api/docs/security/anti-cheat.md` §4 |
| **GR-4** | **At most one active authoritative run per user**, enforced by a **partial unique database index**, not a read-then-check query. Starting while one is open returns **that same run** — deterministic resume, never a second. The tutorial does not occupy the slot. This also resolves the cross-tab question in [`../architecture/state-management.md`](../architecture/state-management.md) §7. | `purrenade-api/docs/architecture/data-model.md` §3 |
| **GR-3 · API-3** | **The idempotency identity lives with the durable run history — no cleanup window.** `(user_id, idempotency_key)` stays database-unique, with a stored request fingerprint so "same key, different request → `409`" is enforceable. Same key + same request returns the original result with zero side effects. **No `idempotency_keys` table at M9**; generalizing idempotency elsewhere remains **API-5**. | `purrenade-api/docs/api/endpoints/game-runs.md` |
| **Run identity** | **No separate `run_token`.** A run is an opaque `run_id` bound to the authenticated actor, with server-owned state. The threat model establishes no property a token would add, and a browser-held run secret cuts against the approved posture that the browser holds no portable credential. | `purrenade-api/docs/security/threat-model.md` §3 |
| **Submission rate limiting** | **A dedicated limiter exists** for run start and finish: user-scoped primary control, IP as secondary abuse defence, normal mobile retry kept practical, idempotent retries creating no duplicate state, and a `429` never consuming the idempotency slot. Values live in the central configuration, never controller literals, and tests must cover enforcement. **Numeric values are an M9 implementation parameter, not an open decision.** | `purrenade-api/docs/security/rate-limiting.md` §3 |
| **Contract generation** | **M9 absorbs the hand-written API-type debt.** The OpenAPI → TypeScript generation path is established before or as part of introducing the M9 schemas, so the new run and progression types are generated from the authoritative contract rather than duplicated by hand. **Engineering foundation work inside M9, not a separate milestone.** | [`../architecture/api-client.md`](../architecture/api-client.md) §1A |
| **Localization** | Every new M9 player-facing string — including all three outcomes and each flag-reason class — ships in **tr / en / es**, TR default. Parity gates are not weakened. | [ADR-0007](../decisions/ADR-0007-localization-strategy.md) |

### What this closure deliberately did **not** do — ANTI-6

**The APPROVED achievement-progression authority rule was not weakened.** A trusted client
aggregate capped by plausibility checks is still not an acceptable verification model.

Layers 1 and 2 can *bound* a number but cannot *establish* one that depends on what the player
did. Four run-level facts are exactly that — obstacle passes by class, near misses, SLAYYY
activations and **actual Loli activations** — and only Layer 3, or an equivalent separately
approved trustworthy mechanism, can establish them.

So while none exists, those four **must not be promoted from client-reported aggregates into
authoritative `DERIVED_TELEMETRY` progression facts**. M9 does not create their columns, does
not return them, and does not accumulate them. Recording them early would breach the trust
boundary at the outset and buy nothing: a counter built from an untrustworthy source would
have to be discarded the moment a real mechanism arrived.

That consequence is recorded as **ANTI-6** in §1. It blocks **M11** only — not M9, not M10.
Whether M11 adds Layer 3, designs another server-verifiable mechanism, or changes the affected
achievement and unlock behaviour is a **product decision for the M11 architecture decision**,
and this closure deliberately pre-empts none of them.

### Implementation parameters, not open decisions

Selecting these during M9 planning reopens nothing: submission rate-limit values; plausibility
bound values, gated on tuning approval; the authoritative duration derivation and its
clock-skew/late-submission tolerance; the maximum active-run lifetime; and the contract
generator's wiring.

**ARCH-2** and the **ADR-0006** register entry are retired by this closure. **SEC-3** and
**SEC-5** remain open, over a materially smaller surface.

---

## 0AG. Resolved — OPS-5 complete: reboot survival and manual resource baseline

**OPS-5 is resolved and complete.** A controlled production reboot proved a new
boot, a running host with no failed units, the intended kernel, and automatic
return of Purrenade web and queue, nginx, PHP 8.4 FPM and PostgreSQL. Frontend
loopback and public health, API health with its database check, migrations and
queue state were healthy afterwards; the intended runtime revisions remained in
place. The persistent BFF filesystem session store kept its owner/mode and
contents, and an already-authenticated browser session remained authenticated.

OPS-5 also defines a **manual** resource-monitoring baseline: run it after a
controlled reboot/restart, monthly, and when resource or service symptoms
appear. The reproducible procedure and qualitative investigation rules are in
[`../production/operations.md`](../production/operations.md) §8. The baseline
has been executed successfully in production. It deliberately defines neither
numeric automated thresholds nor scheduled monitoring, alerting or paging;
broader observability, alerting and analytics architecture remains **OPEN as
OPS-4**. The single-instance filesystem-store limitation remains **OPEN as
OPS-2**, and privacy/retention/consent remains **OPEN as SEC-3**.

During the proof, a duplicate swap-entry boot configuration issue was corrected
with generator validation. Swap remained active and Purrenade stayed healthy;
this was host configuration, not an application defect. A later routine reboot
may incidentally confirm that its former boot warning does not recur.

---

## 0AF. Resolved — OPS-3 complete: controlled production CI/CD proof

**OPS-3 is resolved and complete.** The controlled frontend and backend
production deployment paths have both been proven end-to-end. The durable model remains
operator-controlled: frontend production deployment is `workflow_dispatch` only,
not automatic on a successful push or pull request. The frontend retains its
exact-SHA and CI-provenance validation before production secrets, protected
production environment, immutable release directories, atomic `current` switch,
shared session store, health verification, rollback and release-pruning
invariants. This proof does not establish horizontal scaling or HA readiness;
the shared session backend remains **OPEN as OPS-2**. Restart/reboot survival
and the manual resource-monitoring baseline are separately resolved as **OPS-5**
(§0AG).

---

## 0AB. Corrected by the M2 adversarial audit

Three things this register and its owning documents recorded as true were not.
Listed here because a decision that the code does not implement is worse than an
open one — an OPEN item gets revisited, a wrong APPROVED one does not.

| Was recorded as | Actually was | Now |
| --- | --- | --- |
| "Every error is RFC 9457, and that holds with `APP_DEBUG=true`" | True for `api/*` only. Every other path on the API host returned the framework's default error, with a stack trace and absolute filesystem paths under debug. | The renderer covers the host. A CI gate boots the application and checks, instead of only linting the contract. |
| "Moving the BFF session store in production is a configuration change, not a code change" | `nitro.storage` is build-time. `NUXT_SESSION_DRIVER` has no runtime effect at all, so a production deploy would keep writing plaintext bearer tokens to local disk while the operator believed otherwise. | Documented as build-time. The BFF refuses to start a production process on a filesystem-backed store unless explicitly acknowledged, and hardens the store's permissions. |
| "`startSession()` is the only function that writes a session" | `touchSession()` writes too. Harmless — it updates one timestamp on an existing record — but the stated invariant was not the true one. | Restated as the property that actually holds: it is the only function that can put a credential into a session. |

Two further gaps were in the code rather than in the record, and are documented
where they belong: a `two-factor` ability outliving the secret it attested to
(`purrenade-api/docs/architecture/auth-architecture.md` §3A), and a pending
two-factor challenge surviving a password reset (§3B, and
`docs/security/authentication.md` §4.2).

**AUTH-4, RL-1, CACHE-1, 2FA-3, 2FA-4, SEC-3, AD-5 and OPS-1 remain OPEN.** The
audit found none of them load-bearing for M2's security: OPS-1 in particular is
now guarded rather than resolved — production cannot reach the unsafe answer by
accident, but choosing the right store is still an open decision.

---

## 0AE. Decided at the M7 adversarial review — now APPROVED

Three decisions were taken by the product owner during M7's review rather than by
implementation. They are recorded here because the register, not a milestone narrative, is
the live list — and because milestone-exit gate **M-C** requires every decision taken during
a milestone to appear in it.

| Ref | Decision | Status | Owning document |
| --- | --- | --- | --- |
| **PD-M7-1** | **A collected Paw Token is worth `10`.** Identical whether the player walked into it or Loli's magnet brought it to them. Replaces a PROPOSED `5`. | **APPROVED / LOCKED** | [scoring-and-progression](scoring-and-progression.md) §1.1 |
| **PD-M7-2** | **First SLAYYY availability targets 35–45 s of a representative healthy run.** A UX target for a *range of play*, **not a timer**: readiness arises only from deterministic meter accumulation, collecting paws reaches it sooner, collecting none reaches it later, and the meter never fires itself. The charge **rates** that serve it remain PROPOSED — see SP-1. | **APPROVED** (target) | [scoring-and-progression](scoring-and-progression.md) §3.2 |
| **PD-M7-3** | **A Paw Token never requires unavoidable damage to collect.** The collectible counterpart of the escape-path guarantee. The *invariant* is locked; the mechanism upholding it is not — `paw.droppedWhenBlocked` stays PROPOSED precisely so it can be replaced. A `JUMPABLE` overlap is not a violation. | **APPROVED / LOCKED** | [tuning-parameters](../game/tuning-parameters.md), "Values that are NOT tunable" |

PD-M7-3 was not a proposal anyone had written down before the review: the review measured
230 same-lane token/obstacle overlaps across twelve seeds, 156 of them lane-blocking, and 58
in which the obstacle's damage window strictly contained the token's collection window — bait
that could not be taken at all without losing a heart. The invariant is the decision; the
reconciliation is the current answer to it.

**Everything else M7 introduced stays PROPOSED**, including all three magnet distances, every
SLAYYY charge rate, and the paw spawn parameters. Shipping a value does not approve it.

---

## 0AD. Implemented at M6 as named parameters — status deliberately unchanged

M6 put the obstacle, collision, difficulty and generation values into running code. **None of
them is promoted.** They are in `game/domain/tuning.ts`, each with its own `@status`, and a test
fails if any drifts from the registry in value or in status.

| Ref | Value now in code | Status |
| --- | --- | --- |
| — | `world.baseScrollUnitsPerS` 3.0, `visibleUnits` 10, `spawnLookaheadUnits` 14, `despawnBehindUnits` 2 | **PROPOSED** — new at M6; the registry had no absolute scroll speed at all |
| — | `obstacle.defaultLengthUnits` 0.7, `collision.playerLengthUnits` 0.5 | **PROPOSED** — new at M6; both reduced during the M6 audit to widen the jump window |
| — | `invuln.postHitMs` 1200, `blinkHz` 10 | **PROPOSED** |
| DO-3 | The six soft-cap endpoints. `difficulty.tierStartsS` **0/30/60/120/180 is APPROVED** (M6) | **PROPOSED** — ceilings unconfirmed; thresholds resolved |
| — | `generator.repeatCooldown` 3, `minGapUnits` 6/5.5/5/4.5/4 per tier | **PROPOSED** — the registry said only "per tier" |
| CR-6 | `nearMiss` lateral 1.25, longitudinal 0.75, vertical 0.40 | **PROPOSED** — lateral corrected at M6; must be tuned with the reaction budget |
| — | `escape.maxActionsPerPattern` 2, `reactionBudgetMs` 350, `solverGridMs` 100, `solverMaxSteps` 2000 | **PROPOSED** |

Only the hearts model, the two obstacle classes and their clearability are APPROVED.

**Three things the review should look at.**

1. **CR-6 is now concrete.** The near-miss envelope and the reaction budget were tuned as a pair
   for the first time, and they do pull against each other exactly as §5A.3 predicted: a budget
   generous enough to make patterns fair puts most passes outside the lateral envelope, so near
   misses are rare. Both sets stay PROPOSED.
2. **`escape.maxActionsPerPattern` of 2 constrains the catalogue more than it looks.** A two-lane
   pair plus a mandatory jump is unsatisfiable from the far lane, because escaping the pair costs
   both actions. This is a design constraint, not a bug, and it shaped the pattern library.
3. **GE-1 now has a second dependant.** The scroll speed, the spawn cadence and the jump's
   coverage of a jumpable obstacle all sit on the fixed step, on top of the airborne-time
   coupling already recorded.

**Still OPEN and deliberately not implemented:** CR-2 (does a collision dip the speed or
interrupt a lane change — neither was added), CR-1 (mid-air lane changes, still PROPOSED as
permitted and relied on by the solver), DO-4 (difficulty influenced by heart count).

---

## 0AC. Implemented at M5 as named parameters — status deliberately unchanged

The game-core milestone put the following PROPOSED values into running code. They
live in one frozen module, `game/domain/tuning.ts`, each leaf annotated with its own
`@status`, and a test (`game/domain/tuning.spec.ts`, run by CI) fails if a tunable exists in
code without a row in [`../game/tuning-parameters.md`](../game/tuning-parameters.md), or carries a
status the registry does not agree with.

**Being implemented does not promote any of them.** They are listed here so the
adversarial audit can still change every one, and so nobody later reads "it is in the
code" as "it was approved". Only the product owner promotes a status.

| Ref | Value now in code | Status |
| --- | --- | --- |
| CR-3 | `road.widthRatio 0.72`, lane pitch = road width / 3 | **PROPOSED** |
| GE-1 | Fixed step `120 Hz` (`sim.fixedStepHz`), catch-up bounded to `sim.maxCatchUpSteps` | **OPEN** — implemented, not decided. The M5 audit found this is **not independent of the approved 650 ms jump**: airborne time is quantised to whole steps, so it is exact at 120 Hz and drifts up to +16.7 ms at 60 Hz. Deciding the rate decides the arc. |
| — | Lane transition `160 ms`, occupancy switching at the midpoint | **PROPOSED** |
| — | Input buffer depth 1, `input.bufferMs 120` | **PROPOSED**, and see the note below |
| — | Swipe: min `24 px`, max `400 ms`, axis dominance `1.5` | **PROPOSED** |
| — | Jump apex `96 px`; gravity and initial velocity **derived** from it and from the airborne target | **PROPOSED** |
| — | Run start: `1500 ms` readiness beat | **PROPOSED** |

Only `jump.airborneMs = 650` and the three-lane count are APPROVED, and the arc is
built so the approved number cannot drift: `airborneMs` and `apexHeightPx` are the
only stored figures, and gravity and launch velocity are computed from them.

**One interaction the review should look at.** `input.bufferMs` (120) is shorter than
`lane.transitionMs` (160), so an input buffered during the first 40 ms of a lane change
expires before the change completes and is silently dropped. Both numbers are PROPOSED
and each is defensible alone; the pair is not obviously right. Pinned by a test so a
change to either is visible.

CR-1 (mid-air lane changes) is implemented as proposed — a lane change may start while
airborne. CR-4 (a shortened readiness beat on resume) is **not** implemented: resume
returns directly to running. It belongs with the pause presentation, which M5 does not
build.

---

## 0AA. Resolved in M2 — now APPROVED and IMPLEMENTED

Ten ADR-0005 parameters and eight register items were decided during M2
implementation. The mechanism is documented in
`purrenade-api/docs/architecture/auth-architecture.md` (API side) and
[`../architecture/bff-and-session.md`](../architecture/bff-and-session.md)
(browser side).

| Decision | Resolution | Owning document |
| --- | --- | --- |
| **API-1** — error envelope | **RFC 9457 Problem Details**, `application/problem+json`, for every error. Extensions: a stable `code` (the value clients branch on), `correlation_id`, per-field `errors`, and `retry_after`. `type` is a **URN**, because the RFC does not require it to be dereferenceable and no documentation site exists to dereference. | `purrenade-api/docs/api/api-conventions.md` §3 |
| **API-2** — naming | **`snake_case`**, in requests, responses, extensions, contract and tests. | `purrenade-api/docs/api/api-conventions.md` §2 |
| **SEC-1** — password policy | **12–128 characters, no composition rules, breach-checked**, hashed with **argon2id**. The maximum is a refusal, never a silent trim — which is also why not bcrypt, whose 72-byte limit would make the policy a truncation bug. | `purrenade-api/docs/security/authentication.md` §2 |
| **SEC-2** — code and token rules | Verification code **10-minute TTL, 5 attempts, 42-second resend cooldown** (the number v0.3 renders), resend 5/hour per account. Concrete limits for every class. Provider: a driver abstraction, `log` locally — M2 depends on **no** purchased provider. | `purrenade-api/docs/security/rate-limiting.md` §2 |
| **AUTH-1** — unverified access | **Exactly four endpoints**: `me`, `email/verify`, `email/verify/resend`, `logout`. Two-factor enrolment and session management are *not* included. Enforced on the route group, with a test that asserts the allowance cannot widen. | `purrenade-api/docs/security/authorization-and-roles.md` §7 |
| **AUTH-2** — revoke-all scope | **Keeps the current session.** The action is "get everyone else out"; `POST /auth/logout` exists for the other intent. | `purrenade-api/docs/security/authentication.md` §6 |
| **AUTH-3** — lockout policy | **Progressive throttling, no lockout, ever.** A hard lockout turns credential stuffing into a reliable denial-of-service against any account whose address is known. Every limiter is two-dimensional, per identifier **and** per source. | `purrenade-api/docs/security/rate-limiting.md` §2 |
| **2FA-1** — recovery codes | **8 codes**, one hashed row each, single use enforced by an atomic conditional update. Regeneration requires the current password and invalidates the whole previous set. | `purrenade-api/docs/security/two-factor.md` §4 |
| **2FA-2** — challenge point | **At login.** Step-up rejected for v1; per-request `current_password` covers the risk it addressed. | `purrenade-api/docs/security/two-factor.md` §6 |
| **ADR-0005** q1–q10 | All resolved: token-mode Sanctum, two-tier timeouts, synchroniser CSRF at the BFF, challenge at login, admin 2FA enforced on the route group via a token ability, 8 hashed recovery codes, token-row sessions with coarse device labels and no IP, the password policy above, the verification rules above, and throttling without lockout. | [ADR-0005](../decisions/ADR-0005-authentication-and-2fa-strategy.md) |
| **AUTH-4** — device labelling | **Partly resolved.** A coarse server-derived label (`Chrome on Android`) is implemented; the raw User-Agent is never stored. **IP address and location remain OPEN** — they need a geo-IP source and a retention policy decided together, and storing the address early would create the obligation before the decision. | `purrenade-api/docs/architecture/auth-architecture.md` §8 |

---

## 0AH. Resolved at M8 — now APPROVED

The tutorial's four open questions, and where "replay tutorial" lives. All five were decided
by the product owner at the M8 planning review; none was promoted by implementation.

| Decision | Outcome | Owning document |
| --- | --- | --- |
| **TU-1 / #12** — tutorial visual design treatment | **Derived from the production visual system**, not commissioned. Milestones A, B and C established the tokens, typography, card and dialog language, the world, Ayşenur, the cone, the barrier, the Paw Token and the SLAYYY control; the tutorial uses those and **introduces no new visual asset family**. `RenderSnapshot` gained nothing, because a tutorial prop is an ordinary obstacle or token in the lane the script chose. The seven criteria §7 set are each answered there. **This unblocks M8.** | [tutorial](tutorial.md) §7 |
| **TU-2** — mandatory or skippable? | **Skippable**, with a restrained affordance and a confirmation that defaults to *continue*. A skip counts as completion for routing and is recorded through the same call a finish makes. | [tutorial](tutorial.md) §4.1 |
| **TU-3** — does the tutorial paw count toward progression? | **It does not**, confirming the standing proposal. Structurally so: the tutorial submits nothing, the paw cycle starts at zero, and one scripted token cannot reach the 200-paw threshold. | [tutorial](tutorial.md) §3.1 |
| **TU-4** — a separate first-SLAYYY coach mark? | **No — the tutorial teaches SLAYYY**, which reverses the earlier decision that excluded it. The objection that stood behind that exclusion (the meter cannot fill inside a short tutorial) is answered by a tutorial-scoped readiness grant that leaves `chargePerSecond`, `chargePerPaw` and every activation rule untouched. | [tutorial](tutorial.md) §2.2 |
| **SI-2** — where "replay tutorial" lives on Settings | **Its own section on board 18, between Language and Account.** It is the one row on that screen that *starts* something rather than changing a setting, so filing it under Account would put an action among preferences. A plain link: a replay grants nothing and cannot affect the player's completed status, so there is nothing to confirm. | [screen-inventory](screen-inventory.md) §6 |

**TU-5 is untouched and remains OPEN.** The tutorial does not demonstrate a near miss; whether
it eventually should is still a product question, and shipping M8 does not decide it.

---

## 0B. Resolved in Milestone C — now APPROVED

| Decision | Outcome | Owning document |
| --- | --- | --- |
| **SI-7** — confirming an abandoned run | **The leave control pauses instead of navigating.** Leaving is not undoable — there is no revive and no continue — and the control sat one tap from the corner of a phone screen with a live run behind it. *Return to menu* is now reached through the pause screen, which already offers it beside *resume*, so the confirmation is approved UX doing a second job rather than a dialog invented for the purpose. A run that has not started — still loading, or failed to load — keeps the direct exit, because there is nothing to pause and nothing to lose. | [screen-inventory](screen-inventory.md) §4 |
| **Run-complete truthfulness** | **Board 13 ships without the record, the achievement chip and the audio controls, and board 14 is not built.** Each states something the frontend cannot source: there is no personal best anywhere in it, no achievement is evaluated client-side, and Phaser is started with `audio: { noAudio: true }`. The record slot carries the honest sentence instead — that saving progress arrives later. Nothing here is a decision *against* those elements; each returns with the milestone that makes it true (M9, M11, M12). | [screen-inventory](screen-inventory.md) §4 |
| **`run.scopeNotice` retired** | The orphaned key listed the build's features and was rendered nowhere. Its one durable clause — progress saving arrives in a later milestone — is now `run.complete.persistenceNotice`, where it does a job. `run.ended` was removed with it: it told the player to leave and re-enter to play again, which stopped being true when Replay arrived. | [localization](localization.md) |

**`CR-4` is untouched.** Resuming still restores the phase it left; the shortened
readiness beat remains PROPOSED and unimplemented. Shipping the pause screen does
not decide it.

---

## 0A. Resolved in M0.6 — now APPROVED

| Decision | Outcome | Owning document |
| --- | --- | --- |
| **Audio controls** (was #10, SI-3) | **Option C.** Settings owns **music and SFX volume sliders**; Pause exposes **quick mute/unmute** for each. **Mute is independent of volume** — unmuting restores the previous non-zero level, and mute is never stored as `volume = 0`. Four persisted fields. A deliberate deviation from both v0.3 boards. | [screen-inventory](screen-inventory.md) §7A |
| **Character unlocks** (was AU-4) | **Büşo** best accepted single-run ≥ 2,500 · **Ogito** 10 accepted runs with **no** minimum-duration criterion · **Sero** 3 lifetime **actual** Loli activations. | [achievements-and-unlocks](achievements-and-unlocks.md) §2.2 |
| **Loli activation is a distinct fact** | **Threshold earned ≠ queued ≠ activated.** An activation counts only on the **ENTERING/ACTIVE transition**. The accepted run exposes `loliActivations`, derived from validated telemetry — **never inferred from the paw ledger**, because run-scoped queued bonuses can expire unstarted. | [achievements-and-unlocks](achievements-and-unlocks.md) §1.5A |
| **Two-column verification model** | **Verification Source** (`DERIVED_PERSISTENT` / `DERIVED_TELEMETRY`) is separated from **Progress Persistence** (`PERSISTED_AGGREGATE` / `RUN_FACT`). Governing rule: *storing a cumulative total never reclassifies where its evidence came from.* Catalogue counts corrected to **9 / 7** by source, **10 / 6** by persistence. | [achievements-and-unlocks](achievements-and-unlocks.md) §1.4 |
| **Leaderboard core rules** (was LB-1, LB-2, LB-4) | Monday 00:00 **Europe/Istanbul**, attributed by server-recorded run start · `score DESC` → earlier `achieved_at` → shorter `duration_ms` → stable id · cursor pagination, default 25 / max 100 · banned users hidden publicly and retained for audit · public opt-out supported. | [leaderboards](leaderboards.md) §3.2, §4, §5 |
| **Display-name v1 baseline** (was LB-3) | 3–20 chars · Unicode letters/digits plus `_` `.` `-` · at least one letter · no leading/trailing punctuation · case-insensitive uniqueness · rate-limited changes · **admin force-rename**. Profanity screening and homoglyph detection are **future hardening, not v1 blockers**. | [leaderboards](leaderboards.md) §5.1 |
| **Minimum admin set** (was SI-1) | Six capabilities: user lookup · suspend/unsuspend · run inspection · run invalidation with mandatory reason · leaderboard/display-name moderation · audit log inspection. CMS, arbitrary data editing, granting progression, impersonation and bulk export are approved as **out of scope**. | `purrenade-api/docs/api/endpoints/admin.md` |
| **Telemetry retention latitude** | **Raw events need not be retained forever.** The implementation may **validate raw telemetry at acceptance and persist compact authoritative derived run facts**, discarding the raw events, where that satisfies replay, audit and security. The data-minimizing option is explicitly permitted; **ANTI-5 then chose it** — see §0AI. | [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md) |

**Retired in M0.6:** `AU-7` (Ogito minimum duration), and the counters `lifetimeScore`,
`maxLoliBonusInSingleRun`, `accepted_runs_above_min_duration`.

---

## 0. Resolved in M0.5 — now APPROVED

Recorded so their history is traceable and they are not reopened by accident.

| Decision | Outcome | Owning document |
| --- | --- | --- |
| **Auth transport** (was ARCH-1, ARCH-3) | **Nuxt BFF with server-managed session cookies** over a token-capable Laravel API. Laravel/Fortify/Sanctum remains the authentication authority. No persistent bearer token in browser storage. A native bearer flow is preserved as a future capability and **not implemented in v1**. Nitro *is* the BFF, which resolves ARCH-3. | [ADR-0005](../decisions/ADR-0005-authentication-and-2fa-strategy.md) |
| **Password reset never touches 2FA** | A security **invariant**: a reset never disables, resets, or bypasses 2FA; enrolment, secret and recovery codes are untouched; the next login is still challenged. 2FA recovery is a separate process. Tested by gate `S8`. | `purrenade-api/docs/security/authentication.md` §4.1 |
| **Obstacle model** (was DO-1, DO-2, conflict #15) | Two semantic classes, decoupled from artwork: **`LANE_BLOCKING`** (traffic cone, avoided by lane change) and **`JUMPABLE`** (low seaside barrier, avoided by jump). No further speculative mechanics. | [difficulty-and-obstacles](difficulty-and-obstacles.md) §3.1 |
| **Near miss** (was #14, AU-3, CR-5) | A real v1 **statistic** mechanic: safely passing within a defined danger envelope; **at most one event per obstacle**; **no score and no multiplier**; deterministic and testable; leaderboard-relevant progress **server-verifiable from accepted run telemetry**. Geometric threshold remains PROPOSED tuning. | [core-run](core-run.md) §5A |
| **Loli Bonus queueing is run-scoped** | Only one bonus active at a time; a threshold crossed while active increments `queuedLoliBonuses` **for that run**; **all queue state ends with the run**; nothing carries forward. `loliCyclePaws` stays persistent. **No `owedLoliBonuses` field anywhere.** | [scoring-and-progression](scoring-and-progression.md) §2.4 |
| **Two achievements removed, one superseded** (was AU-2) | **Çay Molası** and **Trileçe Avcısı** removed as invalid — they need non-mechanics. **Koni Koleksiyoncusu** ("hit 25 cones") **superseded by product review** for rewarding intentional collision. | [achievements-and-unlocks](achievements-and-unlocks.md) §1.3 |
| **Achievement progression authority** | **Client-reported summary counters alone are insufficient.** The client emits telemetry, the server validates the run, and progression is **derived server-side**. Every achievement is `DERIVED_PERSISTENT` or `DERIVED_TELEMETRY`; `BOUNDED` is not an acceptable model. | [achievements-and-unlocks](achievements-and-unlocks.md) §1.4 |
| **Difficulty tier labels** | Relabelled **Tier 1–Tier 5** (one-indexed). Tier 5 begins at 180 s and is terminal. The start times were corrected and **APPROVED at M6**; which patterns each tier admits remains PROPOSED. | [difficulty-and-obstacles](difficulty-and-obstacles.md) §2.3 |

**Retired reference ids.** `ARCH-1`, `ARCH-3`, `AU-2`, `AU-3`, `AU-4`, `AU-7`, `CR-5`, `DO-1`,
`DO-2`, `DM-5`, `DM-6`, `LB-1`, `LB-2`, `LB-3`, `LB-4`, `SI-1` and `SI-3` are resolved and no
longer appear in any owning document. They are named in §0 and §0A only so the history is
traceable, and are **never reused** for a new question.

---

## 1. OPEN — blocking a specific milestone

These stop work when their milestone is reached.

| Ref | Decision | Blocks | Source |
| --- | --- | --- | --- |
| **AU-1** | **Approval of the proposed 16-achievement catalogue**, as a whole. The authoring gap is closed; this is now a review item. | **M11** | [achievements-and-unlocks](achievements-and-unlocks.md) §1.5 |
| ~~**ANTI-5**~~ | **Resolved by ADR-0006** — data minimization; see §0AI. |  | `purrenade-api/docs/security/anti-cheat.md` §2.1 |
| **ANTI-6** | **How the four `DERIVED_TELEMETRY` run facts are established** — obstacle passes by class, near misses, SLAYYY activations, actual Loli activations. Layers 1 and 2 bound them but cannot establish them, and Layer 3 is deferred, so **M9 neither persists nor returns them**. Blocks **seven of the sixteen** achievements and **Sero's unlock**. Adding Layer 3, designing another server-verifiable mechanism, or changing the affected behaviour are all open. Interacts with AU-1, SEC-5. | **M11** | `purrenade-api/docs/security/anti-cheat.md` §8 |
| **LB-5** | **Retention and anonymization policy for deleted players.** Genuinely OPEN — product/legal decision, not architecture. **No longer blocks M10 (D1, §0AJ)**; gates SEC-3 / account deletion. | **M14** | [leaderboards](leaderboards.md) §5.3 |
| **LO-1 / #17** | **English and Spanish copy.** Only Turkish exists. | **M4** onward | [localization](localization.md) §5 |
| ~~**ADR-0006**~~ | **Accepted 2026-09-22.** Layer 1 + Layer 2 in v1, Layer 3 deferred, no separate run token. **M9 and M10 are unblocked**; see §0AI. |  | [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md) |

---

## 2. OPEN — product and brand

| Ref | Decision | Source |
| --- | --- | --- |
| **#6** | Is there an approved **brand tagline**? *"Run Cute. Live Bright."* appears only on the ChatGPT board. If approved, is it localized? | [conflicts #6](design-reference-conflicts.md) |
| **SP-2** | **Bonus score sources.** Near-miss is now excluded, leaving the component with **no defined source at all**. Removing it from the score composition is a legitimate outcome. **M7 implemented the component and left it empty:** `score.bonusMilli` exists, is summed into the displayed total and is always zero, because nothing in the game is specified to write to it. A test asserts it stays zero across a long run, so the day a source is added it is added deliberately. | [scoring-and-progression](scoring-and-progression.md) §6 |
| **TU-5** | Does the tutorial **demonstrate a near miss**, or leave it to be discovered? It does not demonstrate one at M8. | [tutorial](tutorial.md) §2.2 |
| **SI-5 / AU-5** | Do **non-Ayşenur characters have their own special power**? PROPOSED: no — all share SLAYYY in v1. | [achievements-and-unlocks](achievements-and-unlocks.md) §2.4 |
| **SI-6 / AA-6** | **Avatar system** — uploaded, generated, or initials-based. An upload path adds storage, moderation and a new abuse surface. | [screen-inventory](screen-inventory.md) §9 |
| **AU-6** | What an achievement's hidden reward (*"gizli ödül"*) actually grants. | [achievements-and-unlocks](achievements-and-unlocks.md) |
| **AU-8** | Display text in **tr/en/es** for all 16 machine keys, once the catalogue is approved. | [achievements-and-unlocks](achievements-and-unlocks.md) §1.5 |
| **CR-2** | Does a collision interrupt an in-progress lane change or apply a speed dip? | [core-run](core-run.md) §5.5 |
| **CR-6** | **Near-miss envelope vs the escape-path reaction budget** — they pull against each other and must be tuned together during M6. | [core-run](core-run.md) §5A.3 |
| **DO-4** | May difficulty be influenced by the player's current heart count? | [difficulty-and-obstacles](difficulty-and-obstacles.md) §7 |
| ~~**PWA-1**~~ | **Resolved by ADR-0006:** connectivity is required to **start**; an already-started run survives a transient loss and its finish is retried under the same idempotency identity. See §0AI. | [`../architecture/pwa-and-mobile.md`](../architecture/pwa-and-mobile.md) |

---

## 3. OPEN — architecture, security, legal

| Ref | Decision | Owner |
| --- | --- | --- |
| ~~**ARCH-2**~~ | **Resolved by ADR-0006 (2026-09-22).** Layer 1 + Layer 2 in v1, Layer 3 deferred with the domain kept portable. Retired; see §0AI. | [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md) |
| ~~**SEC-1**~~ | **Resolved in M2.** 12–128 characters, no composition rules, breach-checked, argon2id. See §0AA. | `purrenade-api/docs/security/authentication.md` |
| ~~**SEC-2**~~ | **Resolved in M2** for code TTL, resend cooldown and rate-limit values — which is what SEC-2 tracks. The **transactional email provider** carve-out is no longer open: a provider was chosen and is in production — **Zoho Mail, EU region**, SMTP over TLS, with direct delivery and the queued verification flow both verified end to end at the first production deployment. Choosing it does **not** settle the data-protection posture around it — processor terms, retention at the provider and the processing-location analysis remain **OPEN under SEC-3**. | `purrenade-api/docs/security/rate-limiting.md` · `purrenade-api/docs/production/database-and-queue.md` §5 |
| **SEC-3** | **KVKK/GDPR flows** — account deletion, data export, consent capture, retention. Architecture is proposed; **policy is OPEN**. | `purrenade-api/docs/security/data-protection.md` |
| **SEC-4** | Published **security contact** and disclosure timeline. | `SECURITY.md` in both repositories |
| **SEC-5** | **Retention period for gameplay data.** **Materially narrowed by ADR-0006:** ANTI-5 resolved toward minimization, so **no raw per-event history is retained** and — while ANTI-6 is open — no telemetry-derived counters exist either. What remains is the retention *period* for the run records and compact derived facts that are kept. | `purrenade-api/docs/security/data-protection.md` §2A |
| **LR-1** | The **layered licensing model**. `LICENSE` stays a placeholder until decided. | [licensing-and-rights](licensing-and-rights.md) §1 |
| **LR-2 / #18** | **Consent records** for every real-person and real-animal likeness, covering commercial use, app-store distribution and marketing. | [licensing-and-rights](licensing-and-rights.md) §3 |
| **LR-3** | Are the repositories **public from the first commit** or later? | [licensing-and-rights](licensing-and-rights.md) |
| **OPS-1** | Environment matrix, hosting, secret management, backup/restore. **Now also covers operating the BFF as a stateful, security-relevant component.** **Substantially answered by the first production deployment (2026-09-15) and documented in `docs/production/` in both repositories** — hosting, the environment matrix, secret handling, the backup and migration procedure, and BFF session operation are all now recorded fact rather than proposal. **Still OPEN** for the shared session backend (OPS-2); proven restart/reboot survival and the manual resource baseline are resolved as OPS-5. | [`../production/README.md`](../production/README.md) · `purrenade-api/docs/production/` |
| **OPS-2** | **Shared session backend before any horizontal scaling.** The BFF session store is filesystem-backed, which is correct for exactly one Nitro instance and wrong for two. Redis/Valkey or equivalent is a prerequisite for multi-instance or HA. | [`../production/README.md`](../production/README.md) §4 |
| **OPS-4** | **Observability and product analytics architecture.** Three distinct concerns — operational observability, product analytics, gameplay telemetry — and no vendor chosen. Server-authoritative gameplay facts must stay distinct from client events (ARCH-2). Privacy, consent, retention and minimization decided first (SEC-3, SEC-5). | [`../production/README.md`](../production/README.md) §8 |
| ~~**OPS-5**~~ | **Resolved.** Controlled reboot survival, including an existing authenticated BFF filesystem session, is proven. The verified manual resource-monitoring baseline is documented in the operations procedure; automation and alerting remain OPS-4. | [`../production/operations.md`](../production/operations.md) §8 |
| **AA-3** | **Audio asset list, formats and licensing.** | [art-asset-requirements](art-asset-requirements.md) §7 |
| **ASSET-1** | Whether design/production binaries eventually move to **Git LFS or another asset strategy**. Deliberately not adopted in M0. | [`../architecture/asset-strategy.md`](../architecture/asset-strategy.md) |

---

## 4. PROPOSED — awaiting review

Recommendations written so they can be reviewed rather than left blank. They may
be implemented as named tuning parameters; they are **not** approved behavior.

### 4.1 The proposed 16-achievement catalogue

The full table, with both classification columns and rationale, is in
[achievements-and-unlocks](achievements-and-unlocks.md) §1.5.

Summary: **by verification source, 9 `DERIVED_PERSISTENT` and 7 `DERIVED_TELEMETRY`**; by
progress persistence, **10 `PERSISTED_AGGREGATE` and 6 `RUN_FACT`**. Three entries survive from
v0.3; thirteen are new; **none rewards collision, death, or deliberate failure**; every entry
has a stable machine key and counts accepted runs only.

`cone_dodger` reads: *successfully avoid 500 traffic cones across accepted runs; each safely
passed cone increments progress by one; a collision neither increments nor resets progress* —
it is **not** a collision-free streak.

### 4.2 Leaderboard — future hardening

Automated **profanity screening** in tr/en/es and **homoglyph/confusable impersonation
detection**. Both are deferred: each needs a real user base to tune against, and a naive filter
wrongly rejects legitimate names. **Admin force-rename is the approved v1 answer.** Neither
blocks M1 or v1 (LB-7).

### 4.3 Core run

| Ref | Proposal |
| --- | --- |
| CR-1 | **Mid-air lane changes are permitted.** |
| CR-3 | Road width `0.72` of the play column; lane pitch `road.width / 3`. |
| CR-4 | Resuming from pause replays a shortened readiness beat. |
| — | Lane transition `160 ms`, ease-out; collision lane changes at the **midpoint**. |
| — | Input buffer depth 1, `120 ms`. Swipe: min `24 px`, max `400 ms`, axis dominance `1.5`. |
| — | Jump: `650 ms` airborne (APPROVED), apex `96 px`; gravity and velocity derived. No double jump, no variable height, no airborne invulnerability. |
| — | Hitboxes: AABB at `0.60 ×` sprite width, `0.80 ×` height. |
| — | Post-hit invulnerability `1200 ms`, blink `10 Hz`, reduced-motion aware, never a full-screen flash. |
| — | Run start: `1500 ms` readiness beat; no hazard reachable before `2500 ms`. |
| — | **Near-miss envelope:** lateral `1.25` lanes, longitudinal `0.75`, vertical clearance `0.40`. Tuned **with** the escape-path budget (CR-6). |

### 4.4 Difficulty

| Ref | Proposal |
| --- | --- |
| DO-3 | Soft caps: speed `1.00 → 1.85×`, density `0.25 → 0.55`, decisions/min `14 → 38`; asymptotic, time constant `90 s`. |
| — | Driven by **elapsed time**, not distance. |
| — | **Tiers 1–5** at 0 / 30 / 60 / 120 / 180 s; Tier 5 terminal. **APPROVED** at M6. |
| — | Escape-path budget: max 2 actions per pattern, `350 ms` reaction budget, validated across pattern **joins** and across **both verbs**. |

### 4.5 Scoring and progression

| Ref | Proposal |
| --- | --- |
| SP-1 | **SLAYYY charge rates:** max 100; `+1.6`/s; `+1.3`/paw; no decay. **Partly resolved at the M7 review.** This row used to carry a rate set *and* a "first activation around 40 s" estimate that contradicted each other — implemented as written, the meter armed at about 69 s. The product owner has now APPROVED the **target**: first availability around **35-45 s of a representative healthy run**, as a UX range rather than a timer. The rates were retuned to serve it and the result measured across four scenarios (§3.2). The rates themselves remain PROPOSED, so this row stays open for them. |
| SP-3 | The ×2 multiplier applies to **distance, collectible and bonus** alike. |
| SP-4 | **Loli grants no score multiplier.** Maximum multiplier is ×2; multipliers take the maximum, never the product. |
| SP-5 | The in-run paw HUD shows `loliCyclePaws` and switches to `n/200` within 25 of the threshold. Implemented as written from the M7 review; it had been showing `runPaws` in the plain form, which is the same number until the first bonus and wrong after it. |
| SP-6 | `10` points/second at base speed; integer, floored. **The per-paw half is resolved:** `score.perPaw` is **APPROVED / LOCKED at `10`** by the product owner at the M7 review, replacing a PROPOSED `5`. The distance rate and the rounding rule stay open. |
| SP-7 | Whether the HUD shows a queued-bonus indicator when `queuedLoliBonuses > 0`. **Not implemented at M7** — the HUD shows the active companion and nothing about the queue, because the question is open. |
| — | Loli magnet: `1.5` lanes **laterally**, `10` units **up the road**, pull `6.0` lane-units/s, Paw Tokens only. The longitudinal reach was added at the M7 review — without it the magnet repositioned tokens beyond the visible road, where the pull rate's "slow enough to be visible" intent cannot apply. |

### 4.6 Product and platform

| Ref | Proposal |
| --- | --- |
| LO-4 | Numbers are formatted in the **viewer's** locale. |
| AC-1 | Target **WCAG 2.2 AA** for non-canvas UI. |
| AC-2 | Colour independence achieved **structurally** rather than with a separate palette. |
| AA-5 | Art authored at 3× the 390 baseline; atlases for gameplay sprites; **no text in art**; **self-hosted fonts**. |
| — | Locale resolution: profile → device → `Accept-Language` → Turkish. |

---

## 5. How to resolve an item

1. Decide, and record the decision in the owning document with status **APPROVED**.
2. Remove the row from this register (or move it to the APPROVED note in the
   owning document).
3. If the decision changes previously approved behavior, follow the change report
   in `CONTRIBUTING.md` — current specification, evidence, alternative, benefits,
   risks, scope/migration impact, recommendation.
4. If it is an architecture or security decision, write or update the ADR.

---

## 6. Appendix — remaining open questions by owning document

Lower-level questions raised so far. They are not silent: each is recorded in the document
that owns it, and listed here so this register is the complete live list.

### 6.1 Frontend repository

| Ref | Owning document | Question |
| --- | --- | --- |
| AA-1 | [art-asset-requirements.md](art-asset-requirements.md) | SLAYYY visual variant for the `JUMPABLE` beach barrier. A development-master drawing is a candidate only and needs owner approval. |
| AA-2 | [art-asset-requirements.md](art-asset-requirements.md) | Full SLAYYY transformation set. Development-master examples reduce no approval requirement. |
| AA-4 | [art-asset-requirements.md](art-asset-requirements.md) | Who produces rights-cleared runtime character art, and on what schedule; development masters do not answer this. |
| AC-3 | [accessibility.md](accessibility.md) | Is there a low-motion gameplay variant beyond decoration reduction? |
| AC-4 | [accessibility.md](accessibility.md) | Are subtitles/captions needed for any audio? (None is known to carry meaning) |
| AC-5 | [accessibility.md](accessibility.md) | `--text-secondary` measures 3.2–4.1 : 1 and misses the AC-1 AA floor at caption size (§5A). Re-derive the token, or move every small-text usage to `--color-ink`? Found at M7; **M12 owns it**. |
| DO-5 | [difficulty-and-obstacles.md](difficulty-and-obstacles.md) | Whether patterns may span a SLAYYY activation boundary without adjustment |
| DO-6 | [difficulty-and-obstacles.md](difficulty-and-obstacles.md) | Whether additional art variants are needed per class beyond the cone and the beach barrier |
| GE-1 | [architecture/game-engine-integration.md](../architecture/game-engine-integration.md) | Fixed-step rate (PROPOSED 120 Hz). Implemented at 120 Hz at M5 as a tuning parameter; still OPEN — see §0AC |
| GE-2 | [architecture/game-engine-integration.md](../architecture/game-engine-integration.md) | Whether the render snapshot is rebuilt per frame or diffed. **Answered at M5: rebuilt** — eight primitive fields, cheaper to build than to diff. An engineering choice; no product review needed |
| GE-3 | [architecture/game-engine-integration.md](../architecture/game-engine-integration.md) | Whether the domain also runs server-side for validation — see [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md). If it ever does, the domain must be portable, which is an additional reason to keep it free of browser APIs. |
| LB-6 | [leaderboards.md](leaderboards.md) | Is there a friends-only or regional board? Nothing suggests one; recorded so it is not assumed |
| LB-8 | [leaderboards.md](leaderboards.md) | Opt-out surface: where the setting lives and what an opted-out player sees (§5.4) |
| LB-9 | [leaderboards.md](leaderboards.md) | Previous-week viewing: the interaction and API contract for looking at a retained past week (§3.3). Not shipped by M10 |
| LO-2 | [localization.md](localization.md) | Tone brief for translators (§5) |
| LO-3 | [localization.md](localization.md) | Is the brand tagline localized? — depends on whether a tagline is approved at all ([conflict #6](design-reference-conflicts.md)) |
| LR-4 | [licensing-and-rights.md](licensing-and-rights.md) | Trademark posture for the Purrenade name and wordmark |
| LR-5 | [licensing-and-rights.md](licensing-and-rights.md) | Contribution terms, if outside contributions are ever accepted |
| PWA-2 | [architecture/pwa-and-mobile.md](../architecture/pwa-and-mobile.md) | Does the service worker cache sprite atlases aggressively enough to make a repeat run start instantly, within the storage budget? |
| PWA-3 | [architecture/pwa-and-mobile.md](../architecture/pwa-and-mobile.md) | Is installability promoted in-product, or left to the browser? |
| PWA-4 | [architecture/pwa-and-mobile.md](../architecture/pwa-and-mobile.md) | Is a native shell actually planned, and on what horizon? |
| ~~RNG-1~~ | [game/determinism-and-rng.md](../game/determinism-and-rng.md) | **Resolved by [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md):** yes — the seed is server-issued. |
| ~~RNG-2~~ | [game/determinism-and-rng.md](../game/determinism-and-rng.md) | **Resolved by [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md):** no — no input log in v1; it belongs to the deferred Layer 3 design. |
| RNG-3 | [game/determinism-and-rng.md](../game/determinism-and-rng.md) | Fixed-step rate confirmation (PROPOSED 120 Hz) |
| SI-4 | [screen-inventory.md](screen-inventory.md) | Password policy (§2) |
| SP-8 | [scoring-and-progression.md](scoring-and-progression.md) | Whether an activation that is cut short by run end still counts (PROPOSED: yes — it started) |
| TU-5 | [tutorial.md](tutorial.md) | Does the tutorial demonstrate a near miss, or leave it to be discovered? |

### 6.2 Backend repository (`purrenade-api`)

| Ref | Owning document | Question |
| --- | --- | --- |
| ~~2FA-1~~ | `purrenade-api/docs/security/two-factor.md` | **Resolved in M2:** 8 codes; regeneration invalidates the previous set |
| ~~2FA-2~~ | `purrenade-api/docs/security/two-factor.md` | **Resolved in M2:** at login |
| 2FA-3 | `purrenade-api/docs/security/two-factor.md` | Account recovery when both factors are lost |
| 2FA-4 | `purrenade-api/docs/security/two-factor.md` | Admin lockout recovery |
| 2FA-5 | `purrenade-api/docs/security/two-factor.md` | Is WebAuthn planned beyond v1? |
| AD-1 | `purrenade-api/docs/api/endpoints/admin.md` | Is the admin surface part of this application or a separate one? (BA-2) |
| AD-2 | `purrenade-api/docs/security/authorization-and-roles.md` | Is more than one admin level needed? |
| AD-3 | `purrenade-api/docs/api/endpoints/admin.md` | Audit log retention (SEC-3, OB-3) |
| AD-4 | `purrenade-api/docs/security/authorization-and-roles.md` | Is admin access restricted by network or device in addition to 2FA? |
| AD-5 | `purrenade-api/docs/security/authorization-and-roles.md` | Per-capability request/response shapes for the approved six-capability admin console, to be contracted at M13 |
| ~~ANTI-1~~ | `purrenade-api/docs/security/anti-cheat.md` | **Resolved by [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md):** Layers 1 and 2; Layer 3 deferred beyond v1 with the domain kept portable. |
| ~~ANTI-2~~ | `purrenade-api/docs/security/anti-cheat.md` | **Resolved by [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md):** retained and honestly reported, but mutating no progression, ledger, personal best, run count or leaderboard eligibility. |
| ~~ANTI-3~~ | `purrenade-api/docs/security/anti-cheat.md` | **Resolved by [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md):** nobody in M9 — no appeal workflow and no actively serviced queue. M13 may add review tooling. |
| ~~ANTI-4~~ | `purrenade-api/docs/security/anti-cheat.md` | **Resolved by [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md):** structural rejection is separated from tuning-dependent flagging. The bound **values** remain an M9 implementation parameter, gated on tuning approval. |
| **ANTI-6** | `purrenade-api/docs/security/anti-cheat.md` | **How the four `DERIVED_TELEMETRY` run facts are established.** Until something can, they are neither persisted nor returned. **Blocks M11** — see §1. |
| ~~API-1~~ | `purrenade-api/docs/api/api-conventions.md` | **Resolved in M2:** RFC 9457 `problem+json` |
| ~~API-2~~ | `purrenade-api/docs/api/api-conventions.md` | **Resolved in M2:** `snake_case` |
| ~~API-3~~ | `purrenade-api/docs/api/api-conventions.md` | **Resolved by [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md)** for run submission: **no window** — the identity lives with the durable run history. |
| API-4 | `purrenade-api/docs/api/api-conventions.md` | Default and maximum pagination limits |
| API-5 | `purrenade-api/docs/api/api-conventions.md` | Is idempotency generalized beyond run submission? |
| API-6 | `purrenade-api/docs/api/api-conventions.md` | Whether the API exposes a distinct bearer scheme now, or only when the native client is built |
| ~~AUTH-1~~ | `purrenade-api/docs/security/authorization-and-roles.md` | **Resolved in M2:** four endpoints |
| ~~AUTH-2~~ | `purrenade-api/docs/security/authentication.md` | **Resolved in M2:** revoke-all keeps the current session |
| ~~AUTH-3~~ | `purrenade-api/docs/security/authentication.md` | **Resolved in M2:** progressive throttling, no lockout |
| AUTH-4 | `purrenade-api/docs/architecture/auth-architecture.md` | Device **labelling resolved in M2**; IP/location and its retention still OPEN |
| BA-1 | `purrenade-api/docs/architecture/backend-architecture.md` | Whether an event-driven internal design is warranted, or direct service calls suffice at this scale (PROPOSED: direct calls; events only where a genuine fan-out exists) |
| BA-2 | `purrenade-api/docs/architecture/backend-architecture.md` | Whether the admin surface is a separate route group in this application or a separate application |
| ~~BA-3~~ | `purrenade-api/docs/architecture/backend-architecture.md` | **Resolved at M10 (§0AJ):** inside the run-acceptance transaction. |
| CACHE-1 | `purrenade-api/docs/architecture/caching-and-redis.md` | Is Redis adopted at all, and at which milestone? |
| CACHE-2 | `purrenade-api/docs/architecture/caching-and-redis.md` | Redis or Valkey? |
| ~~CACHE-3~~ | `purrenade-api/docs/architecture/caching-and-redis.md` | **Resolved at M10 (§0AJ):** PostgreSQL. |
| CACHE-4 | `purrenade-api/docs/architecture/caching-and-redis.md` | Cache TTLs, once real traffic shapes are known. **M10 uses no cache**; this stays open for later traffic. |
| CH-1 | `purrenade-api/docs/api/endpoints/characters.md` | Does selecting a character affect gameplay at all in v1, or only presentation? |
| ~~DM-1~~ | `purrenade-api/docs/architecture/data-model.md` | **Resolved by [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md):** neither — **no `run_events` table** and no raw per-event history. |
| ~~DM-2~~ | `purrenade-api/docs/architecture/data-model.md` | **Resolved at M10 (§0AJ):** a maintained table. |
| DM-3 | `purrenade-api/docs/architecture/data-model.md` | Retention for `runs`, `paw_ledger`, `audit_log` (SEC-3) |
| DM-4 | `purrenade-api/docs/architecture/data-model.md` | What account deletion does to runs and leaderboard entries (LB-5, SEC-3) |
| DM-7 | `purrenade-api/docs/architecture/data-model.md` | Index strategy for the lifetime telemetry-derived counters once real query shapes exist. Deferred with the counters themselves — **ANTI-6**. |
| ~~GR-1~~ | `purrenade-api/docs/api/endpoints/game-runs.md` | **Resolved by [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md):** retained and excluded from ranking and progression, with the player told honestly. |
| ~~GR-2~~ | `purrenade-api/docs/api/endpoints/game-runs.md` | **Resolved by [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md):** no appeal path in M9. |
| ~~GR-3~~ | `purrenade-api/docs/api/endpoints/game-runs.md` | **Resolved by [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md):** no window; a stored request fingerprint makes the `409` rule enforceable. |
| ~~GR-4~~ | `purrenade-api/docs/api/endpoints/game-runs.md` | **Resolved by [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md):** no — one active run per user, enforced by a partial unique index; starting again resumes it. |
| ~~GR-5~~ | `purrenade-api/docs/api/endpoints/game-runs.md` | **Resolved by [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md):** not per-event. The four facts they feed are blocked on **ANTI-6** and are not established at M9. |
| OB-1 | `purrenade-api/docs/architecture/observability.md` | Log aggregation destination and retention |
| OB-2 | `purrenade-api/docs/security/data-protection.md` | Is an external error tracker acceptable? |
| OB-3 | `purrenade-api/docs/architecture/observability.md` | Audit log retention (SEC-3) |
| OB-4 | `purrenade-api/docs/architecture/observability.md` | Alerting thresholds, particularly on the run-rejection rate |
| PR-1 | `purrenade-api/docs/security/data-protection.md` | Can a player change their username? |
| PR-2 | `purrenade-api/docs/api/endpoints/profile.md` | Avatar source — uploaded, generated, or initials-based (SI-6). An upload path would add file storage, moderation, and a new abuse surface |
| QJ-1 | `purrenade-api/docs/architecture/queues-and-jobs.md` | Is Redis adopted, and therefore used as the queue driver? (CACHE-1) |
| ~~QJ-2~~ | `purrenade-api/docs/architecture/queues-and-jobs.md` | **Resolved at M10 (§0AJ):** inline, affected rows only, inside the finish transaction. |
| QJ-3 | `purrenade-api/docs/architecture/queues-and-jobs.md` | Which security notifications are sent, if any? Nothing in the approved surface requires them |
| QJ-4 | `purrenade-api/docs/architecture/queues-and-jobs.md` | Retention and alerting policy for failed jobs |
| RL-1 | `purrenade-api/docs/security/rate-limiting.md` | Fail open or fail closed when the limiter is unavailable? |
| RL-2 | `purrenade-api/docs/security/rate-limiting.md` | Is Redis adopted for rate limiting, and at which milestone? (CACHE-1) |
