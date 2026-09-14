import { describe, expect, it, vi } from 'vitest'
import { LANE_CENTER, LANE_LEFT, LANE_RIGHT, STEP_MS, TUNING, createRunState, step } from '../domain'
import { createRunLoop } from './loop'
import { interpolateSnapshot, toRenderSnapshot } from './snapshot'
import type { RenderObstacle, RenderPawToken, RenderSnapshot, RunEvent } from './types'

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
      // M7. Each is a projection, not a domain object: `score` carries floored
      // integers rather than the thousandths the domain accumulates, and
      // `pawTokens` carries no outcome field for the same reason obstacles
      // carry none — an outcome is a rule.
      'protection',
      'score',
      'pawTokens',
      'runPaws',
      'loliCyclePaws',
      'loli',
      'slayyy',
    ].sort())
  })
})

describe('nothing mutable escapes to the renderer', () => {
  /*
   * `toRenderSnapshot` freezes each nested structure by hand, and the list was
   * checked by two assertions covering the root and `obstacles`. M7 added five
   * more — `pawTokens`, `protection`, `score`, `loli`, `slayyy` — and tested
   * none of their freezes, so removing any one of them passed the whole suite.
   *
   * Walked generically for the same reason the domain's `sealState` is: the
   * freeze is a hand-maintained list, so the *next* nested field is unfrozen by
   * default and nothing complains. This fails on the day it is added.
   */
  function unfrozen(node: unknown, path: string, seen: Set<unknown>): string[] {
    if (node === null || typeof node !== 'object' || seen.has(node)) return []

    seen.add(node)

    const here = Object.isFrozen(node) ? [] : [path]

    return Object.entries(node).flatMap(([key, value]) => unfrozen(value, `${path}.${key}`, seen))
      .concat(here)
  }

  /** A snapshot of a run far enough along to have all of M7 in flight. */
  function busySnapshot(): RenderSnapshot {
    const loop = createRunLoop({ seed: 31 })

    frames(loop, READY_STEPS + 2400)

    return toRenderSnapshot(loop.debugState())
  }

  it('freezes every object the snapshot can reach', () => {
    const snapshot = busySnapshot()
    const seen = new Set<unknown>()

    expect(snapshot.pawTokens.length, 'tokens must be in flight or this proves nothing')
      .toBeGreaterThan(0)
    expect(unfrozen(snapshot, 'snapshot', seen)).toEqual([])
    expect(seen.size).toBeGreaterThan(8)
  })

  it('refuses a write through the paw token list', () => {
    const snapshot = busySnapshot()

    expect(() => (snapshot.pawTokens as RenderPawToken[]).push(snapshot.pawTokens[0]!))
      .toThrow(TypeError)
    expect(() => {
      ;(snapshot.pawTokens[0] as { laneOffset: number }).laneOffset = 99
    }).toThrow(TypeError)
  })

  it('freezes what interpolation hands back, on every path', () => {
    const loop = createRunLoop({ seed: 31 })

    frames(loop, READY_STEPS + 2400)

    const a = toRenderSnapshot(loop.debugState())

    frames(loop, 30)

    const b = toRenderSnapshot(loop.debugState())
    const seen = new Set<unknown>()

    expect(unfrozen(interpolateSnapshot(a, b, 0.5), 'blended', seen)).toEqual([])
  })
})

describe('interpolating paw tokens', () => {
  /*
   * `interpolateObstacles` had a test from M6; its M7 sibling had none, though
   * it is the harder of the two — a token moves on **both** axes, because the
   * magnet slides it between lanes while the road brings it closer.
   */
  const token = (id: number, laneOffset: number, distanceUnits: number): RenderPawToken =>
    Object.freeze({ id, laneOffset, distanceUnits })

  function blend(from: readonly RenderPawToken[], to: readonly RenderPawToken[], t: number) {
    const loop = createRunLoop({ seed: 1 })
    const base = toRenderSnapshot(loop.debugState())

    return interpolateSnapshot(
      Object.freeze({ ...base, pawTokens: Object.freeze(from) }),
      Object.freeze({ ...base, pawTokens: Object.freeze(to) }),
      t,
    ).pawTokens
  }

  it('blends both axes, matching tokens by id', () => {
    const blended = blend([token(7, 0, 10)], [token(7, 2, 6)], 0.5)

    expect(blended).toHaveLength(1)
    expect(blended[0]!.laneOffset).toBeCloseTo(1, 6)
    expect(blended[0]!.distanceUnits).toBeCloseTo(8, 6)
  })

  it('takes the later value for a token that has no earlier match', () => {
    // A token spawned between the two snapshots has nothing to blend from, and
    // must appear where it actually is rather than at some invented midpoint.
    const blended = blend([token(7, 0, 10)], [token(7, 0, 9), token(8, 2, 14)], 0.5)
    const fresh = blended.find(entry => entry.id === 8)

    expect(fresh?.laneOffset).toBe(2)
    expect(fresh?.distanceUnits).toBe(14)
  })

  it('passes the later list straight through on the first frame', () => {
    const blended = blend([], [token(7, 1, 5)], 0.5)

    expect(blended).toHaveLength(1)
    expect(blended[0]!.distanceUnits).toBe(5)
  })

  it('drops a token that is gone by the later snapshot', () => {
    // Collection removes a token in the same step it is taken, so the blended
    // list must follow the later snapshot rather than keep drawing a reward the
    // player has already been given.
    expect(blend([token(7, 1, 5), token(8, 1, 6)], [token(8, 1, 5.7)], 0.5)).toHaveLength(1)
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
  protection: Object.freeze({ hitRecovery: false, slayyy: false }),
  score: Object.freeze({ total: 0, distance: 0, collection: 0, bonus: 0 }),
  pawTokens: Object.freeze([]),
  runPaws: 0,
  loliCyclePaws: 0,
  loli: Object.freeze({ phase: 'inactive' as const, phaseProgress: 1, queuedLoliBonuses: 0 }),
  slayyy: Object.freeze({ phase: 'charging' as const, charge: 0, activeRemainingMs: 0 }),
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

      /*
       * M7's authoritative facts, in the same comparison.
       *
       * Every one of these is a number a later milestone may submit as a run
       * fact, so "the same at every refresh rate" is not a nicety — a score
       * that depends on a monitor is a score a server cannot validate. The
       * fractional accumulators are included deliberately: comparing only the
       * floored score would hide a drift of less than a point per run, which is
       * exactly the drift that compounds over a long session.
       */
      score: [state.score.distanceMilli, state.score.collectionMilli, state.score.bonusMilli],
      runPaws: state.runPaws,
      cyclePaws: state.loliCyclePaws,
      pawsSpawned: state.nextPawTokenId,
      pawTokens: state.pawTokens.map(t => [t.id, t.laneOffset, t.outcome]),
      loli: [state.loli.phase, state.loli.queuedLoliBonuses, state.loliActivations],
      slayyy: [state.slayyy.phase, state.slayyy.chargeMicro, state.slayyyActivations],
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

  it('makes run_ended the last event of the run', () => {
    /*
     * The terminal step still earns distance — the movement happened — so the
     * score event for it must arrive before the run is declared over, not
     * after. A consumer that treats `run_ended` as "the final numbers are in"
     * is a consumer M9 will write.
     */
    const events: RunEvent[] = []
    const loop = createRunLoop({ seed: 31, onEvent: e => events.push(e) })

    for (let i = 0; i < 20_000 && loop.debugState().phase !== 'ended'; i++) {
      loop.frame(STEP_MS)
    }

    expect(loop.debugState().phase).toBe('ended')

    const ended = events.findIndex(event => event.type === 'run_ended')

    expect(ended, 'the run must have ended').toBeGreaterThan(-1)
    expect(events.slice(ended + 1).map(event => event.type), 'nothing may follow it')
      .toEqual([])

    // And the guard against the assertion above passing for the wrong reason:
    // the terminal step really did produce other events first.
    const sameStep = events.slice(0, ended).map(event => event.type)

    expect(sameStep).toContain('score_changed')
    expect(sameStep).toContain('phase_changed')
  })

  it('compares M7 fields that have actually moved, not constants', () => {
    /*
     * A guard on the test above rather than a new comparison.
     *
     * Twenty seconds of a run that presses nothing reaches the score, the paw
     * counters, the token positions and the meter — but **not** an activation
     * of either system: SLAYYY never fires itself, and a Loli Bonus is 200 paws
     * away. Those fields therefore agree across every refresh rate because they
     * are zero everywhere, which is not evidence of anything.
     *
     * So the fields that *are* exercised are asserted to be non-trivial here.
     * If a future change makes the reference run die early or stop collecting,
     * this fails loudly instead of leaving the comparison above quietly vacuous.
     *
     * Activation counts are covered by the domain's A/B determinism test rather
     * than here, and deliberately: reaching an activation needs input, input
     * arrives on frames, and *when* a frame falls is exactly what a refresh rate
     * changes. A scripted player driven per frame is rate-dependent by
     * construction, so a cross-rate comparison of one measures the bot, not the
     * simulation.
     */
    const state = JSON.parse(drive(rates['120Hz']!, 20)) as {
      score: [number, number, number]
      runPaws: number
      pawTokens: unknown[]
      slayyy: [string, number, number]
    }

    expect(state.score[0], 'distance score must have accrued').toBeGreaterThan(0)
    expect(state.runPaws, 'paws must have been collected').toBeGreaterThan(0)
    expect(state.score[1], 'collection score must have accrued').toBeGreaterThan(0)
    expect(state.pawTokens.length, 'tokens must be in flight').toBeGreaterThan(0)
    expect(state.slayyy[1], 'the meter must have charged').toBeGreaterThan(0)
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

describe('the meter reaches the app as a number, not as a stream', () => {
  /*
   * `accessibility.md` §3.1 requires the control to communicate charge progress
   * while charging. The obvious way to do that is to publish the fraction every
   * step, which would be 120 events a second into Vue for a bar that moves a
   * couple of percent per second. So the loop emits the *displayed* percent and
   * nothing else, and these hold that shape.
   */

  /** Every `slayyy_charge` the loop emitted over `steps` simulation steps. */
  function chargeEvents(steps: number): number[] {
    const percents: number[] = []
    const loop = createRunLoop({
      seed: 7,
      onEvent: (event) => {
        if (event.type === 'slayyy_charge') percents.push(event.percent)
      },
    })

    frames(loop, steps)

    return percents
  }

  it('starts at nothing and climbs', () => {
    const percents = chargeEvents(READY_STEPS + 1200)

    expect(percents.length).toBeGreaterThan(0)
    expect(percents[0]).toBeGreaterThan(0)
    expect(percents.at(-1)).toBeGreaterThan(percents[0] as number)
  })

  it('never repeats a value, and never goes backwards while charging', () => {
    const percents = chargeEvents(READY_STEPS + 2400)

    for (let i = 1; i < percents.length; i++) {
      expect(percents[i], `event ${i}`).toBeGreaterThan(percents[i - 1] as number)
    }
  })

  it('emits far fewer events than there are steps', () => {
    const steps = 2400
    const percents = chargeEvents(READY_STEPS + steps)

    // The meter is floored to a whole percent and capped at 100, so it can
    // never emit more than 100 events however the rates are tuned. Anything
    // close to one event per step is the fraction leaking through.
    expect(percents.length).toBeLessThan(steps / 20)
  })

  it('agrees with the snapshot the renderer is drawing', () => {
    const loop = createRunLoop({ seed: 7 })

    frames(loop, READY_STEPS + 1200)

    const snapshot = toRenderSnapshot(loop.debugState())

    expect(snapshot.slayyy.percent).toBe(Math.floor(snapshot.slayyy.charge * 100))
  })

  it('never reads 100 while the control is still disabled', () => {
    /*
     * Floored, not rounded. A meter that says 100% beside a button that does
     * nothing is a bug report, and rounding would produce exactly that for the
     * last half-percent of every charge.
     */
    const loop = createRunLoop({ seed: 7 })

    for (let i = 0; i < 20_000; i++) {
      loop.frame(STEP_MS)

      const state = loop.debugState()

      if (state.phase === 'ended') break

      const snapshot = toRenderSnapshot(state)

      if (snapshot.slayyy.percent === 100) {
        expect(state.slayyy.phase, 'a full meter must be armed').toBe('ready')
      }
    }
  })
})
