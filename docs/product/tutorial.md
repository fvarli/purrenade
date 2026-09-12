# Tutorial

**Status legend:** APPROVED / PROPOSED / OPEN.

> **Design status: the tutorial has no Claude Design v0.3 screen.** Its
> *behavior* is APPROVED and specified below. Its *visual presentation* is
> **OPEN and requires a design treatment before M8 implementation.** No visual
> design is invented here.

---

## 1. Approved behavior — APPROVED

The tutorial is:

- **interactive** — the player performs the actions; it is not a slideshow, a
  video, or a wall of text;
- **safe** — **no death during the tutorial sequence**;
- **gated by successful player input** — the player must *successfully perform*
  each action before the sequence advances;
- **replayable from Settings**;
- **persisted to the player profile** on completion;
- **localized** in Turkish, English and Spanish.

## 2. Required steps — APPROVED

The player must successfully perform each of the following, in order:

| # | Step | Success condition |
| --- | --- | --- |
| 1 | **Move left** | The player reaches the left lane |
| 2 | **Move right** | The player reaches the right lane |
| 3 | **Jump** | The player completes a jump |
| 4 | **Avoid a safe obstacle** | The player passes a designated safe obstacle without colliding |

Since M0.5 approved two obstacle classes, the tutorial has a real target for each verb:

| Step | Class used | Teaches |
| --- | --- | --- |
| 3 · Jump | **`JUMPABLE`** — the low beach barrier | That jumping clears something |
| 4 · Avoid | **`LANE_BLOCKING`** — the traffic cone | That some obstacles must be gone *around*, not over |

Teaching both classes matters: a player who only ever met one class would reasonably conclude
the other verb is optional, and then meet a pattern that requires it.
| 5 | **Collect a paw** | The player collects a Paw Token |

These five steps teach exactly the v1 gameplay vocabulary:
*obstacle → dodge/jump*, *paw → collect*, and — implicitly — that hearts exist.

**SLAYYY is not taught by the tutorial** in v1: it is run-local, charge-gated,
and cannot be reached within a short safe sequence.

**OPEN:** whether a separate first-activation coach mark introduces SLAYYY the
first time the meter fills during a real run.

---

## 3. Safety guarantee — APPROVED

**No death during the tutorial sequence.** This is an invariant, not a difficulty
setting.

### 3.1 How it is enforced — PROPOSED

Enforcement is structural rather than incidental:

- The tutorial runs in a **dedicated tutorial mode** of the game core, not in a
  difficulty-zero variant of the normal run loop.
- In tutorial mode, **damage is disabled at the rules level** — a collision plays
  feedback and re-prompts the step; it does not remove a heart.
- The scene is **authored, not generated**. The tutorial does not use the
  procedural pattern generator, so it cannot inherit a hazard from it.
- The tutorial does not submit a run result and does not affect score,
  leaderboards, `lifetimePaws`, or `loliCyclePaws`.

**PROPOSED:** the paw collected in step 5 is demonstrative and **does not** count
toward progression, so that the tutorial cannot be farmed. This must be confirmed
because the alternative — counting it — is also defensible.

### 3.2 Step gating — PROPOSED

- The world holds (scroll pauses or loops safely) until the current step
  succeeds. The player cannot fail forward.
- A wrong or absent input re-prompts after `tutorial.repromptMs` (PROPOSED
  `3000`) with progressively more explicit guidance.
- There is no step timeout and no forced skip.

---

## 4. Entry points — APPROVED

| Trigger | Behavior |
| --- | --- |
| First run after registration | The tutorial is offered/entered before the first real run |
| Settings → replay tutorial | Runs the full sequence again at any time |

**OPEN:** whether the first-time tutorial is **mandatory** or **skippable**.
The approved brief requires that the player *must successfully perform* each
action, which argues for mandatory on first entry; it does not state it
outright, so it is not asserted here.

---

## 5. Persistence — APPROVED

Tutorial completion is **persisted to the player profile** (server-side), not to
device storage, so it survives reinstall and follows the account across devices.

| Field | Meaning |
| --- | --- |
| `tutorialCompletedAt` | Timestamp of first successful completion; `null` until then |

Replaying the tutorial from Settings does **not** clear or re-stamp this field.

---

## 6. Localization — APPROVED

All tutorial copy ships in **tr / en / es**. Per the approved localization
constraint, **no tutorial text is baked into images**, prompts switch language
instantly, and layout tolerates long translations — tutorial prompts are among
the most translation-sensitive strings in the product because they are short,
imperative and gesture-dependent.

Gesture vocabulary differs by platform: touch prompts describe **swipes**,
desktop prompts describe **keys**. Both variants exist per locale.

---

## 7. Design requirements for the M8 treatment — OPEN

The visual design does not exist yet. When it is produced it must satisfy:

1. Prompts readable over a moving background at 390 × 844.
2. Gesture affordance that reads on both touch and keyboard without implying a
   mechanic that does not exist (notably: **no swipe-down**).
3. A visible, non-punitive retry state.
4. Compliance with the reduced-motion setting.
5. Step progress that is legible without counting.
6. Room for the longest of the three locales.

---

## 8. Open questions owned by this document

| Ref | Question |
| --- | --- |
| TU-1 | Visual design treatment (§7) — **blocks M8** |
| TU-2 | Is the first-time tutorial mandatory or skippable? (§4) |
| TU-3 | Does the tutorial paw count toward progression? (§3.1) |
| TU-4 | Is there a separate first-SLAYYY coach mark? (§2) |
| TU-5 | Does the tutorial demonstrate a near miss, or leave it to be discovered? |
