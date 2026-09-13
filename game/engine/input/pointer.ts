import { GESTURE } from '../../bridge'
import type { InputEvent } from '../../bridge'

/**
 * Swipes to intent.
 *
 * A pure recogniser: it takes the two ends of a gesture and returns what the
 * player meant, or null. No DOM, no listeners — the caller supplies the
 * coordinates and the timestamps, which is what makes the thresholds testable
 * without a touchscreen.
 *
 * **There is no swipe-down.** The slide mechanic does not exist in v1, so a
 * downward swipe resolves to nothing rather than to a mystery action.
 */

export interface GesturePoint {
  readonly x: number
  readonly y: number
  readonly timeMs: number
}

/**
 * What a completed gesture meant.
 *
 * Three thresholds, all PROPOSED tuning:
 *
 * - **Distance.** Below `swipe.minDistancePx` it is a tap, not a swipe. Without
 *   a floor, the jitter of a finger resting on glass becomes lane changes.
 * - **Duration.** Above `swipe.maxDurationMs` it is a drag. A slow finger
 *   travelling across the screen is not a flick and should not be read as one.
 * - **Axis dominance.** The dominant axis must beat the other by
 *   `swipe.axisDominanceRatio`, so a diagonal resolves predictably instead of
 *   flipping between "left" and "up" on a pixel.
 */
export function gestureToInput(from: GesturePoint, to: GesturePoint): InputEvent | null {
  const durationMs = to.timeMs - from.timeMs

  if (durationMs < 0 || durationMs > GESTURE.maxDurationMs) return null

  const dx = to.x - from.x
  const dy = to.y - from.y
  const absX = Math.abs(dx)
  const absY = Math.abs(dy)

  const horizontal = absX >= absY * GESTURE.axisDominanceRatio
  const vertical = absY >= absX * GESTURE.axisDominanceRatio

  // Neither axis dominates: an ambiguous diagonal. Doing nothing is better than
  // guessing, because a wrong lane change costs a heart at M6.
  if (!horizontal && !vertical) return null

  if (horizontal) {
    if (absX < GESTURE.minDistancePx) return null

    return dx < 0 ? { type: 'move_left' } : { type: 'move_right' }
  }

  if (absY < GESTURE.minDistancePx) return null

  // Up only. Down is not a gesture in v1.
  return dy < 0 ? { type: 'jump' } : null
}

/**
 * A gesture in progress.
 *
 * Deliberately a value rather than a class instance: the scene holds one, and
 * a value is easier to reason about across a Phaser lifecycle that can tear
 * down mid-gesture.
 */
export interface PointerTracker {
  readonly start: GesturePoint | null
}

export const IDLE_POINTER: PointerTracker = Object.freeze({ start: null })

/** Begin tracking. A second pointer going down replaces the first. */
export function pointerDown(point: GesturePoint): PointerTracker {
  return { start: point }
}

/**
 * Finish tracking, returning what the gesture meant.
 *
 * Returns the reset tracker alongside the input so a caller cannot forget to
 * clear it — a tracker left holding a stale start point turns the next tap into
 * a swipe from wherever the last one began.
 */
export function pointerUp(
  tracker: PointerTracker,
  point: GesturePoint,
): { readonly tracker: PointerTracker, readonly input: InputEvent | null } {
  if (tracker.start === null) return { tracker: IDLE_POINTER, input: null }

  return { tracker: IDLE_POINTER, input: gestureToInput(tracker.start, point) }
}

/** Abandon a gesture — the pointer left the surface, or the scene is going away. */
export function pointerCancel(): PointerTracker {
  return IDLE_POINTER
}
