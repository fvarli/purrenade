# Tuning Parameters

**The single source for every tunable gameplay value.**

The approved brief states it directly: *"final values must be tuning/config
parameters, not scattered magic numbers."* This document is that registry.

---

## Rules — APPROVED

1. **Every value below exists exactly once in code**, in a typed tuning module
   that the game domain reads. Never duplicated into a scene, a component, or a
   stylesheet.
2. **Derived values are derived, not restated.** Jump gravity and initial
   velocity are computed from airborne duration and apex height so the arc cannot
   drift away from the approved 650 ms target.
3. **Status is carried per value.** APPROVED values are authoritative. PROPOSED
   values may be implemented but are not approved behavior — they are reviewed
   before their milestone closes.
4. **Adding a tunable means adding a row here**, in the same change.
5. Units are explicit in every name: `Ms`, `Px`, `PerSecond`, `Units`, `Ratio`.

**Units:** `lane` = one lane pitch · `unit` = one longitudinal road unit ·
`px` values are at the **390 px design baseline** and scale with the play column.

---

## 1. Playfield

| Parameter | Value | Status | Notes |
| --- | --- | --- | --- |
| `layout.baselineViewportWidthPx` | 390 | **APPROVED** | 21 v0.3 mobile artboards |
| `layout.baselineViewportHeightPx` | 844 | **APPROVED** | 21 v0.3 mobile artboards |
| `layout.desktopPlayColumnPx` | 460 | **APPROVED** | v0.3 desktop board |
| `road.widthRatio` | 0.72 | PROPOSED | Fraction of the play column; measure against v0.3 in M5 |
| `lane.count` | 3 | **APPROVED** | LEFT / CENTER / RIGHT |
| `lane.pitch` | `road.width / 3` | PROPOSED | Derived |
| `lane.startIndex` | 1 (CENTER) | **APPROVED** | |

## 2. Input

| Parameter | Value | Status | Notes |
| --- | --- | --- | --- |
| `swipe.minDistancePx` | 24 | PROPOSED | Below this, treat as a tap |
| `swipe.maxDurationMs` | 400 | PROPOSED | |
| `swipe.axisDominanceRatio` | 1.5 | PROPOSED | Resolves diagonal flicks predictably |
| `input.bufferMs` | 120 | PROPOSED | |
| `input.bufferDepth` | 1 | PROPOSED | A later input replaces an earlier pending one |

**No swipe-down/slide mechanic exists in v1 — APPROVED.**

> **Interaction found at M5, needs review with §3.** `input.bufferMs` (120) is shorter than
> `lane.transitionMs` (160), so an input queued in the **first 40 ms** of a lane change ages out
> before that change settles and is dropped. The buffer therefore covers the last 120 ms of a
> transition, not all of it.
>
> That may well be right — an input 160 ms early is arguably a mis-input, not an early one — but it
> is a consequence of two independently-chosen PROPOSED numbers rather than a decision anybody
> made. The behaviour is implemented as specified and pinned by a test
> (`game/domain/domain.spec.ts`, *"expires an input queued earlier than the buffer window
> reaches"*), so changing either value will show up as a failing test rather than a silent change
> in feel. **Review the pair together**, as core-run.md §5A already requires for the near-miss
> envelope.

## 3. Lane movement

| Parameter | Value | Status | Notes |
| --- | --- | --- | --- |
| `lane.transitionMs` | 160 | PROPOSED | |
| `lane.easing` | ease-out | PROPOSED | |
| `lane.occupancySwitchAtRatio` | 0.5 of the transition | PROPOSED | Collision lane changes at the midpoint |
| `lane.midAirChangeAllowed` | true | PROPOSED | See [core-run](../product/core-run.md) §3.3 |

## 4A. Obstacle classes

| Parameter | Value | Status | Notes |
| --- | --- | --- | --- |
| `obstacle.classes` | `LANE_BLOCKING`, `JUMPABLE` | **APPROVED** | Exactly two; not tunable |
| `obstacle.laneBlocking.clearableByJump` | **false** | **APPROVED** | Being airborne does not clear it |
| `obstacle.jumpable.clearableByJump` | **true** | **APPROVED** | |
| `obstacle.classChangesDuringSlayyy` | **false** | **APPROVED** | SLAYYY swaps the visual variant only |

Behaviour belongs to the class, never to the artwork. See
[difficulty-and-obstacles](../product/difficulty-and-obstacles.md) §3.1.

## 4B. Near miss

| Parameter | Value | Status | Notes |
| --- | --- | --- | --- |
| `nearMiss.enabled` | **true** | **APPROVED** | A real v1 statistic mechanic |
| `nearMiss.awardsScore` | **false** | **APPROVED** | No score, no multiplier, directly or indirectly |
| `nearMiss.oneEventPerObstacle` | **true** | **APPROVED** | Structural, not a debounce |
| `nearMiss.lateralEnvelopeUnits` | `0.55` lane widths | PROPOSED | Passing a `LANE_BLOCKING` obstacle in an adjacent lane |
| `nearMiss.longitudinalEnvelopeUnits` | `0.75` | PROPOSED | How close along the road counts as passing |
| `nearMiss.verticalClearanceUnits` | `0.40` | PROPOSED | Clearing a `JUMPABLE` obstacle with little headroom |

Envelope values must be tuned **together with** `escape.reactionBudgetMs` — see
[core-run](../product/core-run.md) §5A.3.

## 4. Jump

| Parameter | Value | Status | Notes |
| --- | --- | --- | --- |
| `jump.airborneMs` | **650** | **APPROVED** | Approved target; **independent** |
| `jump.apexHeightPx` | 96 | PROPOSED | At the 390 baseline; **independent** |
| `jump.apexMs` | 325 | derived | `airborneMs / 2` |
| `jump.gravityPxPerS2` | 1818 | derived | `2h / t_apex²` |
| `jump.initialVelocityPxPerS` | 591 | derived | `g × t_apex` |
| `jump.doubleJumpAllowed` | false | PROPOSED | |
| `jump.variableHeight` | false | PROPOSED | Hold duration does not change the arc |
| `jump.grantsInvulnerability` | false | PROPOSED | Airborne avoids only jumpable obstacles |

Only `airborneMs` and `apexHeightPx` are stored. The rest are computed.

## 5. Collision and hearts

| Parameter | Value | Status | Notes |
| --- | --- | --- | --- |
| `hearts.start` | **3** | **APPROVED** | |
| `hearts.max` | **3** | **APPROVED** | |
| `hearts.costPerCollision` | **1** | **APPROVED** | |
| `hearts.healingSources` | **none** | **APPROVED** | No mechanic restores a heart in v1 |
| `collision.playerBoxWidthRatio` | 0.60 | PROPOSED | |
| `collision.playerBoxHeightRatio` | 0.80 | PROPOSED | |
| `invuln.postHitMs` | 1200 | PROPOSED | |
| `invuln.blinkHz` | 10 | PROPOSED | Partial-alpha on the sprite; never a full-screen flash; reduced-motion aware |

## 6. Run lifecycle

| Parameter | Value | Status | Notes |
| --- | --- | --- | --- |
| `run.readyMs` | 1500 | PROPOSED | Readiness beat before the first hazard |
| `run.firstHazardMinMs` | 2500 | PROPOSED | No hazard reachable before this |
| `run.resumeReadyMs` | 800 | PROPOSED | Shortened beat after unpause |
| `sim.fixedStepHz` | 120 | PROPOSED | Fixed-step simulation with an accumulator |
| `sim.maxCatchUpSteps` | 8 | PROPOSED | Steps one frame may owe before the excess is discarded, not simulated |

## 7. Difficulty

| Parameter | Value | Status | Notes |
| --- | --- | --- | --- |
| `difficulty.driver` | elapsed run time | PROPOSED | Not distance — avoids compounding with speed |
| `difficulty.speed.base` | 1.00× | PROPOSED | |
| `difficulty.speed.ceiling` | 1.85× | PROPOSED | Soft cap |
| `difficulty.speed.timeConstantS` | 90 | PROPOSED | |
| `difficulty.density.base` | 0.25 | PROPOSED | Fraction of road length occupied |
| `difficulty.density.ceiling` | 0.55 | PROPOSED | |
| `difficulty.decisionsPerMin.base` | 14 | PROPOSED | |
| `difficulty.decisionsPerMin.ceiling` | 38 | PROPOSED | |
| `difficulty.tierStartsS` | 0 / 25 / 60 / 110 / 180 | PROPOSED | Tier 1…Tier 5; **Tier 5 is terminal** |

Curve: `value(t) = ceiling - (ceiling - base) × exp(-t / timeConstant)`.

## 8. Generation and escape path

| Parameter | Value | Status | Notes |
| --- | --- | --- | --- |
| `generator.repeatCooldown` | 3 | PROPOSED | Patterns recently used are excluded |
| `generator.minGapUnits` | per tier | PROPOSED | Floor regardless of density |
| `escape.maxActionsPerPattern` | 2 | PROPOSED | |
| `escape.reactionBudgetMs` | 350 | PROPOSED | Subtracted from the available window; turns "possible" into "fair" |
| `escape.validateJoins` | true | **APPROVED** | Patterns are validated across joins, not in isolation |

## 9. Scoring

| Parameter | Value | Status | Notes |
| --- | --- | --- | --- |
| `score.distancePerSecond` | 10 at base speed | PROPOSED | Scales with actual scroll speed |
| `score.perPaw` | 5 | PROPOSED | |
| `score.rounding` | floor, integer | PROPOSED | |
| `score.slayyyMultiplier` | **2** | **APPROVED** | |
| `score.multiplierScope` | distance + collectible + bonus | PROPOSED | |
| `score.multiplierComposition` | **max, never product** | PROPOSED | Maximum multiplier in v1 is ×2 |
| `score.comboSystem` | **none** | **APPROVED** | |

## 10. Paws and Loli Bonus

| Parameter | Value | Status | Notes |
| --- | --- | --- | --- |
| `paw.loliThreshold` | **200** | **APPROVED** | |
| `paw.overflowPreserved` | **true** | **APPROVED** | 198 + 5 → bonus, cycle = 3 |
| `paw.magnetCollectedCountsNormally` | **true** | **APPROVED** | |
| `paw.hudThresholdProximity` | 25 | PROPOSED | When the HUD switches to `n/200` |
| `loli.durationMs` | **8000** | **APPROVED** | ≈ 8 s |
| `loli.grantsInvulnerability` | **false** | **APPROVED** | |
| `loli.grantsScoreMultiplier` | false | PROPOSED | Keeps the maximum multiplier at ×2 |
| `loli.magnetRadiusUnits` | 1.5 lanes | PROPOSED | |
| `loli.magnetPullPerSecond` | 6.0 lane-units/s | PROPOSED | |
| `loli.eligibleCollectibles` | Paw Tokens only | PROPOSED | The only collectible in v1 |
| `loli.concurrentInstances` | **1** | **APPROVED** | Two Loli companions never run concurrently |
| `queuedLoliBonuses` | run-scoped counter, `0..n` | **APPROVED** | **`RunState` only.** Never persisted, never in the API `Progression` schema, never a database column. Not a boolean — more than one may queue within a run. |
| `loli.queueSurvivesRunEnd` | **false** | **APPROVED** | All active and queued bonus state ends with the run |
| `loli.activationCountedOn` | **ENTERING/ACTIVE transition** | **APPROVED** | An activation counts only when the bonus **actually starts**. A threshold earned but never started is **not** an activation. |
| `loli.thresholdEarnedIsNotActivation` | **true** | **APPROVED** | Invariant, not tunable. See [scoring-and-progression](../product/scoring-and-progression.md) §2.4. |

## 10A. Audio

| Parameter | Value | Status | Notes |
| --- | --- | --- | --- |
| `audio.settingsControls` | music volume slider · SFX volume slider | **APPROVED** | Settings screen |
| `audio.pauseControls` | music mute/unmute · SFX mute/unmute | **APPROVED** | Pause screen; one tap, no drag |
| `audio.muteIndependentOfVolume` | **true** | **APPROVED** | Unmute restores the previous **non-zero** volume. Mute is never stored as `volume = 0`. |
| `audio.persistedFields` | `music_volume`, `music_muted`, `effects_volume`, `effects_muted` | **APPROVED** | Four fields, not two |
| `audio.defaultMusicVolume` | `0.7` | PROPOSED | |
| `audio.defaultEffectsVolume` | `0.9` | PROPOSED | Effects carry gameplay feedback, so they default louder than music |

## 11. SLAYYY

| Parameter | Value | Status | Notes |
| --- | --- | --- | --- |
| `slayyy.durationMs` | **5000** | **APPROVED** | ≈ 5 s |
| `slayyy.grantsInvulnerability` | **true** | **APPROVED** | |
| `slayyy.heals` | **false** | **APPROVED** | |
| `slayyy.autoActivate` | **false** | **APPROVED** | Never fires on its own |
| `slayyy.chargeMax` | 100 | PROPOSED | |
| `slayyy.chargePerSecond` | 1.4 | PROPOSED | |
| `slayyy.chargePerPaw` | 0.45 | PROPOSED | |
| `slayyy.decayPerSecond` | 0 | PROPOSED | No decay |
| `slayyy.chargesWhileActive` | false | PROPOSED | |
| `slayyy.carriesAcrossRuns` | **false** | **APPROVED** | Run-local |
| `slayyy.desktopKey` | `E` | **APPROVED** | |

## 12. Rendering (engine-side, not game rules)

| Parameter | Value | Status | Notes |
| --- | --- | --- | --- |
| `render.targetFps` | 60 | PROPOSED | |
| `render.minAcceptableFps` | 30 | PROPOSED | |
| `render.maxDevicePixelRatio` | 2 | PROPOSED | Caps cost on high-DPR phones |

---

## Values that are NOT tunable — APPROVED

Some things are invariants, not parameters. They must not be exposed as config,
because making them configurable implies they may change:

- Lane count is **3**.
- Maximum health is **3**, and no healing exists.
- The Loli threshold semantics — one bonus per completed threshold, overflow
  preserved.
- SLAYYY never auto-activates.
- Every generated pattern has a valid escape path.
- No combo system; no swipe-down/slide.
- There are exactly **two** obstacle classes, and an obstacle's class never changes.
- A near miss awards **no** score, and fires at most **once per obstacle**.
- Loli Bonus queueing is **run-scoped**; nothing carries into a future run.
- A Loli **activation** counts only on actual start; a threshold earned is not an activation.
- **Mute is independent of volume**; unmute restores the previous non-zero level.
