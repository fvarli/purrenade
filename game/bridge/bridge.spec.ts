import { describe, expect, it, vi } from 'vitest'
import { LANE_CENTER, LANE_LEFT, LANE_RIGHT, STEP_MS, TUNING, createRunState, step } from '../domain'
import { createRunLoop } from './loop'
import { interpolateSnapshot, toRenderSnapshot } from './snapshot'
import type { RunEvent } from './types'

/**
 * The boundary, tested in Node.
 *
 * None of this needs a browser, which is the point of putting the loop here
 * rather than in the engine: the stall and pause invariants are the ones most
 * likely to break and the least pleasant to reproduce by hand in a tab.
 */

/** Drive a loop for a number of whole simulation steps. */
function frames(loop: ReturnType<typeof createRunLoop>, count: number): void {
  for (let i = 0; i < count; i++) loop.frame(STEP_MS)
}

/** Steps needed to get past the readiness beat. */
const READY_STEPS = Math.ceil(TUNING.run.readyMs / STEP_MS) + 1

describe('toRenderSnapshot', () => {
  it('reports lane position in lane units, not pixels', () => {
    const snapshot = toRenderSnapshot(createRunState({ seed: 1 }))

    expect(snapshot.lanePosition).toBe(LANE_CENTER)
  })

  it('reports a fractional position mid-transition', () => {
    let state = step(createRunState({ seed: 1 }), [{ type: 'move_left' }], STEP_MS)
    state = step(state, [], TUNING.lane.transitionMs / 2)

    const snapshot = toRenderSnapshot(state)

    expect(snapshot.lanePosition).toBeGreaterThan(LANE_LEFT)
    expect(snapshot.lanePosition).toBeLessThan(LANE_CENTER)
  })

  it('reports occupancy separately from visual position', () => {
    // The two genuinely differ: occupancy flips at the midpoint while the
    // visual position slides the whole way. A renderer that conflated them
    // would draw the player in a lane the rules disagree about.
    let state = step(createRunState({ seed: 1 }), [{ type: 'move_right' }], STEP_MS)
    state = step(state, [], TUNING.lane.transitionMs * 0.25)

    const snapshot = toRenderSnapshot(state)

    expect(snapshot.occupiedLane).toBe(LANE_CENTER)
    expect(snapshot.lanePosition).toBeGreaterThan(LANE_CENTER)
  })

  it('is frozen, so a renderer cannot write back through it', () => {
    expect(Object.isFrozen(toRenderSnapshot(createRunState({ seed: 1 })))).toBe(true)
  })

  it('exposes no field the domain owns', () => {
    // The mutable state must not leak. If `rng`, `seed` or `buffered` ever
    // appear here, the renderer has been handed the rules.
    const snapshot = toRenderSnapshot(createRunState({ seed: 1 }))

    expect(Object.keys(snapshot).sort()).toEqual([
      'elapsedMs',
      'heightPx',
      'jumpProgress',
      'laneProgress',
      'lanePosition',
      'occupiedLane',
      'phase',
      'readyRemainingMs',
    ].sort())
  })
})

describe('interpolateSnapshot', () => {
  it('blends continuous fields and takes the later discrete ones', () => {
    const a = toRenderSnapshot(createRunState({ seed: 1 }))
    const b = toRenderSnapshot(step(createRunState({ seed: 1 }), [{ type: 'move_right' }], TUNING.lane.transitionMs / 2))

    const mid = interpolateSnapshot(a, b, 0.5)

    expect(mid.lanePosition).toBeCloseTo((a.lanePosition + b.lanePosition) / 2, 9)
    expect(mid.occupiedLane).toBe(b.occupiedLane)
    expect(mid.phase).toBe(b.phase)
  })

  it('clamps alpha rather than extrapolating past the two states', () => {
    const a = toRenderSnapshot(createRunState({ seed: 1 }))
    const b = toRenderSnapshot(step(createRunState({ seed: 1 }), [{ type: 'move_right' }], TUNING.lane.transitionMs / 2))

    expect(interpolateSnapshot(a, b, -5).lanePosition).toBe(a.lanePosition)
    expect(interpolateSnapshot(a, b, 5).lanePosition).toBe(b.lanePosition)
  })
})

describe('the fixed-step loop', () => {
  it('turns variable frames into whole simulation steps', () => {
    const loop = createRunLoop({ seed: 1 })

    // One and a half steps: exactly one simulates, the half is carried.
    loop.frame(STEP_MS * 1.5)

    expect(loop.debugState().readyRemainingMs).toBeCloseTo(TUNING.run.readyMs - STEP_MS, 9)
  })

  it('loses no time to the carry, however the frames are cut up', () => {
    // Deliberately not asserting a step count per frame. The step is 8.33 ms and
    // the accumulator is a float, so a frame can land an ULP short of the
    // threshold and defer its step to the next one. Nothing is lost — the
    // remainder carries — and the property worth pinning is exactly that:
    // total time simulated tracks total time supplied.
    const ragged = createRunLoop({ seed: 1 })
    const even = createRunLoop({ seed: 1 })

    for (let i = 0; i < 240; i++) {
      ragged.frame(i % 2 === 0 ? STEP_MS * 1.5 : STEP_MS * 0.5)
      even.frame(STEP_MS)
    }

    expect(ragged.debugState().readyRemainingMs)
      .toBeCloseTo(even.debugState().readyRemainingMs, 6)
  })

  it('ignores a negative or non-finite frame delta', () => {
    const loop = createRunLoop({ seed: 1 })
    const before = loop.debugState()

    loop.frame(-100)
    loop.frame(Number.NaN)
    loop.frame(Number.POSITIVE_INFINITY)

    // Value, not identity: `debugState()` hands out a copy, so reference
    // equality would only be re-testing that it does.
    expect(loop.debugState()).toEqual(before)
  })

  it('applies queued input on the next step', () => {
    const loop = createRunLoop({ seed: 1 })

    loop.enqueue({ type: 'move_left' })
    loop.frame(STEP_MS)

    expect(loop.debugState().laneTransition?.to).toBe(LANE_LEFT)
  })

  it('emits run_started, then run_interactive when the beat ends', () => {
    const events: RunEvent[] = []
    const loop = createRunLoop({ seed: 1, onEvent: e => events.push(e) })

    expect(events).toEqual([{ type: 'run_started' }])

    frames(loop, READY_STEPS)

    expect(events).toContainEqual({ type: 'run_interactive' })
    expect(events).toContainEqual({ type: 'phase_changed', phase: 'running' })
  })

  it('emits no gameplay state to the app layer', () => {
    // Coarse events only. A UI that re-rendered on lane changes would be a UI
    // fighting a 120 Hz loop.
    const events: RunEvent[] = []
    const loop = createRunLoop({ seed: 1, onEvent: e => events.push(e) })

    frames(loop, READY_STEPS)
    loop.enqueue({ type: 'move_left' })
    frames(loop, 40)

    const serialised = JSON.stringify(events)

    expect(serialised).not.toContain('lane')
    expect(serialised).not.toContain('seed')
  })
})

describe('pause, and the stalled tab', () => {
  it('freezes the simulation', () => {
    const loop = createRunLoop({ seed: 1 })
    frames(loop, READY_STEPS)

    loop.pause()
    loop.frame(STEP_MS)

    const frozen = loop.debugState()

    frames(loop, 100)

    expect(loop.phase()).toBe('paused')
    expect(loop.debugState().elapsedMs).toBe(frozen.elapsedMs)
  })

  it('banks no time while paused — a long stall does not jump on resume', () => {
    // The invariant that matters most here. Ten minutes in a background tab
    // must not come back as ten minutes of simulation.
    const loop = createRunLoop({ seed: 1 })
    frames(loop, READY_STEPS)
    loop.frame(STEP_MS)

    loop.pause()
    loop.frame(STEP_MS)

    const atPause = loop.debugState().elapsedMs

    loop.frame(10 * 60 * 1000)

    loop.resume()
    loop.frame(STEP_MS)

    const afterResume = loop.debugState().elapsedMs

    expect(loop.phase()).toBe('running')
    expect(afterResume - atPause).toBeLessThanOrEqual(STEP_MS * 2)
  })

  it('bounds catch-up even without a pause', () => {
    // Belt to the pause's braces: a stall that never paused still must not
    // simulate its whole backlog in one frame.
    const loop = createRunLoop({ seed: 1 })
    frames(loop, READY_STEPS)

    const before = loop.debugState().elapsedMs

    loop.frame(30_000)

    const advanced = loop.debugState().elapsedMs - before

    expect(advanced).toBeLessThanOrEqual(STEP_MS * TUNING.sim.maxCatchUpSteps + 0.001)
  })

  it('does not resume by itself, however long it is left', () => {
    const loop = createRunLoop({ seed: 1 })
    frames(loop, READY_STEPS)

    loop.pause()
    frames(loop, 5000)

    expect(loop.phase()).toBe('paused')

    loop.resume()
    loop.frame(STEP_MS)

    expect(loop.phase()).toBe('running')
  })

  it('sees a pause queued in the same frame as gameplay input', () => {
    const loop = createRunLoop({ seed: 1 })
    frames(loop, READY_STEPS)

    loop.enqueue({ type: 'jump' })
    loop.pause()
    loop.frame(STEP_MS)

    expect(loop.phase()).toBe('paused')
    expect(loop.debugState().jumpElapsedMs).toBeNull()
  })

  it('stops interpolating while paused', () => {
    const loop = createRunLoop({ seed: 1 })
    frames(loop, READY_STEPS)

    loop.enqueue({ type: 'move_right' })
    frames(loop, 2)
    loop.pause()
    loop.frame(STEP_MS)

    const first = loop.snapshot()
    loop.frame(STEP_MS * 0.9)

    expect(loop.snapshot()).toEqual(first)
  })

  it('resumes a lane change exactly where it was frozen', () => {
    const loop = createRunLoop({ seed: 1 })
    frames(loop, READY_STEPS)

    loop.enqueue({ type: 'move_right' })
    frames(loop, 4)
    loop.pause()
    loop.frame(STEP_MS)

    const frozen = loop.debugState().laneTransition

    frames(loop, 200)
    loop.resume()
    loop.frame(STEP_MS)

    expect(loop.debugState().laneTransition?.from).toBe(frozen?.from)
    expect(loop.debugState().laneTransition?.to).toBe(frozen?.to)
  })
})

describe('the loop does not leak between runs', () => {
  it('gives two loops from the same seed identical traces', () => {
    const trace = (): string[] => {
      const loop = createRunLoop({ seed: 0xBEEF })
      const out: string[] = []

      for (let i = 0; i < 400; i++) {
        if (i % 31 === 0) loop.enqueue({ type: 'move_right' })
        if (i % 43 === 0) loop.enqueue({ type: 'jump' })
        loop.frame(STEP_MS)
        out.push(JSON.stringify(loop.debugState()))
      }

      return out
    }

    expect(trace()).toEqual(trace())
  })

  it('does not share pending input between loops', () => {
    const a = createRunLoop({ seed: 1 })
    const b = createRunLoop({ seed: 1 })

    frames(a, READY_STEPS)
    frames(b, READY_STEPS)

    a.enqueue({ type: 'move_right' })
    a.frame(STEP_MS)
    b.frame(STEP_MS)

    expect(a.debugState().laneTransition?.to).toBe(LANE_RIGHT)
    expect(b.debugState().laneTransition).toBeNull()
  })

  it('calls the event sink only for the loop that owns it', () => {
    const sinkA = vi.fn()
    const sinkB = vi.fn()

    const a = createRunLoop({ seed: 1, onEvent: sinkA })
    createRunLoop({ seed: 1, onEvent: sinkB })

    sinkA.mockClear()
    sinkB.mockClear()

    frames(a, READY_STEPS)

    expect(sinkA).toHaveBeenCalled()
    expect(sinkB).not.toHaveBeenCalled()
  })
})

describe('pause and resume do not depend on the loop they control', () => {
  it('takes effect immediately, with no frame in between', () => {
    // The defect this pins: pause and resume were queued as inputs, so they
    // only applied on the next `frame()` — and `frame()` is driven by the
    // renderer's loop, which Phaser stops on window blur. A player whose run
    // was paused by that blur pressed Resume and nothing happened.
    const loop = createRunLoop({ seed: 1 })
    frames(loop, READY_STEPS)

    loop.pause()

    expect(loop.phase()).toBe('paused')

    loop.resume()

    expect(loop.phase()).toBe('running')
  })

  it('resumes even if no frame ever arrives again', () => {
    const loop = createRunLoop({ seed: 1 })
    frames(loop, READY_STEPS)

    loop.pause()
    loop.resume()

    // Not one `frame()` call after the pause. The state must already be right.
    expect(loop.debugState().phase).toBe('running')
  })

  it('reports the phase truthfully the instant it is asked', () => {
    // The app layer labels its button from this. A stale answer meant the
    // button read "Pause" on a paused run.
    const loop = createRunLoop({ seed: 1 })
    frames(loop, READY_STEPS)

    loop.pause()
    expect(loop.phase()).toBe('paused')

    loop.resume()
    expect(loop.phase()).toBe('running')
  })

  it('emits the phase change to the app layer', () => {
    const events: RunEvent[] = []
    const loop = createRunLoop({ seed: 1, onEvent: e => events.push(e) })
    frames(loop, READY_STEPS)

    events.length = 0
    loop.pause()

    expect(events).toEqual([{ type: 'phase_changed', phase: 'paused' }])
  })

  it('still swallows a gameplay input queued alongside the pause', () => {
    const loop = createRunLoop({ seed: 1 })
    frames(loop, READY_STEPS)

    loop.enqueue({ type: 'jump' })
    loop.pause()
    loop.frame(STEP_MS)

    expect(loop.debugState().jumpElapsedMs).toBeNull()
  })

  it('advances no time when it applies', () => {
    const loop = createRunLoop({ seed: 1 })
    frames(loop, READY_STEPS)

    const before = loop.debugState().elapsedMs

    loop.pause()
    loop.resume()

    expect(loop.debugState().elapsedMs).toBe(before)
  })
})
