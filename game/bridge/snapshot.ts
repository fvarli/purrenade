import {
  chargeFraction,
  isProtected,
  jumpHeightPx,
  jumpProgress,
  laneProgress,
  occupiedLane,
  protectionSources,
  scoreComponents,
  scoreTotal,
  TUNING,
} from '../domain'
import type { LaneIndex, RunState } from '../domain'
import type { RenderObstacle, RenderPawToken, RenderSnapshot } from './types'

/** A fraction as a percentage. Presentation arithmetic, not a tunable. */
const PERCENT = 100

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

/**
 * How far through its current phase the companion is, `0`–`1`.
 *
 * Presentation only — the entrance and exit are animations, and the renderer
 * needs a fraction rather than a countdown to drive them. `inactive` has no
 * duration, so it reports `1`: finished, not about to start.
 */
function loliPhaseProgress(state: RunState): number {
  const { phase, phaseRemainingMs } = state.loli

  const total = phase === 'entering'
    ? TUNING.loli.enteringMs
    : phase === 'active'
      ? TUNING.loli.durationMs
      : phase === 'exiting'
        ? TUNING.loli.exitingMs
        : 0

  if (total <= 0) return 1

  return Math.min(1, Math.max(0, 1 - phaseRemainingMs / total))
}

/** Derive the render snapshot for the current state. */
export function toRenderSnapshot(state: RunState): RenderSnapshot {
  return Object.freeze({
    obstacles: Object.freeze(state.obstacles.map(obstacle => Object.freeze({
      id: obstacle.id,
      kind: obstacle.kind,
      lane: obstacle.lane,
      distanceUnits: obstacle.distanceUnits,
      lengthUnits: obstacle.lengthUnits,
    }))),
    hearts: state.hearts,
    invulnerable: isProtected(state),
    protection: Object.freeze(protectionSources(state)),
    score: Object.freeze({ total: scoreTotal(state), ...scoreComponents(state) }),
    pawTokens: Object.freeze(state.pawTokens.map(token => Object.freeze({
      id: token.id,
      laneOffset: token.laneOffset,
      distanceUnits: token.distanceUnits,
    }))),
    runPaws: state.runPaws,
    loliCyclePaws: state.loliCyclePaws,
    loli: Object.freeze({
      phase: state.loli.phase,
      phaseProgress: loliPhaseProgress(state),
      queuedLoliBonuses: state.loli.queuedLoliBonuses,
    }),
    slayyy: Object.freeze({
      phase: state.slayyy.phase,
      charge: chargeFraction(state.slayyy),
      // Floored, not rounded: a meter that reads 100% while the control is
      // still disabled is a bug report. Only a genuinely full meter says 100.
      percent: Math.floor(chargeFraction(state.slayyy) * PERCENT),
      activeRemainingMs: state.slayyy.activeRemainingMs,
    }),
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
    obstacles: interpolateObstacles(previous.obstacles, current.obstacles, t),
    hearts: current.hearts,
    invulnerable: current.invulnerable,
    phase: current.phase,
    lanePosition: previous.lanePosition + (current.lanePosition - previous.lanePosition) * t,
    occupiedLane: current.occupiedLane,
    heightPx: previous.heightPx + (current.heightPx - previous.heightPx) * t,
    jumpProgress: previous.jumpProgress + (current.jumpProgress - previous.jumpProgress) * t,
    laneProgress: previous.laneProgress + (current.laneProgress - previous.laneProgress) * t,
    readyRemainingMs: current.readyRemainingMs,
    elapsedMs: current.elapsedMs,

    /*
     * M7. Discrete facts take the later value; only positions are blended.
     *
     * Score, paw counts and phases are not continuous quantities — a score
     * interpolated halfway between two integers is a number that never
     * existed, and a half-entered companion is not a state the domain has. The
     * charge fraction is continuous and *could* be blended, but it drives a
     * meter that changes by a fraction of a percent per step, so taking the
     * current value costs nothing visible and keeps the rule simple: if the
     * domain owns it as a fact, the later fact wins.
     */
    protection: current.protection,
    score: current.score,
    pawTokens: interpolatePawTokens(previous.pawTokens, current.pawTokens, t),
    runPaws: current.runPaws,
    loliCyclePaws: current.loliCyclePaws,
    loli: current.loli,
    slayyy: current.slayyy,
  })
}

/**
 * Blend token positions by id, exactly as obstacles are blended.
 *
 * Both axes here, unlike an obstacle: the magnet moves a token laterally as
 * well as along the road, and a token that jumps between lane offsets once per
 * simulation step would stutter visibly at 60 fps. A token with no counterpart
 * in the previous frame is new and is drawn where it is.
 */
function interpolatePawTokens(
  previous: readonly RenderPawToken[],
  current: readonly RenderPawToken[],
  t: number,
): readonly RenderPawToken[] {
  if (previous.length === 0) return current

  const before = new Map(previous.map(token => [token.id, token]))

  return Object.freeze(current.map((token) => {
    const from = before.get(token.id)

    if (from === undefined) return token

    return Object.freeze({
      id: token.id,
      laneOffset: from.laneOffset + (token.laneOffset - from.laneOffset) * t,
      distanceUnits: from.distanceUnits + (token.distanceUnits - from.distanceUnits) * t,
    })
  }))
}

/**
 * Blend the world between two simulation steps, matched by id.
 *
 * By id and not by index, which is the whole subtlety: obstacles spawn and
 * despawn between steps, so pairing position 0 with position 0 would smoothly
 * interpolate one obstacle's distance toward a completely different obstacle's
 * — a cone visibly sliding across the road as the one in front of it is culled.
 *
 * An obstacle that exists only in the newer snapshot appears at its own
 * position rather than blending in from nowhere; it has just spawned, far
 * beyond the visible road, so there is nothing to see either way.
 */
function interpolateObstacles(
  previous: readonly RenderObstacle[],
  current: readonly RenderObstacle[],
  t: number,
): readonly RenderObstacle[] {
  if (previous.length === 0) return current

  const before = new Map(previous.map(obstacle => [obstacle.id, obstacle]))

  return Object.freeze(current.map((obstacle) => {
    const from = before.get(obstacle.id)

    if (from === undefined) return obstacle

    return Object.freeze({
      ...obstacle,
      distanceUnits: from.distanceUnits + (obstacle.distanceUnits - from.distanceUnits) * t,
    })
  }))
}
