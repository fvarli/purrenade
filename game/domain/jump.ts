import { JUMP_ARC, TUNING } from './tuning'
import type { RunState } from './types'

/**
 * The jump: one arc, always the same one.
 *
 * Approved as deterministic and tunable — the same input from the same state
 * always produces the same arc — with an airborne target of ~650 ms. Three
 * constraints follow from that and are enforced here rather than by the engine:
 *
 * - **No double jump.** A jump while airborne is ignored, though it may still be
 *   buffered to fire on landing.
 * - **No variable height.** Hold duration changes nothing. A jump whose height
 *   depends on how long a key was held is a jump whose arc depends on frame
 *   timing, which is the opposite of deterministic.
 * - **No invulnerability.** Being airborne clears the obstacles that are defined
 *   as jumpable, and nothing else. M6 owns that; the rule is recorded here
 *   because it is a property of the jump.
 *
 * A jump does not move the player between lanes.
 */

/** Is the player off the ground? */
export function isAirborne(state: RunState): boolean {
  return state.jumpElapsedMs !== null
}

/** Can a jump begin right now? */
export function canJump(state: RunState): boolean {
  return state.jumpElapsedMs === null
}

/** Begin a jump, or return the state unchanged if one is already in progress. */
export function startJump(state: RunState): RunState {
  if (!canJump(state)) return state

  return { ...state, jumpElapsedMs: 0 }
}

/**
 * Height above the ground, in baseline pixels.
 *
 * The symmetric parabola `h(t) = v₀t − ½gt²`, with both constants derived from
 * the airborne duration and the apex height so the arc cannot drift from the
 * approved target. Clamped at zero: floating-point arithmetic at the very end
 * of the arc can produce a value a hair below ground, and a character rendered
 * one ten-thousandth of a pixel underground is a rendering artefact nobody
 * should have to debug.
 */
export function jumpHeightPx(state: RunState): number {
  const elapsedMs = state.jumpElapsedMs

  if (elapsedMs === null) return 0

  const t = elapsedMs / 1000
  const height = JUMP_ARC.initialVelocityPxPerS * t - 0.5 * JUMP_ARC.gravityPxPerS2 * t * t

  return Math.max(0, height)
}

/**
 * How far through the arc the player is, `0`–`1`.
 *
 * For rendering and for animation state selection. The domain reports the
 * fraction; the engine decides what to draw at it.
 */
export function jumpProgress(state: RunState): number {
  const elapsedMs = state.jumpElapsedMs

  if (elapsedMs === null) return 0

  return Math.min(1, elapsedMs / TUNING.jump.airborneMs)
}

/** Advance a jump, landing when the airborne duration is spent. */
export function advanceJump(state: RunState, deltaMs: number): RunState {
  const elapsedMs = state.jumpElapsedMs

  if (elapsedMs === null) return state

  const next = elapsedMs + deltaMs

  // Landing is exact: the arc is defined as ending at `airborneMs`, so the
  // player is grounded from that instant rather than at the next whole step.
  if (next >= TUNING.jump.airborneMs) {
    return { ...state, jumpElapsedMs: null }
  }

  return { ...state, jumpElapsedMs: next }
}
