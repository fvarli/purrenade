import { createRngState, MAX_SEED } from './rng'
import { TUNING } from './tuning'
import { isLaneIndex } from './lanes'
import { firstHazardDistanceUnits } from './obstacles'
import type { RunState } from './types'

/**
 * Constructing a run.
 *
 * The approved initial state is: centre lane, three hearts, empty SLAYYY
 * charge, `runPaws` zero, `loliCyclePaws` loaded from the profile. Only the
 * first of those exists at M5 — hearts arrive with collisions at M6, and
 * everything paw- or SLAYYY-shaped arrives at M7 — so the rest are absent
 * rather than stubbed. A field that is present but meaningless is worse than a
 * field that is missing: the missing one fails to compile.
 */

export interface CreateRunOptions {
  /**
   * The run seed.
   *
   * Whether it comes from the server is RNG-1, still OPEN and dependent on
   * ADR-0006. Until that is decided the caller supplies it, which keeps both
   * answers available and keeps this function pure — generating one here would
   * mean reading a clock or a platform RNG, and neither belongs in the domain.
   */
  readonly seed: number
}

/**
 * A run at its first instant.
 *
 * Starts in `ready`: the player sees the lane and the character before anything
 * can happen. Input is accepted throughout — the readiness beat is a guarantee
 * about hazards, not a lock on the controls — so a player who already knows
 * what they are doing loses nothing to it.
 */
export function createRunState({ seed }: CreateRunOptions): RunState {
  /*
   * The seed is the run's identity, so a seed that cannot round-trip is not a
   * seed. Every stream derivation ends in `>>> 0`, which quietly maps `NaN`,
   * `Infinity`, `0.5` and `2 ** 32` all onto zero — so five different "seeds"
   * produced one identical run and nobody found out. `JSON.stringify` turns a
   * `NaN` seed into `null`, so the field that exists purely to make a run
   * replayable was the one input class it silently lost.
   */
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) {
    throw new RangeError(
      `createRunState: seed must be a whole number from 0 to ${MAX_SEED} (got ${String(seed)})`,
    )
  }

  const startLane = TUNING.lane.startIndex

  // The tunable is the tunable. This read used to be the `LANE_CENTER`
  // constant, so `lane.startIndex` was a registry-listed, APPROVED knob wired
  // to nothing: changing it moved the renderer's centre and left the rules
  // starting where they always had.
  if (!isLaneIndex(startLane)) {
    throw new RangeError(`createRunState: lane.startIndex ${startLane} is not a lane`)
  }

  return sealState({
    phase: 'ready',
    elapsedMs: 0,
    readyRemainingMs: TUNING.run.readyMs,
    lane: startLane,
    laneTransition: null,
    jumpElapsedMs: null,
    buffered: null,
    resumePhase: 'ready',
    rng: createRngState(seed),
    seed,

    hearts: TUNING.hearts.start,
    invulnRemainingMs: 0,
    obstacles: [],
    distanceUnits: 0,
    nextObstacleId: 0,
    spawn: {
      // The first pattern is scheduled so that nothing can reach the player
      // before the approved protected interval. Reachability, not spawn time:
      // an obstacle exists earlier so it can be seen approaching.
      nextAtUnits: firstHazardDistanceUnits(),
      recentPatternIds: [],
    },
    nearMissCount: 0,
  })
}

/**
 * Make a state actually immutable, not merely typed that way.
 *
 * `readonly` is erased at build time, and the domain hands states out to a
 * renderer, to `debugState()`, and eventually to a replay validator. Two of
 * those were able to corrupt a run: writing to a returned state's `lane` put a
 * value outside `0..2` into the very next step, and because every state in a
 * run shares one `rng` object by spread, a single write through any state
 * rewrote the generator for every snapshot ever taken of that run — including
 * the ones a replay would be checked against.
 *
 * Shallow freezing is not enough for the same reason: the nested objects are
 * the shared ones.
 */
export function sealState(state: RunState): RunState {
  // Obstacles are frozen where they are built, so this only has to seal the
  // array — but the array matters: without it a renderer holding a snapshot
  // could splice the world out from under the rules.
  Object.freeze(state.obstacles)
  Object.freeze(state.spawn.recentPatternIds)
  Object.freeze(state.spawn)

  Object.freeze(state.rng.pattern)
  Object.freeze(state.rng.collectible)
  Object.freeze(state.rng.cosmetic)
  Object.freeze(state.rng)

  if (state.laneTransition !== null) Object.freeze(state.laneTransition)

  if (state.buffered !== null) {
    Object.freeze(state.buffered.event)
    Object.freeze(state.buffered)
  }

  return Object.freeze(state)
}
