import { describe, expect, it } from 'vitest'
import { tierAt } from './difficulty'
import { scoreComponents, scoreTotal } from './score'
import { chargeCeilingMicro } from './slayyy'
import { createRunState } from './state'
import { step } from './step'
import { STEP_MS, TUNING } from './tuning'
import type { InputEvent, RunState } from './types'

/**
 * The whole M7 layer, driven for a long time, all at once.
 *
 * The per-system files prove each rule in isolation. This one exists because
 * the interesting failures are not in the rules — they are in the arithmetic
 * that only shows up after ten minutes: an accumulator that drifts, an array
 * that never shrinks, a queue that grows without bound, a counter that
 * double-increments once in ten thousand steps.
 */

const THRESHOLD = TUNING.paw.loliThreshold

interface Observations {
  readonly steps: number
  readonly tiers: Set<number>
  readonly peakTokens: number
  readonly peakQueue: number
  readonly loliActivations: number
  readonly slayyyActivations: number
  readonly overlapSteps: number
  readonly hits: number
  readonly maxMultiplierSeen: number
}

/**
 * Play a long, busy run.
 *
 * The player is scripted rather than random: it fires SLAYYY the moment the
 * meter arms, and it is topped up with paws so Loli cycles repeatedly. Both are
 * legitimate state the game can reach — the top-up stands in for a player who
 * collects well, which no amount of standing still would achieve inside a test
 * budget.
 */
function playLongRun(seed: number, steps: number): { state: RunState, seen: Observations } {
  let state = createRunState({ seed })

  const tiers = new Set<number>()

  let peakTokens = 0
  let peakQueue = 0
  let overlapSteps = 0
  let hits = 0
  let maxMultiplierSeen = 1
  let previousHearts = state.hearts
  let previousTotal = 0
  let previousDistance = 0

  for (let i = 0; i < steps; i++) {
    const inputs: InputEvent[] = []

    // Fire the moment it is available. Nothing else activates it.
    if (state.slayyy.phase === 'ready') inputs.push({ type: 'slayyy' })

    // A pause every so often, resumed two steps later.
    if (i % 4_000 === 1_500) inputs.push({ type: 'pause' })
    if (i % 4_000 === 1_502) inputs.push({ type: 'resume' })

    const before = state

    state = step(state, inputs, STEP_MS)

    if (state.hearts < previousHearts) hits++
    previousHearts = state.hearts

    // Keep the run alive: this is a stress test of M7, not of survival.
    if (state.phase === 'ended') {
      state = { ...state, phase: 'running', hearts: TUNING.hearts.max, resumePhase: 'running' }
    }

    // Top the cycle up so thresholds keep arriving, including while active.
    if (i % 900 === 0) {
      state = { ...state, loliCyclePaws: THRESHOLD - 1, pawTokens: [
        Object.freeze({ id: 100_000 + i, lane: state.lane, laneOffset: state.lane, distanceUnits: 0, outcome: 'pending' as const }),
      ] }
    }

    tiers.add(tierAt(state.elapsedMs))
    peakTokens = Math.max(peakTokens, state.pawTokens.length)
    peakQueue = Math.max(peakQueue, state.loli.queuedLoliBonuses)

    if (state.loli.phase === 'active' && state.slayyy.phase === 'active') overlapSteps++

    // The multiplier, observed rather than asserted: the largest per-step
    // distance gain divided by the smallest tells us whether anything ever
    // exceeded ×2.
    const distanceGain = state.score.distanceMilli - previousDistance

    if (before.phase === 'running' && distanceGain > 0 && previousDistance > 0) {
      const plainRate = state.distanceUnits > 0
        ? (TUNING.score.distancePerSecond / TUNING.world.baseScrollUnitsPerS) * 1000
        : 0
      const movedUnits = state.distanceUnits - before.distanceUnits

      if (movedUnits > 0) {
        maxMultiplierSeen = Math.max(maxMultiplierSeen, distanceGain / (movedUnits * plainRate))
      }
    }

    previousDistance = state.score.distanceMilli
    previousTotal = Math.max(previousTotal, scoreTotal(state))
  }

  return {
    state,
    seen: {
      steps,
      tiers,
      peakTokens,
      peakQueue,
      loliActivations: state.loliActivations,
      slayyyActivations: state.slayyyActivations,
      overlapSteps,
      hits,
      maxMultiplierSeen,
    },
  }
}

describe('a long, busy run', () => {
  const { state, seen } = playLongRun(21, 40_000)

  it('reaches every difficulty tier', () => {
    expect([...seen.tiers].sort()).toEqual([1, 2, 3, 4, 5])
  })

  it('activates Loli and SLAYYY repeatedly, and overlaps them', () => {
    expect(seen.loliActivations).toBeGreaterThan(3)
    expect(seen.slayyyActivations).toBeGreaterThan(3)
    expect(seen.overlapSteps, 'the two ran at the same time at least once').toBeGreaterThan(0)
  })

  it('queues bonuses without the queue running away', () => {
    /*
     * The queue may legitimately grow — a generous run earns faster than an
     * eight-second companion can spend — so this is not a cap. It is a check
     * that it stays proportional to what was earned rather than compounding.
     */
    expect(seen.peakQueue).toBeGreaterThan(0)
    expect(seen.peakQueue).toBeLessThan(seen.loliActivations + 60)
  })

  it('keeps the token array bounded', () => {
    expect(seen.peakTokens).toBeGreaterThan(0)
    expect(seen.peakTokens).toBeLessThan(40)
  })

  it('never exceeds ×2, at any point in the run', () => {
    /*
     * The tolerance is per-step rounding, not slack in the rule.
     *
     * Distance score is rounded to whole thousandths every step, and one step
     * at the base speed is only ~83 thousandths — so a half-unit rounding is
     * 0.6 % of it, and a genuine ×2 can be *observed* as high as 2.012. The
     * structural guarantee that the multiplier is applied exactly once lives in
     * `score.spec.ts`; this is the long-run check that nothing ever compounds
     * it, and ×4 would show here as 4.
     */
    expect(seen.maxMultiplierSeen).toBeLessThan(TUNING.score.slayyyMultiplier * 1.01)
  })

  it('takes hits, and never heals', () => {
    expect(seen.hits).toBeGreaterThan(0)
    expect(state.hearts).toBeLessThanOrEqual(TUNING.hearts.max)
  })

  it('keeps the score integral and the components summing exactly', () => {
    const parts = scoreComponents(state)

    expect(Number.isInteger(scoreTotal(state))).toBe(true)
    expect(scoreTotal(state)).toBe(parts.distance + parts.collection + parts.bonus)
    expect(parts.bonus, 'no bonus source is defined').toBe(0)
  })

  it('keeps every counter within its own bounds', () => {
    expect(state.loliCyclePaws).toBeGreaterThanOrEqual(0)
    expect(state.loliCyclePaws).toBeLessThan(THRESHOLD)
    expect(state.slayyy.chargeMicro).toBeGreaterThanOrEqual(0)
    expect(state.slayyy.chargeMicro).toBeLessThanOrEqual(chargeCeilingMicro())
    expect(state.runPaws).toBeGreaterThan(0)
    expect(Number.isFinite(state.score.distanceMilli)).toBe(true)
  })

  it('leaves every collection accounted for', () => {
    /*
     * Every paw taken is worth one paw of score, or two while SLAYYY is
     * running — `score.multiplierScope` is PROPOSED as covering collectible
     * score, so a token taken during the power is worth ×2 like everything
     * else. The bound therefore brackets rather than equals: below it, a paw
     * was collected without paying; above it, one paid twice.
     */
    const collection = scoreComponents(state).collection
    const plain = state.runPaws * TUNING.score.perPaw

    expect(collection).toBeGreaterThanOrEqual(plain)
    expect(collection).toBeLessThanOrEqual(plain * TUNING.score.slayyyMultiplier)
  })
})

describe('a run played twice is the same run', () => {
  it('replays byte-for-byte from the same seed and inputs', () => {
    const a = playLongRun(77, 12_000).state
    const b = playLongRun(77, 12_000).state

    const facts = (s: RunState) => JSON.stringify({
      score: s.score,
      runPaws: s.runPaws,
      cycle: s.loliCyclePaws,
      loli: [s.loli.phase, s.loli.queuedLoliBonuses, s.loliActivations],
      slayyy: [s.slayyy.phase, s.slayyy.chargeMicro, s.slayyyActivations],
      hearts: s.hearts,
      nearMiss: s.nearMissCount,
      spawned: [s.nextObstacleId, s.nextPawTokenId],
    })

    expect(facts(a)).toBe(facts(b))
  })
})

describe('the terminal state stops everything M7 owns', () => {
  it('freezes every counter and clears every companion', () => {
    let state = createRunState({ seed: 5 })

    // Get to a rich state: a bonus running, a bonus queued, the power active.
    while (state.phase !== 'running') state = step(state, [], STEP_MS)

    state = { ...state, loliCyclePaws: THRESHOLD - 1, pawTokens: [
      Object.freeze({ id: 1, lane: state.lane, laneOffset: state.lane, distanceUnits: 0, outcome: 'pending' as const }),
    ] }
    state = step(state, [], STEP_MS)
    state = { ...state, loliCyclePaws: THRESHOLD - 1, pawTokens: [
      Object.freeze({ id: 2, lane: state.lane, laneOffset: state.lane, distanceUnits: 0, outcome: 'pending' as const }),
    ] }
    state = step(state, [], STEP_MS)

    state = {
      ...state,
      slayyy: { phase: 'ready', chargeMicro: chargeCeilingMicro(), activeRemainingMs: 0 },
    }
    state = step(state, [{ type: 'slayyy' }], STEP_MS)

    expect(state.loli.queuedLoliBonuses).toBeGreaterThan(0)
    expect(state.slayyy.phase).toBe('active')

    // Now kill the run outright.
    const lethal: RunState = {
      ...state,
      hearts: 1,
      slayyy: { phase: 'charging', chargeMicro: 0, activeRemainingMs: 0 },
      obstacles: [Object.freeze({
        id: 42,
        kind: 'lane_blocking' as const,
        lane: state.lane,
        distanceUnits: 0,
        lengthUnits: TUNING.obstacle.defaultLengthUnits,
        outcome: 'pending' as const,
      })],
    }

    const ended = step(lethal, [], STEP_MS)

    expect(ended.phase).toBe('ended')
    expect(ended.loli.phase).toBe('inactive')
    expect(ended.loli.queuedLoliBonuses).toBe(0)
    expect(ended.slayyy.phase).not.toBe('active')

    const frozen = {
      score: JSON.stringify(ended.score),
      runPaws: ended.runPaws,
      cycle: ended.loliCyclePaws,
      charge: ended.slayyy.chargeMicro,
      loliActivations: ended.loliActivations,
      slayyyActivations: ended.slayyyActivations,
    }

    let after = ended

    for (let i = 0; i < 600; i++) {
      after = step(after, [{ type: 'slayyy' }, { type: 'jump' }], STEP_MS)
    }

    expect({
      score: JSON.stringify(after.score),
      runPaws: after.runPaws,
      cycle: after.loliCyclePaws,
      charge: after.slayyy.chargeMicro,
      loliActivations: after.loliActivations,
      slayyyActivations: after.slayyyActivations,
    }).toEqual(frozen)
  })
})
