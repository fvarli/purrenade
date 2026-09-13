# Core Run

Lanes, input, jump, collision, hearts, and the run lifecycle.

**Status legend:** APPROVED / PROPOSED / OPEN. Every numeric value marked
PROPOSED is a reviewable starting point, not a decided product value; all of them
are registered in [`../game/tuning-parameters.md`](../game/tuning-parameters.md)
and read from configuration.

---

## 1. Playfield

### 1.1 Composition — APPROVED (Claude Design v0.3)

- A fixed sea horizon occupies the upper portion of the frame; the promenade
  fills the lower portion.
- **Three parallel lanes run vertically with near-orthographic projection.** The
  lanes do **not** converge toward a vanishing point.
- Ayşenur is anchored near the bottom-centre of the playfield and does not move
  vertically except when jumping.
- Obstacles and collectibles enter at the horizon edge and scroll toward the
  player.

> The ChatGPT art-direction board shows a converging-perspective, behind-the-back
> camera. That is **not** the approved composition. See
> [design-reference-conflicts.md](design-reference-conflicts.md) #3. This matters
> technically: the approved composition is achievable with straightforward 2D
> scrolling, while the art-board framing would require faux-3D lane projection
> and per-depth sprite scaling.

### 1.2 Play column — APPROVED

| Form factor | Play column |
| --- | --- |
| Mobile | Full-bleed. Design baseline viewport is **390 × 844**. |
| Tablet | The column grows proportionally to the screen. |
| Desktop | The playfield runs inside a **protected 460 px column**; the seaside environment expands decoratively to either side. |

Details in [`../architecture/responsive-and-viewport.md`](../architecture/responsive-and-viewport.md).

### 1.3 Lane geometry — PROPOSED

Gameplay is simulated in **lane indices**, not pixels. Lane index is the only
lateral state the game rules know about.

```
LANE_LEFT = 0     LANE_CENTER = 1     LANE_RIGHT = 2
```

Rendering maps lane index to a horizontal position inside the play column:

| Parameter | PROPOSED value | Note |
| --- | --- | --- |
| `road.widthRatio` | `0.72` of the play column | Sand shoulders occupy the remainder |
| `lane.pitch` | `road.width / 3` | Lane centres at `roadCentre + (index - 1) × pitch` |

Exact ratios are to be measured against the v0.3 boards during M5 and then
promoted from PROPOSED to APPROVED.

---

## 2. Input

### 2.1 Mobile — APPROVED

| Gesture | Action |
| --- | --- |
| Swipe left | Move one lane left |
| Swipe right | Move one lane right |
| Swipe up | Jump |
| Tap the SLAYYY control when fully charged | Activate SLAYYY |
| Tap pause | Pause |

**There is no swipe-down / slide mechanic in v1.**

### 2.2 Desktop — APPROVED

| Key | Action |
| --- | --- |
| `←` / `A` | Move one lane left |
| `→` / `D` | Move one lane right |
| `Space` / `↑` / `W` | Jump |
| `E` | Activate SLAYYY when ready |
| `Esc` | Pause |

The on-screen SLAYYY control is also clickable on desktop.

> The v0.3 desktop keyboard legend lists only `← →`, `Space / ↑` and `Ⅱ / Esc`.
> `A` / `D` / `W` are additive aliases and `E` was approved during specification
> review; neither contradicts the board.

### 2.3 Gesture recognition — PROPOSED

| Parameter | PROPOSED value | Rationale |
| --- | --- | --- |
| `swipe.minDistancePx` | `24` | Below this, treat as a tap |
| `swipe.maxDurationMs` | `400` | Slower drags are not swipes |
| `swipe.axisDominanceRatio` | `1.5` | Dominant axis must exceed the other by this factor, so diagonal flicks resolve predictably |
| `input.bufferMs` | `120` | An input arriving during a lane transition is queued, not dropped |

### 2.4 Browser input hygiene — APPROVED

The playfield must not be fighting the browser:

- the canvas surface sets `touch-action: none`;
- no page scroll, pull-to-refresh, double-tap zoom, or text selection may be
  triggered by gameplay gestures;
- keyboard gameplay keys are captured only while a run is active and focus is in
  the game; they never hijack form fields or interfere with the rest of the UI;
- `Space` must not also activate a focused button while running.

### 2.5 Input is buffered, not dropped — PROPOSED

One pending action may be queued while a lane transition or jump is resolving.
A queued action executes as soon as it becomes legal. Queue depth is 1; a second
pending input replaces the first. This prevents the common feel bug where rapid
correct inputs are silently ignored.

---

## 3. Lane movement

### 3.1 Rules — APPROVED

- A swipe or key press moves **exactly one lane** per input.
- Movement from the leftmost lane further left, or the rightmost lane further
  right, is a no-op. It is not an error and produces no penalty.

### 3.2 Transition — PROPOSED

| Parameter | PROPOSED value |
| --- | --- |
| `lane.transitionMs` | `160` |
| `lane.easing` | ease-out |

**Occupancy rule — PROPOSED:** the player's collision lane changes at the
**midpoint** of the transition, not at its start or end. This makes a lane change
feel committed and prevents both "I was already out of the way" and "I was
clipped by the lane I left" complaints.

### 3.3 Mid-air lane change — PROPOSED

**Lane changes are permitted while airborne.** The same one-lane-per-input and
transition rules apply.

*Rationale:* forbidding it turns every jump into a commitment trap, which
conflicts with invariant 2 (a fair run is always survivable) once patterns
combine a jumpable obstacle with a lane-only obstacle. This is a feel decision
with real difficulty consequences and must be confirmed before M6 closes.

---

## 4. Jump

### 4.1 Rules — APPROVED

- Jump is **deterministic and tunable**. The same input from the same state
  always produces the same arc.
- Target airborne duration is approximately **650 ms**.
- Final values are **configuration parameters**, never scattered literals.

### 4.2 Derived arc — PROPOSED

A symmetric parabola, expressed against the 390-wide design baseline:

| Parameter | PROPOSED value | Derivation |
| --- | --- | --- |
| `jump.airborneMs` | `650` | APPROVED target |
| `jump.apexMs` | `325` | Symmetric rise/fall |
| `jump.apexHeightPx` | `96` @ 390 baseline | Scales with the play column |
| `jump.gravityPxPerS2` | `1818` | `2h / t_apex²` |
| `jump.initialVelocityPxPerS` | `591` | `g × t_apex` |

Only two of these are independent. The implementation stores
`airborneMs` and `apexHeightPx` and derives the rest, so the arc cannot drift
out of sync with the approved 650 ms target.

### 4.3 Constraints — PROPOSED

- **No double jump.** A jump input while airborne is ignored (it may still be
  buffered per §2.5 to fire on landing).
- **No variable jump height.** Hold duration does not change the arc; this keeps
  the jump deterministic as required.
- **A jump grants no invulnerability.** Being airborne avoids only the obstacles
  that are defined as jumpable.
- Jump does not change the player's lane by itself.

---

## 5. Collision

### 5.1 Rules — APPROVED

- A normal collision **removes one heart**.
- A brief **post-hit invulnerability** window follows, to prevent repeated
  immediate damage from the same or an adjacent hazard.
- The run ends when hearts reach zero.

### 5.2 Hitboxes — PROPOSED

| Parameter | PROPOSED value | Rationale |
| --- | --- | --- |
| `collision.playerBoxWidthRatio` | `0.60` of sprite width | Forgiving lateral feel; art silhouettes are wider than the body |
| `collision.playerBoxHeightRatio` | `0.80` of sprite height | Hair and accessories do not collide |
| `collision.shape` | axis-aligned bounding box | Cheap, deterministic, testable |

Collision is evaluated against **lane occupancy plus longitudinal overlap plus
vertical clearance**, not against rendered pixels. Rendering never decides
gameplay outcomes.

### 5.3 Post-hit invulnerability — PROPOSED

| Parameter | PROPOSED value |
| --- | --- |
| `invuln.postHitMs` | `1200` |
| `invuln.blinkHz` | `10` |

During post-hit invulnerability the player passes through obstacles without
further damage, collectibles are still collected, and the state is visible
(blink). The blink respects the reduced-motion setting — see
[accessibility.md](accessibility.md).

### 5.4 What each obstacle class collides with — APPROVED

Collision depends on the obstacle's **class**, never on its artwork. See
[difficulty-and-obstacles.md](difficulty-and-obstacles.md) §3.1.

| Class | Grounded player in the same lane | Airborne player in the same lane |
| --- | --- | --- |
| `LANE_BLOCKING` | **Collision** | **Collision** — being airborne does not clear it |
| `JUMPABLE` | **Collision** | **Cleared** |

This is the whole reason the jump verb exists: with only `LANE_BLOCKING` obstacles, jumping
would be decorative.

### 5.4A As implemented at M6

Collision is `occupiedLane` **plus** longitudinal overlap **plus** class. Both extents are open
intervals, so touching exactly at a boundary is not a collision — one policy at every edge, so a
value landing on a boundary resolves the same way on every device.

At most **one heart per simulation step**, whatever overlaps, and an obstacle resolves exactly
once: a cone cannot drain the run over the several steps it takes to pass through the player, and
a pattern that puts two blockers in one lane costs one heart with the invulnerability window
covering the rest.

**CR-2 is still OPEN and nothing was invented in its place.** A collision starts the
invulnerability window and does nothing else: no speed dip, no scroll hitch, and an in-progress
lane change continues undisturbed.

### 5.5 Collision feedback — APPROVED

Ayşenur plays the **collision / cry** animation state. Hearts update immediately.

**OPEN:** whether a collision also applies a brief speed dip or scroll hitch, and
whether it interrupts an in-progress lane change.

---

## 5A. Near miss ("Ramak Kala") — APPROVED

A near miss is a **real v1 statistic mechanic**, not a scoring mechanic.

### 5A.1 Rules — APPROVED

| Rule | Detail |
| --- | --- |
| **When it occurs** | The player **safely passes within a defined danger envelope** of an obstacle without colliding with it |
| **Frequency** | **At most one near-miss event per obstacle.** Passing close to the same obstacle cannot be counted twice. |
| **Score** | **None.** A near miss awards no score and no multiplier, directly or indirectly. |
| **What it feeds** | Statistics and achievements only |
| **Determinism** | Detection is **deterministic and testable** — it lives in the pure game domain, alongside collision |
| **Verification** | Leaderboard-relevant achievement progress from near misses must be **server-verifiable from accepted run telemetry**. A client-reported count is an input to derivation, never an authoritative total. |

Keeping near misses out of scoring is deliberate. A scoring near miss rewards deliberately
brushing obstacles, which fights the difficulty curve and makes plausibility bounds much harder
to reason about — and it would make the leaderboard depend on a value the server cannot
independently establish.

### 5A.2 Danger envelope — PROPOSED

The geometric threshold is tuning, not product behaviour.

| Parameter | PROPOSED value | Note |
| --- | --- | --- |
| `nearMiss.lateralEnvelopeUnits` | `1.25` lane widths | Measured centre-to-centre against the obstacle's lane. Corrected at M6: `0.55` made the adjacent-lane case below unreachable, since an adjacent lane is exactly `1.0` |
| `nearMiss.longitudinalEnvelopeUnits` | `0.75` | How close along the road counts as "passing" |
| `nearMiss.verticalClearanceUnits` | `0.40` | For a `JUMPABLE` obstacle cleared by a low jump |
| `nearMiss.oneEventPerObstacle` | `true` | **APPROVED**, not tunable |

**Detection rule — PROPOSED:** evaluate once, at the moment the obstacle's longitudinal extent
passes the player's reference point, and only if no collision occurred with that obstacle. A
single evaluation point makes the "at most one event" rule structural rather than a debounce.

Two ways to earn one, both intended:

- passing a `LANE_BLOCKING` obstacle in an **adjacent** lane, close to the boundary;
- clearing a `JUMPABLE` obstacle with **little vertical clearance**.

### 5A.2A As implemented at M6

Evaluated once, at the instant the obstacle's trailing edge reaches
`nearMiss.longitudinalEnvelopeUnits` behind the player's reference point, and only when nothing
collided with it. A single evaluation instant is what makes "at most one event" structural.

**One reading was required and is recorded as such.** `nearMiss.verticalClearanceUnits` is
written in "units", and the domain has no pixels — the jump apex is the only vertical scale it
owns. It is therefore read as an **apex-normalised fraction**: clearing a `JUMPABLE` obstacle
while below 0.40 of the apex counts. That is an interpretation of an ambiguous row, not a
decision, and it belongs with CR-6 when the envelope is tuned.

### 5A.3 Interaction with the escape-path budget — OPEN (CR-6)

The escape-path validator subtracts a `350 ms` reaction budget so patterns are humanly fair.
That budget and the near-miss envelope pull against each other: a pattern tuned to be
comfortably escapable may make near misses nearly unreachable, while a tight one may make them
unavoidable and therefore meaningless.

Both sets of values are PROPOSED and must be tuned **together** during M6, not independently.

---

## 6. Hearts

### 6.1 Rules — APPROVED

| Rule | Value |
| --- | --- |
| Starting hearts | **3** |
| Maximum hearts | **3** |
| Cost of a normal collision | **1 heart** |
| Healing in v1 | **None. No mechanic restores a heart.** |
| Run ends | at **0 hearts** |

SLAYYY grants temporary invulnerability; it does **not** heal. Trileçe is not a
functional pickup in v1. See
[deferred-design-exploration.md](deferred-design-exploration.md).

> **Design-reference note:** v0.3 board 11 (SLAYYY active) shows three full
> hearts while the adjacent normal-gameplay board shows two. This is an
> **illustrative inconsistency in the mockup**, not gameplay behavior. Recorded
> in [design-reference-conflicts.md](design-reference-conflicts.md) #7.

---

## 7. Run start

### 7.1 Readiness beat — PROPOSED

| Parameter | PROPOSED value | Rationale |
| --- | --- | --- |
| `run.readyMs` | `1500` | The player sees the lane, the character and the HUD before anything can hurt them |
| `run.firstHazardMinMs` | `2500` | No obstacle may be reachable before this |

Input is accepted from the moment the run becomes interactive; the guarantee is
about hazards, not about locking the controls.

### 7.2 Initial state — APPROVED

- Lane: **CENTER**.
- Hearts: **3**.
- SLAYYY charge: **empty** (run-local; never carried over).
- `runPaws`: **0**.
- `loliCyclePaws`: loaded from the player profile — paw progress persists across runs.

---

## 8. Pause — APPROVED

- `Esc` on desktop, the pause control on every form factor.
- Simulation freezes: no scroll, no spawning, no timers advancing, no SLAYYY or
  Loli duration burn.
- The pause screen states that the score is safe and shows the current score.
- Offered actions: **resume**, **restart**, **return to menu**, plus audio controls.

**OPEN:** the audio controls on the pause screen appear as **volume sliders**
while the settings screen shows **on/off toggles**. This is an internal v0.3
contradiction — see [design-reference-conflicts.md](design-reference-conflicts.md) #10.

**PROPOSED:** resuming from pause replays the readiness beat (§7.1) at a shorter
duration so the player is not immediately hit on unpause.

---

## 9. Run end — APPROVED

- Triggered when hearts reach **0**.
- **No revive, no continue, no second chance.** The game-over screen offers only
  *play again* and *return to menu*.
- Ayşenur plays the collision/cry state; on a new personal record, the record
  dance state plays on the new-high-score screen instead.
- The run result reports: final score, previous record, `runPaws` gained, and any
  achievement progress advanced during the run.

Submission, validation and persistence of the result are backend concerns —
see [`../architecture/api-client.md`](../architecture/api-client.md) and the
backend's `docs/api/endpoints/game-runs.md`.

---

## 10. Open questions owned by this document

| Ref | Question |
| --- | --- |
| CR-1 | Are mid-air lane changes permitted? (§3.3 PROPOSED: yes) |
| CR-2 | Does a collision interrupt an in-progress lane change or apply a speed dip? (§5.4) |
| CR-3 | Exact lane pitch and road width ratios, measured from v0.3 (§1.3) |
| CR-4 | Does resuming from pause replay a readiness beat? (§8) |
| CR-6 | Near-miss envelope vs the escape-path reaction budget — must be tuned together (§5A.3) |

**Resolved by M0.5:** CR-5 (near-miss detection) — the mechanic is APPROVED in §5A; only its
geometric threshold remains PROPOSED tuning.

All of these are mirrored in [open-decisions.md](open-decisions.md).
