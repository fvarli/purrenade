# Open and Proposed Decision Register

The single live list of everything not yet decided, and everything recommended
but not yet authoritative — **across both repositories**.

Sections 1–3 hold the decisions that block or shape milestones. Section 4 holds
the proposals awaiting review. **Section 6 indexes every remaining open question**
raised so far, so nothing is recorded only in a document nobody rereads.

**Last reviewed:** 2026-09-13 (M6 obstacles and collision — see §0AD; no status was promoted).

| Status | Meaning |
| --- | --- |
| **OPEN** | Unresolved. Requires a product-owner decision. **Must not be implemented or guessed.** |
| **PROPOSED** | A recommendation written so it can be reviewed. **Not authoritative.** May be implemented as a named tuning parameter, never presented as decided. |

**Neither is ever silently promoted to APPROVED.**

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
| **Telemetry retention latitude** | **Raw events need not be retained forever.** The implementation may **validate raw telemetry at acceptance and persist compact authoritative derived run facts**, discarding the raw events, where that satisfies replay, audit and security. The data-minimizing option is explicitly permitted; the retention *choice* remains ANTI-5. | [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md) |

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
| **ANTI-5** | **What validated event data is retained**, in what form and for how long. **Seven** achievements are `DERIVED_TELEMETRY`. Validating at acceptance and keeping only derived run facts is an **explicitly permitted** answer. Interacts with SEC-3 and SEC-5. | **M9**, **M11** | `purrenade-api/docs/security/anti-cheat.md` §2.1 |
| **TU-1 / #12** | **Tutorial visual design treatment.** Behavior is APPROVED; presentation has no v0.3 screen and must not be invented. | **M8** | [tutorial](tutorial.md) §7 |
| **LB-5** | **Retention and anonymization policy for deleted players.** Genuinely OPEN — product/legal decision, not architecture. | **M10**, **M14** | [leaderboards](leaderboards.md) §5.3 |
| **LO-1 / #17** | **English and Spanish copy.** Only Turkish exists. | **M4** onward | [localization](localization.md) §5 |
| **ADR-0006** | The run validation model itself, and **PWA-1** (offline play), which decides whether a server-issued run token is available. | **M9**, **M10** | [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md) |

---

## 2. OPEN — product and brand

| Ref | Decision | Source |
| --- | --- | --- |
| **#6** | Is there an approved **brand tagline**? *"Run Cute. Live Bright."* appears only on the ChatGPT board. If approved, is it localized? | [conflicts #6](design-reference-conflicts.md) |
| **SP-2** | **Bonus score sources.** Near-miss is now excluded, leaving the component with **no defined source at all**. Removing it from the score composition is a legitimate outcome. **M7 implemented the component and left it empty:** `score.bonusMilli` exists, is summed into the displayed total and is always zero, because nothing in the game is specified to write to it. A test asserts it stays zero across a long run, so the day a source is added it is added deliberately. | [scoring-and-progression](scoring-and-progression.md) §6 |
| **TU-2** | Is the first-time tutorial **mandatory or skippable**? | [tutorial](tutorial.md) §4 |
| **TU-3** | Does the **tutorial paw count** toward progression? PROPOSED: no, so the tutorial cannot be farmed. | [tutorial](tutorial.md) §3.1 |
| **TU-4** | Is there a separate **first-SLAYYY coach mark**? | [tutorial](tutorial.md) §2 |
| **SI-2** | Where **"replay tutorial"** lives on the Settings screen. | [screen-inventory](screen-inventory.md) §6 |
| **SI-5 / AU-5** | Do **non-Ayşenur characters have their own special power**? PROPOSED: no — all share SLAYYY in v1. | [achievements-and-unlocks](achievements-and-unlocks.md) §2.4 |
| **SI-6 / AA-6** | **Avatar system** — uploaded, generated, or initials-based. An upload path adds storage, moderation and a new abuse surface. | [screen-inventory](screen-inventory.md) §9 |
| **AU-6** | What an achievement's hidden reward (*"gizli ödül"*) actually grants. | [achievements-and-unlocks](achievements-and-unlocks.md) |
| **AU-8** | Display text in **tr/en/es** for all 16 machine keys, once the catalogue is approved. | [achievements-and-unlocks](achievements-and-unlocks.md) §1.5 |
| **CR-2** | Does a collision interrupt an in-progress lane change or apply a speed dip? | [core-run](core-run.md) §5.5 |
| **CR-6** | **Near-miss envelope vs the escape-path reaction budget** — they pull against each other and must be tuned together during M6. | [core-run](core-run.md) §5A.3 |
| **DO-4** | May difficulty be influenced by the player's current heart count? | [difficulty-and-obstacles](difficulty-and-obstacles.md) §7 |
| **PWA-1** | **Is a run playable offline?** Shapes both the PWA strategy and run validation. | [`../architecture/pwa-and-mobile.md`](../architecture/pwa-and-mobile.md) |

---

## 3. OPEN — architecture, security, legal

| Ref | Decision | Owner |
| --- | --- | --- |
| **ARCH-2** | **Run validation / anti-cheat model.** Leaderboards are in v1. Largest architectural risk in the product. | [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md) |
| ~~**SEC-1**~~ | **Resolved in M2.** 12–128 characters, no composition rules, breach-checked, argon2id. See §0AA. | `purrenade-api/docs/security/authentication.md` |
| ~~**SEC-2**~~ | **Resolved in M2** for code TTL, resend cooldown and rate-limit values — which is what SEC-2 tracks. The **transactional email provider** carve-out is no longer open: a provider was chosen and is in production — **Zoho Mail, EU region**, SMTP over TLS, with direct delivery and the queued verification flow both verified end to end at the first production deployment. Choosing it does **not** settle the data-protection posture around it — processor terms, retention at the provider and the processing-location analysis remain **OPEN under SEC-3**. | `purrenade-api/docs/security/rate-limiting.md` · `purrenade-api/docs/production/database-and-queue.md` §5 |
| **SEC-3** | **KVKK/GDPR flows** — account deletion, data export, consent capture, retention. Architecture is proposed; **policy is OPEN**. | `purrenade-api/docs/security/data-protection.md` |
| **SEC-4** | Published **security contact** and disclosure timeline. | `SECURITY.md` in both repositories |
| **SEC-5** | **Retention period and minimization for gameplay telemetry.** New in M0.5: derived-from-telemetry achievements mean per-event data is retained, and that data is **behavioural personal data**. Jointly with ANTI-5. | `purrenade-api/docs/security/data-protection.md` §2A |
| **LR-1** | The **layered licensing model**. `LICENSE` stays a placeholder until decided. | [licensing-and-rights](licensing-and-rights.md) §1 |
| **LR-2 / #18** | **Consent records** for every real-person and real-animal likeness, covering commercial use, app-store distribution and marketing. | [licensing-and-rights](licensing-and-rights.md) §3 |
| **LR-3** | Are the repositories **public from the first commit** or later? | [licensing-and-rights](licensing-and-rights.md) |
| **OPS-1** | Environment matrix, hosting, secret management, backup/restore. **Now also covers operating the BFF as a stateful, security-relevant component.** **Substantially answered by the first production deployment (2026-09-15) and documented in `docs/production/` in both repositories** — hosting, the environment matrix, secret handling, the backup and migration procedure, and BFF session operation are all now recorded fact rather than proposal. **Still OPEN** for the parts a single manual deployment cannot settle: the shared session backend (OPS-2), CI/CD and its secret handling (OPS-3), and proven restart survival (OPS-5). | [`../production/README.md`](../production/README.md) · `purrenade-api/docs/production/` |
| **OPS-2** | **Shared session backend before any horizontal scaling.** The BFF session store is filesystem-backed, which is correct for exactly one Nitro instance and wrong for two. Redis/Valkey or equivalent is a prerequisite for multi-instance or HA. | [`../production/README.md`](../production/README.md) §4 |
| **OPS-3** | **CI/CD design.** **Implemented and locally tested in both repositories** — `workflow_dispatch`-only deployment, a `production` environment, SHA-validated revisions proven reachable from `main` and CI-green, actions pinned to full commit SHAs, real SSH host verification, immutable releases with atomic activation, and a backup proven readable before any migration. **Still OPEN**: none of it has run against production, the operator bootstrap (deployment identity, narrow sudoers, environment, secrets, host-key material) is outstanding, and a first automated deployment has not been performed. Closing this on implementation alone would record a capability the project does not yet have. | [`../production/ci-cd.md`](../production/ci-cd.md) · `purrenade-api/docs/production/ci-cd.md` |
| **OPS-4** | **Observability and product analytics architecture.** Three distinct concerns — operational observability, product analytics, gameplay telemetry — and no vendor chosen. Server-authoritative gameplay facts must stay distinct from client events (ARCH-2). Privacy, consent, retention and minimization decided first (SEC-3, SEC-5). | [`../production/README.md`](../production/README.md) §8 |
| **OPS-5** | **Restart and reboot survival, and resource monitoring** on shared infrastructure. Units are enabled and expected to return; a controlled restart drill has not yet been performed. | [`../production/operations.md`](../production/operations.md) §8 |
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
| TU-3 | The tutorial paw does **not** count toward progression. |
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
| AA-1 | [art-asset-requirements.md](art-asset-requirements.md) | SLAYYY visual variant for the `JUMPABLE` beach barrier (§3) — the cone already has one |
| AA-2 | [art-asset-requirements.md](art-asset-requirements.md) | Full SLAYYY transformation set (§3) |
| AA-4 | [art-asset-requirements.md](art-asset-requirements.md) | Who produces the production character art, and on what schedule |
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
| LO-2 | [localization.md](localization.md) | Tone brief for translators (§5) |
| LO-3 | [localization.md](localization.md) | Is the brand tagline localized? — depends on whether a tagline is approved at all ([conflict #6](design-reference-conflicts.md)) |
| LR-4 | [licensing-and-rights.md](licensing-and-rights.md) | Trademark posture for the Purrenade name and wordmark |
| LR-5 | [licensing-and-rights.md](licensing-and-rights.md) | Contribution terms, if outside contributions are ever accepted |
| PWA-2 | [architecture/pwa-and-mobile.md](../architecture/pwa-and-mobile.md) | Does the service worker cache sprite atlases aggressively enough to make a repeat run start instantly, within the storage budget? |
| PWA-3 | [architecture/pwa-and-mobile.md](../architecture/pwa-and-mobile.md) | Is installability promoted in-product, or left to the browser? |
| PWA-4 | [architecture/pwa-and-mobile.md](../architecture/pwa-and-mobile.md) | Is a native shell actually planned, and on what horizon? |
| RNG-1 | [game/determinism-and-rng.md](../game/determinism-and-rng.md) | Is the run seed server-issued? Depends on [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md) and on the offline question (PWA-1) |
| RNG-2 | [game/determinism-and-rng.md](../game/determinism-and-rng.md) | Is an input log recorded and submitted with the run? Directly affects payload size and the validation model |
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
| ANTI-1 | `purrenade-api/docs/security/anti-cheat.md` | Which layers ship in v1 |
| ANTI-2 | `purrenade-api/docs/security/anti-cheat.md` | What a `flagged` run means for the player, and whether there is an appeal |
| ANTI-3 | `purrenade-api/docs/security/anti-cheat.md` | Who reviews flagged runs — an admin capability that does not exist yet (SI-1) |
| ANTI-4 | `purrenade-api/docs/security/anti-cheat.md` | Bound values, derived once the tuning values are APPROVED rather than PROPOSED |
| ~~API-1~~ | `purrenade-api/docs/api/api-conventions.md` | **Resolved in M2:** RFC 9457 `problem+json` |
| ~~API-2~~ | `purrenade-api/docs/api/api-conventions.md` | **Resolved in M2:** `snake_case` |
| API-3 | `purrenade-api/docs/api/api-conventions.md` | Idempotency key retention window |
| API-4 | `purrenade-api/docs/api/api-conventions.md` | Default and maximum pagination limits |
| API-5 | `purrenade-api/docs/api/api-conventions.md` | Is idempotency generalized beyond run submission? |
| API-6 | `purrenade-api/docs/api/api-conventions.md` | Whether the API exposes a distinct bearer scheme now, or only when the native client is built |
| ~~AUTH-1~~ | `purrenade-api/docs/security/authorization-and-roles.md` | **Resolved in M2:** four endpoints |
| ~~AUTH-2~~ | `purrenade-api/docs/security/authentication.md` | **Resolved in M2:** revoke-all keeps the current session |
| ~~AUTH-3~~ | `purrenade-api/docs/security/authentication.md` | **Resolved in M2:** progressive throttling, no lockout |
| AUTH-4 | `purrenade-api/docs/architecture/auth-architecture.md` | Device **labelling resolved in M2**; IP/location and its retention still OPEN |
| BA-1 | `purrenade-api/docs/architecture/backend-architecture.md` | Whether an event-driven internal design is warranted, or direct service calls suffice at this scale (PROPOSED: direct calls; events only where a genuine fan-out exists) |
| BA-2 | `purrenade-api/docs/architecture/backend-architecture.md` | Whether the admin surface is a separate route group in this application or a separate application |
| BA-3 | `purrenade-api/docs/architecture/backend-architecture.md` | The transaction boundary for leaderboard projection refresh — inside the submission transaction, or deferred |
| CACHE-1 | `purrenade-api/docs/architecture/caching-and-redis.md` | Is Redis adopted at all, and at which milestone? |
| CACHE-2 | `purrenade-api/docs/architecture/caching-and-redis.md` | Redis or Valkey? |
| CACHE-3 | `purrenade-api/docs/architecture/caching-and-redis.md` | Is the leaderboard projection in PostgreSQL or in Redis? |
| CACHE-4 | `purrenade-api/docs/architecture/caching-and-redis.md` | Cache TTLs, once real traffic shapes are known |
| CH-1 | `purrenade-api/docs/api/endpoints/characters.md` | Does selecting a character affect gameplay at all in v1, or only presentation? |
| DM-1 | `purrenade-api/docs/architecture/data-model.md` | What form validated event retention takes — per-event records or per-run derived counts (ANTI-5). *That* some retention exists is no longer in question. |
| DM-2 | `purrenade-api/docs/architecture/data-model.md` | Weekly window: partitioned table, materialized view, or maintained table (LB-1) |
| DM-3 | `purrenade-api/docs/architecture/data-model.md` | Retention for `runs`, `paw_ledger`, `audit_log` (SEC-3) |
| DM-4 | `purrenade-api/docs/architecture/data-model.md` | What account deletion does to runs and leaderboard entries (LB-5, SEC-3) |
| DM-7 | `purrenade-api/docs/architecture/data-model.md` | Index strategy for the lifetime telemetry-derived counters once real query shapes exist |
| GR-1 | `purrenade-api/docs/api/endpoints/game-runs.md` | What a `flagged` run means for the player: hidden, held, or rejected |
| GR-2 | `purrenade-api/docs/api/endpoints/game-runs.md` | Is there an appeal path, and who reviews |
| GR-3 | `purrenade-api/docs/api/endpoints/game-runs.md` | Idempotency key retention window (API-3) |
| GR-4 | `purrenade-api/docs/api/endpoints/game-runs.md` | May a player hold two runs open at once? |
| GR-5 | `purrenade-api/docs/api/endpoints/game-runs.md` | Do near-miss, obstacle-pass, SLAYYY-activation and Loli-activation events arrive per-event, or as counts derived at acceptance? (ANTI-5) — the latter is explicitly permitted |
| OB-1 | `purrenade-api/docs/architecture/observability.md` | Log aggregation destination and retention |
| OB-2 | `purrenade-api/docs/security/data-protection.md` | Is an external error tracker acceptable? |
| OB-3 | `purrenade-api/docs/architecture/observability.md` | Audit log retention (SEC-3) |
| OB-4 | `purrenade-api/docs/architecture/observability.md` | Alerting thresholds, particularly on the run-rejection rate |
| PR-1 | `purrenade-api/docs/security/data-protection.md` | Can a player change their username? |
| PR-2 | `purrenade-api/docs/api/endpoints/profile.md` | Avatar source — uploaded, generated, or initials-based (SI-6). An upload path would add file storage, moderation, and a new abuse surface |
| QJ-1 | `purrenade-api/docs/architecture/queues-and-jobs.md` | Is Redis adopted, and therefore used as the queue driver? (CACHE-1) |
| QJ-2 | `purrenade-api/docs/architecture/queues-and-jobs.md` | Is the leaderboard projection refreshed by job or inline? (BA-3) |
| QJ-3 | `purrenade-api/docs/architecture/queues-and-jobs.md` | Which security notifications are sent, if any? Nothing in the approved surface requires them |
| QJ-4 | `purrenade-api/docs/architecture/queues-and-jobs.md` | Retention and alerting policy for failed jobs |
| RL-1 | `purrenade-api/docs/security/rate-limiting.md` | Fail open or fail closed when the limiter is unavailable? |
| RL-2 | `purrenade-api/docs/security/rate-limiting.md` | Is Redis adopted for rate limiting, and at which milestone? (CACHE-1) |
