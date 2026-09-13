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
