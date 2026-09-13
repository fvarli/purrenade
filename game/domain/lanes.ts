import { TUNING } from './tuning'
import type { LaneIndex, LaneTransition, RunState } from './types'

/**
 * Lane movement: one lane per input, clamped at the edges, committed at the
 * midpoint.
 */

const MIN_LANE = 0
const MAX_LANE = TUNING.lane.count - 1

/** Is this a lane the playfield actually has? */
export function isLaneIndex(value: number): value is LaneIndex {
  return Number.isInteger(value) && value >= MIN_LANE && value <= MAX_LANE
}

/**
 * The lane one step in a direction, or `null` if there is none.
 *
 * Null rather than a clamped value on purpose: the caller has to distinguish
 * "move to lane 0" from "you are already at lane 0", because the second is a
 * no-op that must not start a transition, spend a buffered input, or produce
 * any feedback. It is not an error and carries no penalty — it simply does not
 * happen.
 */
export function laneStep(from: LaneIndex, direction: -1 | 1): LaneIndex | null {
  const target = from + direction

  return isLaneIndex(target) ? target : null
}

/**
 * The lane the player currently occupies for collision purposes.
 *
 * Not the visual position, and during a transition not either endpoint either.
 * Occupancy flips at `occupancySwitchAtRatio` through the movement, so a lane
 * change is committed halfway: early enough that the player is not clipped by
 * the lane they visibly left, late enough that they cannot claim to have
 * already escaped the moment they pressed the key.
 *
 * Nothing collides yet — M6 owns obstacles — but the rule belongs with the
 * movement it describes rather than with the first thing that needs it.
 */
export function occupiedLane(state: RunState): LaneIndex {
  const transition = state.laneTransition

  if (transition === null) return state.lane

  const switchAtMs = TUNING.lane.transitionMs * TUNING.lane.occupancySwitchAtRatio

  return transition.elapsedMs < switchAtMs ? transition.from : transition.to
}

/**
 * How far through the current lane change the player is, `0`–`1`.
 *
 * For rendering only. The engine eases it; the domain reports it linearly,
 * because an easing curve is a presentation decision and putting one here would
 * make the rules depend on how the movement looks.
 */
export function laneProgress(state: RunState): number {
  const transition = state.laneTransition

  if (transition === null) return 1

  return Math.min(1, transition.elapsedMs / TUNING.lane.transitionMs)
}

/** Can a lane change begin right now? */
export function canStartLaneChange(state: RunState): boolean {
  if (state.laneTransition !== null) return false

  // Mid-air lane changes are permitted (CR-1, PROPOSED). Forbidding them turns
  // every jump into a commitment trap once M6 combines a jumpable obstacle with
  // a lane-only one.
  if (state.jumpElapsedMs !== null && !TUNING.lane.midAirChangeAllowed) return false

  return true
}

/** Begin a lane change, or return the state unchanged if it cannot happen. */
export function startLaneChange(state: RunState, direction: -1 | 1): RunState {
  if (!canStartLaneChange(state)) return state

  const target = laneStep(state.lane, direction)

  // Already at the edge. A no-op, not an error.
  if (target === null) return state

  const transition: LaneTransition = { from: state.lane, to: target, elapsedMs: 0 }

  return { ...state, laneTransition: transition }
}

/** Advance a lane change, settling it when the transition completes. */
export function advanceLaneTransition(state: RunState, deltaMs: number): RunState {
  const transition = state.laneTransition

  if (transition === null) return state

  const elapsedMs = transition.elapsedMs + deltaMs

  if (elapsedMs >= TUNING.lane.transitionMs) {
    return { ...state, lane: transition.to, laneTransition: null }
  }

  return { ...state, laneTransition: { ...transition, elapsedMs } }
}
