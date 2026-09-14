import { describe, expect, it } from 'vitest'
import { createRunState } from './state'
import { step } from './step'
import { STEP_MS, TUNING } from './tuning'
import { intent } from '../../tests/support/scripted-player'
import type { Style } from '../../tests/support/scripted-player'

/**
 * When the power first becomes available, measured rather than asserted.
 *
 * The approved target is a **UX target, not a timer**: the first activation
 * should normally become available somewhere around 35–45 s of a representative
 * healthy run. Nothing in the domain knows that number — READY arises only from
 * the meter filling — so the only honest way to hold the target is to play the
 * game and look.
 *
 * Which means the scripted players below are the load-bearing part of this file.
 * "A representative healthy run" is not a property of a seed; it is a property
 * of how well the player collects, so the range is bracketed by four styles and
 * the target is asserted against the one that represents it.
 *
 * These live in a spec rather than beside the rules deliberately: they are
 * measuring instruments, not gameplay, and nothing shipped may depend on them.
 */

interface Readiness {
  /** Seconds of *running* time before the meter first armed. */
  readonly readyAtS: number
  /** Paws taken by that moment. */
  readonly pawsAtReady: number
}

/**
 * Play until the meter arms, and report when.
 *
 * The player is revived rather than allowed to end the run: this measures the
 * charge model, and a run that ends at twenty seconds says nothing about a
 * forty-second target. Only running time counts, so the readiness beat and any
 * pause are excluded — exactly as the charge itself excludes them.
 */
function firstReady(seed: number, style: Style, tokensEnabled = true): Readiness {
  let state = createRunState({ seed })
  let runningMs = 0

  for (let i = 0; i < 40_000; i++) {
    state = step(tokensEnabled ? state : { ...state, pawTokens: [] }, intent(state, style), STEP_MS)

    if (state.phase === 'running') runningMs += STEP_MS

    if (state.phase === 'ended') {
      state = { ...state, phase: 'running', hearts: TUNING.hearts.max, invulnRemainingMs: 0 }
    }

    if (state.slayyy.phase === 'ready') {
      return { readyAtS: runningMs / 1000, pawsAtReady: state.runPaws }
    }
  }

  throw new Error(`the meter never armed for a ${style} player on seed ${seed}`)
}

const SEEDS = [1, 2, 3]

/** The approved UX window for a representative healthy run. */
const TARGET_MIN_S = 35
const TARGET_MAX_S = 45

describe('the first activation arrives when the product expects it', () => {
  it('arms inside the approved window on a representative healthy run', () => {
    for (const seed of SEEDS) {
      const { readyAtS } = firstReady(seed, 'healthy')

      expect(readyAtS, `seed ${seed} armed at ${readyAtS.toFixed(1)}s`)
        .toBeGreaterThanOrEqual(TARGET_MIN_S)
      expect(readyAtS, `seed ${seed} armed at ${readyAtS.toFixed(1)}s`)
        .toBeLessThanOrEqual(TARGET_MAX_S)
    }
  })

  it('rewards collecting: more paws is never slower', () => {
    /*
     * The approved direction, not a magnitude. `chargePerPaw` used to be 0.45
     * against a 100 meter, which made the collectible loop worth about seven
     * percent of the fill — the rate was nominally "rewarding engagement" and
     * in practice indistinguishable from standing still.
     */
    for (const seed of SEEDS) {
      const aggressive = firstReady(seed, 'aggressive')
      const healthy = firstReady(seed, 'healthy')
      const avoidant = firstReady(seed, 'avoidant')

      expect(aggressive.pawsAtReady).toBeGreaterThan(avoidant.pawsAtReady)
      expect(aggressive.readyAtS, `seed ${seed}`).toBeLessThanOrEqual(healthy.readyAtS)
      expect(healthy.readyAtS, `seed ${seed}`).toBeLessThan(avoidant.readyAtS)
    }
  })

  it('makes a player who collects nothing wait past the window', () => {
    // The floor of the model: time alone. `chargeMax / chargePerSecond`, which
    // must sit clearly outside the target or the paw term is decoration.
    const { readyAtS, pawsAtReady } = firstReady(1, 'passive', false)

    expect(pawsAtReady).toBe(0)
    expect(readyAtS).toBeGreaterThan(TARGET_MAX_S)
    expect(readyAtS).toBeCloseTo(TUNING.slayyy.chargeMax / TUNING.slayyy.chargePerSecond, 0)
  })

  it('still never fires on its own, however fast it fills', () => {
    let state = createRunState({ seed: 1 })

    for (let i = 0; i < 20_000; i++) {
      state = step(state, intent(state, 'aggressive'), STEP_MS)

      if (state.phase === 'ended') {
        state = { ...state, phase: 'running', hearts: TUNING.hearts.max, invulnRemainingMs: 0 }
      }

      expect(state.slayyyActivations, `step ${i}`).toBe(0)
      expect(state.slayyy.phase).not.toBe('active')
    }

    expect(state.slayyy.phase).toBe('ready')
  })
})
