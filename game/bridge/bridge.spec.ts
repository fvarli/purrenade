import { describe, expect, it, vi } from 'vitest'
import { LANE_CENTER, LANE_LEFT, LANE_RIGHT, STEP_MS, TUNING, createRunState, step } from '../domain'
import { createRunLoop } from './loop'
import { interpolateSnapshot, toRenderSnapshot } from './snapshot'
import type { RenderObstacle, RenderSnapshot, RunEvent } from './types'

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
      'hearts',
      'heightPx',
      'invulnerable',
      'jumpProgress',
      'laneProgress',
      'lanePosition',
      'obstacles',
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

describe('the world crosses the boundary safely', () => {
  /** Advance a fresh loop far enough that obstacles exist. */
  function withObstacles(): ReturnType<typeof createRunLoop> {
    const loop = createRunLoop({ seed: 5 })

    for (let i = 0; i < 900; i++) loop.frame(STEP_MS)

    return loop
  }

  it('carries obstacles in road units, frozen, with no rule fields', () => {
    const snapshot = withObstacles().snapshot()

    expect(snapshot.obstacles.length).toBeGreaterThan(0)
    expect(Object.isFrozen(snapshot.obstacles)).toBe(true)

    for (const obstacle of snapshot.obstacles) {
      expect(Object.isFrozen(obstacle)).toBe(true)
      // `outcome` is a rule. A renderer that could read it could start deciding.
      expect(Object.keys(obstacle).sort()).toEqual(
        ['distanceUnits', 'id', 'kind', 'lane', 'lengthUnits'],
      )
    }
  })

  it('does not let a renderer edit the world it is drawing', () => {
    const loop = withObstacles()
    const snapshot = loop.snapshot()
    const before = loop.debugState().obstacles.length

    expect(() => {
      ;(snapshot.obstacles as RenderObstacle[]).push({
        id: -1, kind: 'lane_blocking', lane: 0, distanceUnits: 0, lengthUnits: 1,
      })
    }).toThrow(TypeError)

    expect(() => {
      ;(snapshot.obstacles[0] as unknown as { distanceUnits: number }).distanceUnits = -99
    }).toThrow(TypeError)

    expect(loop.debugState().obstacles.length).toBe(before)
  })

  it('interpolates obstacles by id, never by position in the array', () => {
    /*
     * Index pairing looks fine until an obstacle is culled mid-frame: position
     * zero then refers to a different obstacle, and the one behind it visibly
     * slides across the road toward where the culled one used to be.
     */
    const a: RenderSnapshot = { ...BLANK, obstacles: Object.freeze([
      Object.freeze({ id: 1, kind: 'lane_blocking' as const, lane: 0, distanceUnits: 10, lengthUnits: 1 }),
      Object.freeze({ id: 2, kind: 'jumpable' as const, lane: 2, distanceUnits: 20, lengthUnits: 1 }),
    ]) }

    // Obstacle 1 has been culled; only 2 remains, and it has moved.
    const b: RenderSnapshot = { ...BLANK, obstacles: Object.freeze([
      Object.freeze({ id: 2, kind: 'jumpable' as const, lane: 2, distanceUnits: 18, lengthUnits: 1 }),
    ]) }

    const blended = interpolateSnapshot(a, b, 0.5)

    expect(blended.obstacles).toHaveLength(1)
    expect(blended.obstacles[0]!.id).toBe(2)
    // Halfway between 20 and 18 — not halfway between 10 and 18.
    expect(blended.obstacles[0]!.distanceUnits).toBeCloseTo(19, 9)
  })

  it('emits a coarse event when a heart goes, and when the run ends', () => {
    const events: RunEvent[] = []
    const loop = createRunLoop({ seed: 5, onEvent: event => events.push(event) })

    for (let i = 0; i < 30_000 && loop.phase() !== 'ended'; i++) loop.frame(STEP_MS)

    const hearts = events.filter(event => event.type === 'heart_lost')

    expect(hearts.length).toBe(3)
    expect(hearts.at(-1)).toEqual({ type: 'heart_lost', hearts: 0 })
    expect(events.filter(event => event.type === 'run_ended')).toHaveLength(1)
  })

  it('does not put gameplay geometry into the event stream', () => {
    const events: RunEvent[] = []
    const loop = createRunLoop({ seed: 5, onEvent: event => events.push(event) })

    for (let i = 0; i < 2000; i++) loop.frame(STEP_MS)

    const serialised = JSON.stringify(events)

    expect(serialised).not.toContain('distanceUnits')
    expect(serialised).not.toContain('lane')
  })
})

const BLANK: RenderSnapshot = Object.freeze({
  phase: 'running' as const,
  lanePosition: 1,
  occupiedLane: 1 as const,
  heightPx: 0,
  jumpProgress: 0,
  laneProgress: 1,
  readyRemainingMs: 0,
  elapsedMs: 0,
  obstacles: Object.freeze([]),
  hearts: 3,
  invulnerable: false,
})

describe('the world does not depend on the display', () => {
  /*
   * The same run, driven through the real loop at six refresh rates plus
   * jitter. Collision and near-miss outcomes must not depend on a monitor.
   *
   * Compared on authoritative state, never on interpolated pixels: the whole
   * point of the fixed step is that what the player *sees* is smoothed while
   * what the rules *do* is quantised, so the smoothing is the one thing that is
   * allowed to differ.
   */
  function drive(frameMs: readonly number[], seconds: number): string {
    const loop = createRunLoop({ seed: 31 })

    let elapsed = 0
    let index = 0

    while (elapsed < seconds * 1000) {
      const delta = frameMs[index % frameMs.length]!

      loop.frame(delta)
      elapsed += delta
      index++
    }

    const state = loop.debugState()

    return JSON.stringify({
      hearts: state.hearts,
      nearMiss: state.nearMissCount,
      phase: state.phase,
      spawned: state.nextObstacleId,
      obstacles: state.obstacles.map(o => [o.id, o.kind, o.lane, o.outcome]),
    })
  }

  const rates: Record<string, readonly number[]> = {
    '60Hz': [1000 / 60],
    '90Hz': [1000 / 90],
    '120Hz': [1000 / 120],
    '144Hz': [1000 / 144],
    '165Hz': [1000 / 165],
    '240Hz': [1000 / 240],
    jitter: [12, 4, 33, 8, 21, 6, 17],
  }

  it('reaches the same authoritative state at every refresh rate', () => {
    const seconds = 20
    const reference = drive(rates['120Hz']!, seconds)

    for (const [name, frames] of Object.entries(rates)) {
      expect(drive(frames, seconds), `${name} diverged from 120Hz`).toBe(reference)
    }
  })

  it('does not spawn a burst after a long stall', () => {
    // The loop discards time it cannot honestly simulate, and generation
    // follows the same clock — so a backgrounded tab cannot come back to a wall
    // of hazards it never scrolled past.
    const steady = createRunLoop({ seed: 31 })
    const stalled = createRunLoop({ seed: 31 })

    for (let i = 0; i < 600; i++) {
      steady.frame(STEP_MS)
      stalled.frame(STEP_MS)
    }

    const before = stalled.debugState().nextObstacleId

    stalled.frame(30_000)

    const spawnedByTheStall = stalled.debugState().nextObstacleId - before

    // At most what the bounded catch-up could honestly have scrolled past.
    expect(spawnedByTheStall).toBeLessThanOrEqual(2)
  })
})

describe('pausing discards what was queued', () => {
  it('does not fire a gameplay input that was queued just before a pause', () => {
    /*
     * The queue used to be cleared by the next *paused frame* — and `frame()`
     * is exactly what stops when the window loses focus, which is the case the
     * synchronous pause path exists for. So a jump queued a moment before a
     * blur survived the pause and fired on resume: the player looked away and
     * came back mid-air.
     */
    const loop = createRunLoop({ seed: 1 })

    for (let i = 0; i < 400; i++) loop.frame(STEP_MS)

    expect(loop.phase()).toBe('running')

    loop.enqueue({ type: 'jump' })

    // No frame between the two — the blur case exactly.
    loop.pause()
    loop.resume()
    loop.frame(STEP_MS)

    expect(loop.debugState().jumpElapsedMs, 'a queued input must not survive a pause').toBeNull()
  })

  it('still applies an input queued after the resume', () => {
    const loop = createRunLoop({ seed: 1 })

    for (let i = 0; i < 400; i++) loop.frame(STEP_MS)

    loop.pause()
    loop.resume()
    loop.enqueue({ type: 'jump' })
    loop.frame(STEP_MS)

    expect(loop.debugState().jumpElapsedMs).not.toBeNull()
  })
})
