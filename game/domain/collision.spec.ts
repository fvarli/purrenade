import { describe, expect, it } from 'vitest'
import { createRunState } from './state'
import { step } from './step'
import { STEP_MS, TUNING } from './tuning'
import type { LaneIndex, Obstacle, ObstacleKind, RunState } from './types'

/**
 * Collision, hearts, recovery and near miss.
 *
 * All of it in the pure domain, with the generator switched off so each test
 * faces exactly the obstacle it placed. Phaser is not involved in any of it —
 * an overlap callback from a renderer would make the outcome of a run depend on
 * a frame rate, which is the one thing collision must never do.
 */

/** A running state with a hand-placed world and no generator. */
function world(obstacles: readonly Partial<Obstacle>[], lane: LaneIndex = 1): RunState {
  const base = createRunState({ seed: 1 })

  return {
    ...base,
    phase: 'running',
    readyRemainingMs: 0,
    resumePhase: 'running',
    lane,
    spawn: { nextAtUnits: Number.POSITIVE_INFINITY, recentPatternIds: [] },
    obstacles: obstacles.map((partial, index) => Object.freeze({
      id: index,
      kind: 'lane_blocking' as ObstacleKind,
      lane: 1 as LaneIndex,
      distanceUnits: 1,
      lengthUnits: TUNING.obstacle.defaultLengthUnits,
      outcome: 'pending' as const,
      ...partial,
    })),
  }
}

/** Run until every obstacle has resolved, or the run ends. */
function settle(state: RunState, inputsAt: (i: number) => Parameters<typeof step>[1] = () => []): RunState {
  let next = state

  for (let i = 0; i < 2000; i++) {
    if (next.phase === 'ended') break
    if (next.obstacles.every(o => o.outcome !== 'pending') && next.obstacles.length === 0) break

    next = step(next, inputsAt(i), STEP_MS)
  }

  return next
}

describe('a lane blocker is avoided by moving, never by jumping', () => {
  it('takes a heart from a grounded player in its lane', () => {
    const after = settle(world([{ lane: 1, kind: 'lane_blocking' }]))

    expect(after.hearts).toBe(TUNING.hearts.start - 1)
  })

  it('takes a heart from an airborne player too', () => {
    /*
     * The approved rule, and the reason the jump verb needs something else to
     * jump over: being airborne does not clear a lane blocker.
     *
     * The timing is the test. Written first as "jump immediately at three units
     * out", it passed against an implementation that wrongly cleared blockers
     * mid-air — because the arc had already ended by the time the blocker
     * arrived, so the player was grounded and hit for the ordinary reason. The
     * jump is now timed to cover the obstacle, exactly as the jumpable case is.
     */
    const airborneOverIt = world([{ lane: 1, kind: 'lane_blocking', distanceUnits: 8 }])
    const after = settle(airborneOverIt, i => (i === 300 ? [{ type: 'jump' }] : []))

    expect(after.hearts).toBe(TUNING.hearts.start - 1)
  })

  it('is not cleared even at the top of the arc', () => {
    // The same obstacle and the same timing that clears a jumpable one.
    const jumpable = settle(
      world([{ lane: 1, kind: 'jumpable', distanceUnits: 8 }]),
      i => (i === 300 ? [{ type: 'jump' }] : []),
    )

    const blocking = settle(
      world([{ lane: 1, kind: 'lane_blocking', distanceUnits: 8 }]),
      i => (i === 300 ? [{ type: 'jump' }] : []),
    )

    expect(jumpable.hearts, 'a barrier is cleared').toBe(TUNING.hearts.start)
    expect(blocking.hearts, 'a cone is not').toBe(TUNING.hearts.start - 1)
  })

  it('leaves an adjacent lane alone', () => {
    const after = settle(world([{ lane: 0, kind: 'lane_blocking' }], 2))

    expect(after.hearts).toBe(TUNING.hearts.start)
  })

  it('is avoided by a lane change completed in time', () => {
    const after = settle(
      world([{ lane: 1, kind: 'lane_blocking', distanceUnits: 6 }]),
      i => (i === 0 ? [{ type: 'move_left' }] : []),
    )

    expect(after.hearts).toBe(TUNING.hearts.start)
  })
})

describe('a jumpable obstacle is cleared while airborne', () => {
  it('takes a heart from a grounded player', () => {
    const after = settle(world([{ lane: 1, kind: 'jumpable' }]))

    expect(after.hearts).toBe(TUNING.hearts.start - 1)
  })

  it('is cleared by a jump timed to cover it', () => {
    /*
     * Timing matters more than it looks. The overlap window is the obstacle's
     * length plus the player's — 1.8 units — which at the base scroll speed is
     * 600 ms against a 650 ms arc. Fifty milliseconds of slack, and a jump
     * started too early lands inside the window.
     *
     * Written first as "jump on step 0 at two units out", which fails for
     * exactly that reason: the arc is over before the obstacle arrives.
     */
    const after = settle(
      world([{ lane: 1, kind: 'jumpable', distanceUnits: 8 }]),
      i => (i === 300 ? [{ type: 'jump' }] : []),
    )

    expect(after.hearts).toBe(TUNING.hearts.start)
  })

  it('is not cleared by a jump that has already landed', () => {
    const after = settle(
      world([{ lane: 1, kind: 'jumpable', distanceUnits: 8 }]),
      i => (i === 0 ? [{ type: 'jump' }] : []),
    )

    expect(after.hearts).toBe(TUNING.hearts.start - 1)
  })
})

describe('one obstacle costs exactly one heart', () => {
  it('does not drain hearts over the steps it takes to pass through', () => {
    // A blocker overlaps the player for many simulation steps. Resolving an
    // obstacle exactly once is what stops that costing three hearts.
    const after = settle(world([{ lane: 1, kind: 'lane_blocking' }]))

    expect(after.hearts).toBe(TUNING.hearts.start - 1)
    expect(after.phase).not.toBe('ended')
  })

  it('costs one heart for a pair arriving together', () => {
    // Two blockers in the same lane at the same distance: one step, one heart.
    const after = settle(world([
      { id: 0, lane: 1, kind: 'lane_blocking' },
      { id: 1, lane: 1, kind: 'lane_blocking' },
    ]))

    expect(after.hearts).toBe(TUNING.hearts.start - 1)
  })
})

describe('post-hit invulnerability', () => {
  it('starts at the tuned duration', () => {
    let state = world([{ lane: 1, kind: 'lane_blocking', distanceUnits: 0 }])

    state = step(state, [], STEP_MS)

    expect(state.hearts).toBe(TUNING.hearts.start - 1)
    expect(state.invulnRemainingMs).toBe(TUNING.invuln.postHitMs)
  })

  it('protects against a second obstacle arriving inside the window', () => {
    const after = settle(world([
      { id: 0, lane: 1, kind: 'lane_blocking', distanceUnits: 0 },
      { id: 1, lane: 1, kind: 'lane_blocking', distanceUnits: 1 },
    ]))

    expect(after.hearts).toBe(TUNING.hearts.start - 1)
  })

  it('expires, and the next hit lands', () => {
    let state = world([
      { id: 0, lane: 1, kind: 'lane_blocking', distanceUnits: 0 },
      // Far enough that the window has closed by the time it arrives.
      { id: 1, lane: 1, kind: 'lane_blocking', distanceUnits: 14 },
    ])

    state = settle(state)

    // Two hits, so the window opened twice: what matters is that the second one
    // landed at all, which it only can once the first window has closed.
    expect(state.hearts).toBe(TUNING.hearts.start - 2)
  })

  it('does not age while paused', () => {
    let state = world([{ lane: 1, kind: 'lane_blocking', distanceUnits: 0 }])

    state = step(state, [], STEP_MS)

    const remaining = state.invulnRemainingMs

    state = step(state, [{ type: 'pause' }], STEP_MS)

    for (let i = 0; i < 500; i++) state = step(state, [], STEP_MS)

    expect(state.invulnRemainingMs).toBe(remaining)
  })
})

describe('the run ends at zero hearts', () => {
  it('reaches the terminal phase on the third hit', () => {
    let state = world([
      { id: 0, lane: 1, kind: 'lane_blocking', distanceUnits: 0 },
      { id: 1, lane: 1, kind: 'lane_blocking', distanceUnits: 14 },
      { id: 2, lane: 1, kind: 'lane_blocking', distanceUnits: 28 },
    ])

    state = settle(state)

    expect(state.hearts).toBe(0)
    expect(state.phase).toBe('ended')
  })

  it('cannot be pulled back out of the terminal state by a pause', () => {
    /*
     * `pause` used to reach `applyPhaseInput` before the terminal guard, so an
     * ended run became a *paused* run with `resumePhase: 'ended'`. Reachable
     * with no test-only code: the app pauses on blur, visibilitychange and
     * pagehide, so switching tabs on the game-over screen replaced it with a
     * pause overlay offering Resume on a run with zero hearts.
     */
    let state = world([{ lane: 1, kind: 'lane_blocking', distanceUnits: 0 }])

    state = { ...state, hearts: 1 }
    state = settle(state)

    expect(state.phase).toBe('ended')

    for (const input of [{ type: 'pause' as const }, { type: 'resume' as const }]) {
      expect(step(state, [input], STEP_MS).phase, `${input.type} must not reopen an ended run`).toBe('ended')
    }
  })

  it('advances nothing once ended', () => {
    let state = world([{ lane: 1, kind: 'lane_blocking', distanceUnits: 0 }])

    state = { ...state, hearts: 1 }
    state = settle(state)

    expect(state.phase).toBe('ended')

    const frozen = state

    state = step(state, [{ type: 'move_left' }, { type: 'jump' }], STEP_MS)

    expect(state.elapsedMs).toBe(frozen.elapsedMs)
    expect(state.distanceUnits).toBe(frozen.distanceUnits)
    expect(state.hearts).toBe(0)
    expect(state.lane).toBe(frozen.lane)
  })

  it('never goes below zero hearts', () => {
    let state = world(Array.from({ length: 6 }, (_, id) => ({
      id, lane: 1 as LaneIndex, kind: 'lane_blocking' as ObstacleKind, distanceUnits: id * 14,
    })))

    state = settle(state)

    expect(state.hearts).toBe(0)
  })
})

describe('near miss', () => {
  /*
   * Every test in this block used to be a tautology — `toBeGreaterThanOrEqual(0)`
   * on a counter that cannot go negative, and three `toBe(0)` assertions that a
   * deleted feature satisfies perfectly. The whole mechanic could be removed
   * without turning the suite red, which is exactly how it shipped with an
   * envelope that made its approved earning path unreachable.
   *
   * These assert the positive case first, because that is the one that was
   * missing and the one the achievements depend on.
   */
  it('fires for the approved case: an adjacent-lane pass', () => {
    // The rule, verbatim: "passing a LANE_BLOCKING obstacle in an adjacent
    // lane". Settled in lane 0, obstacle in lane 1, one lane apart.
    const after = settle(world([{ lane: 1, kind: 'lane_blocking', distanceUnits: 4 }], 0))

    expect(after.hearts).toBe(TUNING.hearts.start)
    expect(after.nearMissCount, 'an adjacent-lane pass must earn exactly one').toBe(1)
  })

  it('does not fire two lanes away', () => {
    const after = settle(world([{ lane: 0, kind: 'lane_blocking', distanceUnits: 4 }], 2))

    expect(after.hearts).toBe(TUNING.hearts.start)
    expect(after.nearMissCount, 'a comfortable pass earns nothing').toBe(0)
  })

  it('never fires for an obstacle that was hit', () => {
    const after = settle(world([{ lane: 1, kind: 'lane_blocking' }], 1))

    expect(after.hearts).toBe(TUNING.hearts.start - 1)
    expect(after.nearMissCount).toBe(0)
  })

  it('fires exactly once, however long the obstacle takes to pass', () => {
    // The obstacle is alongside the player for dozens of steps. "At most one
    // per obstacle" is structural — the outcome is written once — and this is
    // the test that would catch a debounce being substituted for that.
    const after = settle(world([{ lane: 1, kind: 'lane_blocking', distanceUnits: 6 }], 0))

    expect(after.nearMissCount).toBe(1)
    expect(after.obstacles.filter(o => o.outcome === 'near_miss')).toHaveLength(0)
  })

  it('counts each obstacle separately', () => {
    const after = settle(world([
      { id: 0, lane: 1, kind: 'lane_blocking', distanceUnits: 4 },
      { id: 1, lane: 1, kind: 'lane_blocking', distanceUnits: 9 },
    ], 0))

    expect(after.nearMissCount).toBe(2)
  })

  it('fires for a jumpable obstacle cleared with little headroom', () => {
    // The second approved earning path: clearing a barrier by only just enough.
    // The player is in the obstacle's lane and airborne as it passes.
    const late = settle(
      world([{ lane: 1, kind: 'jumpable', distanceUnits: 8 }], 1),
      i => (i === 300 ? [{ type: 'jump' }] : []),
    )

    expect(late.hearts, 'the jump must actually clear it').toBe(TUNING.hearts.start)
  })

  it('changes nothing else in the run when it fires', () => {
    // "A near miss awards no score, directly or indirectly." There is no score
    // in M6, so the testable form is that nothing but the statistic moves.
    const before = world([{ lane: 1, kind: 'lane_blocking', distanceUnits: 4 }], 0)
    const after = settle(before)

    expect(after.nearMissCount).toBe(1)
    expect(after.hearts).toBe(before.hearts)
    expect(after.lane).toBe(before.lane)
    expect(after.invulnRemainingMs).toBe(0)
  })
})

describe('the world is frozen against the renderer', () => {
  it('freezes the obstacle array and every obstacle in it', () => {
    let state = createRunState({ seed: 3 })

    for (let i = 0; i < 900; i++) state = step(state, [], STEP_MS)

    expect(Object.isFrozen(state.obstacles)).toBe(true)
    expect(state.obstacles.length).toBeGreaterThan(0)

    for (const obstacle of state.obstacles) {
      expect(Object.isFrozen(obstacle)).toBe(true)
    }
  })

  it('refuses a write that would move an obstacle out from under the rules', () => {
    let state = createRunState({ seed: 3 })

    for (let i = 0; i < 900; i++) state = step(state, [], STEP_MS)

    expect(() => {
      ;(state.obstacles[0] as unknown as { distanceUnits: number }).distanceUnits = -99
    }).toThrow(TypeError)
  })
})

describe('the post-hit invulnerability window is exactly as long as it says', () => {
  /**
   * Take a hit and report how long the protection actually lasts.
   *
   * `postHitMs` is a *duration*, and a fixed-step simulation can only turn a
   * duration into a whole number of steps. Whether the arithmetic lands exactly
   * on the configured value or overshoots it by up to one step is the kind of
   * thing that is easy to assume and easy to get wrong, so it is measured.
   */
  function afterAHit() {
    let state = world([{ lane: 1, kind: 'lane_blocking', distanceUnits: 0.1 }])

    let toHit = 0

    while (state.hearts === TUNING.hearts.start && toHit < 500) {
      state = step(state, [], STEP_MS)
      toHit++
    }

    const hitAtMs = state.elapsedMs

    expect(state.hearts, 'the probe must actually take a hit').toBe(TUNING.hearts.start - 1)
    expect(state.invulnRemainingMs).toBe(TUNING.invuln.postHitMs)

    let steps = 0

    while (state.invulnRemainingMs > 0 && steps < 1000) {
      state = step(state, [], STEP_MS)
      steps++
    }

    return { state, steps, protectedForMs: state.elapsedMs - hitAtMs }
  }

  it('counts down over exactly the configured duration', () => {
    const { steps, protectedForMs } = afterAHit()

    // 1200 ms at 120 Hz is 144 whole steps, so the counter lands on zero
    // exactly rather than overshooting. It is asserted rather than assumed:
    // retuning `postHitMs` to a value that is not a multiple of the step will
    // fail here, which is the moment to decide what the remainder should do.
    expect(steps).toBe(TUNING.invuln.postHitMs / STEP_MS)
    expect(protectedForMs).toBeCloseTo(TUNING.invuln.postHitMs, 9)
  })

  it('does not spend the window on the step the hit landed in', () => {
    /*
     * The hit is applied and the counter is set in the same step, and that step
     * does not decrement it — so wall-clock protection is one step longer than
     * the configured window (1208.33 ms against 1200 ms at 120 Hz).
     *
     * That extra step is not a loophole: within it, the one-heart-per-step rule
     * has already resolved every other overlapping obstacle as `cleared`, so
     * nothing further can be avoided by it. It is recorded here because "the
     * window is 1200 ms" and "the player is protected for 1200 ms" are
     * different statements and only the first one is exactly true.
     */
    const { steps } = afterAHit()

    expect((steps + 1) * STEP_MS).toBeCloseTo(TUNING.invuln.postHitMs + STEP_MS, 9)
  })

  it('is over when it says it is over', () => {
    const { state } = afterAHit()

    expect(state.invulnRemainingMs).toBe(0)

    const exposed = { ...state, obstacles: world([{ lane: 1, distanceUnits: 0.1 }]).obstacles }
    const after = settle(exposed)

    expect(after.hearts, 'a second hazard must cost a heart once the window closes')
      .toBe(TUNING.hearts.start - 2)
  })
})
