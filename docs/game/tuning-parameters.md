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

## 3A. The scrolling world

One **unit** is one lane width, used for both axes so the lateral and longitudinal
envelopes are directly comparable. The player's reference point sits at distance zero and
obstacles approach it. None of this is pixels — the engine converts.

| Parameter | Value | Status | Notes |
| --- | --- | --- | --- |
| `world.baseScrollUnitsPerS` | 3.0 | PROPOSED | Road units per second at `difficulty.speed.base` |
| `world.visibleUnits` | 10 | PROPOSED | How much road the player can see ahead; sets the reaction window |
| `world.spawnLookaheadUnits` | 14 | PROPOSED | Obstacles are created this far ahead, beyond the visible road |
| `world.despawnBehindUnits` | 2 | PROPOSED | Removed once the trailing edge is this far behind the player |

## 4A. Obstacle classes

| Parameter | Value | Status | Notes |
| --- | --- | --- | --- |
| `obstacle.classes` | `LANE_BLOCKING`, `JUMPABLE` | **APPROVED** | Exactly two; not tunable |
| `obstacle.laneBlocking.clearableByJump` | **false** | **APPROVED** | Being airborne does not clear it |
| `obstacle.jumpable.clearableByJump` | **true** | **APPROVED** | |
| `obstacle.classChangesDuringSlayyy` | **false** | **APPROVED** | SLAYYY swaps the visual variant only |
| `obstacle.defaultLengthUnits` | 0.7 | PROPOSED | Longitudinal footprint. Reduced at M6 so the jump arc clears a barrier with a human-sized margin — see the note below |

Behaviour belongs to the class, never to the artwork. See
[difficulty-and-obstacles](../product/difficulty-and-obstacles.md) §3.1.

> **Not in the code tuning module, deliberately — M6.** `obstacle.laneBlocking.clearableByJump`,
> `nearMiss.enabled`, `nearMiss.awardsScore`, `nearMiss.oneEventPerObstacle` and
> `escape.validateJoins` are APPROVED statements of policy rather than knobs, and each is
> structural in the implementation: there is no score for a near miss to award, an obstacle's
> outcome is fixed once so it cannot fire twice, joins are validated because a test validates
> them, and only the jumpable class is exempted from collision while airborne. Giving each a
> readable `true` would add a way to switch the invariant off.

## 4B. Near miss

| Parameter | Value | Status | Notes |
| --- | --- | --- | --- |
| `nearMiss.enabled` | **true** | **APPROVED** | A real v1 statistic mechanic |
| `nearMiss.awardsScore` | **false** | **APPROVED** | No score, no multiplier, directly or indirectly |
| `nearMiss.oneEventPerObstacle` | **true** | **APPROVED** | Structural, not a debounce |
| `nearMiss.lateralEnvelopeUnits` | `1.25` lane widths | PROPOSED | Centre-to-centre. Admits an adjacent lane (1.0), excludes two lanes away (2.0). Corrected at M6 — see the note below |
| `nearMiss.longitudinalEnvelopeUnits` | `0.75` | PROPOSED | How close along the road counts as passing |
| `nearMiss.verticalClearanceUnits` | `0.40` | PROPOSED | Clearing a `JUMPABLE` obstacle with little headroom |

Envelope values must be tuned **together with** `escape.reactionBudgetMs` — see
[core-run](../product/core-run.md) §5A.3.

> **Lateral envelope corrected at M6 (CR-6).** It was `0.55`, measured centre-to-centre,
> against an approved rule that earns a near miss by *"passing a `LANE_BLOCKING` obstacle in
> an adjacent lane"*. An adjacent lane is exactly `1.0` centre-to-centre, so the approved
> earning path could never fire — measured, the mechanic produced ~0.94 events per simulated
> minute, all of them from an 8 ms sliver mid-transition rather than from the case the rule
> describes. `1.25` admits the adjacent lane and still excludes two lanes away. **The
> measurement basis is unchanged** — still centre-to-centre — and the value stays PROPOSED.

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
| `collision.playerBoxWidthRatio` | 0.60 | PROPOSED | **Not implemented.** Superseded by the lane-occupancy model: collision asks which lane the player occupies, never how wide a box is |
| `collision.playerBoxHeightRatio` | 0.80 | PROPOSED | **Not implemented.** Superseded by `jump.airborneMs` and `nearMiss.verticalClearanceUnits`: vertical clearance is a question about the arc, not about a box |
| `collision.playerLengthUnits` | 0.5 | PROPOSED | The player's longitudinal footprint, centred on the reference point. Reduced at M6 alongside the obstacle footprint |

> **The jump window, corrected at M6.** The overlap a jump must cover is the obstacle's
> footprint plus the player's, divided by the scroll speed. At 1.0 + 0.8 that was 600 ms at
> the base speed against an **APPROVED** 650 ms arc, leaving a **42 ms** window to start the
> jump — and, because the overlap shrinks as the world speeds up, the jump verb was hardest
> at the very start of a run and easiest at the end. That inverts the difficulty principle
> the curve is built on. 0.7 + 0.5 gives a window of roughly 250 ms at the opening, widening
> with speed. `jump.airborneMs` is APPROVED and was not touched; the two footprints are
> PROPOSED and were.
| `invuln.postHitMs` | 1200 | PROPOSED | |
| `invuln.blinkHz` | 10 | PROPOSED | Partial-alpha on the sprite; never a full-screen flash; reduced-motion aware |

## 6. Run lifecycle

| Parameter | Value | Status | Notes |
| --- | --- | --- | --- |
| `run.readyMs` | 1500 | PROPOSED | Readiness beat before the first hazard |
| `run.firstHazardMinMs` | 2500 | PROPOSED | No hazard reachable before this |
| `run.resumeReadyMs` | 800 | PROPOSED | **Not implemented.** Resuming restores the phase it left; there is no shortened beat. Kept as an open proposal, not as behaviour |
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
| `difficulty.tierStartsS` | 0, 30, 60, 120, 180 | **APPROVED** | Seconds. Tier 1…Tier 5; **Tier 5 is terminal**. Corrected and approved at M6 — see the note below |

Curve: `value(t) = ceiling - (ceiling - base) × exp(-t / timeConstant)`.

> **Tier thresholds corrected and approved at M6.** The product decision is
> **0 / 30 / 60 / 120 / 180 seconds**. This repository carried `0 / 25 / 60 / 110 / 180`
> from its first commit and never changed it, so a PROPOSED value that had simply been
> present for a long time began to read as source of truth. It had never been approved —
> DO-3 recorded the thresholds as unconfirmed throughout — and the M0.5 note that
> relabelled `T0…T4` to Tier 1…5 said explicitly that thresholds were unchanged, which is
> why nothing ever flagged it. The corrected values are recorded here and in
> `difficulty-and-obstacles.md` §2.3 so the ambiguity cannot recur.
>
> The product owner approved these thresholds during the M6 adversarial remediation, so
> the row above is **APPROVED**. That covers the thresholds *only*. DO-3 also asked about
> the soft-cap ceilings, and those are untouched by the decision: they remain PROPOSED and
> DO-3 stays open, narrowed to them.

## 8. Generation and escape path

| Parameter | Value | Status | Notes |
| --- | --- | --- | --- |
| `generator.repeatCooldown` | 3 | PROPOSED | Patterns recently used are excluded |
| `generator.minGapUnits` | 6, 5.5, 5, 4.5, 4 | PROPOSED | One per tier. Floor regardless of density |
| `escape.maxActionsPerPattern` | 2 | PROPOSED | |
| `escape.reactionBudgetMs` | 350 | PROPOSED | Subtracted from the available window; turns "possible" into "fair" |
| `escape.validateJoins` | true | **APPROVED** | Patterns are validated across joins, not in isolation |
| `escape.solverGridMs` | 100 | PROPOSED | How finely the solver considers acting. Far under the reaction budget, so nothing survivable is lost |
| `escape.solverMaxSteps` | 2000 | PROPOSED | Search ceiling, so a misconfigured pattern fails rather than hangs |

## 9. Scoring

| Parameter | Value | Status | Notes |
| --- | --- | --- | --- |
| `score.distancePerSecond` | 10 at base speed | PROPOSED | **Not implemented** — later milestone. Scales with actual scroll speed |
| `score.perPaw` | 5 | PROPOSED | **Not implemented** — later milestone. |
| `score.rounding` | floor, integer | PROPOSED | **Not implemented** — later milestone. |
| `score.slayyyMultiplier` | **2** | **APPROVED** | **Not implemented** — later milestone. |
| `score.multiplierScope` | distance + collectible + bonus | PROPOSED | **Not implemented** — later milestone. |
| `score.multiplierComposition` | **max, never product** | PROPOSED | **Not implemented** — later milestone. Maximum multiplier in v1 is ×2 |
| `score.comboSystem` | **none** | **APPROVED** | **Not implemented** — later milestone. |

## 10. Paws and Loli Bonus

| Parameter | Value | Status | Notes |
| --- | --- | --- | --- |
| `paw.loliThreshold` | **200** | **APPROVED** | **Not implemented** — later milestone. |
| `paw.overflowPreserved` | **true** | **APPROVED** | **Not implemented** — later milestone. 198 + 5 → bonus, cycle = 3 |
| `paw.magnetCollectedCountsNormally` | **true** | **APPROVED** | **Not implemented** — later milestone. |
| `paw.hudThresholdProximity` | 25 | PROPOSED | **Not implemented** — later milestone. When the HUD switches to `n/200` |
| `loli.durationMs` | **8000** | **APPROVED** | **Not implemented** — later milestone. ≈ 8 s |
| `loli.grantsInvulnerability` | **false** | **APPROVED** | **Not implemented** — later milestone. |
| `loli.grantsScoreMultiplier` | false | PROPOSED | **Not implemented** — later milestone. Keeps the maximum multiplier at ×2 |
| `loli.magnetRadiusUnits` | 1.5 lanes | PROPOSED | **Not implemented** — later milestone. |
| `loli.magnetPullPerSecond` | 6.0 lane-units/s | PROPOSED | **Not implemented** — later milestone. |
| `loli.eligibleCollectibles` | Paw Tokens only | PROPOSED | **Not implemented** — later milestone. The only collectible in v1 |
| `loli.concurrentInstances` | **1** | **APPROVED** | **Not implemented** — later milestone. Two Loli companions never run concurrently |
| `queuedLoliBonuses` | run-scoped counter, `0..n` | **APPROVED** | **`RunState` only.** Never persisted, never in the API `Progression` schema, never a database column. Not a boolean — more than one may queue within a run. |
| `loli.queueSurvivesRunEnd` | **false** | **APPROVED** | **Not implemented** — later milestone. All active and queued bonus state ends with the run |
| `loli.activationCountedOn` | **ENTERING/ACTIVE transition** | **APPROVED** | **Not implemented** — later milestone. An activation counts only when the bonus **actually starts**. A threshold earned but never started is **not** an activation. |
| `loli.thresholdEarnedIsNotActivation` | **true** | **APPROVED** | **Not implemented** — later milestone. Invariant, not tunable. See [scoring-and-progression](../product/scoring-and-progression.md) §2.4. |

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
| `slayyy.durationMs` | **5000** | **APPROVED** | **Not implemented** — later milestone. ≈ 5 s |
| `slayyy.grantsInvulnerability` | **true** | **APPROVED** | **Not implemented** — later milestone. |
| `slayyy.heals` | **false** | **APPROVED** | **Not implemented** — later milestone. |
| `slayyy.autoActivate` | **false** | **APPROVED** | **Not implemented** — later milestone. Never fires on its own |
| `slayyy.chargeMax` | 100 | PROPOSED | **Not implemented** — later milestone. |
| `slayyy.chargePerSecond` | 1.4 | PROPOSED | **Not implemented** — later milestone. |
| `slayyy.chargePerPaw` | 0.45 | PROPOSED | **Not implemented** — later milestone. |
| `slayyy.decayPerSecond` | 0 | PROPOSED | **Not implemented** — later milestone. No decay |
| `slayyy.chargesWhileActive` | false | PROPOSED | **Not implemented** — later milestone. |
| `slayyy.carriesAcrossRuns` | **false** | **APPROVED** | **Not implemented** — later milestone. Run-local |
| `slayyy.desktopKey` | `E` | **APPROVED** | **Not implemented** — later milestone. |

## 12. Rendering (engine-side, not game rules)

| Parameter | Value | Status | Notes |
| --- | --- | --- | --- |
| `render.targetFps` | 60 | PROPOSED | **Not implemented** — later milestone. |
| `render.minAcceptableFps` | 30 | PROPOSED | **Not implemented** — later milestone. |
| `render.maxDevicePixelRatio` | 2 | PROPOSED | **Not implemented** — later milestone. Caps cost on high-DPR phones |

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
