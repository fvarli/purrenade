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
| `difficulty.density.base` | 0.25 | PROPOSED | Fraction of road length occupied. **Computed by `densityTarget` and consumed by nothing** — spacing comes from `generator.minGapUnits`. Wiring it would change difficulty feel, which is a product decision (DO-3) |
| `difficulty.density.ceiling` | 0.55 | PROPOSED | Same: computed, not consumed |
| `difficulty.decisionsPerMin.base` | 14 | PROPOSED | **Computed by `decisionsPerMinute` and consumed by nothing**, exactly as the density pair above |
| `difficulty.decisionsPerMin.ceiling` | 38 | PROPOSED | Same: computed, not consumed |
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
| `score.distancePerSecond` | 10 at base speed | PROPOSED | Scales with actual scroll speed |
| `score.perPaw` | **10** | **APPROVED** | **LOCKED.** Decided by the product owner at the M7 adversarial review, replacing a PROPOSED `5`. One normally collected token, magnet-collected or not; ×2 while SLAYYY is active, like every other component |
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
| `paw.droppedWhenBlocked` | **true** | PROPOSED | **The mechanism, not the rule.** The rule — *a Paw Token never requires unavoidable damage to collect* — is an **APPROVED/LOCKED invariant**, listed under "Values that are NOT tunable". This row records only how it is currently upheld: a pending token that a **`LANE_BLOCKING`** obstacle has landed on is removed. It stays PROPOSED because the mechanism may be replaced; the invariant may not. A `JUMPABLE` overlap is kept deliberately — collection never consults `isAirborne`, so the player clears the barrier and takes the token in the same jump. See the note below |

> **Why tokens are reconciled against the road, found at the M7 adversarial review.**
> Obstacle patterns and token groups run on **independent schedules into the same band** —
> both originate near `world.spawnLookaheadUnits`, tokens every `paw.groupGapUnits`,
> patterns every `pattern.lengthUnits + generator.minGapUnits` — and the obstacle generator
> has never read the token list. `clearLanes` can only check the road as it stands when a
> group is emitted, so an obstacle emitted a few steps later lands on a token that already
> exists.
>
> Measured over twelve seeds and forty thousand steps each: **230** same-lane overlaps,
> **156** of them lane-blocking, and **58 in which the obstacle's damage window strictly
> contained the token's collection window** — bait that could not be taken at all without
> losing a heart. The first arrives **15.3 s into seed 1, in Tier 1**, roughly one per 25 s
> of play. Of the 230, **215 came from an obstacle that did not exist when the token was
> placed**, which is why no spawn-time check can solve it: widening `clearLanes` by the
> player's half-extent was tried and changed **not one placement** across 120 000 steps.
>
> Reconciling afterwards rather than teaching the obstacle generator about tokens keeps the
> two RNG streams independent — G23 still holds, because this reads the obstacle list and
> consumes no randomness.
| `paw.hudThresholdProximity` | 25 | PROPOSED | When the HUD switches to `n/200` |
| `paw.lengthUnits` | 0.5 | PROPOSED | New at M7. Longitudinal footprint, matched to the player's own |
| `paw.collectLateralUnits` | 0.5 | PROPOSED | New at M7. Lateral reach for collection, centre to centre |
| `paw.perPatternMax` | 3 | PROPOSED | New at M7. Most tokens one group may carry |
| `paw.spacingUnits` | 1.2 | PROPOSED | New at M7. Gap between tokens within a group |
| `paw.groupGapUnits` | 8 | PROPOSED | New at M7. Road distance between one group and the next. No document specifies a paw spawn model, so the whole cadence is proposed here |
| `loli.durationMs` | **8000** | **APPROVED** | ≈ 8 s |
| `loli.enteringMs` | 600 | PROPOSED | New at M7. The "puf" entrance, before the magnet engages. The art brief names an entry state; its length was never specified |
| `loli.exitingMs` | 500 | PROPOSED | New at M7. The exit flourish, after the magnet disengages |
| `loli.grantsInvulnerability` | **false** | **APPROVED** | |
| `loli.grantsScoreMultiplier` | false | PROPOSED | Keeps the maximum multiplier at ×2 |
| `loli.magnetRadiusUnits` | 1.5 lanes | PROPOSED | **Lateral** reach: which lanes Loli can serve |
| `loli.magnetReachUnits` | 10 units | PROPOSED | New at the M7 review. **Longitudinal** reach: how far up the road she notices. Matches `world.visibleUnits` by intent — see the note below |
| `loli.magnetPullPerSecond` | 6.0 lane-units/s | PROPOSED | Closes the lateral gap; the token's progress down the road is left to the world's scroll |
| `loli.eligibleCollectibles` | Paw Tokens only | PROPOSED | The only collectible in v1 |
| `loli.concurrentInstances` | **1** | **APPROVED** | Two Loli companions never run concurrently |
| `queuedLoliBonuses` | run-scoped counter, `0..n` | **APPROVED** | **`RunState` only.** Never persisted, never in the API `Progression` schema, never a database column. Not a boolean — more than one may queue within a run. |
| `loli.queueSurvivesRunEnd` | **false** | **APPROVED** | All active and queued bonus state ends with the run |
| `loli.activationCountedOn` | **ENTERING/ACTIVE transition** | **APPROVED** | An activation counts only when the bonus **actually starts**. A threshold earned but never started is **not** an activation. |
| `loli.thresholdEarnedIsNotActivation` | **true** | **APPROVED** | Invariant, not tunable. See [scoring-and-progression](../product/scoring-and-progression.md) §2.4. |

> **Why the magnet gained a second bound at the M7 review.**
> It was implemented with a lateral radius and no longitudinal term, on the reading
> that "1.5 **lanes**" names an axis. That reading does not survive contact with the
> numbers. Tokens exist from `spawnLookaheadUnits` 14 down to `-despawnBehindUnits`,
> the visible road is `visibleUnits` 10, and the lateral radius of 1.5 covers *every*
> lane from the centre one — so the magnet was repositioning tokens across a band of
> road about four units deep that the player cannot see, and `magnetPullPerSecond` is
> specified as *"slow enough to be visible"*. Every off-screen token finished its
> entire lateral move before it appeared, which makes the pull rate unobservable and
> the word "nearby" untrue.
>
> **What did not change: nothing about what the player collects.** Collection is
> already gated on longitudinal overlap, so a distant token was never collectible —
> it was aligned early and then travelled normally. This was a readability defect,
> not a fairness or scoring one, and the fix is scoped to match.
>
> Two independent bounds rather than one Euclidean radius, because the axes answer
> different questions — sideways is *which lanes Loli serves*, forward is *how far
> ahead she notices* — and a single radius would force one of the two to be wrong.
> **Both numbers stay PROPOSED.** `magnetReachUnits` was set to `visibleUnits` by
> intent, not derived from it: the day the camera changes is not the day the magnet
> should.

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
| `slayyy.chargePerSecond` | 1.6 | PROPOSED | Retuned at the M7 review, from `1.4`. See the note below |
| `slayyy.chargePerPaw` | 1.3 | PROPOSED | Retuned at the M7 review, from `0.45`, which made the collectible loop worth about 7 % of a fill |
| `slayyy.decayPerSecond` | 0 | PROPOSED | No decay. **Declared and read by nothing** — the absence of decay is structural, not a value the code consults |
| `slayyy.chargesWhileActive` | false | PROPOSED | Structural, like `nearMiss.awardsScore`: `addCharge` returns its argument unchanged while the phase is `active`. There is deliberately no leaf in `TUNING` — a knob here would be a way to switch off a specification sentence |
| `slayyy.carriesAcrossRuns` | **false** | **APPROVED** | Run-local |
| `slayyy.desktopKey` | `E` | **APPROVED** | |

> **The first activation is an APPROVED UX target, and the rates are what serve it.**
> The product owner approved, at the M7 review, that the first activation should normally
> become available **around 35–45 s of a representative healthy run**. That is a target for
> a *range of play*, not a timer: nothing in the domain knows the number, READY arises only
> from the meter filling, and a player who collects more arrives sooner.
>
> The rates were chosen against measurement, not arithmetic. Four scripted players, three
> seeds each, running-time only (the readiness beat and any pause are excluded, exactly as
> the charge itself excludes them):
>
> | Scenario | First READY | Paws taken by then |
> | --- | --- | --- |
> | Collects nothing at all (tokens removed) | **62.5 s** | 0 |
> | Dodges hazards, avoids tokens | **45.4 – 51.1 s** | 14 – 21 |
> | **Representative healthy run** | **38.1 – 42.9 s** | 25 – 30 |
> | Crosses the road for every token | **36.5 – 38.9 s** | 29 – 32 |
>
> Held by `game/domain/slayyy-readiness.spec.ts`, which plays the game rather than staging a
> state, and fails if the healthy case leaves the window in either direction.
>
> **What the previous rates got wrong was the balance, not just the total.** At `0.45` per paw
> against a meter of 100, a healthy player's whole collection effort was worth about **7 %** of
> a fill — the rate was nominally *"rewards engagement with the collectible loop"* and in
> practice indistinguishable from standing still. It is now about **35 %**, which is what makes
> the spread above exist at all.
>
> **Both rates remain PROPOSED.** The 35–45 s *target* is APPROVED; these two numbers are one
> way to hit it and SP-1 still owns them.

## 11A. Tutorial

Every value here is about **teaching pace**, never about difficulty. The tutorial
cannot hurt the player — damage is disabled at the rules level — so none of these
can make it harder or easier, only quicker or slower to read. That is also why the
re-presentation of an unsatisfied lesson is a **distance gap** rather than a
timeout: the player is never racing anything, and there is no step timeout and no
forced skip.

| Parameter | Value | Status | Notes |
| --- | --- | --- | --- |
| `tutorial.introDwellMs` | 2600 | PROPOSED | How long the greeting holds before the first lesson opens |
| `tutorial.repromptMs` | 3000 | PROPOSED | From [tutorial.md](../product/tutorial.md) §3.2 — a lesson with no input re-prompts with more explicit guidance |
| `tutorial.firstCueUnits` | 9 | PROPOSED | How far ahead a lesson places its first prop |
| `tutorial.repeatGapUnits` | 11 | PROPOSED | The gap before an unsatisfied lesson presents its prop again. The world keeps scrolling; the lesson loops |
| `tutorial.celebrateMs` | 900 | PROPOSED | How long a passed lesson is acknowledged before the next prompt |
| `tutorial.finalPracticeUnits` | 34 | PROPOSED | The closing practice stretch, applying what was already taught |

**Not tunable, deliberately.** The tutorial's safety is structural, not a value:
there is no `tutorial.damageEnabled`, no `tutorial.hearts` and no
`tutorial.canDie`. Damage is bypassed by the mode, so a knob here would be a way
to switch off the one guarantee [tutorial.md](../product/tutorial.md) §3 states as
an invariant. The lesson order is likewise a sequence in the rules, not a list a
value could reorder.

## 12. Rendering (engine-side, not game rules)

| Parameter | Value | Status | Notes |
| --- | --- | --- | --- |
| `render.targetFps` | 60 | PROPOSED | **Not implemented** — later milestone. |
| `render.minAcceptableFps` | 30 | PROPOSED | **Not implemented** — later milestone. |
| `render.maxDevicePixelRatio` | 2 | PROPOSED | **Not implemented** — later milestone. Caps cost on high-DPR phones |

---

## 13. Server plausibility bounds — PROPOSED, flag-only (M9)

The backend classifies every finish (`purrenade-api` `docs/security/anti-cheat.md` §3B,
`config/game_runs.php`). Bounds derived from the **PROPOSED** values above may only **flag** a
run — never reject it — because a legitimate player's run is never rejected on an unresolved
tuning number (ANTI-4). A change to any value they derive from should be checked against them.

| Server rule | Bound | Derived from | Effect |
| --- | --- | --- | --- |
| `score_rate_high` | > 80 points per second | §3A speed, §7 difficulty, §9 scoring, §11 SLAYYY ×2 (theoretical max ≈ 78.6) | flag |
| `paw_rate_high` | > 3 paws per second | §10 paw spawn (peak ≤ 2.08/s) | flag |
| `score_below_duration_floor` | < 5 points per second | half of §9 `distancePerSecond` 10 | flag |
| `duration_below_minimum` | < 4000 ms | §5 first hazard 2500 ms + invulnerability, below the ≈ 4900 ms fastest three-heart loss | flag |

The **structural** rules — which may reject — rest only on APPROVED or LOCKED values:
`score.perPaw` 10 (`score ≥ 10 × run_paws`), the stored integer domain, a non-zero duration,
and a claimed duration within the server's own `finished_at − started_at` window plus 5000 ms.

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
- **A Paw Token never requires unavoidable damage to collect.** The collectible
  counterpart of the escape-path guarantee, and APPROVED/LOCKED at the M7 review.
  The *invariant* is fixed; the mechanism that upholds it is not — today a pending
  token that a `LANE_BLOCKING` obstacle has landed on is removed from the world,
  and a different implementation may replace that so long as the guarantee holds.
  A `JUMPABLE` overlap is explicitly **not** a violation: clearing the barrier and
  taking the token in the same jump is legitimate play.
- No combo system; no swipe-down/slide.
- There are exactly **two** obstacle classes, and an obstacle's class never changes.
- A near miss awards **no** score, and fires at most **once per obstacle**.
- Loli Bonus queueing is **run-scoped**; nothing carries into a future run.
- A Loli **activation** counts only on actual start; a threshold earned is not an activation.
- **Mute is independent of volume**; unmute restores the previous non-zero level.
