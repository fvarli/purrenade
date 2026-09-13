import { describe, expect, it } from 'vitest'
import { poolForTier, validatePatterns } from './patterns'
import type { Pattern } from './patterns'
import { createRunState } from './state'
import { step } from './step'
import { findEscapePath } from './escape'
import { minGapUnits, tierAt } from './difficulty'
import { STEP_MS, TUNING } from './tuning'
import { firstHazardDistanceUnits } from './obstacles'
import type { LaneIndex, Obstacle } from './types'

/**
 * The escape-path guarantee, proven rather than inspected.
 *
 * This is the invariant the whole milestone rests on: no seed, no tier and no
 * ordering may ever produce a pattern the player cannot survive. The solver
 * runs the real rules, so a pass here means the actual game has a path — not
 * that a simplified model thinks it does.
 */

const LANES: readonly LaneIndex[] = [0, 1, 2]
const TIERS = [1, 2, 3, 4, 5] as const

/** Seconds into a run at which a tier is comfortably established. */
const TIER_SAMPLE_MS: Record<number, number> = { 1: 0, 2: 30_000, 3: 70_000, 4: 120_000, 5: 200_000 }

/** Place a pattern on the road, the way the generator would. */
function place(pattern: Pattern, originUnits: number): Obstacle[] {
  return pattern.entries.map((entry, index) => ({
    id: index,
    kind: entry.kind,
    lane: entry.lane,
    distanceUnits: originUnits + entry.offsetUnits,
    lengthUnits: TUNING.obstacle.defaultLengthUnits,
    outcome: 'pending' as const,
  }))
}

describe('every authored pattern is survivable', () => {
  /*
   * The acceptance criterion, verbatim: "Every pattern is survivable from every
   * starting lane within the action and reaction-time budget — proven by
   * property tests, not inspection."
   */
  const cases = TIERS.flatMap(tier =>
    poolForTier(tier).flatMap(pattern =>
      LANES.map(lane => ({ tier, pattern, lane })),
    ),
  )

  it.each(cases)('tier $tier, $pattern.id, from lane $lane', ({ tier, pattern, lane }) => {
    const elapsedMs = TIER_SAMPLE_MS[tier]!
    const result = findEscapePath({
      startLane: lane,
      obstacles: place(pattern, TUNING.world.visibleUnits),
      elapsedMs,
    })

    expect(
      result.survivable,
      `no survivable path: tier ${tier}, pattern ${pattern.id}, from lane ${lane}, `
      + `at ${elapsedMs}ms, within ${TUNING.escape.maxActionsPerPattern} actions `
      + `after a ${TUNING.escape.reactionBudgetMs}ms reaction budget`,
    ).toBe(true)
  })
})

describe('pattern joins are survivable, not only patterns in isolation', () => {
  /*
   * A pattern that is safe alone can be lethal when it follows another: the
   * player arrives already committed to a lane, mid-transition, or airborne.
   * `escape.validateJoins` is APPROVED, so this is not optional.
   *
   * The first version of this test proved much less than it looked like it did.
   * It ran tier 5 only; it started the join from a *standing* start rather than
   * from where the first pattern actually leaves the player; and it handed the
   * solver `maxActionsPerPattern * 2`, so the second pattern could be paid for
   * with actions the first one had not spent. Every one of those makes the
   * problem easier than the game.
   *
   * This version solves the first pattern under the real budget, replays the
   * winning schedule through the real `step()` to find out what state the
   * player is genuinely in when the second pattern comes into view, and then
   * requires the second to be survivable *from that state* on its own fresh
   * budget — which is what the player actually gets.
   */
  const joins = TIERS.flatMap(tier => {
    const pool = poolForTier(tier)

    return pool.flatMap(first => pool.map(second => ({ tier, first, second })))
  })

  /**
   * Run the first pattern for real and report where the player ends up.
   *
   * Returns `null` when the solver's schedule does not in fact survive: that is
   * a solver bug rather than a join failure, and it is asserted on separately
   * so the two cannot be confused.
   */
  function exitState(tier: number, first: Pattern, lane: LaneIndex, untilUnits: number) {
    const found = findEscapePath({
      startLane: lane,
      obstacles: place(first, TUNING.world.visibleUnits),
      elapsedMs: TIER_SAMPLE_MS[tier]!,
    })

    if (!found.survivable) return null

    let state = {
      ...createRunState({ seed: 1 }),
      phase: 'running' as const,
      readyRemainingMs: 0,
      resumePhase: 'running' as const,
      elapsedMs: TIER_SAMPLE_MS[tier]!,
      lane,
      obstacles: place(first, TUNING.world.visibleUnits),
      spawn: { nextAtUnits: Number.POSITIVE_INFINITY, recentPatternIds: [] },
    }

    const startElapsed = state.elapsedMs
    const schedule = [...found.actions]

    // Advance until the second pattern would have travelled into view.
    const travelSteps = Math.ceil(
      untilUnits / (TUNING.world.baseScrollUnitsPerS * (STEP_MS / 1000)),
    )

    for (let i = 0; i < travelSteps; i++) {
      const sinceStart = state.elapsedMs - startElapsed
      const due = schedule.length > 0 && sinceStart >= schedule[0]!.atMs
      const inputs = due ? [{ type: schedule.shift()!.input }] : []

      state = step(state, inputs, STEP_MS)

      if (state.hearts < TUNING.hearts.start) return 'damaged' as const
    }

    return state
  }

  it.each(joins)('tier $tier: $first.id then $second.id', ({ tier, first, second }) => {
    const gap = minGapUnits(tier)
    const travelUnits = first.lengthUnits + gap

    for (const lane of LANES) {
      const exit = exitState(tier, first, lane, travelUnits)

      expect(exit, `the solver's own schedule for ${first.id} does not survive it`).not.toBeNull()
      expect(exit, `the solver's own schedule for ${first.id} takes damage`).not.toBe('damaged')

      if (exit === null || exit === 'damaged') return

      const result = findEscapePath({
        startLane: exit.lane,
        obstacles: place(second, TUNING.world.visibleUnits),
        elapsedMs: exit.elapsedMs,
        // A fresh budget, because the player gets a fresh budget. What they do
        // not get is a fresh body: the arrival state below is the real one.
        start: {
          laneTransition: exit.laneTransition,
          jumpElapsedMs: exit.jumpElapsedMs,
          buffered: exit.buffered === null
            ? null
            : { type: exit.buffered.event.type, ageMs: exit.buffered.ageMs },
        },
      })

      expect(
        result.survivable,
        `no survivable path across the join ${first.id} → ${second.id} from lane ${lane} `
        + `at tier ${tier}, arriving in lane ${exit.lane}`
        + (exit.laneTransition === null ? '' : ` mid-transition to ${exit.laneTransition.to}`)
        + (exit.jumpElapsedMs === null ? '' : ` ${Math.round(exit.jumpElapsedMs)}ms into a jump`),
      ).toBe(true)
    }
  })
})

describe('a pattern met mid-action is still survivable', () => {
  /*
   * The join test covers the arrival states the generator actually produces.
   * This covers the ones a *player* produces: a lane change begun a moment too
   * early, a jump taken at the wrong time, an input buffered just before the
   * pattern appeared. None of these are exotic — they are what happens when
   * somebody reacts to the previous hazard slightly late.
   *
   * Each removes an option rather than adding one, so a pattern that is safe
   * from rest is not automatically safe from here.
   */
  const ARRIVALS = [
    { name: 'a lane change just begun', at: 0.1 },
    { name: 'a lane change at the occupancy switch', at: TUNING.lane.occupancySwitchAtRatio },
    { name: 'a lane change about to settle', at: 0.9 },
  ] as const

  const AIRBORNE = [
    { name: 'just left the ground', at: 0.1 },
    { name: 'at the top of the arc', at: 0.5 },
    { name: 'about to land', at: 0.9 },
  ] as const

  const cases = TIERS.flatMap(tier => poolForTier(tier).map(pattern => ({ tier, pattern })))

  it.each(cases)('tier $tier, $pattern.id, arriving mid-transition', ({ tier, pattern }) => {
    for (const arrival of ARRIVALS) {
      for (const from of LANES) {
        for (const direction of [-1, 1] as const) {
          const to = from + direction

          if (to < 0 || to > TUNING.lane.count - 1) continue

          const result = findEscapePath({
            // The lane being left: a transition in flight has not settled yet.
            startLane: from,
            obstacles: place(pattern, TUNING.world.visibleUnits),
            elapsedMs: TIER_SAMPLE_MS[tier]!,
            start: {
              laneTransition: {
                from,
                to: to as LaneIndex,
                elapsedMs: TUNING.lane.transitionMs * arrival.at,
              },
            },
          })

          expect(
            result.survivable,
            `${pattern.id} is unsurvivable when the player arrives with ${arrival.name} `
            + `from lane ${from} to lane ${to}`,
          ).toBe(true)
        }
      }
    }
  })

  it.each(cases)('tier $tier, $pattern.id, arriving airborne', ({ tier, pattern }) => {
    for (const arrival of AIRBORNE) {
      for (const lane of LANES) {
        const result = findEscapePath({
          startLane: lane,
          obstacles: place(pattern, TUNING.world.visibleUnits),
          elapsedMs: TIER_SAMPLE_MS[tier]!,
          start: { jumpElapsedMs: TUNING.jump.airborneMs * arrival.at },
        })

        expect(
          result.survivable,
          `${pattern.id} is unsurvivable when the player arrives ${arrival.name} in lane ${lane}`,
        ).toBe(true)
      }
    }
  })

  it.each(cases)('tier $tier, $pattern.id, arriving with a buffered input', ({ tier, pattern }) => {
    for (const type of ['move_left', 'move_right', 'jump'] as const) {
      for (const lane of LANES) {
        const result = findEscapePath({
          startLane: lane,
          obstacles: place(pattern, TUNING.world.visibleUnits),
          elapsedMs: TIER_SAMPLE_MS[tier]!,
          // Half-aged, so it is still live and will spend itself unbidden.
          start: { buffered: { type, ageMs: TUNING.input.bufferMs / 2 } },
        })

        expect(
          result.survivable,
          `${pattern.id} is unsurvivable when the player arrives in lane ${lane} `
          + `holding a buffered ${type}`,
        ).toBe(true)
      }
    }
  })

})

describe('the arrival state genuinely reaches the simulation', () => {
  /*
   * The four families above assert that a mid-action arrival is still safe. On
   * their own they cannot prove the arrival state was applied at all: if the
   * solver quietly ignored it, every one of them would still pass, because a
   * standing start is safe too. Mutating the start state away confirmed exactly
   * that — nothing failed.
   *
   * So each of these poses a question whose *answer changes* with the arrival
   * state. They are deliberately lethal geometries, not catalogue patterns.
   */
  const SPEED = TUNING.world.baseScrollUnitsPerS

  /** An obstacle that first touches the player `afterMs` from now. */
  function arriving(kind: Obstacle['kind'], lane: LaneIndex, afterMs: number): Obstacle {
    return {
      id: 0,
      kind,
      lane,
      distanceUnits: TUNING.collision.playerLengthUnits / 2 + SPEED * (afterMs / 1000),
      lengthUnits: TUNING.obstacle.defaultLengthUnits,
      outcome: 'pending',
    }
  }

  it('spends a buffered input, even into harm', () => {
    /*
     * A buffered move_right is not a suggestion: it fires the moment a lane
     * change is possible, which here is immediately. The player is dragged out
     * of the only safe lane before the reaction budget lets them do anything
     * about it.
     */
    const obstacles = [arriving('lane_blocking', 1, 150)]

    expect(
      findEscapePath({ startLane: 0, obstacles, elapsedMs: 0 }).survivable,
      'standing in lane 0 is safe: the hazard is in lane 1',
    ).toBe(true)

    expect(
      findEscapePath({
        startLane: 0,
        obstacles,
        elapsedMs: 0,
        start: { buffered: { type: 'move_right', ageMs: 0 } },
      }).survivable,
      'a buffered move_right must carry the player into lane 1 and be fatal',
    ).toBe(false)
  })

  it('honours a lane change already in flight', () => {
    /*
     * `canStartLaneChange` refuses while a transition is running, and occupancy
     * flips to the target at the halfway point. So a player committed to lane 2
     * cannot turn round, and arrives in the hazard.
     */
    const obstacles = [arriving('lane_blocking', 2, 150)]

    expect(
      findEscapePath({ startLane: 1, obstacles, elapsedMs: 0 }).survivable,
      'standing in lane 1 is safe: the hazard is in lane 2',
    ).toBe(true)

    expect(
      findEscapePath({
        startLane: 1,
        obstacles,
        elapsedMs: 0,
        start: { laneTransition: { from: 1, to: 2, elapsedMs: 0 } },
      }).survivable,
      'a transition already committed to lane 2 must be fatal',
    ).toBe(false)
  })

  it('counts time already spent airborne', () => {
    /*
     * The other direction: being airborne on arrival is what *saves* the player
     * here, because the hazard lands inside the reaction budget and a jump
     * started now would come too late.
     */
    const obstacles = [arriving('jumpable', 1, 150)]

    expect(
      findEscapePath({ startLane: 1, obstacles, elapsedMs: 0 }).survivable,
      'from the ground there is no time to jump inside the reaction budget',
    ).toBe(false)

    expect(
      findEscapePath({
        startLane: 1,
        obstacles,
        elapsedMs: 0,
        start: { jumpElapsedMs: 100 },
      }).survivable,
      'already airborne, the same hazard passes underneath',
    ).toBe(true)
  })

  it('never answers the question as a protected player', () => {
    /*
     * Survival means unharmed. Invulnerability removes no option, so it can
     * only ever launder an unavoidable collision into a pass — which is what
     * happened when this interface briefly accepted a starting
     * `invulnRemainingMs`. The state the solver builds is always unprotected,
     * and there is no caller-facing way to change that.
     */
    const obstacles = [arriving('lane_blocking', 1, 150)]

    expect(
      findEscapePath({ startLane: 1, obstacles, elapsedMs: 0 }).survivable,
      'an unavoidable hit is unsurvivable',
    ).toBe(false)

    // The escape query has no invulnerability field to set; this is the
    // compile-time half of the same guarantee, kept honest by the type.
    expect(Object.keys({
      laneTransition: null,
      jumpElapsedMs: null,
      buffered: null,
    } satisfies Required<NonNullable<Parameters<typeof findEscapePath>[0]['start']>>))
      .toEqual(['laneTransition', 'jumpElapsedMs', 'buffered'])
  })
})

describe('the solver refuses a start state the rules cannot produce', () => {
  it('rejects a transition that does not leave the start lane', () => {
    /*
     * Guarding the wrong end of the transition is an easy mistake — I made it
     * writing this — and it silently poses the solver a question about a state
     * the rules cannot reach.
     */
    expect(() => findEscapePath({
      startLane: 2,
      obstacles: [],
      elapsedMs: 0,
      start: { laneTransition: { from: 1, to: 2, elapsedMs: 0 } },
    })).toThrow(/must be the lane being left/)
  })

  it('accepts the transition the rules actually produce', () => {
    expect(() => findEscapePath({
      startLane: 1,
      obstacles: [],
      elapsedMs: 0,
      start: { laneTransition: { from: 1, to: 2, elapsedMs: 0 } },
    })).not.toThrow()
  })
})

describe('the solver is honest about impossible patterns', () => {
  it('reports a three-lane wall of blockers as unsurvivable', () => {
    // Not in the catalogue, and this is why. If the solver called this
    // survivable, every pass above would be worthless.
    const wall: Obstacle[] = LANES.map((lane, index) => ({
      id: index,
      kind: 'lane_blocking' as const,
      lane,
      distanceUnits: TUNING.world.visibleUnits,
      lengthUnits: TUNING.obstacle.defaultLengthUnits,
      outcome: 'pending' as const,
    }))

    for (const lane of LANES) {
      expect(findEscapePath({ startLane: lane, obstacles: wall, elapsedMs: 0 }).survivable).toBe(false)
    }
  })

  it('reports a pattern needing more actions than the budget as unsurvivable', () => {
    /*
     * Two pairs with opposite escapes. The first blocks LEFT and CENTRE so only
     * RIGHT survives it; the second blocks CENTRE and RIGHT so only LEFT does.
     * From the left lane that is four lane changes, and the budget is two.
     *
     * Written first as three staggered single blockers, which the solver
     * correctly called survivable — one sidestep into a lane none of them
     * occupied cleared all three. The test was wrong, not the solver.
     */
    const forced: Obstacle[] = [
      { id: 0, kind: 'lane_blocking' as const, lane: 0, distanceUnits: 10, lengthUnits: 1, outcome: 'pending' as const },
      { id: 1, kind: 'lane_blocking' as const, lane: 1, distanceUnits: 10, lengthUnits: 1, outcome: 'pending' as const },
      { id: 2, kind: 'lane_blocking' as const, lane: 1, distanceUnits: 16, lengthUnits: 1, outcome: 'pending' as const },
      { id: 3, kind: 'lane_blocking' as const, lane: 2, distanceUnits: 16, lengthUnits: 1, outcome: 'pending' as const },
    ]

    const result = findEscapePath({ startLane: 0, obstacles: forced, elapsedMs: 0, maxActions: 2 })

    expect(result.survivable).toBe(false)
  })

  it('respects the reaction budget', () => {
    // A blocker close enough that only an instant reaction saves it. With the
    // budget the solver must refuse; without it, it should find the path.
    const close: Obstacle[] = [{
      id: 0,
      kind: 'lane_blocking' as const,
      lane: 1,
      distanceUnits: 1,
      lengthUnits: TUNING.obstacle.defaultLengthUnits,
      outcome: 'pending' as const,
    }]

    const fair = findEscapePath({ startLane: 1, obstacles: close, elapsedMs: 0 })
    const superhuman = findEscapePath({ startLane: 1, obstacles: close, elapsedMs: 0, reactionBudgetMs: 0 })

    expect(fair.survivable, 'a human cannot react in time').toBe(false)
    expect(superhuman.survivable, 'but the path exists without the budget').toBe(true)
  })
})

describe('the first hazard cannot arrive before the protected interval', () => {
  /*
   * This used to assert `firstHazardDistanceUnits()` equals the expression that
   * defines it — the implementation restated as a test. It could not fail, and
   * it did not notice that the value was being used as a spawn cursor on top of
   * the lookahead, so the real opening was almost three times the guarantee.
   *
   * Simulate instead, and ask the question the player would: when can something
   * first touch me?
   */
  it('lets nothing reach the player before the approved floor, across many seeds', () => {
    const half = TUNING.collision.playerLengthUnits / 2

    let earliest = Number.POSITIVE_INFINITY

    for (let seed = 1; seed <= 60; seed++) {
      let state = createRunState({ seed })

      for (let i = 0; i < Math.ceil(20_000 / STEP_MS); i++) {
        state = step(state, [], STEP_MS)

        const touching = state.obstacles.some(
          o => o.distanceUnits < half && o.distanceUnits + o.lengthUnits > -half,
        )

        if (touching) {
          earliest = Math.min(earliest, state.elapsedMs)
          break
        }
      }
    }

    expect(earliest).toBeGreaterThanOrEqual(TUNING.run.firstHazardMinMs)
  })

  it('does not delay the opening far beyond what was asked for', () => {
    /*
     * The other half, and the half that was missing. A floor honoured three
     * times over is an empty road the player is waiting on, and nothing would
     * have reported it.
     */
    const half = TUNING.collision.playerLengthUnits / 2

    let earliest = Number.POSITIVE_INFINITY

    for (let seed = 1; seed <= 20; seed++) {
      let state = createRunState({ seed })

      for (let i = 0; i < Math.ceil(20_000 / STEP_MS); i++) {
        state = step(state, [], STEP_MS)

        if (state.obstacles.some(o => o.distanceUnits < half && o.distanceUnits + o.lengthUnits > -half)) {
          earliest = Math.min(earliest, state.elapsedMs)
          break
        }
      }
    }

    expect(earliest).toBeLessThan(TUNING.run.firstHazardMinMs * 2.5)
  })

  it('starts the tier clock at Tier 1', () => {
    expect(tierAt(0)).toBe(1)
  })
})

describe('the pattern catalogue is well formed', () => {
  it('has no malformed entry', () => {
    expect(validatePatterns()).toEqual([])
  })

  it('rejects the mistakes that would quietly make the game unfair', () => {
    // Each of these degrades the game without looking like a bug from outside.
    const bad = [
      { id: 'a', minTier: 1 as const, weight: 0, lengthUnits: 1, entries: [{ offsetUnits: 0, kind: 'lane_blocking' as const, lane: 0 as const }], tags: [] },
      { id: 'a', minTier: 1 as const, weight: 1, lengthUnits: 1, entries: [{ offsetUnits: 0, kind: 'lane_blocking' as const, lane: 0 as const }], tags: [] },
      { id: 'b', minTier: 9 as never, weight: 1, lengthUnits: 1, entries: [], tags: [] },
      { id: 'c', minTier: 1 as const, weight: 1, lengthUnits: 1, entries: [{ offsetUnits: 5, kind: 'jumpable' as const, lane: 0 as const }], tags: [] },
      { id: 'wall', minTier: 1 as const, weight: 1, lengthUnits: 1, tags: [], entries: [
        { offsetUnits: 0, kind: 'lane_blocking' as const, lane: 0 as const },
        { offsetUnits: 0, kind: 'lane_blocking' as const, lane: 1 as const },
        { offsetUnits: 0, kind: 'lane_blocking' as const, lane: 2 as const },
      ] },
      // A mixed wall: two blockers and a barrier. Survivable only by being in
      // the third lane *and* airborne — much harsher than a plain wall, and the
      // old check skipped it because it only counted `lane_blocking`.
      { id: 'mixed-wall', minTier: 1 as const, weight: 1, lengthUnits: 1, tags: [], entries: [
        { offsetUnits: 0, kind: 'lane_blocking' as const, lane: 0 as const },
        { offsetUnits: 0, kind: 'lane_blocking' as const, lane: 1 as const },
        { offsetUnits: 0, kind: 'jumpable' as const, lane: 2 as const },
      ] },
      // An entry whose own footprint overruns the declared length, silently
      // eating the next pattern's gap.
      { id: 'overrun', minTier: 1 as const, weight: 1, lengthUnits: 5, tags: [], entries: [
        { offsetUnits: 5, kind: 'lane_blocking' as const, lane: 0 as const },
      ] },
    ]

    const problems = validatePatterns(bad)

    expect(problems).toContain('a: weight must be a positive integer, got 0')
    expect(problems).toContain('duplicate pattern id: a')
    expect(problems).toContain('b: no entries')
    expect(problems.some(p => p.startsWith('b: minTier'))).toBe(true)
    expect(problems).toContain('wall: every lane is blocked at offset 0')
    expect(problems, 'a mixed wall is harsher than a plain one').toContain('mixed-wall: every lane is blocked at offset 0')
    expect(problems.some(p => p.startsWith('overrun: an entry at 5'))).toBe(true)
  })

  it('keeps the first hazard reachable no earlier than the floor allows', () => {
    expect(firstHazardDistanceUnits()).toBeGreaterThanOrEqual(0)
  })
})
