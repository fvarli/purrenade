import { lanePosition } from './collision'
import { scrollDeltaUnits } from './obstacles'
import { nextIntInclusive } from './rng'
import { TUNING } from './tuning'
import type { LaneIndex, PawToken, RunState } from './types'

/**
 * Paw Tokens: the one collectible in v1.
 *
 * Deliberately a sibling of `obstacles.ts` rather than an extension of it. The
 * two share geometry — road units, leading edge, the same scroll — but nothing
 * else, and the one thing that must never be shared is the generator: every
 * draw here comes from the **collectible** stream, so retuning tokens cannot
 * move a single obstacle. `world.spec.ts` already proves that direction by
 * perturbing the collectible stream and asserting the obstacle sequence is
 * unchanged; this module is what makes that test meaningful rather than vacuous.
 *
 * A token is not a hazard. It cannot make a survivable pattern unsurvivable,
 * and the escape-path solver does not know it exists — a player may have to
 * ignore a token to live, which is the intended tension rather than a defect.
 */

/** Move every token toward the player and drop the ones long past. */
export function advancePawTokens(state: RunState, deltaMs: number): RunState {
  if (deltaMs === 0 || state.pawTokens.length === 0) return state

  const moved = scrollDeltaUnits(state.elapsedMs, deltaMs)
  const pawTokens: PawToken[] = []

  for (const token of state.pawTokens) {
    const distanceUnits = token.distanceUnits - moved

    // The same margin obstacles use, so a token cannot vanish from under a
    // collection that was about to resolve.
    if (distanceUnits + TUNING.paw.lengthUnits < -TUNING.world.despawnBehindUnits) continue

    pawTokens.push(Object.freeze({ ...token, distanceUnits }))
  }

  return { ...state, pawTokens }
}

/**
 * Emit the next group of tokens if the world has scrolled far enough.
 *
 * A `while`, like pattern spawning, because one catch-up step can cross more
 * than one threshold. The same bound applies for the same reason.
 */
export function advancePawSpawning(state: RunState): RunState {
  if (state.phase !== 'running') return state

  /*
   * The tutorial's road is authored, so the generator is off and its stream is
   * never consulted — which is what keeps `rng.collectible` untouched across a
   * whole tutorial, and why a tutorial cannot inherit a token it did not place.
   */
  if (state.tutorial !== null) return state

  let next = state
  let guard = 0

  while (next.distanceUnits >= next.nextPawAtUnits && guard < MAX_GROUPS_PER_STEP) {
    next = emitPawGroup(next)
    guard++
  }

  return next
}

const MAX_GROUPS_PER_STEP = TUNING.sim.maxCatchUpSteps

/**
 * Which lanes are clear of obstacles around a distance.
 *
 * Reading the obstacle list is not the same as drawing from its stream: this
 * consumes no randomness and changes no generator state, so token placement
 * stays invisible to pattern selection. The point is only that a token should
 * not sit inside a lane blocker, where it would read as bait for a collision
 * the player cannot win.
 */
function clearLanes(state: RunState, fromUnits: number, toUnits: number): Set<LaneIndex> {
  /*
   * This check is necessarily incomplete, and `dropBlockedTokens` is why.
   *
   * It can only see the road as it stands now. Measured over twelve seeds, the
   * overwhelming majority of token/obstacle overlaps — 215 of 231 — come from
   * an obstacle emitted *after* the group, which nothing here can anticipate.
   * Widening it by the player's half-extent was tried and removed: it changed
   * not one placement across 120 000 steps, because the cases it would have
   * caught are not the cases that occur. Two partial guards would only make the
   * problem look handled in two places when it is handled in one.
   */
  /*
   * Derived from `lane.count`, not written out.
   *
   * The rotation in `emitPawGroup` already reads `lane.count`; a literal list
   * here would mean a three-lane assumption living in one of the two and not
   * the other, which is the shape a fourth lane would break silently.
   */
  const clear = new Set<LaneIndex>(
    Array.from({ length: TUNING.lane.count }, (_, index) => index as LaneIndex),
  )

  for (const obstacle of state.obstacles) {
    const overlaps = obstacle.distanceUnits < toUnits
      && obstacle.distanceUnits + obstacle.lengthUnits > fromUnits

    if (overlaps) clear.delete(obstacle.lane)
  }

  return clear
}

/**
 * Does this token share road with a lane blocker in its lane?
 *
 * Only `LANE_BLOCKING` counts. A `JUMPABLE` obstacle over a token is a good
 * moment rather than a defect: collection does not consult `isAirborne`, so the
 * player clears the barrier and takes the token in the same jump.
 */
function sitsInsideABlocker(state: RunState, token: PawToken): boolean {
  const lane = Math.round(token.laneOffset)

  return state.obstacles.some(obstacle => obstacle.kind === 'lane_blocking'
    && obstacle.lane === lane
    && obstacle.distanceUnits < token.distanceUnits + TUNING.paw.lengthUnits
    && obstacle.distanceUnits + obstacle.lengthUnits > token.distanceUnits)
}

/**
 * Remove tokens a hazard has landed on.
 *
 * `clearLanes` checks the road as it stands when a group is emitted, and that
 * is all it can do — patterns and token groups run on **independent schedules
 * into the same band** (both originate near `spawnLookaheadUnits`, tokens every
 * `groupGapUnits`, patterns every `lengthUnits + minGapUnits`), and the obstacle
 * generator has never read the token list. So an obstacle emitted a few steps
 * later lands on a token that already exists, and nothing noticed.
 *
 * Measured over twelve seeds and forty thousand steps each: 230 same-lane
 * overlaps, 156 of them lane-blocking, and **58 in which taking the token was
 * mathematically impossible without losing a heart** — the obstacle's damage
 * window strictly contained the token's collection window. The first lands 15
 * seconds into seed 1, in Tier 1.
 *
 * This module claimed a player "may have to ignore a token to live, which is
 * the intended tension". That presupposes a choice. Those 58 had none, and the
 * other 98 offered a window shorter than a lane change takes.
 *
 * Reconciling afterwards rather than teaching the obstacle generator about
 * tokens: the two RNG streams must stay independent, and a generator that read
 * the token list would couple them through the playfield. This consumes no
 * randomness and reads only what is already on the road.
 */
export function dropBlockedTokens(state: RunState): RunState {
  if (state.pawTokens.length === 0 || state.obstacles.length === 0) return state

  const pawTokens = state.pawTokens.filter(token => !sitsInsideABlocker(state, token))

  return pawTokens.length === state.pawTokens.length ? state : { ...state, pawTokens }
}

function emitPawGroup(state: RunState): RunState {
  /*
   * The overshoot is subtracted, exactly as pattern placement does it, so a
   * group lands where the schedule intended rather than at twice however far
   * past the threshold this step happened to start.
   */
  const overshoot = state.distanceUnits - state.nextPawAtUnits
  const origin = TUNING.world.spawnLookaheadUnits - overshoot

  const countDraw = nextIntInclusive(state.rng.collectible, 1, TUNING.paw.perPatternMax)
  const count = countDraw.value

  const span = TUNING.paw.spacingUnits * (count - 1) + TUNING.paw.lengthUnits
  const clear = clearLanes(state, origin, origin + span)

  const laneDraw = nextIntInclusive(countDraw.state, 0, TUNING.lane.count - 1)

  /*
   * Rotate to a clear lane rather than redrawing.
   *
   * A redraw loop would consume a variable number of values from the stream,
   * which makes the sequence depend on the obstacle layout — the coupling this
   * module exists to avoid. Rotating consumes exactly two draws per group,
   * always, whatever the road looks like.
   */
  let lane = laneDraw.value as LaneIndex

  for (let i = 0; i < TUNING.lane.count; i++) {
    const candidate = ((laneDraw.value + i) % TUNING.lane.count) as LaneIndex

    if (clear.has(candidate)) {
      lane = candidate
      break
    }
  }

  const spawned: PawToken[] = []

  let nextPawTokenId = state.nextPawTokenId

  for (let i = 0; i < count; i++) {
    spawned.push(Object.freeze({
      id: nextPawTokenId,
      lane,
      laneOffset: lane,
      distanceUnits: origin + TUNING.paw.spacingUnits * i,
      outcome: 'pending' as const,
    }))

    nextPawTokenId++
  }

  return {
    ...state,
    pawTokens: [...state.pawTokens, ...spawned],
    nextPawTokenId,
    nextPawAtUnits: state.nextPawAtUnits + TUNING.paw.groupGapUnits,
    rng: { ...state.rng, collectible: laneDraw.state },
  }
}

/** Does the player's footprint overlap this token's, along the road? */
function overlapsLongitudinally(token: PawToken): boolean {
  const half = TUNING.collision.playerLengthUnits / 2

  return token.distanceUnits < half
    && token.distanceUnits + TUNING.paw.lengthUnits > -half
}

export interface PawCollection {
  readonly state: RunState
  /** How many tokens were taken this step. Unbounded: two may resolve at once. */
  readonly collected: number
  /**
   * Which tokens, by id.
   *
   * The count is what scoring needs; the identity is what the tutorial needs.
   * Its paw lesson asks "was *my* token collected", and answering that from the
   * count would only work while nothing else can award one — true today, since
   * the generator is off in tutorial mode, and exactly the kind of accidental
   * coupling that survives until the day it does not.
   */
  readonly collectedIds: readonly number[]
}

/** Shared empty result, so the common "took nothing" step allocates nothing. */
export const NOTHING_COLLECTED: readonly number[] = Object.freeze([])

/**
 * Collect every token the player is on top of.
 *
 * Deliberately **not** part of `resolveCollisions`. Collection is not damage:
 * it is not gated by invulnerability, it is not capped at one per step, and it
 * must keep working while SLAYYY is protecting the player. Folding it into the
 * damage path would have coupled all three of those to rules that exist for a
 * different purpose.
 *
 * Order is the token list's own order, which is spawn order, which is
 * deterministic — so two tokens taken on one step are always taken in the same
 * sequence for the same seed.
 */
export function resolvePawTokens(state: RunState): PawCollection {
  if (state.pawTokens.length === 0) {
    return { state, collected: 0, collectedIds: NOTHING_COLLECTED }
  }

  const position = lanePosition(state)
  const pawTokens: PawToken[] = []
  const collectedIds: number[] = []

  let collected = 0
  let changed = false

  for (const token of state.pawTokens) {
    if (token.outcome !== 'pending') {
      pawTokens.push(token)
      continue
    }

    const lateral = Math.abs(position - token.laneOffset)
    const takes = overlapsLongitudinally(token) && lateral <= TUNING.paw.collectLateralUnits

    if (takes) {
      collected++
      collectedIds.push(token.id)
      changed = true
      pawTokens.push(Object.freeze({ ...token, outcome: 'collected' as const }))
      continue
    }

    pawTokens.push(token)
  }

  if (!changed) return { state, collected: 0, collectedIds: NOTHING_COLLECTED }

  /*
   * A collected token leaves the world immediately.
   *
   * Keeping it around with an outcome, the way an obstacle is kept so its near
   * miss can resolve, would mean the renderer had to know not to draw it — and
   * a token that is still in the list is a token a later step can look at
   * again. Removing it makes "exactly once" structural.
   */
  return {
    state: { ...state, pawTokens: pawTokens.filter(token => token.outcome !== 'collected') },
    collected,
    collectedIds: Object.freeze(collectedIds),
  }
}
