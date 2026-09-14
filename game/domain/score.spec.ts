import { describe, expect, it } from 'vitest'
import { createRunState } from './state'
import { step } from './step'
import { scoreComponents, scoreTotal } from './score'
import { STEP_MS, TUNING } from './tuning'
import type { InputEvent, RunState } from './types'

/**
 * Score: the components, the multiplier, and the boundaries around it.
 *
 * Two rules carry most of the weight. **The total is the sum of its parts** —
 * there is no fourth stored number that can drift away from them. And **×2
 * applies to score earned while SLAYYY is active, never retroactively** — a
 * multiplier that reached backwards would make the same run score differently
 * depending on when the player pressed a key, which is not what "double score"
 * means to anyone.
 */

function runningState(seed = 1): RunState {
  let state = createRunState({ seed })

  while (state.phase !== 'running') state = step(state, [], STEP_MS)

  return state
}

function advance(state: RunState, ms: number, inputs: readonly InputEvent[] = []): RunState {
  let next = step(state, inputs, STEP_MS)
  let elapsed = STEP_MS

  while (elapsed < ms) {
    next = step(next, [], STEP_MS)
    elapsed += STEP_MS
  }

  return next
}

/** Fill the meter without playing to it, so activation boundaries are testable. */
function armed(state: RunState): RunState {
  return {
    ...state,
    slayyy: { ...state.slayyy, phase: 'ready', chargeMicro: TUNING.slayyy.chargeMax * 1000 * 1000 },
  }
}

describe('the score is the sum of its parts', () => {
  it('starts at zero, in every component', () => {
    const state = createRunState({ seed: 1 })

    expect(scoreTotal(state)).toBe(0)
    expect(scoreComponents(state)).toEqual({ distance: 0, collection: 0, bonus: 0 })
  })

  it('always equals its components added up', () => {
    /*
     * The invariant that makes a stored total unnecessary. Components are
     * floored individually and the total is their sum, so the parts a player
     * reads always add to the whole they read — flooring once at the end would
     * leave the displayed pieces one short of the displayed total.
     */
    let state = runningState()

    for (let i = 0; i < 4000; i++) {
      state = step(state, [], STEP_MS)

      const parts = scoreComponents(state)

      expect(scoreTotal(state)).toBe(parts.distance + parts.collection + parts.bonus)
    }
  })

  it('reports whole points, never a fraction', () => {
    let state = runningState()

    for (let i = 0; i < 500; i++) {
      state = step(state, [], STEP_MS)

      expect(Number.isInteger(scoreTotal(state))).toBe(true)
    }
  })

  it('leaves the bonus component at zero, because no source is defined', () => {
    /*
     * SP-2 is OPEN: near miss was excluded and nothing replaced it, so the
     * component has no source at all. It stays structurally present and unfired
     * rather than being given an invented award to make it look alive.
     */
    const state = advance(runningState(), 60_000)

    expect(scoreComponents(state).bonus).toBe(0)
  })
})

describe('distance score', () => {
  it('accrues while running and not before', () => {
    const ready = createRunState({ seed: 1 })

    expect(scoreTotal(ready)).toBe(0)

    // The readiness beat moves the player but not the world.
    const stillReady = step(ready, [], STEP_MS)

    expect(scoreTotal(stillReady)).toBe(0)

    expect(scoreTotal(advance(runningState(), 5_000))).toBeGreaterThan(0)
  })

  it('tracks the documented rate at the base speed', () => {
    /*
     * `score.distancePerSecond` is quoted "at base speed", and the run speeds
     * up on a soft-cap curve — so the check is against the *distance actually
     * travelled*, which is the quantity the rate is expressed per.
     */
    const state = advance(runningState(), 10_000)
    const perUnit = TUNING.score.distancePerSecond / TUNING.world.baseScrollUnitsPerS
    const expected = Math.floor(state.distanceUnits * perUnit)

    expect(scoreComponents(state).distance).toBeCloseTo(expected, -1)
  })

  it('does not move while paused', () => {
    const running = advance(runningState(), 3_000)
    const paused = step(running, [{ type: 'pause' }], STEP_MS)
    const before = scoreTotal(paused)

    let held = paused

    for (let i = 0; i < 240; i++) held = step(held, [], STEP_MS)

    expect(held.phase).toBe('paused')
    expect(scoreTotal(held)).toBe(before)
  })

  it('does not move after the run has ended', () => {
    let state = runningState()

    // Drain the hearts by standing still in the middle of the road.
    for (let i = 0; i < 12_000 && state.phase !== 'ended'; i++) {
      state = step(state, [], STEP_MS)
    }

    expect(state.phase).toBe('ended')

    const atEnd = scoreTotal(state)

    for (let i = 0; i < 500; i++) state = step(state, [], STEP_MS)

    expect(scoreTotal(state)).toBe(atEnd)
  })
})

describe('the SLAYYY multiplier', () => {
  it('doubles what is earned while it is active, and only then', () => {
    const base = advance(runningState(), 2_000)

    // The same run twice from one state: once plainly, once with the power on.
    const plainBefore = scoreTotal(base)
    const plain = advance(base, 2_000)
    const plainGain = scoreTotal(plain) - plainBefore

    const boosted = advance(armed(base), 2_000, [{ type: 'slayyy' }])
    const boostedGain = scoreTotal(boosted) - plainBefore

    expect(boosted.slayyy.phase).toBe('active')
    // Within a point, because flooring lands where it lands.
    expect(boostedGain).toBeGreaterThanOrEqual(plainGain * 2 - 1)
    expect(boostedGain).toBeLessThanOrEqual(plainGain * 2 + 1)
  })

  it('never multiplies score already earned', () => {
    /*
     * The retroactive case, stated directly: bank some score, then activate,
     * and the banked part must be untouched. A multiplier applied to the
     * accumulator rather than to the increment would double it here.
     */
    const banked = advance(runningState(), 4_000)
    const before = scoreTotal(banked)

    const activated = step(armed(banked), [{ type: 'slayyy' }], STEP_MS)

    expect(scoreTotal(activated)).toBeGreaterThanOrEqual(before)
    // One step's worth of distance at ×2 is a point or two, never a doubling.
    expect(scoreTotal(activated)).toBeLessThan(before * 2)
  })

  it('stops doubling when the window closes', () => {
    /*
     * Measured over the *same absolute window* in both runs.
     *
     * The scroll speed rises on a soft-cap curve, so two 2-second windows at
     * different points in a run earn different amounts even with no multiplier
     * at all. A first version of this test compared 4–6 s against 9–11 s and
     * read the curve as a leftover multiplier.
     */
    const base = advance(runningState(), 2_000)
    const settle = TUNING.slayyy.durationMs + 500

    const spent = advance(step(armed(base), [{ type: 'slayyy' }], STEP_MS), settle)
    const plain = advance(base, settle)

    expect(spent.slayyy.phase).not.toBe('active')

    const spentGain = scoreTotal(advance(spent, 2_000)) - scoreTotal(spent)
    const plainGain = scoreTotal(advance(plain, 2_000)) - scoreTotal(plain)

    // Same elapsed time, same speed, no multiplier on either side.
    expect(Math.abs(spentGain - plainGain)).toBeLessThanOrEqual(2)
  })

  it('doubles a token taken on the very step the window closes', () => {
    /*
     * The collection boundary, which the distance boundary above does not cover.
     *
     * `step()` resolves collection (8) before it runs the active window down
     * (9), so a token taken on the expiring step is earned while the power is
     * still active and is worth ×2 — the same rule distance follows, settled at
     * the rate that applied while it happened. Worth pinning because the two
     * are decided in different places and could drift apart.
     */
    const base = runningState()
    const armed: RunState = {
      ...base,
      slayyy: { phase: 'active', chargeMicro: 0, activeRemainingMs: STEP_MS / 2 },
      pawTokens: [Object.freeze({
        id: 0, lane: 1, laneOffset: 1, distanceUnits: 0, outcome: 'pending' as const,
      })],
    }

    const after = step(armed, [], STEP_MS)

    expect(after.runPaws, 'the token must have been taken').toBe(1)
    expect(after.slayyy.phase, 'and the window must have closed on the same step').not.toBe('active')
    expect(scoreComponents(after).collection)
      .toBe(TUNING.score.perPaw * TUNING.score.slayyyMultiplier)
  })

  it('pays a token taken one step later at the plain rate', () => {
    // The other side of the same boundary: once the window has closed, a token
    // is worth exactly one paw.
    const base = runningState()
    const spent = step({
      ...base,
      slayyy: { phase: 'active', chargeMicro: 0, activeRemainingMs: STEP_MS / 2 },
    }, [], STEP_MS)

    const after = step({
      ...spent,
      pawTokens: [Object.freeze({
        id: 0, lane: 1, laneOffset: 1, distanceUnits: 0, outcome: 'pending' as const,
      })],
    }, [], STEP_MS)

    expect(after.runPaws).toBe(1)
    expect(scoreComponents(after).collection).toBe(TUNING.score.perPaw)
  })

  it('is never more than ×2, even with Loli overlapping', () => {
    /*
     * The x4 case. Loli grants no multiplier at all, so an overlap must earn
     * exactly what SLAYYY alone earns — this is the assertion that fails if
     * anyone ever multiplies the two together.
     */
    const base = advance(runningState(), 2_000)
    const before = scoreTotal(base)

    const slayyyOnly = advance(armed(base), 2_000, [{ type: 'slayyy' }])

    const withLoli = advance(
      { ...armed(base), loli: { phase: 'active', phaseRemainingMs: TUNING.loli.durationMs, queuedLoliBonuses: 0 } },
      2_000,
      [{ type: 'slayyy' }],
    )

    expect(withLoli.loli.phase).toBe('active')
    expect(withLoli.slayyy.phase).toBe('active')

    const slayyyGain = scoreTotal(slayyyOnly) - before
    const overlapGain = scoreTotal(withLoli) - before

    // Collection may differ if the magnet swept a token, so compare the
    // component the overlap cannot touch.
    const slayyyDistance = scoreComponents(slayyyOnly).distance
    const overlapDistance = scoreComponents(withLoli).distance

    expect(overlapDistance).toBe(slayyyDistance)
    expect(overlapGain).toBeGreaterThanOrEqual(slayyyGain)
  })
})

describe('a near miss is still worth nothing', () => {
  it('awards no score however many it earns', () => {
    /*
     * M6 made this structural by there being no score. There is a score now,
     * so the rule needs an actual test: run until near misses have happened
     * and assert the collectible and bonus components never moved for them.
     */
    let state = runningState(7)

    for (let i = 0; i < 8_000 && state.nearMissCount === 0; i++) {
      state = step(state, [], STEP_MS)
    }

    expect(state.nearMissCount).toBeGreaterThan(0)
    expect(scoreComponents(state).bonus).toBe(0)
    // Collection score comes from tokens alone; it must equal the paws taken.
    expect(scoreComponents(state).collection).toBe(state.runPaws * TUNING.score.perPaw)
  })
})
