import { describe, expect, it } from 'vitest'
import { protectionSources } from './collision'
import { chargeCeilingMicro, chargeFraction } from './slayyy'
import { createRunState } from './state'
import { step } from './step'
import { STEP_MS, TUNING } from './tuning'
import type { Obstacle, RunState } from './types'

/**
 * SLAYYY: the meter, the window, and who is protecting the player.
 *
 * The invariant this file exists to hold is the last group: **protection has a
 * provenance**. Post-hit recovery and SLAYYY are two independent clocks, and
 * collapsing them into one boolean would let a five-second power silently
 * refresh a 1.2-second recovery window, or end one when the other expires.
 * They are tested as two facts because they are two facts.
 */

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

/** A meter one press away from firing. */
function armed(state: RunState): RunState {
  return { ...state, slayyy: { ...state.slayyy, phase: 'ready', chargeMicro: chargeCeilingMicro() } }
}

function blocker(lane: number, id = 500): Obstacle {
  return Object.freeze({
    id,
    kind: 'lane_blocking' as const,
    lane: lane as 0 | 1 | 2,
    distanceUnits: 0,
    lengthUnits: TUNING.obstacle.defaultLengthUnits,
    outcome: 'pending' as const,
  })
}

describe('the meter', () => {
  it('starts empty on every run', () => {
    const state = createRunState({ seed: 1 })

    expect(state.slayyy.chargeMicro).toBe(0)
    expect(state.slayyy.phase).toBe('charging')
    expect(chargeFraction(state.slayyy)).toBe(0)
  })

  it('fills from surviving time', () => {
    const after = advance(runningState(), 5_000)

    expect(after.slayyy.chargeMicro).toBeGreaterThan(0)
  })

  it('fills faster when Paw Tokens are collected', () => {
    const base = runningState()
    const plain = advance(base, 400)

    const collected = advance({
      ...base,
      pawTokens: [Object.freeze({ id: 0, lane: 1 as const, laneOffset: 1, distanceUnits: 0, outcome: 'pending' as const })],
    }, 400)

    expect(collected.runPaws).toBe(1)
    expect(collected.slayyy.chargeMicro).toBeGreaterThan(plain.slayyy.chargeMicro)
  })

  it('tracks the documented per-second rate', () => {
    const seconds = 10
    const after = advance(runningState(), seconds * 1000)

    // No tokens are guaranteed in a given window, so compare against at least
    // the time-only contribution rather than an exact figure.
    const fromTime = TUNING.slayyy.chargePerSecond * seconds

    expect(chargeFraction(after.slayyy) * TUNING.slayyy.chargeMax).toBeGreaterThanOrEqual(fromTime * 0.95)
  })

  it('never exceeds a full meter, however much is added', () => {
    const state = advance(armed(runningState()), 5_000)

    expect(state.slayyy.chargeMicro).toBeLessThanOrEqual(chargeCeilingMicro())
    expect(chargeFraction(state.slayyy)).toBeLessThanOrEqual(1)
  })

  it('arms itself when it fills, and does not fire', () => {
    /*
     * The single most important negative in the milestone: reaching full
     * *arms* the power. `slayyy.autoActivate` is APPROVED false.
     */
    let state = runningState()

    for (let i = 0; i < 20_000 && state.slayyy.phase === 'charging'; i++) {
      state = step(state, [], STEP_MS)

      if (state.phase === 'ended') state = { ...state, phase: 'running', hearts: TUNING.hearts.max }
    }

    expect(state.slayyy.phase).toBe('ready')
    expect(state.slayyyActivations).toBe(0)
    expect(state.slayyy.activeRemainingMs).toBe(0)
  })

  it('does not fill while the power is running', () => {
    const active = step(armed(runningState()), [{ type: 'slayyy' }], STEP_MS)

    expect(active.slayyy.chargeMicro).toBe(0)

    const later = advance(active, 2_000)

    expect(later.slayyy.phase).toBe('active')
    expect(later.slayyy.chargeMicro).toBe(0)
  })

  it('does not fill while paused', () => {
    const running = advance(runningState(), 2_000)
    const paused = step(running, [{ type: 'pause' }], STEP_MS)
    const charge = paused.slayyy.chargeMicro

    let held = paused

    for (let i = 0; i < 200; i++) held = step(held, [], STEP_MS)

    expect(held.slayyy.chargeMicro).toBe(charge)
  })
})

describe('activation', () => {
  it('fires on the input, once, and spends the meter', () => {
    const fired = step(armed(runningState()), [{ type: 'slayyy' }], STEP_MS)

    expect(fired.slayyy.phase).toBe('active')
    expect(fired.slayyyActivations).toBe(1)
    expect(fired.slayyy.chargeMicro).toBe(0)
  })

  it('ignores a press while still charging', () => {
    const state = advance(runningState(), 1_000)

    expect(state.slayyy.phase).toBe('charging')

    const pressed = step(state, [{ type: 'slayyy' }], STEP_MS)

    expect(pressed.slayyy.phase).toBe('charging')
    expect(pressed.slayyyActivations).toBe(0)
  })

  it('ignores a repeated press while already active', () => {
    /*
     * Key repeat. A held `E` delivers the same intent many times a second; the
     * second and later ones must be deterministic no-ops rather than extending
     * or restarting the window.
     */
    const active = step(armed(runningState()), [{ type: 'slayyy' }], STEP_MS)
    const remaining = active.slayyy.activeRemainingMs

    const spammed = step(active, [
      { type: 'slayyy' }, { type: 'slayyy' }, { type: 'slayyy' },
    ], STEP_MS)

    expect(spammed.slayyyActivations).toBe(1)
    expect(spammed.slayyy.activeRemainingMs).toBeLessThan(remaining)
  })

  it('ignores a press while paused, and does not leak it through the resume', () => {
    const ready = armed(advance(runningState(), 1_000))
    const paused = step(ready, [{ type: 'pause' }], STEP_MS)

    const pressed = step(paused, [{ type: 'slayyy' }], STEP_MS)

    expect(pressed.slayyy.phase).toBe('ready')
    expect(pressed.slayyyActivations).toBe(0)

    const resumed = step(pressed, [{ type: 'resume' }], STEP_MS)

    expect(resumed.slayyyActivations, 'nothing was buffered to fire later').toBe(0)
    expect(resumed.slayyy.phase).toBe('ready')
  })

  it('cannot be activated once the run has ended', () => {
    const ready = armed(runningState())
    const ended: RunState = { ...ready, phase: 'ended', hearts: 0 }

    const pressed = step(ended, [{ type: 'slayyy' }], STEP_MS)

    expect(pressed.slayyyActivations).toBe(0)
    expect(pressed.slayyy.phase).toBe('ready')
  })

  it('can be used again later in the same run once the meter refills', () => {
    let state = step(armed(runningState()), [{ type: 'slayyy' }], STEP_MS)

    state = advance(state, TUNING.slayyy.durationMs + 200)
    expect(state.slayyy.phase).toBe('charging')

    state = step(armed(state), [{ type: 'slayyy' }], STEP_MS)

    expect(state.slayyyActivations).toBe(2)
  })
})

describe('the active window', () => {
  it('runs for approximately the approved duration', () => {
    let state = step(armed(runningState()), [{ type: 'slayyy' }], STEP_MS)
    let activeMs = STEP_MS

    while (state.slayyy.phase === 'active' && activeMs < TUNING.slayyy.durationMs * 2) {
      state = step(state, [], STEP_MS)

      if (state.phase === 'ended') state = { ...state, phase: 'running', hearts: TUNING.hearts.max }

      activeMs += STEP_MS
    }

    expect(activeMs).toBeGreaterThan(TUNING.slayyy.durationMs - STEP_MS * 2)
    expect(activeMs).toBeLessThan(TUNING.slayyy.durationMs + STEP_MS * 2)
  })

  it('freezes while paused', () => {
    const active = step(armed(runningState()), [{ type: 'slayyy' }], STEP_MS)
    const paused = step(active, [{ type: 'pause' }], STEP_MS)
    const remaining = paused.slayyy.activeRemainingMs

    let held = paused

    for (let i = 0; i < 300; i++) held = step(held, [], STEP_MS)

    expect(held.slayyy.phase).toBe('active')
    expect(held.slayyy.activeRemainingMs).toBe(remaining)
  })

  it('leaves no lingering cooldown', () => {
    // The fourth state is named but transient: the specification's only
    // re-activation rule is "once the meter refills", so a lockout would be an
    // invented mechanic.
    const spent = advance(step(armed(runningState()), [{ type: 'slayyy' }], STEP_MS), TUNING.slayyy.durationMs + 200)

    expect(spent.slayyy.phase).toBe('charging')
  })
})

describe('protection, and where it comes from', () => {
  it('prevents damage while active', () => {
    const active = step(armed(runningState()), [{ type: 'slayyy' }], STEP_MS)
    const hearts = active.hearts

    const hit = step({ ...active, obstacles: [blocker(active.lane)] }, [], STEP_MS)

    expect(hit.hearts).toBe(hearts)
  })

  it('does not heal, and does not add a heart', () => {
    const hurt: RunState = { ...runningState(), hearts: 1 }
    const active = step(armed(hurt), [{ type: 'slayyy' }], STEP_MS)

    expect(active.hearts).toBe(1)

    const survived = advance(active, TUNING.slayyy.durationMs + 200)

    expect(survived.hearts).toBe(1)
  })

  it('does not start a recovery window for a collision it absorbed', () => {
    /*
     * A collision during SLAYYY is not damage, so it must not leave the player
     * with a post-hit recovery window they never earned — that would extend
     * their protection past the power for free.
     */
    const active = step(armed(runningState()), [{ type: 'slayyy' }], STEP_MS)

    const hit = step({ ...active, obstacles: [blocker(active.lane)] }, [], STEP_MS)

    expect(hit.invulnRemainingMs).toBe(0)
    expect(protectionSources(hit)).toEqual({ hitRecovery: false, slayyy: true })
  })

  it('does not refresh or extend the power', () => {
    const active = step(armed(runningState()), [{ type: 'slayyy' }], STEP_MS)
    const before = active.slayyy.activeRemainingMs

    const hit = step({ ...active, obstacles: [blocker(active.lane)] }, [], STEP_MS)

    expect(hit.slayyy.activeRemainingMs).toBeLessThan(before)
  })

  it('leaves the player vulnerable again the moment it ends', () => {
    const active = step(armed(runningState()), [{ type: 'slayyy' }], STEP_MS)
    const spent = advance(active, TUNING.slayyy.durationMs + 200)

    expect(protectionSources(spent)).toEqual({ hitRecovery: false, slayyy: false })

    const hearts = spent.hearts
    const hit = step({ ...spent, obstacles: [blocker(spent.lane)] }, [], STEP_MS)

    expect(hit.hearts).toBe(hearts - 1)
  })

  it('keeps hit recovery running on its own clock when the power ends first', () => {
    /*
     * Recovery is 1.2 s and the power is 5 s, so the natural case is the power
     * outlasting it. This is the reverse: a recovery window started just before
     * the power expires must survive the expiry with its own time left.
     */
    const active = step(armed(runningState()), [{ type: 'slayyy' }], STEP_MS)
    const nearEnd = advance(active, TUNING.slayyy.durationMs - 300)

    expect(nearEnd.slayyy.phase).toBe('active')

    // Grant a fresh recovery window directly: a collision during SLAYYY
    // deliberately does not create one, so this is the only honest way to make
    // the two clocks overlap.
    const overlapping: RunState = { ...nearEnd, invulnRemainingMs: TUNING.invuln.postHitMs }
    const afterExpiry = advance(overlapping, 400)

    expect(afterExpiry.slayyy.phase).not.toBe('active')
    expect(afterExpiry.invulnRemainingMs).toBeGreaterThan(0)
    expect(protectionSources(afterExpiry)).toEqual({ hitRecovery: true, slayyy: false })
  })

  it('keeps the power running when hit recovery ends first', () => {
    const hit = step({ ...runningState(), obstacles: [blocker(runningState().lane)] }, [], STEP_MS)

    expect(hit.invulnRemainingMs).toBeGreaterThan(0)

    const active = step(armed(hit), [{ type: 'slayyy' }], STEP_MS)
    const later = advance(active, TUNING.invuln.postHitMs + 200)

    expect(later.invulnRemainingMs).toBe(0)
    expect(later.slayyy.phase).toBe('active')
    expect(protectionSources(later)).toEqual({ hitRecovery: false, slayyy: true })
  })
})

describe('the run ending', () => {
  it('closes an active window without granting anything further', () => {
    const active = step(armed({ ...runningState(), hearts: 1 }), [{ type: 'slayyy' }], STEP_MS)

    expect(active.slayyy.phase).toBe('active')

    // End the run by draining the last heart after the power expires.
    let state = advance(active, TUNING.slayyy.durationMs + 200)

    state = step({ ...state, obstacles: [blocker(state.lane)] }, [], STEP_MS)

    expect(state.phase).toBe('ended')
    expect(state.slayyy.phase).not.toBe('active')
    expect(state.slayyyActivations, 'the activation still happened').toBe(1)
  })

  it('does not advance the meter after the run has ended', () => {
    let state = runningState()

    for (let i = 0; i < 12_000 && state.phase !== 'ended'; i++) state = step(state, [], STEP_MS)

    expect(state.phase).toBe('ended')

    const charge = state.slayyy.chargeMicro

    for (let i = 0; i < 500; i++) state = step(state, [], STEP_MS)

    expect(state.slayyy.chargeMicro).toBe(charge)
  })
})
