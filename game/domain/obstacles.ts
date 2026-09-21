import { scrollUnitsPerS, minGapUnits, tierAt } from './difficulty'
import { poolForTier } from './patterns'
import type { Pattern } from './patterns'
import { nextIntInclusive } from './rng'
import { TUNING } from './tuning'
import type { Obstacle, RunState } from './types'

/**
 * The world: what is on the road, where it is, and what arrives next.
 *
 * Positions are road units measured from the player's reference point at zero.
 * An obstacle's `distanceUnits` is its leading edge and decreases as the world
 * scrolls; nothing here knows about pixels or frames.
 *
 * Scrolling and spawning are both driven by **simulated** time, which is what
 * makes a backgrounded tab harmless: the fixed-step loop discards time it
 * cannot honestly simulate, and because generation follows the same clock, a
 * stalled tab cannot come back to a burst of hazards it never scrolled past.
 */

const MS_PER_SECOND = 1000

/** How far the world moves in one step, at the current difficulty. */
export function scrollDeltaUnits(elapsedMs: number, deltaMs: number): number {
  return scrollUnitsPerS(elapsedMs) * (deltaMs / MS_PER_SECOND)
}

/**
 * Move every obstacle toward the player and drop the ones long past.
 *
 * Despawn is deliberately *behind* the reference point by a margin, so an
 * obstacle is never removed before it has had the chance to resolve into a hit,
 * a near miss or a clean pass.
 */
export function advanceObstacles(state: RunState, deltaMs: number): RunState {
  if (deltaMs === 0) return state

  const moved = scrollDeltaUnits(state.elapsedMs, deltaMs)

  if (moved === 0 && state.obstacles.length === 0) return state

  const obstacles: Obstacle[] = []

  for (const obstacle of state.obstacles) {
    const distanceUnits = obstacle.distanceUnits - moved

    // Keep it until its trailing edge is a margin behind the player.
    if (distanceUnits + obstacle.lengthUnits < -TUNING.world.despawnBehindUnits) continue

    obstacles.push(Object.freeze({ ...obstacle, distanceUnits }))
  }

  return {
    ...state,
    obstacles,
    distanceUnits: state.distanceUnits + moved,
  }
}

/**
 * The earliest world distance at which a hazard may be able to reach the player.
 *
 * The approved guarantee is about **reachability**, not about when an object is
 * created: obstacles are built a lookahead ahead so the renderer can show them
 * approaching, and what the player is promised is that none of them can hurt
 * them before `run.firstHazardMinMs` of interactive time.
 *
 * Expressed as a distance because that is what the generator schedules against.
 */
export function firstHazardDistanceUnits(): number {
  const settleSeconds = TUNING.run.firstHazardMinMs / MS_PER_SECOND

  /*
   * The distance the world covers during the protected interval, at the base
   * speed the run starts at. The curve only speeds up from here, so the opening
   * speed is the conservative choice.
   *
   * Minus the lookahead, because an obstacle is created that far ahead and then
   * has to travel it. Without the subtraction the two delays stacked and the
   * first hazard arrived at about 7.2 s against a 2.5 s floor — the guarantee
   * was honoured almost three times over, and the opening was that much emptier
   * than anyone chose. Clamped at zero: the lookahead alone already exceeds the
   * floor, so the protection is structural rather than scheduled.
   */
  const reachDistance = TUNING.world.baseScrollUnitsPerS * settleSeconds

  return Math.max(0, reachDistance - TUNING.world.spawnLookaheadUnits)
}

/** Weighted, deterministic, integer-only selection from a tier's pool. */
export function selectPattern(
  pool: readonly Pattern[],
  stream: RunState['rng']['pattern'],
): { pattern: Pattern | null, stream: RunState['rng']['pattern'] } {
  const total = pool.reduce((sum, pattern) => sum + pattern.weight, 0)

  if (pool.length === 0 || total <= 0) return { pattern: null, stream }

  // Integer weights and an integer draw: no floating comparison decides which
  // pattern a seed produces, so the sequence is reproducible exactly.
  const draw = nextIntInclusive(stream, 1, total)

  let cursor = draw.value

  for (const pattern of pool) {
    cursor -= pattern.weight

    if (cursor <= 0) return { pattern, stream: draw.state }
  }

  return { pattern: pool[pool.length - 1]!, stream: draw.state }
}

/** Patterns a tier may draw right now, minus the ones on cooldown. */
export function eligiblePatterns(state: RunState): readonly Pattern[] {
  const pool = poolForTier(tierAt(state.elapsedMs))

  /*
   * The cooldown is capped so it can never leave a single candidate.
   *
   * Tier 1 has four patterns and the cooldown is three, which left exactly one
   * eligible from the fourth spawn onward: the generator locked into a fixed
   * rotation, the weights stopped mattering, and every seed produced the same
   * opening — the RNG draw was still consumed, so it looked random while being
   * completely determined. Leaving at least two candidates keeps the seed
   * meaningful in the tier where every run begins.
   */
  const maxCooldown = Math.max(0, pool.length - MIN_CANDIDATES)
  const cooling = new Set(state.spawn.recentPatternIds.slice(0, maxCooldown))
  const fresh = pool.filter(pattern => !cooling.has(pattern.id))

  // Never starve. A road with no obstacles is a worse failure than a repeat.
  return fresh.length > 0 ? fresh : pool
}

/**
 * Emit the next pattern if the world has scrolled far enough to owe one.
 *
 * A `while` rather than an `if`: one catch-up step can cross more than one
 * spawn threshold, and skipping the extra would make the road quietly emptier
 * after a stall than before it.
 */
export function advanceSpawning(state: RunState): RunState {
  if (state.phase !== 'running') return state

  /*
   * The tutorial authors its own road — `tutorial.md` §3.1: the scene is
   * authored, not generated, so it cannot inherit a hazard from the pattern
   * pool. The cursor and the `pattern` stream are both left where they were,
   * which is what makes "a tutorial draws no randomness" provable.
   */
  if (state.tutorial !== null) return state

  let next = state
  let guard = 0

  while (next.distanceUnits >= next.spawn.nextAtUnits && guard < MAX_PATTERNS_PER_STEP) {
    next = emitPattern(next)
    guard++
  }

  return next
}

/**
 * A catch-up frame is bounded, so this only ever guards a configuration bug.
 *
 * Tied to the loop's own catch-up bound rather than repeated as a number: they
 * are the same fact — how much a single step is allowed to owe — and two copies
 * of one fact drift.
 */
const MAX_PATTERNS_PER_STEP = TUNING.sim.maxCatchUpSteps

/** The fewest patterns the cooldown may leave eligible, so a seed still matters. */
const MIN_CANDIDATES = 2

function emitPattern(state: RunState): RunState {
  const tier = tierAt(state.elapsedMs)
  const chosen = selectPattern(eligiblePatterns(state), state.rng.pattern)

  if (chosen.pattern === null) {
    // A misconfigured pool must not spin forever. Push the cursor and move on.
    return {
      ...state,
      spawn: { ...state.spawn, nextAtUnits: state.spawn.nextAtUnits + minGapUnits(tier) },
    }
  }

  const pattern = chosen.pattern
  /*
   * The overshoot is subtracted, not added.
   *
   * `distanceUnits - nextAtUnits` is how far past the scheduled point the world
   * already travelled before this step ran, so the pattern must be placed that
   * much *closer* to land where the schedule intended. Adding it put every
   * pattern at twice the overshoot beyond its anchor, making the real gap
   * depend on where a step boundary happened to fall.
   */
  const overshoot = state.distanceUnits - state.spawn.nextAtUnits
  const origin = TUNING.world.spawnLookaheadUnits - overshoot

  const spawned: Obstacle[] = []

  let nextObstacleId = state.nextObstacleId

  for (const entry of pattern.entries) {
    spawned.push(Object.freeze({
      id: nextObstacleId,
      kind: entry.kind,
      lane: entry.lane,
      distanceUnits: origin + entry.offsetUnits,
      lengthUnits: TUNING.obstacle.defaultLengthUnits,
      outcome: 'pending' as const,
    }))

    nextObstacleId++
  }

  const recent = [pattern.id, ...state.spawn.recentPatternIds].slice(0, TUNING.generator.repeatCooldown)

  return {
    ...state,
    obstacles: [...state.obstacles, ...spawned],
    nextObstacleId,
    rng: { ...state.rng, pattern: chosen.stream },
    spawn: {
      nextAtUnits: state.spawn.nextAtUnits + pattern.lengthUnits + minGapUnits(tier),
      recentPatternIds: recent,
    },
  }
}
