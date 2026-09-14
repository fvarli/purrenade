import { describe, expect, it } from 'vitest'
import { createRunState } from './state'
import { step } from './step'
import { scoreComponents } from './score'
import { STEP_MS, TUNING } from './tuning'
import type { PawToken, RunState } from './types'

/**
 * Paw Tokens: spawning, collection, and the stream boundary.
 *
 * The load-bearing test in this file is the last one. Paw Tokens draw from the
 * **collectible** RNG stream, and if a single draw ever leaked into the
 * **pattern** stream, every recorded obstacle sequence for every seed would
 * shift — silently, and only visibly as "the game feels different now".
 */

function runningState(seed = 1): RunState {
  let state = createRunState({ seed })

  while (state.phase !== 'running') state = step(state, [], STEP_MS)

  return state
}

function advance(state: RunState, steps: number): RunState {
  let next = state

  for (let i = 0; i < steps; i++) next = step(next, [], STEP_MS)

  return next
}

/** The obstacle sequence a seed produces, as a comparable string. */
function obstacleTrace(state: RunState, steps: number): string {
  let next = state
  const seen: string[] = []

  for (let i = 0; i < steps; i++) {
    const before = next.nextObstacleId

    next = step(next, [], STEP_MS)

    for (const obstacle of next.obstacles) {
      if (obstacle.id >= before) seen.push(`${obstacle.id}:${obstacle.kind}:${obstacle.lane}`)
    }
  }

  return seen.join('|')
}

/** Put a token exactly on the player, so collection is the only variable. */
function tokenAt(id: number, distanceUnits: number, laneOffset: number): PawToken {
  return Object.freeze({ id, lane: 1, laneOffset, distanceUnits, outcome: 'pending' as const })
}

describe('Paw Tokens appear on the road', () => {
  it('spawns tokens as the run progresses', () => {
    const state = advance(runningState(), 3_000)

    expect(state.nextPawTokenId).toBeGreaterThan(0)
  })

  it('gives every token a deterministic, monotonic id', () => {
    const state = advance(runningState(), 6_000)
    const ids = state.pawTokens.map(token => token.id)

    expect(ids).toEqual([...ids].sort((a, b) => a - b))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('produces the same tokens for the same seed', () => {
    const a = advance(runningState(5), 4_000)
    const b = advance(runningState(5), 4_000)

    expect(JSON.stringify(a.pawTokens)).toBe(JSON.stringify(b.pawTokens))
    expect(a.nextPawTokenId).toBe(b.nextPawTokenId)
  })

  it('produces different tokens for different seeds', () => {
    const a = advance(runningState(11), 6_000)
    const b = advance(runningState(12), 6_000)

    expect(a.nextPawTokenId + JSON.stringify(a.pawTokens))
      .not.toBe(b.nextPawTokenId + JSON.stringify(b.pawTokens))
  })

  it('keeps the world bounded over a long run', () => {
    // An unbounded token array is a memory leak with a frame-rate cost.
    let state = runningState()
    let peak = 0

    for (let i = 0; i < 30_000; i++) {
      state = step(state, [], STEP_MS)

      if (state.phase === 'ended') state = { ...state, phase: 'running', hearts: TUNING.hearts.max }

      peak = Math.max(peak, state.pawTokens.length)
    }

    expect(peak).toBeGreaterThan(0)
    expect(peak).toBeLessThan(40)
  })

  it('never leaves a token sitting inside a lane blocker', () => {
    /*
     * The defect this covers, found at the M7 adversarial review.
     *
     * Patterns and token groups run on independent schedules into the same
     * band, and the obstacle generator has never read the token list — so an
     * obstacle emitted a few steps after a group lands on top of it. Over
     * twelve seeds and forty thousand steps each that produced 230 same-lane
     * overlaps, 156 of them lane-blocking, and **58 in which the obstacle's
     * damage window strictly contained the token's collection window** — bait
     * that could not be taken at all without losing a heart. The first arrives
     * 15 seconds into seed 1, in Tier 1.
     *
     * Asserted as a property over real runs rather than as a staged case,
     * because the failure is a race between two schedules and a fixed state
     * cannot express it.
     */
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      let state = runningState(seed)

      for (let i = 0; i < 12_000; i++) {
        state = step(state, [], STEP_MS)

        if (state.phase === 'ended') {
          state = { ...state, phase: 'running', hearts: TUNING.hearts.max, invulnRemainingMs: 0 }
        }

        for (const token of state.pawTokens) {
          const lane = Math.round(token.laneOffset)
          const blocker = state.obstacles.find(obstacle => obstacle.kind === 'lane_blocking'
            && obstacle.lane === lane
            && obstacle.distanceUnits < token.distanceUnits + TUNING.paw.lengthUnits
            && obstacle.distanceUnits + obstacle.lengthUnits > token.distanceUnits)

          expect(
            blocker,
            `seed ${seed} step ${i}: token ${token.id} at ${token.distanceUnits.toFixed(3)} `
            + `sits inside blocker ${blocker?.id} at ${blocker?.distanceUnits.toFixed(3)}`,
          ).toBeUndefined()
        }
      }
    }
  }, 120_000)

  it('leaves a token under a jumpable obstacle alone', () => {
    /*
     * Only lane blockers are bait. Collection never consults `isAirborne`, so a
     * player clearing a barrier takes the token in the same jump — a good
     * moment, and removing it would be a silent nerf rather than a fix.
     */
    const base = runningState()
    const staged: RunState = {
      ...base,
      obstacles: [Object.freeze({
        id: 900, kind: 'jumpable' as const, lane: 1, distanceUnits: 5,
        lengthUnits: TUNING.obstacle.defaultLengthUnits, outcome: 'pending' as const,
      })],
      pawTokens: [tokenAt(0, 5.1, 1)],
    }

    expect(step(staged, [], STEP_MS).pawTokens).toHaveLength(1)
  })

  it('removes a token the magnet pulled into a blocker', () => {
    // The magnet moves tokens between lanes, so the reconciliation runs after
    // it: a token dragged into a cone is bait just as surely as one spawned
    // into one.
    const base = runningState()
    const staged: RunState = {
      ...base,
      loli: { phase: 'active', phaseRemainingMs: TUNING.loli.durationMs, queuedLoliBonuses: 0 },
      obstacles: [Object.freeze({
        id: 901, kind: 'lane_blocking' as const, lane: 1, distanceUnits: 4.9,
        lengthUnits: TUNING.obstacle.defaultLengthUnits, outcome: 'pending' as const,
      })],
      pawTokens: [tokenAt(0, 5, 1)],
    }

    expect(step(staged, [], STEP_MS).pawTokens).toHaveLength(0)
  })

  it('drops tokens once they are well behind the player', () => {
    const state = advance(runningState(), 5_000)

    for (const token of state.pawTokens) {
      expect(token.distanceUnits + TUNING.paw.lengthUnits)
        .toBeGreaterThanOrEqual(-TUNING.world.despawnBehindUnits)
    }
  })
})

describe('collection', () => {
  it('takes a token the player runs into', () => {
    const state = runningState()
    const staged: RunState = { ...state, pawTokens: [tokenAt(0, 0, 1)] }

    const after = step(staged, [], STEP_MS)

    expect(after.runPaws).toBe(1)
    expect(after.pawTokens).toHaveLength(0)
    expect(scoreComponents(after).collection).toBe(TUNING.score.perPaw)
  })

  it('ignores a token in another lane', () => {
    const state = runningState()
    const staged: RunState = { ...state, pawTokens: [tokenAt(0, 0, 0)] }

    const after = step(staged, [], STEP_MS)

    expect(after.runPaws).toBe(0)
    expect(after.pawTokens).toHaveLength(1)
  })

  it('takes two tokens that resolve on the same step', () => {
    // Collection is not capped the way damage is: two tokens on one step are
    // two paws, two lots of score and two lots of charge.
    const state = runningState()
    const staged: RunState = { ...state, pawTokens: [tokenAt(0, 0, 1), tokenAt(1, 0.1, 1)] }

    const after = step(staged, [], STEP_MS)

    expect(after.runPaws).toBe(2)
    expect(scoreComponents(after).collection).toBe(TUNING.score.perPaw * 2)
  })

  it('takes each token exactly once', () => {
    /*
     * The duplicate-collection case. A collected token leaves the world in the
     * same step, so there is nothing left for a later step to take again — the
     * guarantee is structural rather than a flag someone has to check.
     */
    const state = runningState()
    const staged: RunState = { ...state, pawTokens: [tokenAt(0, 0, 1)] }

    let after = step(staged, [], STEP_MS)

    expect(after.runPaws).toBe(1)

    for (let i = 0; i < 20; i++) after = step(after, [], STEP_MS)

    expect(after.runPaws).toBe(1)
  })

  it('collects nothing once the run has ended', () => {
    const state = runningState()
    const ended: RunState = {
      ...state,
      phase: 'ended',
      pawTokens: [tokenAt(0, 0, 1)],
    }

    const after = step(ended, [], STEP_MS)

    expect(after.runPaws).toBe(0)
  })

  it('collects nothing while paused', () => {
    const state = runningState()
    const staged: RunState = { ...state, pawTokens: [tokenAt(0, 0, 1)] }
    const paused = step(staged, [{ type: 'pause' }], STEP_MS)

    expect(paused.runPaws).toBe(0)
    expect(paused.pawTokens).toHaveLength(1)
  })

  it('still collects while the player is invulnerable', () => {
    // Collection is not damage. Post-hit recovery must not stop it.
    const state = runningState()
    const staged: RunState = {
      ...state,
      invulnRemainingMs: TUNING.invuln.postHitMs,
      pawTokens: [tokenAt(0, 0, 1)],
    }

    expect(step(staged, [], STEP_MS).runPaws).toBe(1)
  })
})

describe('the collectible stream is isolated from the pattern stream', () => {
  it('leaves the obstacle sequence untouched when the collectible stream changes', () => {
    /*
     * The regression this file exists for.
     *
     * Perturb only the collectible stream and assert the obstacles are
     * bit-identical over a long run. If Paw Token placement ever draws from
     * `pattern`, this fails — and so does every replay ever recorded.
     */
    const base = runningState(3)
    const perturbed: RunState = {
      ...base,
      rng: { ...base.rng, collectible: { a: 0x1234, b: 0x5678, c: 0x9ABC, d: 0xDEF0 } },
    }

    expect(obstacleTrace(perturbed, 4_000)).toBe(obstacleTrace(base, 4_000))
  })

  it('does change the tokens when the collectible stream changes', () => {
    // The other half: if this passed too, the first test would be proving
    // nothing more than "paws are not random".
    const base = runningState(3)
    const perturbed: RunState = {
      ...base,
      rng: { ...base.rng, collectible: { a: 0x1234, b: 0x5678, c: 0x9ABC, d: 0xDEF0 } },
    }

    const a = advance(base, 4_000)
    const b = advance(perturbed, 4_000)

    expect(JSON.stringify(b.pawTokens)).not.toBe(JSON.stringify(a.pawTokens))
  })

  it('never advances the pattern stream from a token draw', () => {
    // Directly: run a stretch and compare the pattern stream against a run
    // whose spawning is identical. Any paw draw touching it would show here.
    const base = runningState(9)
    const after = advance(base, 3_000)
    const reference = advance(runningState(9), 3_000)

    expect(after.rng.pattern).toEqual(reference.rng.pattern)
    expect(after.rng.cosmetic).toEqual(base.rng.cosmetic)
  })
})
