/**
 * Every tunable gameplay value, exactly once.
 *
 * The approved brief is explicit: *"final values must be tuning/config
 * parameters, not scattered magic numbers"*. `docs/game/tuning-parameters.md` is
 * the registry; this module is the code half of it, and
 * `tuning.spec.ts` fails the build if the two drift apart.
 *
 * **Status is carried per value**, in the `@status` tag above it. An APPROVED
 * value is authoritative product behaviour. A PROPOSED value may be implemented
 * — that is what a tuning parameter is for — but shipping it does not approve
 * it, and it stays PROPOSED until the product owner reviews it. Nothing in this
 * file promotes itself by being used.
 *
 * **Derived values are derived, never restated.** Jump gravity and initial
 * velocity are computed from the airborne duration and the apex height, so the
 * arc cannot drift away from the approved 650 ms target by someone editing one
 * number and not the other.
 *
 * Units are in the name: `Ms`, `Px`, `Ratio`, `Hz`. `Px` values are at the
 * 390 px design baseline and scale with the play column — the domain itself
 * never sees a real pixel, so these are baseline-relative quantities that the
 * engine maps.
 */

export const TUNING = Object.freeze({
  layout: Object.freeze({
    /** @status APPROVED — the 21 v0.3 mobile artboards */
    baselineViewportWidthPx: 390,
    /** @status APPROVED — the 21 v0.3 mobile artboards */
    baselineViewportHeightPx: 844,
    /** @status APPROVED — v0.3 desktop board */
    desktopPlayColumnPx: 460,
  }),

  road: Object.freeze({
    /** @status PROPOSED — fraction of the play column; measure against v0.3 (CR-3) */
    widthRatio: 0.72,
  }),

  lane: Object.freeze({
    /** @status APPROVED — LEFT / CENTER / RIGHT */
    count: 3,
    /** @status APPROVED — a run begins in the centre lane */
    startIndex: 1,
    /** @status PROPOSED */
    transitionMs: 160,
    /**
     * Where in the transition the collision lane changes.
     *
     * At the midpoint, so a lane change feels committed: neither "I was already
     * out of the way" at the start nor "I was clipped by the lane I left" at the
     * end.
     *
     * @status PROPOSED
     */
    occupancySwitchAtRatio: 0.5,
    /** @status PROPOSED — core-run.md §3.3, must be confirmed before M6 closes (CR-1) */
    midAirChangeAllowed: true,
  }),

  input: Object.freeze({
    /**
     * How long a pending input stays queued waiting to become legal.
     *
     * Without a buffer, a correct input during a lane transition is silently
     * dropped and the game feels unresponsive at exactly the moments that matter.
     *
     * @status PROPOSED
     */
    bufferMs: 120,
    /** @status PROPOSED — a later input replaces an earlier pending one */
    bufferDepth: 1,
  }),

  swipe: Object.freeze({
    /** @status PROPOSED — below this, treat as a tap */
    minDistancePx: 24,
    /** @status PROPOSED — slower drags are not swipes */
    maxDurationMs: 400,
    /** @status PROPOSED — the dominant axis must exceed the other by this, so diagonals resolve predictably */
    axisDominanceRatio: 1.5,
  }),

  jump: Object.freeze({
    /** @status APPROVED — the target airborne duration */
    airborneMs: 650,
    /** @status PROPOSED — at the 390 px baseline; scales with the play column */
    apexHeightPx: 96,
  }),

  sim: Object.freeze({
    /** @status PROPOSED — two steps per frame at 60 fps (RNG-3, GE-1 both OPEN) */
    fixedStepHz: 120,
    /**
     * The most steps one frame may simulate before the excess is discarded.
     *
     * Spiral protection. After a tab stall, a GC pause or a device sleep,
     * simulating the whole backlog instantly would teleport the player through
     * everything that accumulated. The excess is dropped, not played.
     *
     * @status PROPOSED
     */
    maxCatchUpSteps: 8,
  }),

  run: Object.freeze({
    /**
     * The readiness beat before a run becomes interactive.
     *
     * The player sees the lane and the character before anything can happen.
     * Input is accepted from the moment the run is interactive; the guarantee is
     * about hazards, not about locking the controls.
     *
     * @status PROPOSED
     */
    readyMs: 1500,
    /**
     * No hazard may be **reachable** before this.
     *
     * Reachable, not spawned: obstacles are created a lookahead ahead of the
     * player so the renderer can show them approaching, and the guarantee the
     * player experiences is about when one can first hurt them.
     *
     * @status PROPOSED
     */
    firstHazardMinMs: 2500,
  }),

  /**
   * The scrolling world, in road units.
   *
   * One unit is one lane width, used for both axes so the lateral and
   * longitudinal envelopes are comparable. The player's reference point sits at
   * distance zero; obstacles are created ahead at a positive distance and move
   * toward it. Nothing here is a pixel — the engine converts.
   */
  world: Object.freeze({
    /** @status PROPOSED — road units per second at the base difficulty speed */
    baseScrollUnitsPerS: 3.0,
    /** @status PROPOSED — how much road the player can see ahead */
    visibleUnits: 10,
    /** @status PROPOSED — obstacles are created this far ahead, beyond the visible road */
    spawnLookaheadUnits: 14,
    /** @status PROPOSED — an obstacle is removed once its trailing edge is this far behind */
    despawnBehindUnits: 2,
  }),

  obstacle: Object.freeze({
    /**
     * Longitudinal footprint of a v1 obstacle.
     *
     * Was 1.0, which together with a 0.8 player made the overlap window 1.8
     * units — 600 ms at the base scroll speed, against an APPROVED 650 ms jump
     * arc. That left a **42 ms** window in which a jump could be started and
     * still clear a barrier, at the slowest point of the run: the jump verb was
     * effectively unusable in the first half-minute, and got *easier* as the
     * game sped up, which is backwards. 0.7 with a 0.5 player gives 400 ms of
     * overlap and a ~250 ms window at the start, widening from there.
     *
     * @status PROPOSED
     */
    defaultLengthUnits: 0.7,
    jumpable: Object.freeze({
      /** @status APPROVED — a jumpable obstacle is cleared while airborne */
      clearableByJump: true,
    }),
  }),

  collision: Object.freeze({
    /** @status PROPOSED — the player's longitudinal footprint, centred on the reference point */
    playerLengthUnits: 0.5,
  }),

  hearts: Object.freeze({
    /** @status APPROVED */
    start: 3,
    /** @status APPROVED */
    max: 3,
    /** @status APPROVED */
    costPerCollision: 1,
  }),

  invuln: Object.freeze({
    /** @status PROPOSED — post-hit invulnerability, so one hazard cannot drain the run */
    postHitMs: 1200,
    /** @status PROPOSED — presentation only; the domain exposes the state, not the blink */
    blinkHz: 10,
  }),

  /*
   * `nearMiss.enabled`, `nearMiss.awardsScore`, `nearMiss.oneEventPerObstacle`,
   * `escape.validateJoins` and `obstacle.laneBlocking.clearableByJump` are in
   * the registry and deliberately **not** here.
   *
   * Each is an APPROVED statement of policy rather than a knob, and each is
   * already structural in the code: a near miss cannot award score because
   * there is no score; it cannot fire twice because an obstacle's outcome is
   * set once; joins are validated because a test validates them; and a lane
   * blocker is not cleared by a jump because `collision.ts` only exempts the
   * jumpable class. Reading a `true` and branching on it would add a way for
   * the invariant to be switched off, which is the opposite of enforcing it.
   */
  nearMiss: Object.freeze({
    /**
     * Lane widths, centre to centre, against the obstacle's lane.
     *
     * Was 0.55, which made the approved earning path unreachable: an adjacent
     * lane is exactly 1.0 centre-to-centre, so a settled pass could never
     * qualify and the mechanic only fired in an 8 ms sliver mid-transition.
     * 1.25 admits the adjacent lane and still excludes two lanes away (2.0),
     * which is exactly what the approved rule describes. The measurement basis
     * is unchanged; only the number moved. CR-6 tuning correction.
     *
     * @status PROPOSED
     */
    lateralEnvelopeUnits: 1.25,
    /** @status PROPOSED — how close along the road counts as passing */
    longitudinalEnvelopeUnits: 0.75,
    /**
     * Headroom, as a fraction of the jump apex, below which clearing a
     * `JUMPABLE` obstacle counts as a near miss.
     *
     * The registry writes this in "units"; read here as apex-normalised height,
     * because the domain has no pixels and the apex is the only vertical scale
     * it owns. Recorded as an interpretation, not a decision.
     *
     * @status PROPOSED
     */
    verticalClearanceUnits: 0.40,
  }),

  difficulty: Object.freeze({
    speed: Object.freeze({
      /** @status PROPOSED — reference scroll speed */
      base: 1.00,
      /** @status PROPOSED — never faster than this */
      ceiling: 1.85,
      /** @status PROPOSED — reaches about 63% of the gap at this many seconds */
      timeConstantS: 90,
    }),
    density: Object.freeze({
      /** @status PROPOSED — fraction of road length occupied */
      base: 0.25,
      /** @status PROPOSED */
      ceiling: 0.55,
    }),
    decisionsPerMin: Object.freeze({
      /** @status PROPOSED */
      base: 14,
      /** @status PROPOSED */
      ceiling: 38,
    }),
    /**
     * Tier 1…Tier 5 start times, in seconds. Tier 5 is terminal.
     *
     * The repository carried 0 / 25 / 60 / 110 / 180 from its first commit and
     * never changed it, which let a PROPOSED value quietly read as source of
     * truth. It had never been approved: DO-3 recorded the thresholds as
     * unconfirmed from M0.5 onward, and the M0.5 note changed only the labels.
     *
     * The product owner settled it during the M6 adversarial remediation, and
     * these are that decision. Approved as *thresholds* only — the soft-cap
     * ceilings DO-3 also asked about are still open and still PROPOSED, so the
     * decision narrows DO-3 rather than closing it.
     *
     * @status APPROVED
     */
    tierStartsS: Object.freeze([0, 30, 60, 120, 180]),
  }),

  generator: Object.freeze({
    /** @status PROPOSED — patterns used within this many selections are excluded */
    repeatCooldown: 3,
    /** @status PROPOSED — the gap floor per tier, regardless of density */
    minGapUnits: Object.freeze([6, 5.5, 5, 4.5, 4]),
  }),

  /**
   * Score.
   *
   * Three components, never a fourth mutable total: the displayed score is the
   * sum, so it cannot drift away from the parts that produced it.
   *
   * `perPaw` is APPROVED; the other two are not. The registry records what the
   * approved value did to the run totals — the v0.3 boards' 1,200-5,900 range
   * now spans roughly one to four minutes rather than 1.5 to five — and
   * `distancePerSecond` is the PROPOSED lever that owns the difference.
   */
  score: Object.freeze({
    /** @status PROPOSED — per second at the base speed; scales with the real scroll rate */
    distancePerSecond: 10,
    /** @status APPROVED — awarded once per collected Paw Token, magnet or not */
    perPaw: 10,
    /** @status APPROVED — the only multiplier in v1, and it never compounds */
    slayyyMultiplier: 2,
  }),

  /**
   * Paw Tokens: the one collectible in v1.
   *
   * Placement is drawn from the **collectible** RNG stream, never the pattern
   * stream, so adding or retuning tokens cannot move a single obstacle.
   */
  paw: Object.freeze({
    /** @status APPROVED — Paw Tokens per Loli Bonus, with the overflow preserved */
    loliThreshold: 200,
    /** @status PROPOSED — how close to the threshold the HUD starts showing n/200 */
    hudThresholdProximity: 25,
    /** @status PROPOSED — longitudinal footprint, matched to the player's own */
    lengthUnits: 0.5,
    /** @status PROPOSED — lateral reach for collection, centre to centre */
    collectLateralUnits: 0.5,
    /** @status PROPOSED — most tokens one pattern may carry */
    perPatternMax: 3,
    /** @status PROPOSED — spacing between tokens in a run of them */
    spacingUnits: 1.2,
    /** @status PROPOSED — road distance between one token group and the next */
    groupGapUnits: 8,
  }),

  /**
   * The Loli Bonus: a companion, not a coin.
   *
   * It magnetises Paw Tokens and does nothing else — no invulnerability, no
   * extra life, no healing, no multiplier of its own. Overlapping SLAYYY is
   * allowed and still yields ×2, never ×4.
   */
  loli: Object.freeze({
    /** @status APPROVED — the active companion window, ≈ 8 s */
    durationMs: 8000,
    /** @status PROPOSED — the "puf" entrance, before the magnet engages */
    enteringMs: 600,
    /** @status PROPOSED — the exit flourish, after the magnet disengages */
    exitingMs: 500,
    /** @status PROPOSED — lateral attraction reach, in lane widths */
    magnetRadiusUnits: 1.5,
    /**
     * How far up the road the magnet reaches.
     *
     * Chosen to match `world.visibleUnits`, because "attracts nearby paws"
     * cannot honestly mean a token the player has never seen. Held as its own
     * value rather than read from `world`: this is a gameplay reach, and the
     * day the camera changes is not the day the magnet should.
     *
     * @status PROPOSED
     */
    magnetReachUnits: 10,
    /** @status PROPOSED — how fast an attracted token closes, in lane-units per second */
    magnetPullPerSecond: 6,
    /** @status APPROVED — two companions never run at once; further earns queue */
    concurrentInstances: 1,
  }),

  /**
   * SLAYYY: earned across a run, spent by the player, never automatic.
   *
   * The meter is run-local and starts empty every run. Filling it does not fire
   * it — `autoActivate` is APPROVED false — so a full meter becomes READY and
   * waits for a deliberate press.
   */
  slayyy: Object.freeze({
    /** @status APPROVED — the active window, ≈ 5 s */
    durationMs: 5000,
    /** @status PROPOSED — a full meter */
    chargeMax: 100,
    /** @status PROPOSED — the slow fill, from surviving distance */
    chargePerSecond: 1.6,
    /** @status PROPOSED — the fast fill, per Paw Token collected */
    chargePerPaw: 1.3,
    /** @status PROPOSED — no decay in v1; a meter never drains on its own */
    decayPerSecond: 0,
  }),

  escape: Object.freeze({
    /** @status PROPOSED — the solver may spend at most this many actions per pattern */
    maxActionsPerPattern: 2,
    /** @status PROPOSED — subtracted from the window; turns "possible" into "fair" */
    reactionBudgetMs: 350,
    /** @status PROPOSED — how finely the solver considers acting; well under the reaction budget */
    solverGridMs: 100,
    /** @status PROPOSED — search ceiling, so a misconfigured pattern fails rather than hangs */
    solverMaxSteps: 2000,
  }),
})

export type Tuning = typeof TUNING

/**
 * The fixed simulation step, in milliseconds.
 *
 * Derived from the rate so the two cannot disagree. Not an integer at every
 * rate — 120 Hz gives 8.333…ms — which is why the accumulator carries the
 * remainder rather than rounding, and why the domain takes `deltaMs` as a
 * number rather than pretending steps are whole milliseconds.
 */
export const STEP_MS = 1000 / TUNING.sim.fixedStepHz

/**
 * The jump arc, derived from the two independent values.
 *
 * A symmetric parabola: the apex sits at half the airborne duration, and
 * gravity follows from `h = ½ g t²` at that apex. Storing gravity directly
 * would let it drift out of agreement with the approved 650 ms, which is the
 * one number here that is actually approved.
 */
export const JUMP_ARC = Object.freeze((() => {
  const apexMs = TUNING.jump.airborneMs / 2
  const apexSeconds = apexMs / 1000

  // h = ½ g t²  ⇒  g = 2h / t²
  const gravityPxPerS2 = (2 * TUNING.jump.apexHeightPx) / (apexSeconds * apexSeconds)

  return {
    apexMs,
    gravityPxPerS2,
    initialVelocityPxPerS: gravityPxPerS2 * apexSeconds,
  }
})())
