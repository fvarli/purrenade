import { TUNING } from './tuning'
import type { RunState, ScoreState } from './types'

/**
 * Score: three components, one multiplier rule, no fourth total.
 *
 * `scoring-and-progression.md` §1 names the components — distance, collectible
 * and bonus — and the displayed score is their sum. There is deliberately no
 * stored total: a total that is written alongside the parts is a total that can
 * drift away from them, and the drift is invisible until someone audits it.
 *
 * Everything is held in **thousandths of a point**, as integers. Distance score
 * accrues a fraction of a point on every 8.33 ms step, and a float accumulator
 * over a five-minute run is exactly the kind of quantity that ends up depending
 * on the order additions happened in. Integers do not.
 */

const MS_PER_SECOND = 1000

/** One point, in the internal unit. */
const MILLI = 1000

export const EMPTY_SCORE: ScoreState = Object.freeze({
  distanceMilli: 0,
  collectionMilli: 0,
  bonusMilli: 0,
})

/**
 * Is score earned right now multiplied?
 *
 * The single place the ×2 rule lives. `score.multiplierScope` is PROPOSED as
 * "distance + collectible + bonus", so every component is eligible and the rule
 * is a property of *when* score is earned rather than of which kind it is —
 * which is why this takes the state and not a component name.
 *
 * Composition is `max, never product`: Loli overlapping SLAYYY is still ×2.
 * There is only one multiplier in v1, so "max" is expressed by there being
 * nothing to multiply it with.
 */
export function scoreMultiplier(state: RunState): number {
  return state.slayyy.phase === 'active' ? TUNING.score.slayyyMultiplier : 1
}

/**
 * Award score, in whole points, to one component.
 *
 * The multiplier is applied here and nowhere else. Scattering `* 2` through the
 * domain is how a rule becomes four subtly different rules.
 */
export function earnPoints(
  state: RunState,
  component: keyof ScoreState,
  points: number,
): ScoreState {
  return earnMilli(state, component, points * MILLI)
}

/** Award score in thousandths, for the distance rate that is not a whole point. */
export function earnMilli(
  state: RunState,
  component: keyof ScoreState,
  milli: number,
): ScoreState {
  const awarded = Math.round(milli) * scoreMultiplier(state)

  return { ...state.score, [component]: state.score[component] + awarded }
}

/**
 * Score for distance travelled this step.
 *
 * `score.distancePerSecond` is quoted "at base speed", and the run speeds up —
 * so the rate is expressed per **road unit** rather than per second, and a
 * faster run scores faster because it covers more units. Deriving the per-unit
 * rate from the two existing tunables keeps it honest: there is no third number
 * that can be edited into disagreeing with them.
 */
export function distanceMilliFor(movedUnits: number): number {
  const pointsPerUnit = TUNING.score.distancePerSecond / TUNING.world.baseScrollUnitsPerS

  return movedUnits * pointsPerUnit * MILLI
}

/** The three components, floored to whole points for display. */
export function scoreComponents(state: RunState): {
  distance: number
  collection: number
  bonus: number
} {
  return {
    distance: Math.floor(state.score.distanceMilli / MILLI),
    collection: Math.floor(state.score.collectionMilli / MILLI),
    bonus: Math.floor(state.score.bonusMilli / MILLI),
  }
}

/**
 * The displayed score.
 *
 * The sum of the floored components rather than the floor of the sum, so
 * `total === distance + collection + bonus` holds exactly as integers. Flooring
 * once at the end would leave the displayed parts adding up to one less than
 * the displayed whole, which is the kind of thing a player notices.
 */
export function scoreTotal(state: RunState): number {
  const parts = scoreComponents(state)

  return parts.distance + parts.collection + parts.bonus
}

/** Seconds, for anything that needs the rate in its documented unit. */
export const SCORE_MS_PER_SECOND = MS_PER_SECOND
