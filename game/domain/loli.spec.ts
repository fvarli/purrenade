import { describe, expect, it } from 'vitest'
import { applyPawsToCycle } from './loli'
import { createRunState } from './state'
import { step } from './step'
import { STEP_MS, TUNING } from './tuning'
import type { LoliPhase, PawToken, RunState } from './types'

/**
 * The Loli Bonus: earned, queued, activated — three different things.
 *
 * Most of this file defends the distinction between them. A threshold crossed
 * is not a bonus started, and a bonus queued is not a bonus started either.
 * Only an actual start counts toward `loliActivations`, which is the number a
 * later milestone will submit as an authoritative run fact — so getting it
 * wrong here would corrupt progression the player can see.
 */

const THRESHOLD = TUNING.paw.loliThreshold

function runningState(seed = 1): RunState {
  let state = createRunState({ seed })

  while (state.phase !== 'running') state = step(state, [], STEP_MS)

  return state
}

function advance(state: RunState, ms: number): RunState {
  let next = state
  let elapsed = 0

  while (elapsed < ms) {
    next = step(next, [], STEP_MS)
    elapsed += STEP_MS
  }

  return next
}

function token(id: number, laneOffset = 1, distanceUnits = 0): PawToken {
  return Object.freeze({ id, lane: 1, laneOffset, distanceUnits, outcome: 'pending' as const })
}

/** A run one paw short of the threshold, with that paw sitting on the player. */
function aboutToCross(extra = 1, cycle = THRESHOLD - 1): RunState {
  const state = runningState()

  return {
    ...state,
    loliCyclePaws: cycle,
    pawTokens: Array.from({ length: extra }, (_, i) => token(i, 1, i * 0.05)),
  }
}

describe('threshold arithmetic', () => {
  it('earns nothing below the threshold', () => {
    expect(applyPawsToCycle(0, 5)).toEqual({ loliCyclePaws: 5, earned: 0 })
    expect(applyPawsToCycle(190, 9)).toEqual({ loliCyclePaws: 199, earned: 0 })
  })

  it('earns exactly one at the threshold, leaving nothing over', () => {
    expect(applyPawsToCycle(199, 1)).toEqual({ loliCyclePaws: 0, earned: 1 })
    expect(applyPawsToCycle(0, THRESHOLD)).toEqual({ loliCyclePaws: 0, earned: 1 })
  })

  it('preserves the overflow, exactly as the worked example says', () => {
    // scoring-and-progression.md §2.2: 198 + 5 → a bonus, cycle = 3.
    expect(applyPawsToCycle(198, 5)).toEqual({ loliCyclePaws: 3, earned: 1 })
    expect(applyPawsToCycle(195, 10)).toEqual({ loliCyclePaws: 5, earned: 1 })
  })

  it('earns more than one when a single collection crosses twice', () => {
    /*
     * The assumption worth breaking on purpose. Code that subtracts 200 once,
     * or that treats the threshold as a boolean, silently loses the second
     * bonus — and a magnet sweeping a dense run of tokens is exactly how a
     * player would notice.
     */
    expect(applyPawsToCycle(190, 220)).toEqual({ loliCyclePaws: 10, earned: 2 })
    expect(applyPawsToCycle(0, THRESHOLD * 3)).toEqual({ loliCyclePaws: 0, earned: 3 })
    expect(applyPawsToCycle(150, THRESHOLD * 2 + 75)).toEqual({ loliCyclePaws: 25, earned: 3 })
  })

  it('never leaves the cycle at or past the threshold', () => {
    for (let cycle = 0; cycle < THRESHOLD; cycle += 7) {
      for (let collected = 0; collected < 500; collected += 13) {
        const result = applyPawsToCycle(cycle, collected)

        expect(result.loliCyclePaws).toBeGreaterThanOrEqual(0)
        expect(result.loliCyclePaws).toBeLessThan(THRESHOLD)
        expect(cycle + collected).toBe(result.earned * THRESHOLD + result.loliCyclePaws)
      }
    }
  })
})

describe('a threshold starts a bonus', () => {
  it('activates when the threshold is crossed with nothing running', () => {
    const after = step(aboutToCross(), [], STEP_MS)

    expect(after.runPaws).toBe(1)
    expect(after.loliCyclePaws).toBe(0)
    expect(after.loli.phase).toBe('entering')
    expect(after.loliActivations).toBe(1)
    expect(after.loli.queuedLoliBonuses).toBe(0)
  })

  it('runs entering → active → exiting → inactive', () => {
    const seen: LoliPhase[] = []
    let state = step(aboutToCross(), [], STEP_MS)

    for (let i = 0; i < 3_000; i++) {
      if (seen[seen.length - 1] !== state.loli.phase) seen.push(state.loli.phase)

      state = step(state, [], STEP_MS)

      if (state.phase === 'ended') state = { ...state, phase: 'running', hearts: TUNING.hearts.max }
    }

    expect(seen).toEqual(['entering', 'active', 'exiting', 'inactive'])
  })

  it('stays active for approximately the approved duration', () => {
    let state = step(aboutToCross(), [], STEP_MS)

    // Into the active phase.
    state = advance(state, TUNING.loli.enteringMs + STEP_MS)
    expect(state.loli.phase).toBe('active')

    let activeMs = 0

    while (state.loli.phase === 'active' && activeMs < TUNING.loli.durationMs * 2) {
      state = step(state, [], STEP_MS)

      if (state.phase === 'ended') state = { ...state, phase: 'running', hearts: TUNING.hearts.max }

      activeMs += STEP_MS
    }

    expect(activeMs).toBeGreaterThan(TUNING.loli.durationMs - STEP_MS * 2)
    expect(activeMs).toBeLessThan(TUNING.loli.durationMs + STEP_MS * 2)
  })
})

describe('the queue is run-scoped', () => {
  it('queues a second threshold rather than stacking a second companion', () => {
    // Cross once to start a bonus, then cross again while it runs.
    let state = step(aboutToCross(), [], STEP_MS)

    expect(state.loli.phase).toBe('entering')

    state = {
      ...state,
      loliCyclePaws: THRESHOLD - 1,
      pawTokens: [token(50)],
    }

    state = step(state, [], STEP_MS)

    expect(state.loli.queuedLoliBonuses).toBe(1)
    expect(state.loliActivations, 'a queued bonus has not started').toBe(1)
  })

  it('never runs two companions at once', () => {
    let state = step(aboutToCross(), [], STEP_MS)

    for (let i = 0; i < 3; i++) {
      state = { ...state, loliCyclePaws: THRESHOLD - 1, pawTokens: [token(60 + i)] }
      state = step(state, [], STEP_MS)
    }

    expect(state.loli.queuedLoliBonuses).toBe(3)

    // Only ever one phase, and it is a single machine — there is no second.
    for (let i = 0; i < 4_000; i++) {
      state = step(state, [], STEP_MS)

      if (state.phase === 'ended') state = { ...state, phase: 'running', hearts: TUNING.hearts.max }

      expect(['inactive', 'entering', 'active', 'exiting']).toContain(state.loli.phase)
    }
  })

  it('starts the next queued bonus when the current one finishes', () => {
    let state = step(aboutToCross(), [], STEP_MS)

    state = { ...state, loliCyclePaws: THRESHOLD - 1, pawTokens: [token(70)] }
    state = step(state, [], STEP_MS)

    expect(state.loli.queuedLoliBonuses).toBe(1)
    expect(state.loliActivations).toBe(1)

    const full = TUNING.loli.enteringMs + TUNING.loli.durationMs + TUNING.loli.exitingMs

    for (let i = 0; i < Math.ceil((full + 200) / STEP_MS); i++) {
      state = step(state, [], STEP_MS)

      if (state.phase === 'ended') state = { ...state, phase: 'running', hearts: TUNING.hearts.max }
    }

    expect(state.loli.queuedLoliBonuses).toBe(0)
    expect(state.loliActivations, 'the queued bonus started, so it counted').toBe(2)
  })

  it('discards the queue when the run ends, and counts no activation for it', () => {
    /*
     * The critical case named in the milestone: earn while active, die before
     * the queued bonus starts, and `loliActivations` must not include it.
     * Nothing is owed into a later run — there is no `owedLoliBonuses`.
     */
    let state = step(aboutToCross(), [], STEP_MS)

    state = { ...state, loliCyclePaws: THRESHOLD - 1, pawTokens: [token(80)] }
    state = step(state, [], STEP_MS)

    expect(state.loli.queuedLoliBonuses).toBe(1)
    expect(state.loliActivations).toBe(1)

    /*
     * Killed by a real collision, not by forcing the phase. Setting
     * `phase: 'ended'` from outside would hit the reducer's terminal guard and
     * return before the cleanup ever ran, so the test would be asserting
     * against a path the game cannot take.
     */
    const lethal: RunState = {
      ...state,
      hearts: 1,
      obstacles: [Object.freeze({
        id: 999,
        kind: 'lane_blocking' as const,
        lane: state.lane,
        distanceUnits: 0,
        lengthUnits: TUNING.obstacle.defaultLengthUnits,
        outcome: 'pending' as const,
      })],
    }

    const ended = step(lethal, [], STEP_MS)

    expect(ended.phase).toBe('ended')
    expect(ended.loli.queuedLoliBonuses).toBe(0)
    expect(ended.loli.phase).toBe('inactive')
    expect(ended.loliActivations, 'the queued bonus never started').toBe(1)
  })

  it('starts a fresh run with nothing owed', () => {
    const next = createRunState({ seed: 2 })

    expect(next.loli.queuedLoliBonuses).toBe(0)
    expect(next.loliActivations).toBe(0)
    expect(next.loli.phase).toBe('inactive')
  })
})

describe('what Loli does not do', () => {
  it('grants no invulnerability — a collision during Loli still costs a heart', () => {
    let state = step(aboutToCross(), [], STEP_MS)

    state = advance(state, TUNING.loli.enteringMs + STEP_MS)
    expect(state.loli.phase).toBe('active')

    const hearts = state.hearts
    const staged: RunState = {
      ...state,
      obstacles: [Object.freeze({
        id: 900,
        kind: 'lane_blocking' as const,
        lane: state.lane,
        distanceUnits: 0,
        lengthUnits: TUNING.obstacle.defaultLengthUnits,
        outcome: 'pending' as const,
      })],
    }

    const hit = step(staged, [], STEP_MS)

    expect(hit.hearts).toBe(hearts - 1)
    expect(hit.loli.phase, 'and taking a hit does not cancel the bonus').toBe('active')
  })

  it('grants no score multiplier of its own', () => {
    const plain = advance(runningState(4), 3_000)

    const withLoli = advance({
      ...runningState(4),
      loli: { phase: 'active', phaseRemainingMs: TUNING.loli.durationMs, queuedLoliBonuses: 0 },
    }, 3_000)

    // Distance score is untouched by the magnet, so it isolates the multiplier.
    expect(withLoli.score.distanceMilli).toBe(plain.score.distanceMilli)
  })
})

describe('the magnet', () => {
  it('pulls a nearby token toward the player while active', () => {
    const base = runningState()
    const staged: RunState = {
      ...base,
      loli: { phase: 'active', phaseRemainingMs: TUNING.loli.durationMs, queuedLoliBonuses: 0 },
      pawTokens: [token(0, 0, 5)],
    }

    const after = step(staged, [], STEP_MS)
    const moved = after.pawTokens[0]

    expect(moved).toBeTruthy()
    expect(moved!.laneOffset).toBeGreaterThan(0)
    expect(moved!.laneOffset).toBeLessThanOrEqual(1)
  })

  it('leaves a token that is still too far up the road', () => {
    /*
     * The bound this covers did not exist until the M7 review.
     *
     * The radius was lateral only, so a token anywhere between the player and
     * the spawn horizon was pulled — including the stretch beyond the visible
     * road, where the player cannot watch it happen. `magnetPullPerSecond` is
     * specified as "slow enough to be visible", and an off-screen token
     * finished its whole lateral move before it ever appeared.
     */
    const base = runningState()
    const beyond = TUNING.loli.magnetReachUnits + 1
    const staged: RunState = {
      ...base,
      loli: { phase: 'active', phaseRemainingMs: TUNING.loli.durationMs, queuedLoliBonuses: 0 },
      pawTokens: [token(0, 0, beyond)],
    }

    expect(step(staged, [], STEP_MS).pawTokens[0]!.laneOffset).toBe(0)
  })

  it('starts pulling the moment a token comes within reach', () => {
    // The other side of the same bound: the cut-off must be a cut-off, not a
    // silent refusal that never lifts.
    const base = runningState()
    const staged: RunState = {
      ...base,
      loli: { phase: 'active', phaseRemainingMs: TUNING.loli.durationMs, queuedLoliBonuses: 0 },
      pawTokens: [token(0, 0, TUNING.loli.magnetReachUnits - 0.1)],
    }

    expect(step(staged, [], STEP_MS).pawTokens[0]!.laneOffset).toBeGreaterThan(0)
  })

  it('still reaches a token the player has just passed but could still take', () => {
    /*
     * There is deliberately **no** rear bound.
     *
     * The collection window extends slightly behind the reference point, so a
     * token at a small negative distance is still takeable — and a magnet that
     * refused to reach it would drop a paw the player had earned. Anything
     * genuinely past is removed by `advancePawTokens` before the magnet runs,
     * which is why a rear guard here would be unreachable code rather than a
     * rule. An earlier draft of this test had one, and passed because the token
     * no longer existed.
     */
    const base = runningState()
    const staged: RunState = {
      ...base,
      loli: { phase: 'active', phaseRemainingMs: TUNING.loli.durationMs, queuedLoliBonuses: 0 },
      pawTokens: [token(0, 0, -0.2)],
    }

    expect(step(staged, [], STEP_MS).pawTokens[0]!.laneOffset).toBeGreaterThan(0)
  })

  it('never moves a token the renderer is not drawing', () => {
    /*
     * The property behind the two bounds above, over a real run rather than a
     * staged state: every token the magnet moves must be one the player can
     * see. `world.visibleUnits` is what the scene uses for its on-screen test.
     */
    let state: RunState = {
      ...runningState(11),
      loli: { phase: 'active', phaseRemainingMs: TUNING.loli.durationMs * 50, queuedLoliBonuses: 0 },
    }

    let moves = 0

    for (let i = 0; i < 6_000; i++) {
      const before = new Map(state.pawTokens.map(t => [t.id, t.laneOffset]))

      state = step(state, [], STEP_MS)

      for (const token of state.pawTokens) {
        const was = before.get(token.id)

        if (was === undefined || was === token.laneOffset) continue

        moves++
        expect(token.distanceUnits, `token ${token.id} moved off-screen`)
          .toBeLessThanOrEqual(TUNING.world.visibleUnits)
      }
    }

    expect(moves, 'the magnet must actually have moved something').toBeGreaterThan(0)
  })

  it('leaves a token beyond its reach alone', () => {
    const base = runningState()
    const far = 1 + TUNING.loli.magnetRadiusUnits + 0.5
    const staged: RunState = {
      ...base,
      loli: { phase: 'active', phaseRemainingMs: TUNING.loli.durationMs, queuedLoliBonuses: 0 },
      pawTokens: [token(0, far, 5)],
    }

    expect(step(staged, [], STEP_MS).pawTokens[0]!.laneOffset).toBe(far)
  })

  it('does nothing while the bonus is only entering or exiting', () => {
    const base = runningState()

    for (const phase of ['entering', 'exiting'] as const) {
      const staged: RunState = {
        ...base,
        loli: { phase, phaseRemainingMs: 500, queuedLoliBonuses: 0 },
        pawTokens: [token(0, 0, 5)],
      }

      expect(step(staged, [], STEP_MS).pawTokens[0]!.laneOffset, phase).toBe(0)
    }
  })

  it('never moves the player', () => {
    const base = runningState()
    const staged: RunState = {
      ...base,
      loli: { phase: 'active', phaseRemainingMs: TUNING.loli.durationMs, queuedLoliBonuses: 0 },
      pawTokens: [token(0, 0, 5), token(1, 0, 6)],
    }

    const after = step(staged, [], STEP_MS)

    expect(after.lane).toBe(base.lane)
    expect(after.laneTransition).toBeNull()
  })

  it('does not perturb the obstacle stream', () => {
    const base = runningState(6)
    const withLoli: RunState = {
      ...base,
      loli: { phase: 'active', phaseRemainingMs: TUNING.loli.durationMs * 10, queuedLoliBonuses: 0 },
    }

    const plain = advance(base, 4_000)
    const magnetised = advance(withLoli, 4_000)

    expect(magnetised.rng.pattern).toEqual(plain.rng.pattern)
    expect(magnetised.nextObstacleId).toBe(plain.nextObstacleId)
  })

  it('collects a token it reached that the player could not, worth the same', () => {
    /*
     * Both halves in one test, because either alone would be weak.
     *
     * The token sits two thirds of a lane away — outside the collection window,
     * so a player standing still never takes it. With the magnet running it is
     * pulled in and collected, and it is worth exactly one ordinary paw:
     * "magnet-collected paws count normally" is APPROVED.
     */
    const base = runningState()
    const placed = [token(0, 1 - 0.7, 0.3)]

    const withoutLoli = advance({ ...base, pawTokens: placed }, 400)

    expect(withoutLoli.runPaws, 'unreachable without the magnet').toBe(0)

    const withLoli = advance({
      ...base,
      loli: { phase: 'active', phaseRemainingMs: TUNING.loli.durationMs, queuedLoliBonuses: 0 },
      pawTokens: placed,
    }, 400)

    expect(withLoli.runPaws).toBe(1)
    expect(withLoli.score.collectionMilli).toBe(TUNING.score.perPaw * 1000)
  })
})

describe('pause freezes the companion', () => {
  it('does not age any phase while paused', () => {
    for (const phase of ['entering', 'active', 'exiting'] as const) {
      const base = runningState()
      const staged: RunState = {
        ...base,
        loli: { phase, phaseRemainingMs: 400, queuedLoliBonuses: 1 },
      }

      let paused = step(staged, [{ type: 'pause' }], STEP_MS)

      for (let i = 0; i < 200; i++) paused = step(paused, [], STEP_MS)

      expect(paused.loli.phase, phase).toBe(phase)
      expect(paused.loli.phaseRemainingMs, phase).toBe(400)
      expect(paused.loli.queuedLoliBonuses, phase).toBe(1)
    }
  })
})
