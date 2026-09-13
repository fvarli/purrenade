import { describe, expect, it } from 'vitest'
import { createRunState } from './state'
import { step } from './step'
import { STEP_MS, TUNING } from './tuning'
import { findEscapePath } from './escape'
import { minGapUnits, tierAt } from './difficulty'
import { eligiblePatterns } from './obstacles'
import type { Obstacle, RunState } from './types'

/**
 * The generated world, under seeds and over minutes.
 *
 * The per-pattern proofs live in `escape.spec.ts`. What this file adds is the
 * generator: real weighted selection, real cooldown, real gaps, real tier
 * transitions — and the assertion that nothing it emits over simulated minutes
 * is a pattern a player could not have survived.
 *
 * The sample is sized for CI. `PURRENADE_FUZZ_SEEDS` raises it for a local
 * audit pass without making every push wait on it.
 */

const CI_SEEDS = 24
const SEEDS = Number(process.env.PURRENADE_FUZZ_SEEDS ?? CI_SEEDS)

/*
 * Five minutes, not three.
 *
 * Tier 5 starts at 180 s, so a three-minute window ended on the boundary: the
 * run reached Tier 5 and stopped before the generator drew a single Tier 5
 * pattern from its pool. The fuzz was reporting a clean sweep over a tier it
 * had never generated. Five minutes leaves two full minutes inside the terminal
 * tier, and the tier-coverage assertion below makes the omission impossible to
 * reintroduce quietly.
 */
const MINUTES = 5

/** Run the generator forward, keeping the player alive so generation continues. */
function generate(seed: number, minutes: number): { spawns: SpawnRecord[], final: RunState } {
  let state = createRunState({ seed })

  const spawns: SpawnRecord[] = []
  const steps = Math.ceil((minutes * 60 * 1000) / STEP_MS)

  for (let i = 0; i < steps; i++) {
    const before = state.nextObstacleId

    state = step(state, [], STEP_MS)

    if (state.nextObstacleId !== before) {
      spawns.push({
        elapsedMs: state.elapsedMs,
        obstacles: state.obstacles.filter(o => o.id >= before),
      })
    }

    // Generation does not depend on hearts, and a dead run stops generating.
    // Topping them up keeps the *generator* under test for the full window.
    if (state.hearts < TUNING.hearts.max || state.phase === 'ended') {
      state = { ...state, hearts: TUNING.hearts.max, phase: 'running', invulnRemainingMs: 0 }
    }
  }

  return { spawns, final: state }
}

interface SpawnRecord {
  readonly elapsedMs: number
  readonly obstacles: readonly Obstacle[]
}

/** Re-place a recorded spawn at the distance the player first sees it. */
function atVisibleRange(record: SpawnRecord): Obstacle[] {
  const nearest = Math.min(...record.obstacles.map(o => o.distanceUnits))
  const shift = nearest - TUNING.world.visibleUnits

  return record.obstacles.map(o => ({ ...o, distanceUnits: o.distanceUnits - shift }))
}

describe('seeded generation is survivable over simulated minutes', () => {
  it(`emits only survivable patterns across ${SEEDS} seeds × ${MINUTES} minutes`, () => {
    const failures: string[] = []
    const tiersSeen = new Set<number>()

    let checked = 0

    for (let seed = 1; seed <= SEEDS; seed++) {
      const { spawns } = generate(seed, MINUTES)

      expect(spawns.length, `seed ${seed} generated nothing`).toBeGreaterThan(0)

      for (const record of spawns) {
        const obstacles = atVisibleRange(record)

        tiersSeen.add(tierAt(record.elapsedMs))

        for (const lane of [0, 1, 2] as const) {
          checked++

          const result = findEscapePath({ startLane: lane, obstacles, elapsedMs: record.elapsedMs })

          if (!result.survivable) {
            failures.push(
              `seed ${seed}, tier ${tierAt(record.elapsedMs)}, at ${Math.round(record.elapsedMs)}ms, `
              + `from lane ${lane}: ${JSON.stringify(obstacles.map(o => [o.kind, o.lane, o.distanceUnits.toFixed(2)]))}`,
            )
          }
        }
      }
    }

    expect(checked).toBeGreaterThan(1000)
    expect(failures.slice(0, 5)).toEqual([])

    // A sweep that never reaches a tier proves nothing about it.
    expect([...tiersSeen].sort(), 'the fuzz must generate every tier').toEqual([1, 2, 3, 4, 5])
  }, 180_000)
})

describe('the generated world keeps its invariants', () => {
  it('holds every structural invariant across a long run', () => {
    /*
     * Violations are collected and asserted once at the end rather than
     * `expect`-ed inside the loop. Half a million assertions cost more than the
     * simulation they were checking, and a suite slow enough to skip is a suite
     * that stops catching things.
     */
    const problems: string[] = []

    let totalSteps = 0
    let peakObstacles = 0

    for (let seed = 1; seed <= 12; seed++) {
      let state = createRunState({ seed })

      const steps = Math.ceil((5 * 60 * 1000) / STEP_MS)

      let lastTier = 1

      for (let i = 0; i < steps; i++) {
        state = step(state, i % 37 === 0 ? [{ type: 'jump' }] : [], STEP_MS)
        totalSteps++

        if (state.phase === 'ended') {
          state = { ...state, hearts: TUNING.hearts.max, phase: 'running', invulnRemainingMs: 0 }
        }

        if (state.obstacles.length > peakObstacles) peakObstacles = state.obstacles.length

        const ids = new Set<number>()

        for (const obstacle of state.obstacles) {
          if (!Number.isFinite(obstacle.distanceUnits)) problems.push(`seed ${seed} step ${i}: non-finite distance`)
          if (obstacle.lane < 0 || obstacle.lane > TUNING.lane.count - 1) problems.push(`seed ${seed} step ${i}: lane ${obstacle.lane}`)
          if (!(obstacle.lengthUnits > 0)) problems.push(`seed ${seed} step ${i}: length ${obstacle.lengthUnits}`)
          if (ids.has(obstacle.id)) problems.push(`seed ${seed} step ${i}: duplicate id ${obstacle.id}`)

          ids.add(obstacle.id)
        }

        if (state.hearts < 0 || state.hearts > TUNING.hearts.max) problems.push(`seed ${seed} step ${i}: hearts ${state.hearts}`)
        if (state.invulnRemainingMs < 0) problems.push(`seed ${seed} step ${i}: invuln ${state.invulnRemainingMs}`)
        if (!Number.isFinite(state.distanceUnits)) problems.push(`seed ${seed} step ${i}: non-finite distance travelled`)

        const tier = tierAt(state.elapsedMs)

        if (tier < lastTier) problems.push(`seed ${seed} step ${i}: tier went backwards`)
        lastTier = tier

        if (problems.length > 0) break
      }

      if (problems.length > 0) break
    }

    expect(problems.slice(0, 5)).toEqual([])
    expect(totalSteps, 'the sample must be large enough to matter').toBeGreaterThan(100_000)
    expect(peakObstacles, 'the world must stay bounded').toBeLessThan(40)
  }, 120_000)

  it('despawns everything it spawns', () => {
    let state = createRunState({ seed: 99 })

    for (let i = 0; i < Math.ceil(60_000 / STEP_MS); i++) {
      state = step(state, [], STEP_MS)

      if (state.phase === 'ended') {
        state = { ...state, hearts: TUNING.hearts.max, phase: 'running', invulnRemainingMs: 0 }
      }
    }

    const spawned = state.nextObstacleId

    // Let the road empty with generation pushed out of reach.
    state = { ...state, spawn: { nextAtUnits: Number.POSITIVE_INFINITY, recentPatternIds: [] } }

    /*
     * Long enough for the deepest obstacle to travel the full lookahead plus the
     * despawn margin — and kept alive while it does. Without the top-up the run
     * ends part-way through the drain, `step` returns early, and the remaining
     * obstacles simply stop moving: the test then reports a despawn leak that is
     * really a dead run.
     */
    for (let i = 0; i < Math.ceil(60_000 / STEP_MS) && state.obstacles.length > 0; i++) {
      state = step(state, [], STEP_MS)

      if (state.phase === 'ended') {
        state = { ...state, hearts: TUNING.hearts.max, phase: 'running', invulnRemainingMs: 0 }
      }
    }

    expect(spawned).toBeGreaterThan(0)
    expect(state.obstacles, 'passed obstacles must not accumulate').toEqual([])
  })
})

describe('generation is reproducible from a seed', () => {
  it('produces an identical world for the same seed and inputs', () => {
    const trace = (seed: number): string => {
      let state = createRunState({ seed })
      const marks: string[] = []

      for (let i = 0; i < 6000; i++) {
        state = step(state, i % 53 === 0 ? [{ type: 'move_left' }] : [], STEP_MS)

        if (state.phase === 'ended') break

        if (i % 100 === 0) {
          marks.push(state.obstacles.map(o => `${o.id}:${o.kind}:${o.lane}:${o.distanceUnits.toFixed(6)}`).join(','))
        }
      }

      return marks.join('|')
    }

    expect(trace(4242)).toBe(trace(4242))
  })

  it('produces a different world for a different seed', () => {
    /*
     * This compared `String(state.nextObstacleId)` between two seeds and
     * asserted `!(a === b && a === '0')` — a conjunction that is false whenever
     * either seed spawned anything, so two byte-identical worlds passed. It
     * would have stayed green with `selectPattern` hard-coded to the first
     * pattern, which is very close to what the repeat cooldown was actually
     * doing at tier 1.
     */
    const world = (seed: number): string => {
      let state = createRunState({ seed })
      const emitted: string[] = []

      for (let i = 0; i < Math.ceil(90_000 / STEP_MS); i++) {
        const before = state.nextObstacleId

        state = step(state, [], STEP_MS)

        if (state.phase === 'ended') {
          state = { ...state, hearts: TUNING.hearts.max, phase: 'running', invulnRemainingMs: 0 }
        }

        for (const obstacle of state.obstacles) {
          if (obstacle.id >= before) emitted.push(`${obstacle.kind}:${obstacle.lane}`)
        }
      }

      return emitted.join(',')
    }

    const a = world(1)
    const b = world(2)

    expect(a.length, 'each seed must actually generate something').toBeGreaterThan(0)
    expect(a, 'two seeds must not produce the same road').not.toBe(b)
  })

  it('keeps the seed meaningful in the tier where every run starts', () => {
    /*
     * `generator.repeatCooldown` is 3 and the tier-1 pool has four patterns, so
     * the cooldown used to leave exactly one candidate from the fourth spawn
     * onward: a fixed rotation, identical for every seed, with the RNG draw
     * still being consumed so it looked random. The first thirty seconds of
     * every run — where most runs happen — were the same road.
     */
    const opening = (seed: number): string => {
      let state = createRunState({ seed })
      const ids: string[] = []

      for (let i = 0; i < Math.ceil(28_000 / STEP_MS); i++) {
        state = step(state, [], STEP_MS)

        if (state.phase === 'ended') {
          state = { ...state, hearts: TUNING.hearts.max, phase: 'running', invulnRemainingMs: 0 }
        }

        const latest = state.spawn.recentPatternIds[0]

        if (latest !== undefined && latest !== ids[ids.length - 1]) ids.push(latest)
      }

      return ids.join(',')
    }

    const openings = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(opening))

    expect(openings.size, 'eight seeds should not share one opening').toBeGreaterThan(2)
  })

  it('always leaves the generator a real choice', () => {
    /*
     * The direct form of the invariant, because comparing seeds is not enough:
     * a collapsed pool still yields different *strings* for different seeds —
     * they enter the same fixed rotation at different points. What matters is
     * whether there was ever anything to choose between.
     */
    let state = createRunState({ seed: 4 })

    let fewest = Number.POSITIVE_INFINITY

    for (let i = 0; i < Math.ceil(150_000 / STEP_MS); i++) {
      state = step(state, [], STEP_MS)

      if (state.phase === 'ended') {
        state = { ...state, hearts: TUNING.hearts.max, phase: 'running', invulnRemainingMs: 0 }
      }

      fewest = Math.min(fewest, eligiblePatterns(state).length)
    }

    expect(fewest, 'the repeat cooldown must never leave a single candidate').toBeGreaterThan(1)
  })

  it('places patterns at the gap the schedule intended', () => {
    /*
     * The overshoot correction had the wrong sign, putting every pattern at
     * twice the overshoot beyond its anchor — so the real gap depended on where
     * a step boundary happened to fall. Small (about 0.09 units at 120 Hz) and
     * invisible to every other test, but `minGapUnits` is the floor the
     * escape-path argument rests on, and the error scales with the step size.
     */
    let state = createRunState({ seed: 12 })

    const leadingEdges: { at: number, tier: number }[] = []

    let previousId = 0

    for (let i = 0; i < Math.ceil(100_000 / STEP_MS); i++) {
      state = step(state, [], STEP_MS)

      if (state.phase === 'ended') {
        state = { ...state, hearts: TUNING.hearts.max, phase: 'running', invulnRemainingMs: 0 }
      }

      if (state.nextObstacleId !== previousId) {
        const fresh = state.obstacles.filter(o => o.id >= previousId)

        if (fresh.length > 0) {
          leadingEdges.push({
            at: state.distanceUnits + Math.min(...fresh.map(o => o.distanceUnits)),
            tier: tierAt(state.elapsedMs),
          })
        }

        previousId = state.nextObstacleId
      }
    }

    expect(leadingEdges.length).toBeGreaterThan(10)

    // Consecutive anchors must sit a whole gap apart, to within one step of
    // travel. A sign error doubles the overshoot and shows up here immediately.
    const drifts = leadingEdges.slice(1).map((edge, index) => {
      const gap = edge.at - leadingEdges[index]!.at

      return { gap, tier: edge.tier }
    })

    const worst = Math.max(...drifts.map(d => Math.abs(d.gap - Math.round(d.gap * 2) / 2)))

    expect(worst, 'pattern anchors must land on the scheduled grid').toBeLessThan(0.06)
  })

  it('does not let the cosmetic stream touch generation', () => {
    // A decorative change must never shift the obstacle sequence. The pattern
    // stream is the only one generation draws from, so advancing the others
    // must leave the world identical.
    let plain = createRunState({ seed: 77 })
    let cosmeticAdvanced: RunState = {
      ...plain,
      rng: { ...plain.rng, cosmetic: { a: 1, b: 2, c: 3, d: 4 }, collectible: { a: 5, b: 6, c: 7, d: 8 } },
    }

    for (let i = 0; i < 3000; i++) {
      plain = step(plain, [], STEP_MS)
      cosmeticAdvanced = step(cosmeticAdvanced, [], STEP_MS)
    }

    expect(cosmeticAdvanced.obstacles.map(o => [o.id, o.lane, o.kind]))
      .toEqual(plain.obstacles.map(o => [o.id, o.lane, o.kind]))
  })
})

describe('the difficulty tiers cross exactly where they say', () => {
  const starts = TUNING.difficulty.tierStartsS

  it.each(starts.map((seconds, index) => ({ seconds, tier: index + 1 })))(
    'tier $tier begins at $seconds s',
    ({ seconds, tier }) => {
      const ms = seconds * 1000

      expect(tierAt(ms), 'exactly at the boundary').toBe(tier)

      if (seconds > 0) {
        expect(tierAt(ms - 1), 'one millisecond before').toBe(tier - 1)
      }

      expect(tierAt(ms + 1), 'one millisecond after').toBe(tier)
    },
  )

  it('never exceeds the terminal tier', () => {
    expect(tierAt(10 * 60 * 1000)).toBe(starts.length)
  })

  it('tightens the gap floor as the tiers rise', () => {
    for (let tier = 2; tier <= starts.length; tier++) {
      expect(minGapUnits(tier as 2)).toBeLessThanOrEqual(minGapUnits((tier - 1) as 1))
    }
  })
})
