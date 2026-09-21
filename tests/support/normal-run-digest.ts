import { STEP_MS, TUNING, canJump, canStartLaneChange, createRunState, isAirborne, step } from '~~/game/domain'
import type { InputEvent, LaneIndex, RunState } from '~~/game/domain'

/**
 * The instrument behind the normal-run golden.
 *
 * M8 adds a tutorial mode to the reducer. The mode is a nullable field and
 * every branch it gates is guarded on `tutorial !== null`, so a normal run is
 * supposed to take exactly the code path it took before — but "supposed to" is
 * not a property, and the failure it guards against is silent: a lane
 * transition that settles one step later, an RNG stream drawn once more, a
 * spawn cursor nudged by a refactor. None of those break a test that asserts a
 * rule; every one of them changes the run a seed produces.
 *
 * So `normal-run-golden.json` was generated **before** the tutorial existed and
 * is never regenerated to make a test pass. It holds one hash per
 * (seed, style) over every observable field of every step — the RNG streams
 * included, which is what makes "consumes the same randomness" provable rather
 * than argued.
 *
 * **Nothing here may be retuned.** The driver below is deliberately a private
 * copy rather than an import of `scripted-player.ts`: that one is a shared
 * instrument other tests are free to adjust, and an adjustment to it would
 * silently invalidate every hash in the fixture. A golden owns its driver.
 */

/** Simulated minutes per case. Long enough to cross tiers and spawn repeatedly. */
const RUN_STEPS = Math.round((2 * 60 * 1000) / STEP_MS)

const SEEDS = [1, 7, 42, 1337, 90210, 524287, 2147483647, 4294967295] as const

const STYLES = ['avoidant', 'passive', 'healthy', 'aggressive'] as const

export type Style = (typeof STYLES)[number]

export interface GoldenCase {
  readonly seed: number
  readonly style: Style
}

export const GOLDEN_CASES: readonly GoldenCase[] = SEEDS.flatMap(
  seed => STYLES.map(style => ({ seed, style })),
)

export function caseKey({ seed, style }: GoldenCase): string {
  return `${seed}:${style}`
}

const LOOKAHEAD_UNITS = 2.2

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

function intent(state: RunState, style: Style): InputEvent[] {
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

  const direction = style === 'avoidant'
    ? (target < lane ? 1 : -1)
    : (target < lane ? -1 : 1)

  if (!usable(lane + direction)) return []

  return [{ type: direction < 0 ? 'move_left' : 'move_right' }]
}

/**
 * Every observable field, as text.
 *
 * `tutorial` is deliberately absent. The fixture predates the field, and a
 * normal run must hash the same with it present and null as it did when it did
 * not exist — which is exactly the invariant under test. Including it would
 * make the golden agree with itself for the wrong reason.
 */
function observable(state: RunState): string {
  return JSON.stringify([
    state.phase,
    state.elapsedMs,
    state.readyRemainingMs,
    state.lane,
    state.laneTransition,
    state.jumpElapsedMs,
    state.buffered,
    state.resumePhase,
    state.rng,
    state.hearts,
    state.invulnRemainingMs,
    state.obstacles,
    state.distanceUnits,
    state.nextObstacleId,
    state.spawn,
    state.nearMissCount,
    state.score,
    state.pawTokens,
    state.nextPawTokenId,
    state.nextPawAtUnits,
    state.runPaws,
    state.loliCyclePaws,
    state.loli,
    state.slayyy,
    state.loliActivations,
    state.slayyyActivations,
  ])
}

/** FNV-1a over the whole run. A small fixture with total sensitivity. */
export function digestCase({ seed, style }: GoldenCase): string {
  let hash = 0x811C9DC5
  let state = createRunState({ seed })

  for (let i = 0; i < RUN_STEPS; i++) {
    state = step(state, intent(state, style), STEP_MS)

    const text = observable(state)

    for (let c = 0; c < text.length; c++) {
      hash ^= text.charCodeAt(c)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
  }

  return hash.toString(16).padStart(8, '0')
}
