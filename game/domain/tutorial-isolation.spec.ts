import { describe, expect, it } from 'vitest'
import { createRngState } from './rng'
import { createRunState } from './state'
import { step } from './step'
import { STEP_MS, TUNING } from './tuning'
import type { InputEvent, RunState } from './types'

/**
 * What a tutorial is allowed to leave behind: nothing.
 *
 * The tutorial runs inside the real rules, so it genuinely scores, genuinely
 * collects and genuinely spends a meter. None of that may reach the game. This
 * file is the adversarial half of that claim — it plays a tutorial hard, then
 * asks what survived.
 *
 * The structural answer is that a `RunState` is created once per run and the
 * tutorial's is thrown away, so there is no mechanism by which it could carry.
 * These tests exist because "there is no mechanism" is exactly the kind of
 * claim that stops being true quietly.
 */

const SEED = 4242

function playTutorial(steps: number, drive: (s: RunState) => InputEvent[] = () => []): RunState {
  let state = createRunState({ seed: SEED, mode: 'tutorial' })

  for (let i = 0; i < steps; i++) state = step(state, drive(state), STEP_MS)

  return state
}

/** Every reachable node of a state, so nothing nested can be missed. */
function walk(value: unknown, path: string, out: string[]): void {
  if (value === null || typeof value !== 'object') return

  if (!Object.isFrozen(value)) out.push(path)

  if (Array.isArray(value)) {
    value.forEach((entry, i) => walk(entry, `${path}[${i}]`, out))

    return
  }

  for (const [key, entry] of Object.entries(value)) walk(entry, `${path}.${key}`, out)
}

describe('a tutorial draws no randomness at all', () => {
  it('leaves all three streams exactly where they started', () => {
    const state = playTutorial(Math.round((90 * 1000) / STEP_MS))

    /*
     * The generator is off, and the tutorial's own director places props from a
     * script rather than a draw — so a tutorial of any length consumes nothing.
     * This is what makes the authored road authored rather than merely
     * different, and it is the strongest available statement that a tutorial
     * cannot inherit a hazard it did not choose.
     */
    expect(state.rng).toEqual(createRngState(SEED))
    expect(state.spawn.recentPatternIds).toEqual([])
    expect(state.spawn.nextAtUnits).toBe(createRunState({ seed: SEED }).spawn.nextAtUnits)
  })

  it('places every prop from the script, and never from the pattern pool', () => {
    const state = playTutorial(Math.round((90 * 1000) / STEP_MS))

    // A generated pattern would have recorded its id for the repeat cooldown.
    expect(state.spawn.recentPatternIds).toHaveLength(0)
    // And the paw generator's cursor would have moved.
    expect(state.nextPawAtUnits).toBe(createRunState({ seed: SEED }).nextPawAtUnits)
  })
})

describe('nothing a tutorial does reaches a normal run', () => {
  it('starts a fresh run from the authoritative initial state, whatever came before', () => {
    // Play a whole tutorial, taking the paw and firing the meter.
    playTutorial(Math.round((120 * 1000) / STEP_MS))

    const fresh = createRunState({ seed: 99 })

    expect(fresh.tutorial).toBeNull()
    expect(fresh.hearts).toBe(TUNING.hearts.start)
    expect(fresh.runPaws).toBe(0)
    expect(fresh.loliCyclePaws).toBe(0)
    expect(fresh.slayyy.chargeMicro).toBe(0)
    expect(fresh.slayyy.phase).toBe('charging')
    expect(fresh.slayyyActivations).toBe(0)
    expect(fresh.loliActivations).toBe(0)
    expect(fresh.score).toEqual({ distanceMilli: 0, collectionMilli: 0, bonusMilli: 0 })
    expect(fresh.nearMissCount).toBe(0)
    expect(fresh.obstacles).toEqual([])
    expect(fresh.pawTokens).toEqual([])
  })

  it('cannot prime a normal run, because a run state is never reused', () => {
    /*
     * The real guarantee, stated as a test: there is no function that turns a
     * tutorial state into a run state. `createRunState` is the only
     * constructor, it takes the mode, and it builds from constants — so the
     * only way a tutorial fact could reach a run is if someone wrote a new path
     * for it to travel.
     */
    const tutorial = playTutorial(Math.round((60 * 1000) / STEP_MS))
    const run = createRunState({ seed: tutorial.seed })

    expect(run).not.toBe(tutorial)
    expect(run.tutorial).toBeNull()
    expect(run.elapsedMs).toBe(0)
    expect(run.distanceUnits).toBe(0)
  })

  it('never earns a Loli threshold, so no entitlement can be carried', () => {
    const state = playTutorial(Math.round((120 * 1000) / STEP_MS))

    // One scripted token cannot reach a 200-paw threshold, and the cycle is
    // seeded at zero because the app passes nothing.
    expect(state.loliCyclePaws).toBeLessThan(TUNING.paw.loliThreshold)
    expect(state.loliActivations).toBe(0)
    expect(state.loli.queuedLoliBonuses).toBe(0)
  })
})

describe('the state is frozen all the way down', () => {
  /**
   * `sealState` is a hand-written walk, and its own comment says a new nested
   * field ships unfrozen with nothing complaining. This is the check that makes
   * that impossible — generic, so the next field is covered before anyone
   * remembers to cover it.
   */
  it('has no mutable node anywhere in a tutorial run', () => {
    const state = playTutorial(Math.round((30 * 1000) / STEP_MS))
    const unfrozen: string[] = []

    walk(state, 'state', unfrozen)

    expect(unfrozen).toEqual([])
  })

  it('has no mutable node anywhere in a normal run', () => {
    let state = createRunState({ seed: SEED })

    for (let i = 0; i < Math.round((30 * 1000) / STEP_MS); i++) {
      state = step(state, [], STEP_MS)
    }

    const unfrozen: string[] = []

    walk(state, 'state', unfrozen)

    expect(unfrozen).toEqual([])
  })
})

describe('the tutorial mode is opt-in', () => {
  it('is absent unless asked for', () => {
    expect(createRunState({ seed: SEED }).tutorial).toBeNull()
    expect(createRunState({ seed: SEED, mode: 'run' }).tutorial).toBeNull()
    expect(createRunState({ seed: SEED, mode: 'tutorial' }).tutorial).not.toBeNull()
  })

  it('leaves a normal run able to lose hearts and end, exactly as before', () => {
    // The damage bypass is guarded on the mode, so a normal run must still be
    // mortal. A tutorial that accidentally disabled damage everywhere would
    // pass every tutorial test in this directory.
    let state = createRunState({ seed: SEED })

    for (let i = 0; i < Math.round((90 * 1000) / STEP_MS) && state.phase !== 'ended'; i++) {
      state = step(state, [], STEP_MS)
    }

    expect(state.hearts).toBe(0)
    expect(state.phase).toBe('ended')
  })
})
