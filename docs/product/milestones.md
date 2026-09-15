# Milestones

**v1 scope is the entire approved Claude Design v0.3 product surface.** Scope is
not reduced for convenience. It is also not implemented in a single pass:
delivery is broken into milestones with explicit dependencies, acceptance
criteria, tests, and regression gates.

Milestones span **two independent repositories**. A milestone that touches both
produces **separate commits in each**; the repositories are never merged.

**No milestone begins without explicit approval.**

---

## Rules that apply to every milestone

1. **Entry:** read the specification, inspect both repositories, inspect the
   relevant design references, research current practice, document findings that
   materially affect implementation, and identify conflicts with approved
   decisions. A meaningful conflict **stops the milestone** and is reported.
2. **Exit:** tests added/updated, regression gates green, documentation updated,
   final diff reviewed for scope creep and regressions.
3. **No OPEN decision is implemented.** A milestone blocked on an OPEN decision
   stops and reports rather than guessing.
4. **No PROPOSED value is presented as approved.** It may be implemented as a
   named tuning parameter, but its status stays PROPOSED until reviewed.
5. **Engineering standards apply throughout** —
   [`../architecture/engineering-standards.md`](../architecture/engineering-standards.md).

---

## Overview

| M | Milestone | Repos | Depends on | Status | Delivered in |
| --- | --- | --- | --- | --- | --- |
| **M0** | Documentation foundation, API contract, ADRs | both | — | **DELIVERED** | M0, then M0.5 and M0.6 |
| **M1** | Runtime pre-flight and repository bootstrap | both | M0 | **DELIVERED** | M1, completed by M1C |
| **M2** | Backend auth core | api | M1 | **DELIVERED** | executed M2 |
| **M3** | 2FA, roles, admin gate, session/device management | api | M2 | **DELIVERED** — absorbed by executed M2 | executed M2 |
| **M4** | Frontend shell: i18n, tokens, auth UI, profile/settings scaffolding | web | M1, M2 | **DELIVERED** except the profile and settings screens, which M12 owns in full | executed M2 |
| **M5** | Game core: engine boundary, lanes, input, jump | web | M1 | **DELIVERED** — frozen at `1658f4b` | — |
| **M6** | Obstacles, patterns, collision, hearts, difficulty | web | M5 | **DELIVERED** — frozen at `cf4a07b` | — |
| **M7** | Paws, SLAYYY, Loli Bonus, HUD | web | M6 | **DELIVERED** — implemented, audited twice, remediated, frozen at `3d3909d` | — |
| **M8** | Interactive tutorial | web | M7 + tutorial design | Not started | — |
| **M9** | Run lifecycle API, anti-cheat boundary, progression persistence | both | M3, M7 | Not started | — |
| **M10** | Leaderboards | both | M9 | Not started | — |
| **M11** | Achievements and character unlocks | both | M9 | Not started | — |
| **M12** | Support screens, PWA, accessibility, responsive/desktop | web | M4, M7 | Not started | — |
| **M13** | Admin panel | both | M3, M10 | Not started | — |
| **M14** | Hardening: performance, security, observability, KVKK, release readiness | both | all | Not started | — |

### Delivery history, and why the numbers do not line up

The **M** identifiers above are canonical and do not change. Roughly forty cross-references in both
repositories point at them — "resolved at M2", "blocks M9", "to be contracted at M13" — and
renumbering would invalidate every one of those while fixing nothing.

Delivery did not follow them one-for-one, and this table records what actually happened:

| Delivery label | What it was | Roadmap milestones it delivered |
| --- | --- | --- |
| M0 | Documentation foundation | M0 |
| M0.5 | Decision pass — ADR-0005 accepted, obstacle model and other blockers resolved | *(unblocked M2, M3, M6)* |
| M0.6 | Decision normalization — leaderboard, unlock and admin-scope decisions | *(unblocked M10, M11, M13)* |
| M1 | Repository bootstrap | M1 |
| M1C | Runtime completion — root route, readiness probe, systemd services | M1 |
| **M2** | Authentication and access foundation | **M2 and M3**, plus most of M4 |
| M7.1 | Production readiness — safe initial administrator bootstrap (`purrenade:admin:promote`) | *(no roadmap milestone; unblocked the first production deployment)* |

So the scope written under **M3** — TOTP enrolment, challenge and disable; recovery codes; the
`player`/`admin` roles; mandatory admin 2FA; session listing and revocation — shipped inside the
commit labelled M2, and is documented as M2 throughout both repositories. M3 is **delivered by
absorption**, not skipped and not outstanding. No empty milestone is manufactured to occupy the
number, and no frozen commit is re-labelled.

M0.5, M0.6 and M1C were execution-only passes, and so is **M7.1** — a backend-only
production-readiness pass that added the supported way to establish the first administrator,
frozen at `8046fb5`. None of them is a roadmap milestone, and none occupies a number in the
overview table above: the delivery history is where an execution-only pass is recorded.

**The next implementation milestone is M8, Interactive tutorial** — blocked on the tutorial
visual design treatment (OPEN). M5, M6 and M7 are delivered and frozen.

---

## M0 — Documentation foundation — DELIVERED

**Deliverables:** repository hygiene; documentation structure in both
repositories; Product/Game Specification v1 draft; API contract draft; ADR-0001…
0008; open/proposed decision register; this milestone plan.

**Explicitly not in M0:** scaffolding Nuxt or Laravel, installing dependencies,
upgrading PHP or Node, application code, migrations, endpoints, gameplay,
commits, pushes.

**Acceptance criteria**
- Every approved v0.3 screen appears in the screen inventory.
- Every conflict found is in the conflict register with a resolution or an OPEN marker.
- Every OPEN and PROPOSED item appears in the decision register.
- The OpenAPI draft validates and covers every endpoint the frontend expects.
- Nothing is bootstrapped; no commit exists.

---

## M1 — Runtime pre-flight and repository bootstrap — DELIVERED

**Pre-flight, before installing anything:**
- Re-verify current stable versions and their **mutual compatibility**. Findings
  in [`../architecture/versions-and-runtime.md`](../architecture/versions-and-runtime.md)
  are research, not pins. Prefer the newest stable **compatible** stack.
- Upgrade the local runtime: **PHP → 8.4**, **Node → 24 LTS**.
- Confirm the PWA module's compatibility with the chosen Nuxt version, or adopt
  the documented fallback.

**Deliverables:** Nuxt skeleton (TypeScript, no features); Laravel skeleton
(PostgreSQL, no features); CI in both repositories — install, lint, typecheck/static
analysis, test, build; formatting and static-analysis gates; `.env.example` in both;
dependency/license inventory started.

**Acceptance criteria**
- Both repositories build and test green from a clean checkout.
- CI fails on a lint, type, static-analysis, or test error.
- No feature code exists beyond framework defaults.
- Versions actually installed are recorded with the date they were verified.

---

## M2 — Backend auth core — DELIVERED

**Unblocked by M0.5:** [ADR-0005](../decisions/ADR-0005-authentication-and-2fa-strategy.md) is
now **Accepted** — Nuxt BFF with server-managed session cookies over a token-capable Laravel
API. Package and parameter choices are made here, after re-researching current best practice.

**Deliverables:** registration; email/password login; **email verification by
6-digit code** with resend cooldown and TTL; **password reset by emailed link** that
**never disables, resets, or bypasses 2FA**; password policy; queued transactional email;
rate limiting on every auth endpoint; the error envelope from `api-conventions.md`;
the BFF session and its CSRF boundary.

**Acceptance criteria**
- Every flow matches the approved v0.3 behavior (code for verification, link for reset).
- Authorization and validation are server-side; no endpoint trusts the client.
- Rate limits are enforced per identifier and per IP, and are tested.
- OpenAPI matches the implementation exactly.

**Tests:** happy path and failure path per flow; expired/replayed/tampered codes
and tokens; resend cooldown; rate-limit behavior; enumeration resistance on
login, registration and forgot-password; **a completed password reset leaves 2FA enrolment,
secrets and recovery codes untouched, and the next login still requires the 2FA challenge**.

---

## M3 — 2FA, roles, admin gate, sessions — DELIVERED (absorbed by executed M2)

> Delivered inside the commit labelled **M2** and documented as M2 throughout both repositories.
> Every deliverable below has code and tests; every acceptance criterion is covered by the frozen
> suite. Kept here unchanged, with its canonical number, because other documents reference it.


**Deliverables:** TOTP enrolment, challenge, and disable; recovery codes
(generation, single use, regeneration); roles `player` and `admin`; **mandatory
2FA for admin**, enforced server-side; active session/device listing, per-session
revocation, and revoke-all.

**Acceptance criteria**
- An admin without 2FA cannot reach any admin-authorized action, by any route.
- Recovery codes are single-use and stored irreversibly.
- Revoking a session immediately invalidates its credentials.
- Authorization is enforced at the server boundary, not in the UI.

**Tests:** admin-without-2FA is denied on every admin endpoint; recovery-code
replay fails; session revocation takes effect immediately; role escalation
attempts fail.

---

## M4 — Frontend shell — DELIVERED except the profile and settings screens

**Deliverables:** locked design tokens; typography; i18n with tr/en/es and
instant switching; auth screens 02–07 wired to M2; language selection; profile
and settings scaffolding; typed API client with error mapping and correlation IDs.

**Acceptance criteria**
- Language switches instantly with no reload, including before authentication.
- No player-facing string is hard-coded or baked into an image.
- Layouts hold at 390 × 844 in the longest locale.
- Route guards are convenience only; removing them exposes no unauthorized data.

---

## M5 — Game core — DELIVERED, FROZEN

**Deliverables:** the **pure game-rules core** — deterministic, engine-free,
unit-testable; the Phaser↔Nuxt boundary; three lanes; touch and keyboard input
with buffering; jump; the tuning-parameter module.

**Acceptance criteria**
- Game rules run and are tested **without Phaser**.
- No gameplay literal exists outside the tuning module.
- Jump matches the approved ~650 ms airborne target and is deterministic.
- Phaser state does not leak into Vue/Nuxt UI.
- Gameplay gestures never scroll, zoom, or refresh the page.

**Tests:** deterministic replay from a seed; input buffering; lane clamping at
the edges; jump arc timing.

---

## M6 — Obstacles, patterns, collision, hearts, difficulty — DELIVERED, FROZEN

**Unblocked by M0.5:** the two-class obstacle model is APPROVED
([conflict #15](design-reference-conflicts.md) resolved).

**Deliverables:** the `LANE_BLOCKING` / `JUMPABLE` taxonomy with behaviour decoupled from art;
authored pattern library; difficulty-aware weighted pools across Tiers 1–5; the
**escape-path validator** reasoning over both verbs; collision and hitboxes;
**near-miss detection**; hearts and post-hit invulnerability; the soft-capped difficulty
curve.

**Acceptance criteria**
- **Every pattern is survivable from every starting lane** within the action and
  reaction-time budget — proven by property tests, not inspection.
- Pattern **joins** are survivable, not only patterns in isolation.
- A pattern mixing both classes is survivable using **both** verbs: a `JUMPABLE` obstacle is
  cleared while airborne and a `LANE_BLOCKING` obstacle is not.
- An obstacle's class **never changes**, including during SLAYYY.
- **Near-miss detection is deterministic, fires at most once per obstacle, and awards no score.**
- Difficulty never exceeds its soft caps.
- Maximum health is 3 and nothing restores a heart.

**Status:** implemented, adversarially audited, remediated, and remediated again for the
pre-freeze SSR/auth integration defect the audit surfaced. Frozen at `cf4a07b`.

Every number introduced here stays PROPOSED unless the registry says otherwise — shipping one does
not approve it. The one exception is `difficulty.tierStartsS`, which the product owner approved
during the M6 remediation: the tier **start times** are now APPROVED, while the soft-cap ceilings
DO-3 also asks about remain open.

**Two things the implementation had to settle, and both are recorded rather than decided:**

- A two-lane pair and a mandatory jump **cannot share one pattern** under
  `escape.maxActionsPerPattern` of 2: escaping a pair from the far lane already costs both
  actions. The solver refused the first draft of `pair-then-barrier` for exactly this reason,
  and the catalogue was rewritten rather than the budget raised.
- The jump arc covers a jumpable obstacle by about **50 ms at the base scroll speed** — the
  overlap window is the obstacle's length plus the player's, 1.8 units, which is 600 ms at
  3 units/s against a 650 ms arc. It gets *easier* as the run speeds up. Comfortable enough to
  ship as PROPOSED, tight enough to be worth a look during review.

**Tests:** per-pattern and pattern-join property tests; seeded long-run fuzz with
a reference solver; invulnerability window; heart-cap invariants.

---

## M7 — Paws, SLAYYY, Loli Bonus, HUD — DELIVERED, FROZEN

**Deliverables:** Paw Tokens and the three counters; the 200 threshold with
overflow preservation; SLAYYY charge, **manual activation** (mobile affordance,
desktop `E`), duration, ×2, invulnerability and world transformation; Loli Bonus
with magnet and no invulnerability; overlap handling; the full HUD with desktop
parity.

**Acceptance criteria**
- SLAYYY **never auto-activates**.
- Overflow is preserved exactly (198 + 5 → bonus, cycle = 3).
- **Queued Loli Bonuses are run-scoped:** a threshold crossed while Loli is active increments
  `queuedLoliBonuses`; the next starts when the active one exits; **all queue state ends with
  the run**, and nothing carries into a future run.
- Two Loli companions never run concurrently.
- Loli grants no invulnerability and no score multiplier; maximum multiplier is ×2.
- Overlapping timers run independently and neither extends the other.
- Score, hearts, paw progress, SLAYYY state and pause are present on every form factor.

**Status:** implemented, then adversarially reviewed **twice** and remediated after
each pass. Frozen. Every acceptance criterion above has a test behind it rather than an
inspection, and the four that are structural rather than asserted are worth
naming: a collected token is removed from the list in the same step, so
"exactly once" cannot be violated by a later pass; `loliActivations` increments
in one function, so the counter cannot drift from the state machine;
`slayyy.chargeMax` is spent whole on activation, so a partial spend has nowhere
to hide; and the charge function returns its argument unchanged while the phase
is `active`, so "no charging during SLAYYY" is not a tunable that could be
turned off.

Every number M7 introduces stays **PROPOSED** except the six the product owner
has approved — `paw.loliThreshold` 200, `loli.durationMs` 8000,
`loli.concurrentInstances` 1, `slayyy.durationMs` 5000,
`score.slayyyMultiplier` 2 and, at the adversarial review, `score.perPaw` 10.
Shipping a value does not approve it.

**The two questions implementation could not settle, decided at the review:**

- **`score.perPaw` is APPROVED / LOCKED at `10`.** Implementation had shipped
  the registry's PROPOSED `5` and flagged the conflict with the brief's +10
  rather than resolving it. The owner chose 10. Its arithmetic consequence is
  recorded in `scoring-and-progression.md` §1.1: the v0.3 boards' score range
  now spans about one to four minutes of play rather than 1.5 to five, and
  `score.distancePerSecond` — still PROPOSED — is the lever that owns it.
- **First SLAYYY availability is APPROVED as a 35–45 s target** for a
  representative healthy run, as a UX range and not a timer. Implementation had
  measured ≈ 69 s against a PROPOSED estimate of ≈ 40 s and retuned nothing. The
  rates were retuned to serve the target and measured across four scripted
  scenarios; they remain PROPOSED.

**What the second review pass found, and fixed:**

- **Paw Tokens were being placed inside lethal obstacles.** Patterns and token
  groups spawn from independent schedules into the same stretch of road, and the
  obstacle generator has never read the token list — so an obstacle emitted a few
  steps after a group landed on top of it. Over twelve seeds: 230 same-lane
  overlaps, 156 lane-blocking, and **58 where taking the token was mathematically
  impossible without losing a heart**, the first 15 seconds into seed 1. A token a
  lane blocker has landed on is now removed. Jumpable overlaps are left alone — a
  jumping player clears the barrier and takes the token, which is a good moment.
- **Touch was dead across roughly a third of the playfield.** The canvas fills the
  viewport and the HUD rows are painted over it; a touch starting on a row was not
  a touch on the canvas, so no gesture began. Keyboard play was unaffected, which
  is why it survived two milestones. The rows are transparent to pointers now and
  their controls opt back in. M7 added two of the five rows, so M7 made it worse.

**What the first review pass found, and fixed:**

- A **focus trap on every on-screen control.** Gameplay keys are suppressed
  while a control has focus and a `<button>` keeps focus after a click, so
  tapping SLAYYY left the player unable to move, jump or fire for the whole
  five-second window. The pause control had carried the same defect since M5;
  both now hand the keyboard back through one shared path.
- The **Loli magnet had no longitudinal reach**, so it repositioned tokens
  beyond the visible road where the pull rate's "slow enough to be visible"
  intent cannot apply. It now has a PROPOSED forward reach.
- The **paw readout showed `runPaws`** where the specification asks for
  `loliCyclePaws` — identical until the first bonus, wrong after it.
- **`run_ended` was not the last event of a run.** The terminal step's score
  arrived after it.

Score accumulates in thousandths and the SLAYYY meter in millionths, because a
per-second rate at an 8.33 ms step rounds measurably fast in thousandths.

---

## M8 — Interactive tutorial

**Blocked on:** the tutorial visual design treatment (OPEN).

**Deliverables:** a dedicated tutorial mode with damage disabled at the rules
level; five gated steps; authored (non-generated) scene; replay from Settings;
completion persisted to the profile; tr/en/es copy with touch and keyboard
variants.

**Acceptance criteria**
- **The player cannot die in the tutorial** — verified by a test that attempts to.
- Each step requires a successful action to advance.
- The tutorial affects no score, leaderboard, or progression data.
- Completion persists server-side and survives reinstall.

---

## M9 — Run lifecycle, anti-cheat boundary, progression

**Deliverables:** run start and finish endpoints; the validation boundary from
[ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md);
**idempotent** submission; race-safe paw ledger and threshold evaluation;
server-authoritative score; structured logging with correlation IDs.

**Acceptance criteria**
- A replayed submission never double-counts anything.
- Concurrent submissions cannot corrupt the paw ledger or double-trigger a bonus.
- An implausible result is rejected or flagged per the ADR, never silently accepted.
- Database constraints enforce integrity in addition to application validation.

**Tests:** idempotency under replay; concurrency tests on the ledger; tampered
and implausible submissions; authorization on every endpoint.

---

## M10 — Leaderboards

**Unblocked by M0.6:** the week boundary, tie-break, pagination, display-name v1 baseline and
opt-out are **APPROVED**. Profanity and confusable screening are deferred as future hardening
and are **not** v1 blockers.

**Still blocked on:** the genuinely OPEN retention/anonymization policy for deleted players
(LB-5), which the leaderboard projection must honour.

**Deliverables:** weekly and all-time boards; deterministic tie-breaking;
cursor pagination; the pinned "you" row with a true rank; the ranking projection
and its refresh strategy.

**Acceptance criteria**
- Ordering is a **total order**; no page duplicates or skips a row.
- The player's own rank is always accurate and never stale.
- Query plans are verified against realistic volumes, not toy data.

---

## M11 — Achievements and character unlocks

**Unblocked by M0.6:** character unlock semantics are **APPROVED** (AU-4 resolved; AU-7
retired — no minimum-duration criterion).

**Still blocked on:** approval of the proposed 16-achievement catalogue (AU-1).

**Also depends on** the ADR-0006 telemetry retention decision: **seven of the sixteen** have a
`DERIVED_TELEMETRY` verification source and cannot be established from stored aggregates alone.
They draw on four run-level facts: obstacle passes, near misses, SLAYYY activations, and
**actual Loli activations**.

**Deliverables:** server-side achievement evaluation inside the run transaction;
idempotent unlocks; monotonic progress counters; the character unlock model with
**both** gates (criterion met **and** approved artwork exists).

**Acceptance criteria**
- Every achievement is **server-verifiable**; none depends on client assertion. Each carries a
  **Verification Source** (`DERIVED_PERSISTENT` or `DERIVED_TELEMETRY`) and a **Progress
  Persistence** (`PERSISTED_AGGREGATE` or `RUN_FACT`); **no achievement progression is adopted
  from a client summary counter**.
- **Loli achievements and Sero's unlock count *actual* activations**, derived from validated
  telemetry — never inferred from thresholds earned in the paw ledger.
- Re-submission never double-unlocks or double-counts.
- A character whose artwork does not exist cannot be selected, even when earned,
  and the UI says so without implying the player failed.

---

## M12 — Support screens, PWA, accessibility, responsive

**Deliverables:** profile, settings, language, account & security, leaderboard and
achievements UI; the desktop **460 px protected column** with decorative
expansion; tablet scaling; reduced motion end to end; PWA scope per
[`../architecture/pwa-and-mobile.md`](../architecture/pwa-and-mobile.md); self-hosted fonts.

**Acceptance criteria**
- Every non-canvas screen is keyboard-operable with visible focus.
- Reduced motion demonstrably changes behavior, including inside the canvas.
- No gameplay-critical information is lost at any breakpoint.
- Contrast meets the target level against the locked tokens.

---

## M13 — Admin panel

**Unblocked by M0.6:** the six-capability moderation console is **APPROVED** (SI-1 resolved).
CMS, arbitrary data editing, granting scores or progression, impersonation and bulk export are
approved as **out of scope**.

**Deliverables:** a separate, plain admin interface that does not adopt the game
identity; mandatory 2FA enforced server-side; an audit log for every admin action.

**Acceptance criteria**
- No admin capability exists that is not specified.
- Every admin action is audited with actor, target, time and correlation ID.
- Admin authorization is enforced server-side on every request.

---

## M14 — Hardening and release readiness

**Deliverables:** performance work against the mobile targets; a security review;
observability (structured logs, correlation IDs, no PII); **KVKK/GDPR flows** —
account deletion, data export, consent and retention; a backup and restore drill;
the dependency/license inventory closed out; the licensing decision applied.

**Acceptance criteria**
- Frame-rate and load targets met on a mid-range device, measured not assumed.
- The security review has no unresolved high-severity finding.
- Account deletion and data export work end to end and are consistent with the
  public leaderboard decision.
- `LICENSE` is no longer a placeholder.
