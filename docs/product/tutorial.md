# Tutorial

**Status legend:** APPROVED / PROPOSED / OPEN.

> **Design status: RESOLVED at M8.** The tutorial's *behavior* was already
> APPROVED. Its *presentation* had no Claude Design v0.3 screen, which made
> **TU-1** a blocker — and the product owner resolved it at M8 by deriving the
> treatment from the production visual system that Milestones A, B and C
> established, rather than by commissioning a new one. See §7.

---

## 1. Approved behavior — APPROVED

The tutorial is:

- **interactive** — the player performs the actions; it is not a slideshow, a
  video, or a wall of text;
- **safe** — **no death during the tutorial sequence**;
- **gated by successful player input** — the player must *successfully perform*
  each action before the sequence advances;
- **skippable**, with a confirmation (**TU-2**, resolved at M8 — §4);
- **replayable from Settings**;
- **persisted to the player profile** on completion;
- **localized** in Turkish, English and Spanish.

## 2. Required lessons — APPROVED

Nine states, of which seven ask something of the player:

| # | Lesson | Success condition |
| --- | --- | --- |
| 1 | **Intro** | A short greeting elapses |
| 2 | **Move left** | The player settles in the left lane |
| 3 | **Move right** | The player settles in the right lane |
| 4 | **Dodge the cone** | The scripted `LANE_BLOCKING` cone passes with the player never in its lane |
| 5 | **Jump the barrier** | The scripted `JUMPABLE` barrier passes with the player airborne **in its lane** |
| 6 | **Collect a paw** | **That lesson's own Paw Token** is collected |
| 7 | **Activate SLAYYY** | The player activates it manually, through the real control |
| 8 | **Final practice** | A short authored sequence of what was already taught |
| 9 | **Complete** | Terminal |

Since M0.5 approved two obstacle classes, the tutorial has a real target for each verb:

| Lesson | Class used | Teaches |
| --- | --- | --- |
| 4 · Dodge | **`LANE_BLOCKING`** — the traffic cone | That some obstacles must be gone *around*, never over |
| 5 · Jump | **`JUMPABLE`** — the low beach barrier | That jumping clears something |

Teaching both classes matters: a player who only ever met one class would reasonably conclude
the other verb is optional, and then meet a pattern that requires it.

### 2.1 The cone comes first, and that ordering is the point — APPROVED (M8)

Physical-phone testing found the failure this milestone exists for: **a new player meeting a
traffic cone tries to jump it.** They are hit, they do not understand why, and nothing in the
game has told them. So the misconception is corrected *before* the verb that looks like it
should have worked is introduced at all.

This reverses the order an earlier draft of this document gave (jump, then avoid). The
changed order is the finding, not a preference.

Jumping at the cone is **not special-cased anywhere in the domain.** `isDamaging` already
refuses to clear a `LANE_BLOCKING` obstacle for an airborne player, so a jump produces a
contact and the tutorial turns that contact into the correction. The rule teaches itself.

### 2.2 SLAYYY **is** taught — APPROVED (M8), reversing an earlier decision

This section previously read *"SLAYYY is not taught by the tutorial in v1: it is run-local,
charge-gated, and cannot be reached within a short safe sequence."* **That is no longer the
product decision.** The product owner approved teaching it at M8.

The old rationale is answered rather than ignored. The objection was that the meter cannot be
filled inside a short tutorial — first availability is an APPROVED target of 35–45 s of a
representative healthy run — and the resolution is a **tutorial-scoped readiness grant**:
`primeSlayyy` fills the meter once, when the lesson opens, and is called from nowhere but the
tutorial.

Everything else about SLAYYY is untouched. `chargePerSecond` and `chargePerPaw` are unchanged,
so normal progression is exactly what it was; `canActivateSlayyy` still decides; the player
still presses `E` or the on-screen control; `activateSlayyy` still spends the whole meter and
still counts the activation. **What the tutorial grants is the opportunity, not the power.**

**TU-4 is resolved by this**: there is no separate first-SLAYYY coach mark, because the
tutorial teaches it.

**TU-5 remains as it was**: the tutorial does **not** demonstrate a near miss.

---

## 3. Safety guarantee — APPROVED

**No death during the tutorial sequence.** This is an invariant, not a difficulty
setting.

### 3.1 How it is enforced — APPROVED (M8)

Enforcement is structural rather than incidental:

- The tutorial runs in a **dedicated tutorial mode of the game core** —
  `RunState.tutorial`, which is `null` for every normal run — not a difficulty-zero variant
  of the normal loop.
- In tutorial mode, **damage is disabled at the rules level**: the collision is resolved by
  the real rules and the obstacle is stamped exactly as it would be in a run, and then the
  heart is simply not spent. A collision plays feedback and re-presents the lesson.
- The scene is **authored, not generated**. `advanceSpawning` and `advancePawSpawning` both
  return early in tutorial mode, so the tutorial cannot inherit a hazard from the procedural
  generator — and consumes **no randomness at all**, which
  `game/domain/tutorial-isolation.spec.ts` asserts by comparing all three RNG streams against
  a freshly seeded state.
- The tutorial does not submit a run result and does not affect score, leaderboards,
  `lifetimePaws` or `loliCyclePaws`.

**The player is deliberately not made invulnerable.** That would have been the easier
implementation and a worse one: `isProtected` would then be true, every prop would resolve as
`cleared`, and the lesson could no longer tell a cone the player walked into from one they
went around. Safety comes from not spending the heart, not from avoiding the collision.

**TU-3 is resolved:** the paw collected in lesson 6 is demonstrative and does **not** count
toward progression, so the tutorial cannot be farmed. It cannot: the tutorial submits nothing,
the cycle starts at zero, and one scripted token cannot reach a 200-paw threshold.

### 3.2 Step gating — APPROVED (M8)

- A lesson does not advance until it is satisfied. The player cannot fail forward.
- **The world keeps scrolling; the lesson loops.** An unsatisfied lesson re-presents its prop
  `tutorial.repeatGapUnits` further on, indefinitely. Freezing the scroll was considered and
  rejected: a barrier that never travels is a barrier a jump cannot clear, so the jump lesson
  would be unreachable — and a stopped promenade reads as a stall rather than a pause.
- A wrong or absent input re-prompts after `tutorial.repromptMs` (PROPOSED `3000`) with
  progressively more explicit guidance, escalated by an attempt counter.
- **There is no step timeout.** Doing nothing is never a failure.

### 3.3 How a lesson knows it passed — APPROVED (M8)

Each lesson observes **the fact it teaches**, never a number that happens to move at the same
time.

- The cone and barrier lessons watch two recorded facts — *was the player in the prop's lane
  while overlapping it*, and *were they airborne when they were* — rather than the obstacle's
  `outcome`. An outcome is the damage rules' conclusion; these are what the player did, and
  what the player did is the curriculum. It also avoids a real trap: when two obstacles would
  damage on one step only the first is `hit` and the rest are `cleared`, so `cleared` does not
  reliably mean "avoided".
- The paw lesson waits for **its own token, by id**, not for `runPaws` to tick. The two agree
  today only because the generator is off in tutorial mode, and a lesson resting on that
  agreement is a lesson that breaks the day something else can award a paw.

---

## 4. Entry points — APPROVED

| Trigger | Behavior |
| --- | --- |
| First run, tutorial not completed | **PLAY** enters the tutorial |
| Tutorial already completed | **PLAY** enters a normal run |
| Settings → replay tutorial | Runs the full sequence again at any time |

**There is no redirect.** PLAY always points at `/run`, and that page chooses what to mount
from `?mode` and the server's completion flag. Nothing can loop.

### 4.1 Skippable — APPROVED (M8), resolving TU-2

The first-run tutorial **may be skipped**. The affordance is restrained — a quiet text control
beside the progress dots, not a second action competing with the lesson — and it asks for
confirmation, defaulting to *continue*.

Skipping **counts as completion** for routing, and is recorded through the same call a finish
makes. The server is deliberately not told which happened: it is not a fact the API has any
use for, and recording it would be tutorial telemetry.

---

## 5. Persistence — APPROVED

Tutorial completion is **persisted to the player profile** (server-side), not to device
storage, so it survives reinstall and follows the account across devices.

| Field | Meaning |
| --- | --- |
| `tutorial_completed_at` | Timestamp of first completion; `null` until then. Stored server-side |

Replaying the tutorial from Settings does **not** clear or re-stamp this field. That is
structural: the write is a conditional `UPDATE … WHERE tutorial_completed_at IS NULL` whose
affected-row count is the authority.

### 5.1 The client is told *whether*, never *when* — APPROVED (M8)

The stored fact is a timestamp; what crosses the wire is a boolean, `tutorial_completed`, on
`POST /progression/tutorial` and as a read projection on `GET /auth/me`. When a player
finished is not a decision any client makes differently, and a date in the browser would be
analytics nobody asked for.

Progression **owns** the fact. The column sits on `users` until M9 creates
`player_progression`; the backend's `docs/architecture/data-model.md` §4.1 records that
relocation, including the backfill.

### 5.2 A failed save is never hidden — APPROVED (M8)

Completion is true only once the server says so. If the write fails, the completion overlay
stays up with a retry and the player is **not** routed into a run. Routing onward would tell
them they had finished and then hand them the mandatory tutorial again on their next sign-in,
with nothing to explain why. The call is idempotent, so retrying is free.

Nothing about completion is mirrored to browser storage. A value the browser could write would
be authority in the wrong place — it decides whether a tutorial is mandatory.

---

## 6. Localization — APPROVED

All tutorial copy ships in **tr / en / es**. Per the approved localization
constraint, **no tutorial text is baked into images**, prompts switch language
instantly, and layout tolerates long translations — tutorial prompts are among
the most translation-sensitive strings in the product because they are short,
imperative and gesture-dependent.

Gesture vocabulary differs by platform: touch prompts describe **swipes**,
desktop prompts describe **keys**. Both variants exist per locale, keyed
`tutorial.lesson.<lesson>.touch` and `.keyboard`.

The variant is chosen by `(hover: none) and (pointer: coarse)` rather than by touch
capability: a laptop with a touchscreen reports touch support and is still a keyboard machine,
and telling such a player to swipe would be advice they cannot act on.

---

## 7. The M8 treatment — RESOLVED (M8), closing TU-1

TU-1 asked for a visual design that did not exist. It is resolved by **deriving the treatment
from the production visual system** rather than inventing a second one: the tutorial uses the
existing tokens, typography, card and dialog language, the Milestone B world, Ayşenur, the
cone, the barrier, the Paw Token and the SLAYYY control. **No new visual asset family was
introduced, and the renderer gained nothing** — `RenderSnapshot` is unchanged, because a
tutorial prop is an ordinary obstacle or Paw Token in the lane the script chose.

Against the seven requirements this section originally set:

| # | Requirement | How it is met |
| --- | --- | --- |
| 1 | Prompts readable over a moving background at 390 × 844 | A `--bg-surface` card at 92% opacity with `--elevation-card`, held to the play column |
| 2 | Gesture affordance that reads on touch and keyboard without implying a mechanic that does not exist | Separate `touch` / `keyboard` copy per lesson. **No swipe-down** anywhere — `gestureToInput` returns null for it |
| 3 | A visible, non-punitive retry state | The correction line, in `--state-info` rather than `--state-danger`: nothing has gone wrong |
| 4 | Compliance with reduced motion | Inherited. The tutorial adds no animation of its own, and the scene's live `prefers-reduced-motion` listener is untouched |
| 5 | Step progress legible without counting | One dot per lesson, with the live one scaled as well as coloured, plus an `sr-only` "n / total" |
| 6 | Room for the longest of the three locales | Verified at 320 / 360 / 430 px in tr, with en and es spot-checked at the narrowest |
| 7 | *(prompt does not obstruct play)* | The prompt is **not** a dialog: no scrim, no focus trap, `pointer-events: none` except the Skip control |

---

## 8. Open questions owned by this document

| Ref | Question | Status |
| --- | --- | --- |
| TU-1 | Visual design treatment (§7) | **RESOLVED at M8** — derived from the production visual system |
| TU-2 | Is the first-time tutorial mandatory or skippable? (§4.1) | **RESOLVED at M8** — skippable, with confirmation |
| TU-3 | Does the tutorial paw count toward progression? (§3.1) | **RESOLVED at M8** — it does not |
| TU-4 | Is there a separate first-SLAYYY coach mark? (§2.2) | **RESOLVED at M8** — no; the tutorial teaches SLAYYY |
| TU-5 | Does the tutorial demonstrate a near miss, or leave it to be discovered? | **OPEN** — it does not demonstrate one |
