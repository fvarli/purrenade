import { isAirborne, jumpHeightPx } from './jump'
import { occupiedLane } from './lanes'
import { JUMP_ARC, TUNING } from './tuning'
import type { Obstacle, RunState } from './types'

/**
 * Who hit what, and who nearly did.
 *
 * The domain decides this, always. Phaser draws rectangles and knows nothing
 * about hearts: an overlap callback from a physics engine is a rendering
 * artefact, and a rendering artefact that could cost a heart would make the
 * outcome of a run depend on a frame rate.
 *
 * Collision is lane occupancy **plus** longitudinal overlap **plus** vertical
 * clearance — never rendered pixels.
 *
 * ### Interval policy
 *
 * Both extents are treated as **open** intervals: touching exactly at the
 * boundary is not an overlap. One policy, applied at every edge, so a value
 * that lands precisely on a boundary resolves the same way on every device
 * rather than depending on which side a floating-point rounding fell.
 */

/** The player's longitudinal extent, centred on the reference point at zero. */
function playerExtent(): { readonly from: number, readonly to: number } {
  const half = TUNING.collision.playerLengthUnits / 2

  return { from: -half, to: half }
}

/** Do the player and this obstacle overlap along the road? */
export function overlapsLongitudinally(obstacle: Obstacle): boolean {
  const player = playerExtent()

  return obstacle.distanceUnits < player.to
    && obstacle.distanceUnits + obstacle.lengthUnits > player.from
}

/**
 * Would this obstacle damage the player right now, ignoring invulnerability?
 *
 * `LANE_BLOCKING` is not cleared by being airborne — that is the approved rule
 * and the whole reason the jump verb needs something else to jump over.
 */
export function isDamaging(state: RunState, obstacle: Obstacle): boolean {
  if (!overlapsLongitudinally(obstacle)) return false
  if (occupiedLane(state) !== obstacle.lane) return false

  if (obstacle.kind === 'jumpable' && isAirborne(state)) {
    return !TUNING.obstacle.jumpable.clearableByJump
  }

  return true
}

/**
 * Has this obstacle passed the player, and so fixed its outcome?
 *
 * "Passed" is the trailing edge reaching `nearMiss.longitudinalEnvelopeUnits`
 * behind the reference point — the registry's "how close along the road counts
 * as passing". Evaluating a little after the crossing rather than exactly on it
 * gives the check a defined instant that a step can actually land on, and it is
 * the same instant for every obstacle, which is what keeps "at most one event"
 * structural.
 */
function hasPassed(obstacle: Obstacle): boolean {
  return obstacle.distanceUnits + obstacle.lengthUnits + TUNING.nearMiss.longitudinalEnvelopeUnits <= 0
}

/** How high the player is, as a fraction of the jump apex. Zero when grounded. */
function apexFraction(state: RunState): number {
  return jumpHeightPx(state) / TUNING.jump.apexHeightPx
}

/**
 * Was this a near miss?
 *
 * Evaluated once, at the instant the obstacle's longitudinal extent passes the
 * player's reference point, and only when nothing collided with it. A single
 * evaluation point is what makes "at most one event per obstacle" structural
 * rather than a debounce that could fire twice under an unlucky step size.
 *
 * Two ways to earn one, both intended: passing a lane blocker in an adjacent
 * lane close to the boundary, or clearing a jumpable obstacle with very little
 * headroom.
 */
function isNearMiss(state: RunState, obstacle: Obstacle): boolean {
  const lateral = Math.abs(lanePosition(state) - obstacle.lane)

  if (obstacle.kind === 'jumpable') {
    // Same lane, cleared by being airborne, and only just.
    if (occupiedLane(state) !== obstacle.lane) {
      return lateral <= TUNING.nearMiss.lateralEnvelopeUnits && lateral > 0
    }

    return isAirborne(state) && apexFraction(state) <= TUNING.nearMiss.verticalClearanceUnits
  }

  // A lane blocker: an adjacent lane, close to the boundary. Being in its lane
  // would have been a collision, so it cannot reach here.
  return lateral <= TUNING.nearMiss.lateralEnvelopeUnits && lateral > 0
}

/** Where the player is laterally, in lane units, mid-transition included. */
function lanePosition(state: RunState): number {
  const transition = state.laneTransition

  if (transition === null) return state.lane

  const progress = Math.min(1, transition.elapsedMs / TUNING.lane.transitionMs)

  return transition.from + (transition.to - transition.from) * progress
}

export interface CollisionOutcome {
  readonly state: RunState
  /** How many hearts were lost this step. At most one, whatever overlaps. */
  readonly heartsLost: number
  /** Near-miss events resolved this step. */
  readonly nearMisses: number
}

/**
 * Resolve every obstacle against the player for this step.
 *
 * At most **one heart per step**, however many obstacles overlap: a pattern
 * that places two blockers in one lane is a pattern that costs one heart, and
 * the invulnerability that follows covers the rest. An obstacle that has
 * already resolved can never resolve again, which is what stops a single cone
 * draining the run over the several steps it takes to pass through the player.
 */
export function resolveCollisions(state: RunState): CollisionOutcome {
  if (state.obstacles.length === 0) return { state, heartsLost: 0, nearMisses: 0 }

  const invulnerable = state.invulnRemainingMs > 0

  let heartsLost = 0
  let nearMisses = 0
  let changed = false

  const obstacles: Obstacle[] = []

  for (const obstacle of state.obstacles) {
    if (obstacle.outcome !== 'pending') {
      obstacles.push(obstacle)
      continue
    }

    if (isDamaging(state, obstacle)) {
      if (invulnerable || heartsLost > 0) {
        // Passed through: no damage, and no near miss either. The player did
        // not avoid it; they were protected from it.
        obstacles.push(Object.freeze({ ...obstacle, outcome: 'cleared' as const }))
      }
      else {
        heartsLost = TUNING.hearts.costPerCollision
        obstacles.push(Object.freeze({ ...obstacle, outcome: 'hit' as const }))
      }

      changed = true
      continue
    }

    if (hasPassed(obstacle)) {
      const near = isNearMiss(state, obstacle)

      if (near) nearMisses++

      obstacles.push(Object.freeze({ ...obstacle, outcome: near ? 'near_miss' as const : 'cleared' as const }))
      changed = true
      continue
    }

    obstacles.push(obstacle)
  }

  if (!changed) return { state, heartsLost: 0, nearMisses: 0 }

  return { state: { ...state, obstacles }, heartsLost, nearMisses }
}

/** Exported for the escape-path solver, which reasons about the same geometry. */
export { lanePosition, hasPassed, apexFraction, JUMP_ARC }
