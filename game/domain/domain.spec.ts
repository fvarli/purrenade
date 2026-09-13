import { describe, expect, it } from 'vitest'
import {
  LANE_CENTER,
  LANE_LEFT,
  LANE_RIGHT,
  STEP_MS,
  TUNING,
  canJump,
  createRunState,
  isAirborne,
  jumpHeightPx,
  laneProgress,
  occupiedLane,
  step,
} from './index'
import type { InputEvent, RunState } from './index'

/**
 * The game rules, tested without Phaser.
 *
 * That is an M5 acceptance criterion in its own right — *"game rules run and are
 * tested without Phaser"* — and it is why these live beside the code rather
 * than under `tests/`: the `unit` Vitest project runs in Node with no DOM, so a
 * browser dependency creeping into the domain fails here rather than being
 * discovered at M6 when the property tests need to run ten thousand times.
 */

/** A run already past the readiness beat, so tests can start from movement. */
function runningState(seed = 1): RunState {
  let state = createRunState({ seed })

  while (state.phase !== 'running') {
    state = step(state, [], STEP_MS)
  }

  return state
}

/**
 * Drive the simulation for at least `ms`, at the fixed step.
 *
 * At least, not exactly: the step is 8.33 ms and most durations are not a
 * multiple of it, so stopping short would leave a transition one step from
 * settling and make the assertions depend on that arithmetic rather than on
 * the rules.
 */
function advance(state: RunState, ms: number, inputs: readonly InputEvent[] = []): RunState {
  let next = step(state, inputs, STEP_MS)
  let elapsed = STEP_MS

  while (elapsed < ms) {
    next = step(next, [], STEP_MS)
    elapsed += STEP_MS
  }

  return next
}

describe('the readiness beat', () => {
  it('starts a run in the centre lane, grounded, not yet interactive', () => {
    const state = createRunState({ seed: 42 })

    expect(state.phase).toBe('ready')
    expect(state.lane).toBe(LANE_CENTER)
    expect(state.jumpElapsedMs).toBeNull()
    expect(state.elapsedMs).toBe(0)
  })

  it('becomes interactive after the configured beat', () => {
    const state = advance(createRunState({ seed: 1 }), TUNING.run.readyMs + STEP_MS)

    expect(state.phase).toBe('running')
  })

  it('accepts input during the beat — it withholds hazards, not the controls', () => {
    const state = step(createRunState({ seed: 1 }), [{ type: 'move_left' }], STEP_MS)

    expect(state.laneTransition).not.toBeNull()
    expect(state.laneTransition?.to).toBe(LANE_LEFT)
  })

  it('resolves a lane change begun during the beat, rather than freezing it', () => {
    // The bug this guards: advancing the clock but not the movement while
    // `ready` would leave an accepted input visibly doing nothing.
    let state = step(createRunState({ seed: 1 }), [{ type: 'move_left' }], STEP_MS)
    state = advance(state, TUNING.lane.transitionMs)

    expect(state.lane).toBe(LANE_LEFT)
    expect(state.laneTransition).toBeNull()
    expect(state.phase).toBe('ready')
  })

  it('does not accrue run time until the run is interactive', () => {
    const state = advance(createRunState({ seed: 1 }), TUNING.run.readyMs / 2)

    expect(state.phase).toBe('ready')
    expect(state.elapsedMs).toBe(0)
  })

  it('carries the overshoot into run time rather than discarding it', () => {
    // A beat that ends mid-step has left some of that step as run time. Losing
    // it would make elapsed time depend on where the step boundary fell.
    let state = createRunState({ seed: 1 })
    let steps = 0

    while (state.phase === 'ready') {
      state = step(state, [], STEP_MS)
      steps++
    }

    const simulated = steps * STEP_MS

    expect(state.elapsedMs).toBeCloseTo(simulated - TUNING.run.readyMs, 9)
    expect(state.elapsedMs).toBeGreaterThan(0)
    expect(state.elapsedMs).toBeLessThan(STEP_MS)
  })
})

describe('lane movement', () => {
  it('moves exactly one lane per input', () => {
    let state = advance(runningState(), TUNING.lane.transitionMs, [{ type: 'move_right' }])

    expect(state.lane).toBe(LANE_RIGHT)

    state = advance(state, TUNING.lane.transitionMs, [{ type: 'move_left' }])

    expect(state.lane).toBe(LANE_CENTER)
  })

  it('clamps at the left edge as a no-op, not an error', () => {
    let state = advance(runningState(), TUNING.lane.transitionMs, [{ type: 'move_left' }])

    expect(state.lane).toBe(LANE_LEFT)

    state = advance(state, TUNING.lane.transitionMs, [{ type: 'move_left' }])

    expect(state.lane).toBe(LANE_LEFT)
    expect(state.laneTransition).toBeNull()
  })

  it('clamps at the right edge as a no-op, not an error', () => {
    let state = advance(runningState(), TUNING.lane.transitionMs, [{ type: 'move_right' }])
    state = advance(state, TUNING.lane.transitionMs, [{ type: 'move_right' }])

    expect(state.lane).toBe(LANE_RIGHT)
    expect(state.laneTransition).toBeNull()
  })

  it('does not buffer a movement that would run into the edge', () => {
    // A player holding left at the left wall must not lurch left the instant a
    // gap appears. The no-op is discarded, not remembered.
    let state = advance(runningState(), TUNING.lane.transitionMs, [{ type: 'move_left' }])
    state = step(state, [{ type: 'move_left' }], STEP_MS)

    expect(state.buffered).toBeNull()
  })

  it('ignores a second lane input while one is already resolving', () => {
    let state = step(runningState(), [{ type: 'move_right' }], STEP_MS)
    const target = state.laneTransition?.to

    state = step(state, [{ type: 'move_right' }], STEP_MS)

    expect(state.laneTransition?.to).toBe(target)
  })

  it('switches the collision lane at the midpoint, not at either end', () => {
    let state = step(runningState(), [{ type: 'move_right' }], STEP_MS)

    const switchAt = TUNING.lane.transitionMs * TUNING.lane.occupancySwitchAtRatio

    // Just before the midpoint: still in the lane being left.
    state = advance(state, switchAt - STEP_MS * 2)
    expect(occupiedLane(state)).toBe(LANE_CENTER)

    // Past it: committed to the new lane, though the transition is unfinished.
    state = advance(state, STEP_MS * 4)
    expect(occupiedLane(state)).toBe(LANE_RIGHT)
    expect(state.laneTransition).not.toBeNull()
  })

  it('reports linear progress for the renderer to ease', () => {
    let state = step(runningState(), [{ type: 'move_right' }], STEP_MS)
    state = advance(state, TUNING.lane.transitionMs / 2)

    expect(laneProgress(state)).toBeGreaterThan(0.4)
    expect(laneProgress(state)).toBeLessThan(0.7)
  })
})

describe('jump', () => {
  it('leaves the ground and lands again', () => {
    let state = step(runningState(), [{ type: 'jump' }], STEP_MS)

    expect(isAirborne(state)).toBe(true)

    state = advance(state, TUNING.jump.airborneMs)

    expect(isAirborne(state)).toBe(false)
  })

  it('is airborne for the approved ~650 ms', () => {
    let state = step(runningState(), [{ type: 'jump' }], STEP_MS)
    let airborneMs = STEP_MS

    while (isAirborne(state)) {
      state = step(state, [], STEP_MS)
      airborneMs += STEP_MS
    }

    // Within one simulation step of the approved target.
    expect(airborneMs).toBeGreaterThanOrEqual(TUNING.jump.airborneMs)
    expect(airborneMs).toBeLessThan(TUNING.jump.airborneMs + STEP_MS * 2)
  })

  it('reaches the apex height at the midpoint of the arc', () => {
    let state = step(runningState(), [{ type: 'jump' }], STEP_MS)
    let peak = 0

    while (isAirborne(state)) {
      peak = Math.max(peak, jumpHeightPx(state))
      state = step(state, [], STEP_MS)
    }

    expect(peak).toBeCloseTo(TUNING.jump.apexHeightPx, 0)
  })

  it('never dips below the ground, including at the very end of the arc', () => {
    let state = step(runningState(), [{ type: 'jump' }], STEP_MS)

    while (isAirborne(state)) {
      expect(jumpHeightPx(state)).toBeGreaterThanOrEqual(0)
      state = step(state, [], STEP_MS)
    }

    expect(jumpHeightPx(state)).toBe(0)
  })

  it('refuses a double jump', () => {
    let state = step(runningState(), [{ type: 'jump' }], STEP_MS)
    state = advance(state, TUNING.jump.airborneMs / 2)

    const heightBefore = jumpHeightPx(state)
    const elapsedBefore = state.jumpElapsedMs

    state = step(state, [{ type: 'jump' }], STEP_MS)

    expect(state.jumpElapsedMs).toBeCloseTo((elapsedBefore ?? 0) + STEP_MS, 9)
    expect(jumpHeightPx(state)).not.toBe(heightBefore)
    expect(canJump(state)).toBe(false)
  })

  it('does not change lane by itself', () => {
    const state = advance(runningState(), TUNING.jump.airborneMs, [{ type: 'jump' }])

    expect(state.lane).toBe(LANE_CENTER)
  })

  it('permits a lane change while airborne', () => {
    // CR-1, PROPOSED true. Forbidding it turns every jump into a commitment
    // trap once M6 combines a jumpable obstacle with a lane-only one.
    let state = step(runningState(), [{ type: 'jump' }], STEP_MS)
    state = step(state, [{ type: 'move_left' }], STEP_MS)

    expect(state.laneTransition?.to).toBe(LANE_LEFT)
    expect(isAirborne(state)).toBe(true)
  })
})

describe('the input buffer', () => {
  it('fires a lane change queued late in another, on the step it settles', () => {
    // A jump would not do: jumping during a lane change is legal, so it fires
    // immediately and never reaches the buffer. Only a second lane change is
    // genuinely blocked.
    //
    // Starting from the left lane so both moves are real — from the centre the
    // second would clamp at the edge and the test would prove nothing.
    let state = advance(runningState(), TUNING.lane.transitionMs, [{ type: 'move_left' }])
    expect(state.lane).toBe(LANE_LEFT)

    state = step(state, [{ type: 'move_right' }], STEP_MS)

    // Queued inside the buffer window, measured back from the end of the
    // transition. See the expiry test below for why that qualifier matters.
    state = advance(state, TUNING.lane.transitionMs - TUNING.input.bufferMs)
    state = step(state, [{ type: 'move_right' }], STEP_MS)

    expect(state.buffered?.event.type).toBe('move_right')
    expect(state.lane).toBe(LANE_LEFT)

    state = advance(state, TUNING.input.bufferMs)

    expect(state.buffered).toBeNull()
    expect(state.lane).toBe(LANE_CENTER)
    expect(state.laneTransition?.to).toBe(LANE_RIGHT)
  })

  it('expires an input queued earlier than the buffer window reaches', () => {
    // A tuning interaction worth stating rather than discovering later:
    // `input.bufferMs` (120) is SHORTER than `lane.transitionMs` (160), so an
    // input queued in the first 40 ms of a transition ages out before the
    // transition settles and is dropped.
    //
    // Both values are PROPOSED. This test records the behaviour the current
    // pair produces; it is not an endorsement of the pair, and
    // docs/game/tuning-parameters.md carries the note for review.
    let state = advance(runningState(), TUNING.lane.transitionMs, [{ type: 'move_left' }])

    state = step(state, [{ type: 'move_right' }], STEP_MS)
    state = step(state, [{ type: 'move_right' }], STEP_MS)

    expect(state.buffered?.event.type).toBe('move_right')

    state = advance(state, TUNING.lane.transitionMs)

    expect(state.buffered).toBeNull()
    expect(state.lane).toBe(LANE_CENTER)
    expect(state.laneTransition).toBeNull()
  })

  it('lets a jump through during a lane change, rather than buffering it', () => {
    const state = step(
      step(runningState(), [{ type: 'move_right' }], STEP_MS),
      [{ type: 'jump' }],
      STEP_MS,
    )

    expect(state.buffered).toBeNull()
    expect(isAirborne(state)).toBe(true)
    expect(state.laneTransition).not.toBeNull()
  })

  it('holds at most one input — a later one replaces the earlier', () => {
    let state = step(runningState(), [{ type: 'move_right' }], STEP_MS)
    state = step(state, [{ type: 'move_right' }], STEP_MS)
    state = step(state, [{ type: 'move_left' }], STEP_MS)

    expect(state.buffered?.event.type).toBe('move_left')
  })

  it('discards an input nobody could act on within the window', () => {
    let state = step(runningState(), [{ type: 'jump' }], STEP_MS)
    state = step(state, [{ type: 'jump' }], STEP_MS)

    expect(state.buffered?.event.type).toBe('jump')

    state = advance(state, TUNING.input.bufferMs + STEP_MS)

    expect(state.buffered).toBeNull()
  })

  it('never buffers a pause', () => {
    // A pause the player has to wait for is a pause that did not work.
    let state = step(runningState(), [{ type: 'move_right' }], STEP_MS)
    state = step(state, [{ type: 'pause' }], STEP_MS)

    expect(state.phase).toBe('paused')
    expect(state.buffered).toBeNull()
  })
})

describe('pause', () => {
  it('freezes the clock, the lane change, the jump and the buffer', () => {
    let state = step(runningState(), [{ type: 'move_right' }, { type: 'jump' }], STEP_MS)
    state = step(state, [{ type: 'jump' }], STEP_MS)

    const frozen = step(state, [{ type: 'pause' }], STEP_MS)
    const later = advance(frozen, 10_000)

    expect(later.phase).toBe('paused')
    expect(later.elapsedMs).toBe(frozen.elapsedMs)
    expect(later.laneTransition).toEqual(frozen.laneTransition)
    expect(later.jumpElapsedMs).toBe(frozen.jumpElapsedMs)
    expect(later.buffered).toEqual(frozen.buffered)
  })

  it('swallows gameplay inputs arriving in the same batch as the pause', () => {
    const state = step(runningState(), [{ type: 'pause' }, { type: 'jump' }], STEP_MS)

    expect(state.phase).toBe('paused')
    expect(isAirborne(state)).toBe(false)
  })

  it('ignores gameplay input while paused', () => {
    let state = step(runningState(), [{ type: 'pause' }], STEP_MS)
    state = step(state, [{ type: 'jump' }, { type: 'move_left' }], STEP_MS)

    expect(isAirborne(state)).toBe(false)
    expect(state.laneTransition).toBeNull()
    expect(state.buffered).toBeNull()
  })

  it('resumes only on an explicit input, never by time passing', () => {
    // Visibility loss pauses a run; visibility returning must not resume one.
    let state = step(runningState(), [{ type: 'pause' }], STEP_MS)
    state = advance(state, 60_000)

    expect(state.phase).toBe('paused')

    state = step(state, [{ type: 'resume' }], STEP_MS)

    expect(state.phase).toBe('running')
  })

  it('resumes into the readiness beat when it was paused during one', () => {
    let state = step(createRunState({ seed: 1 }), [{ type: 'pause' }], STEP_MS)
    state = step(state, [{ type: 'resume' }], STEP_MS)

    expect(state.phase).toBe('ready')
  })

  it('treats a redundant pause or resume as a no-op', () => {
    let state = step(runningState(), [{ type: 'resume' }], STEP_MS)
    expect(state.phase).toBe('running')

    state = step(state, [{ type: 'pause' }], STEP_MS)
    const paused = state

    state = step(state, [{ type: 'pause' }], STEP_MS)
    expect(state.resumePhase).toBe(paused.resumePhase)
    expect(state.phase).toBe('paused')
  })
})

describe('purity and determinism', () => {
  it('never mutates the state it was given', () => {
    const before = runningState()
    const snapshot = structuredClone(before)

    step(before, [{ type: 'move_left' }, { type: 'jump' }], STEP_MS)

    expect(before).toEqual(snapshot)
  })

  it('produces an identical trace from the same seed and input log', () => {
    const inputs: Array<readonly InputEvent[]> = Array.from({ length: 600 }, (_, i) => {
      if (i % 37 === 0) return [{ type: 'move_left' } as const]
      if (i % 53 === 0) return [{ type: 'move_right' } as const]
      if (i % 29 === 0) return [{ type: 'jump' } as const]
      if (i % 211 === 0) return [{ type: 'pause' } as const]
      if (i % 211 === 5) return [{ type: 'resume' } as const]
      return []
    })

    const replay = (): RunState[] => {
      let state = createRunState({ seed: 0xC0FFEE })
      const trace: RunState[] = []

      for (const batch of inputs) {
        state = step(state, batch, STEP_MS)
        trace.push(state)
      }

      return trace
    }

    // Byte-identical, not merely equivalent at the end: a divergence that
    // cancels out before the last step is still a divergence.
    expect(JSON.stringify(replay())).toBe(JSON.stringify(replay()))
  })

  it('diverges for a different seed only in the generator, with no input', () => {
    const a = createRunState({ seed: 1 })
    const b = createRunState({ seed: 2 })

    expect(a.rng).not.toEqual(b.rng)

    // Nothing consumes the streams yet, so the run itself is identical. When M6
    // starts drawing from them this assertion is expected to change — and the
    // change will be a deliberate one, visible in the diff.
    expect({ ...a, rng: null, seed: 0 }).toEqual({ ...b, rng: null, seed: 0 })
  })

  it('takes time only through deltaMs', () => {
    // Two runs stepped with different deltas reach different states; the same
    // delta always reaches the same one. If anything read a clock, the second
    // half of this would be flaky rather than exact.
    const base = runningState()

    expect(step(base, [], 4)).toEqual(step(base, [], 4))
    expect(step(base, [], 4)).not.toEqual(step(base, [], 8))
  })

  it('refuses a negative delta rather than running time backwards', () => {
    expect(() => step(runningState(), [], -1)).toThrow(RangeError)
  })

  it('runs five simulated minutes without drifting or throwing', () => {
    /*
     * This asserted `phase === 'running'` until M6, and that was true only
     * because nothing could hurt a player who never moved. Now a player who
     * ignores the road loses three hearts and the run ends — the milestone
     * working, not a regression. What the test is for is that five minutes of
     * simulation stays finite and never throws.
     */
    let state = createRunState({ seed: 7 })

    const steps = Math.ceil((5 * 60 * 1000) / STEP_MS)

    for (let i = 0; i < steps; i++) {
      state = step(state, i % 41 === 0 ? [{ type: 'jump' }] : [], STEP_MS)
    }

    expect(Number.isFinite(state.elapsedMs)).toBe(true)
    expect(Number.isFinite(state.distanceUnits)).toBe(true)
    expect(state.hearts).toBeGreaterThanOrEqual(0)
    expect(state.hearts).toBeLessThanOrEqual(TUNING.hearts.max)
  })

  it('ends the run of a player who never avoids anything', () => {
    let state = createRunState({ seed: 7 })

    const steps = Math.ceil((2 * 60 * 1000) / STEP_MS)

    for (let i = 0; i < steps && state.phase !== 'ended'; i++) {
      state = step(state, [], STEP_MS)
    }

    expect(state.phase).toBe('ended')
    expect(state.hearts).toBe(0)
  })
})

describe('the domain refuses input it cannot honour', () => {
  /*
   * The domain's own boundary, not the bridge's.
   *
   * `step` validated the *sign* of the delta and not its finiteness, which is
   * the wrong half: `NaN < 0` is false, so one `NaN` walked in and stayed. The
   * loop in `game/bridge` happened to filter it, which meant the domain's
   * invariant was enforced by a module the domain is forbidden to know about —
   * and any other caller (a replay harness, the server-side validator ADR-0006
   * contemplates, a test) had no protection at all.
   */
  it('rejects a non-finite delta rather than absorbing it', () => {
    for (const delta of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
      expect(() => step(runningState(), [], delta), `delta ${delta}`).toThrow(RangeError)
    }
  })

  it('would have been poisoned permanently by one NaN', () => {
    // What the guard prevents, stated as the consequence rather than the input:
    // with NaN absorbed, `elapsedMs` never recovered, the jump threshold was
    // never met so the player never landed, and the readiness beat was skipped
    // because `1500 - NaN > 0` is false too.
    let state = runningState()

    expect(() => { state = step(state, [{ type: 'jump' }], Number.NaN) }).toThrow()

    // Untouched: a rejected step must not have advanced anything.
    expect(state.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(state.elapsedMs)).toBe(true)
  })

  it('rejects a malformed input event instead of throwing from deep inside', () => {
    // `null` used to surface as a bare TypeError out of the reducer, taking the
    // frame loop with it; an unrecognised `type` was accepted in silence.
    expect(() => step(runningState(), [null as never], STEP_MS)).toThrow(TypeError)
    expect(() => step(runningState(), [{ type: 'teleport' } as never], STEP_MS)).toThrow(TypeError)
  })

  it('accepts a zero delta without ageing anything', () => {
    const before = runningState()
    const after = step(before, [], 0)

    expect(after.elapsedMs).toBe(before.elapsedMs)
  })
})

describe('a returned state cannot be used to corrupt the next one', () => {
  it('is frozen, including the nested objects', () => {
    let state = runningState()

    state = step(state, [{ type: 'move_left' }, { type: 'jump' }], STEP_MS)

    expect(Object.isFrozen(state)).toBe(true)
    expect(Object.isFrozen(state.rng)).toBe(true)
    expect(Object.isFrozen(state.rng.pattern)).toBe(true)
    expect(Object.isFrozen(state.laneTransition)).toBe(true)
  })

  it('refuses a write that would put an impossible lane into the simulation', () => {
    const state = runningState()

    // Writing `lane = 99` used to succeed and the very next step carried it.
    expect(() => {
      ;(state as unknown as { lane: number }).lane = 99
    }).toThrow(TypeError)

    expect(step(state, [], STEP_MS).lane).toBe(state.lane)
  })

  it('does not let one state rewrite the generator of every other', () => {
    /*
     * Every state in a run shares one `rng` object, because `step` rebuilds
     * state by spread. That is fine — and only fine because the object is
     * frozen. Unfrozen, a single write through any retained state rewrote the
     * generator for every snapshot ever taken of that run, including the ones a
     * replay would be validated against.
     */
    const first = runningState()
    const later = step(step(first, [], STEP_MS), [], STEP_MS)

    expect(() => {
      ;(later.rng.pattern as unknown as { a: number }).a = 12345
    }).toThrow(TypeError)

    expect(first.rng.pattern.a).not.toBe(12345)
  })
})

describe('pause means the same thing wherever it lands in a batch', () => {
  /*
   * Inputs were applied in two passes — every phase input, then every gameplay
   * input — which threw the relative order away. Pause then meant three
   * different things depending on where it sat, and two modules documented
   * opposite contracts for the same event.
   */
  const airborne = (state: ReturnType<typeof runningState>): boolean => state.jumpElapsedMs !== null

  it('swallows a jump that arrives after the pause in the same batch', () => {
    const state = step(runningState(), [{ type: 'pause' }, { type: 'jump' }], STEP_MS)

    expect(state.phase).toBe('paused')
    expect(airborne(state)).toBe(false)
  })

  it('still swallows it when a resume follows in the same batch', () => {
    // This was the hole: the resume undid the pause, and the jump — which had
    // been skipped by the phase pass — was then applied by the gameplay pass.
    const state = step(runningState(), [{ type: 'pause' }, { type: 'jump' }, { type: 'resume' }], STEP_MS)

    expect(state.phase).toBe('running')
    expect(airborne(state), 'a jump pressed while paused must not survive the resume').toBe(false)
  })

  it('does not fire an input pressed while already paused', () => {
    const paused = step(runningState(), [{ type: 'pause' }], STEP_MS)
    const resumed = step(paused, [{ type: 'jump' }, { type: 'resume' }], STEP_MS)

    expect(resumed.phase).toBe('running')
    expect(airborne(resumed), 'mashing jump on a pause screen must not jump on resume').toBe(false)
  })

  it('applies an input that genuinely arrived before the pause', () => {
    // The other side of the same rule. The player pressed jump, then paused;
    // the jump happened.
    const state = step(runningState(), [{ type: 'jump' }, { type: 'pause' }], STEP_MS)

    expect(state.phase).toBe('paused')
    expect(airborne(state)).toBe(true)
  })
})
