import { jumpHeightPx, jumpProgress, laneProgress, occupiedLane } from '../domain'
import type { LaneIndex, RunState } from '../domain'
import type { RenderSnapshot } from './types'

/**
 * Turning run state into something safe to render.
 *
 * The engine never receives `RunState`. It receives this: a frozen value in
 * lane and longitudinal units, computed fresh each frame. Handing over the
 * state object would let the renderer read fields the rules own — and, sooner
 * or later, write one.
 */

/**
 * The player's lateral position in lane units.
 *
 * Whole numbers when settled, fractional mid-transition. Reported **linearly**:
 * the engine applies the easing curve, because easing is how the movement looks
 * and the rules must not depend on it. Two renderers with different curves must
 * agree on when the player is in which lane, and they do, because occupancy is
 * a separate field decided by the domain.
 */
function lanePosition(state: RunState): number {
  const transition = state.laneTransition

  if (transition === null) return state.lane

  const progress = laneProgress(state)

  return transition.from + (transition.to - transition.from) * progress
}

/** Derive the render snapshot for the current state. */
export function toRenderSnapshot(state: RunState): RenderSnapshot {
  return Object.freeze({
    phase: state.phase,
    lanePosition: lanePosition(state),
    occupiedLane: occupiedLane(state) as LaneIndex,
    heightPx: jumpHeightPx(state),
    jumpProgress: jumpProgress(state),
    laneProgress: laneProgress(state),
    readyRemainingMs: state.readyRemainingMs,
    elapsedMs: state.elapsedMs,
  })
}

/**
 * Blend two snapshots for rendering between simulation steps.
 *
 * The simulation runs at a fixed 120 Hz and the display does not, so a frame
 * usually falls between two steps. Interpolating there is what keeps movement
 * smooth without letting frame timing feed back into the rules — the two
 * snapshots are already decided, and this only decides what to draw between
 * them.
 *
 * Discrete fields take the later value rather than being averaged: there is no
 * halfway between two lanes as far as collision is concerned, and a phase that
 * blended would be a phase that lied.
 */
export function interpolateSnapshot(
  previous: RenderSnapshot,
  current: RenderSnapshot,
  alpha: number,
): RenderSnapshot {
  // `NaN` fails both comparisons, so the clamp used to pass it straight through
  // and every continuous field in the returned snapshot came out `NaN`.
  const t = Number.isFinite(alpha) ? (alpha <= 0 ? 0 : alpha >= 1 ? 1 : alpha) : 0

  return Object.freeze({
    phase: current.phase,
    lanePosition: previous.lanePosition + (current.lanePosition - previous.lanePosition) * t,
    occupiedLane: current.occupiedLane,
    heightPx: previous.heightPx + (current.heightPx - previous.heightPx) * t,
    jumpProgress: previous.jumpProgress + (current.jumpProgress - previous.jumpProgress) * t,
    laneProgress: previous.laneProgress + (current.laneProgress - previous.laneProgress) * t,
    readyRemainingMs: current.readyRemainingMs,
    elapsedMs: current.elapsedMs,
  })
}
