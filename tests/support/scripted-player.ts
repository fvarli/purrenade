import { TUNING, canJump, canStartLaneChange, isAirborne } from '~~/game/domain'
import type { InputEvent, LaneIndex, RunState } from '~~/game/domain'

/**
 * Scripted players, for tests that need a run to actually go somewhere.
 *
 * Several M7 facts cannot be observed by a player who presses nothing: the
 * meter's readiness window, a Loli Bonus, an overlap. A passive run dies in
 * about twenty seconds and collects a third of a token a second, so a test that
 * wants any of those either stages the state by hand — which proves the rules
 * and not the integration — or plays.
 *
 * Deliberately outside `game/`: these are measuring instruments, and nothing
 * shipped may depend on them. Keeping them here also keeps them clear of the
 * domain's no-literal gate, which would otherwise reject a lookahead constant
 * that is not a tunable and should not become one.
 */

/** Lanes a hazard will occupy within `aheadUnits`, split by class. */
function threats(state: RunState, aheadUnits: number): {
  blocking: Set<LaneIndex>
  jumpable: Set<LaneIndex>
} {
  const blocking = new Set<LaneIndex>()
  const jumpable = new Set<LaneIndex>()

  for (const obstacle of state.obstacles) {
    if (obstacle.distanceUnits + obstacle.lengthUnits < 0) continue
    if (obstacle.distanceUnits > aheadUnits) continue

    if (obstacle.kind === 'lane_blocking') blocking.add(obstacle.lane)
    else jumpable.add(obstacle.lane)
  }

  return { blocking, jumpable }
}

/** The lane of the nearest pending token still ahead, or null. */
function nearestTokenLane(state: RunState): LaneIndex | null {
  let best: { lane: LaneIndex, distance: number } | null = null

  for (const token of state.pawTokens) {
    if (token.distanceUnits < 0) continue

    const lane = Math.round(token.laneOffset)

    if (lane < 0 || lane >= TUNING.lane.count) continue
    if (best === null || token.distanceUnits < best.distance) {
      best = { lane: lane as LaneIndex, distance: token.distanceUnits }
    }
  }

  return best?.lane ?? null
}

/**
 * Four styles, bracketing what a run can yield.
 *
 * `avoidant` dodges hazards and steps *away* from tokens — the floor for a
 * player who is still playing. `passive` presses nothing at all. `healthy`
 * dodges and takes tokens one lane away, which is what an ordinary competent
 * run looks like. `aggressive` crosses the whole road for a token.
 */
export type Style = 'avoidant' | 'passive' | 'healthy' | 'aggressive'

/** The reaction window a scripted player uses. Not a rule — a test instrument. */
const LOOKAHEAD_UNITS = 2.2

export function intent(state: RunState, style: Style): InputEvent[] {
  if (style === 'passive') return []

  const lane = state.lane
  const { blocking, jumpable } = threats(state, LOOKAHEAD_UNITS)

  if (jumpable.has(lane) && !isAirborne(state) && canJump(state)) return [{ type: 'jump' }]

  const usable = (candidate: number): candidate is LaneIndex =>
    candidate >= 0 && candidate < TUNING.lane.count && !blocking.has(candidate as LaneIndex)

  if (blocking.has(lane) && canStartLaneChange(state)) {
    if (usable(lane - 1)) return [{ type: 'move_left' }]
    if (usable(lane + 1)) return [{ type: 'move_right' }]

    return []
  }

  if (!canStartLaneChange(state)) return []

  const target = nearestTokenLane(state)

  if (target === null || target === lane) return []
  if (Math.abs(target - lane) > (style === 'aggressive' ? TUNING.lane.count : 1)) return []

  // `avoidant` inverts the intent: it steps away from the token, not toward it.
  const direction = style === 'avoidant'
    ? (target < lane ? 1 : -1)
    : (target < lane ? -1 : 1)

  if (!usable(lane + direction)) return []

  return [{ type: direction < 0 ? 'move_left' : 'move_right' }]
}

