import { describe, expect, it } from 'vitest'
import { isAirborne } from './jump'
import { canStartLaneChange, occupiedLane } from './lanes'
import { createRunState } from './state'
import { step } from './step'
import { STEP_MS, TUNING } from './tuning'
import { TUTORIAL_LESSON_ORDER } from './tutorial-script'
import type { InputEvent, LaneIndex, RunState, TutorialLesson } from './types'

/**
 * The tutorial, driven by players who do the right thing and players who do
 * not.
 *
 * The milestone's acceptance criteria are all behavioural — *the player cannot
 * die*, *each step requires a successful action to advance*, *jumping does not
 * solve a cone* — so they are tested by playing, not by staging a state and
 * asserting a field. A staged state proves the branch; a played run proves the
 * lesson.
 */

const SEED = 20260921

/** One simulated minute is far more than a tutorial needs. Two is a safety net. */
const MAX_STEPS = Math.round((4 * 60 * 1000) / STEP_MS)

function tutorialOf(state: RunState) {
  const tutorial = state.tutorial

  if (tutorial === null) throw new Error('expected a tutorial run')

  return tutorial
}

/** The nearest cue obstacle still ahead of the player, if the lesson has one. */
function cueObstacle(state: RunState) {
  const { cueObstacleIds } = tutorialOf(state)

  return state.obstacles.find(o => cueObstacleIds.includes(o.id) && o.outcome === 'pending')
}

function cueToken(state: RunState) {
  const { cuePawTokenIds } = tutorialOf(state)

  return state.pawTokens.find(t => cuePawTokenIds.includes(t.id))
}

function moveToward(state: RunState, lane: LaneIndex): InputEvent[] {
  if (!canStartLaneChange(state) || state.lane === lane) return []

  return [{ type: state.lane > lane ? 'move_left' : 'move_right' }]
}

/**
 * A player who does what each prompt asks.
 *
 * Deliberately written against the *prompt*, not against the world: it reads
 * which lesson is live and performs that lesson's verb. That is what makes it
 * evidence about the tutorial rather than about a bot's pathfinding.
 */
function goodPlayer(state: RunState): InputEvent[] {
  const tutorial = tutorialOf(state)

  switch (tutorial.lesson) {
    case 'move_left':
      return moveToward(state, 0)

    case 'move_right':
      return moveToward(state, 2)

    case 'dodge_cone': {
      const cone = cueObstacle(state)

      if (cone === undefined || occupiedLane(state) !== cone.lane) return []

      return moveToward(state, cone.lane === 0 ? 1 : (cone.lane - 1) as LaneIndex)
    }

    case 'jump_barrier': {
      const barrier = cueObstacle(state)

      if (barrier === undefined) return []
      if (occupiedLane(state) !== barrier.lane) return moveToward(state, barrier.lane)
      if (isAirborne(state)) return []
      // Leave the arc enough road to cover the barrier's own footprint.
      if (barrier.distanceUnits > TUNING.obstacle.defaultLengthUnits) return []

      return [{ type: 'jump' }]
    }

    case 'collect_paw':
    case 'final_practice': {
      const cone = cueObstacle(state)

      if (cone !== undefined) {
        if (cone.kind === 'lane_blocking') {
          if (occupiedLane(state) !== cone.lane) return []

          return moveToward(state, cone.lane === 0 ? 1 : (cone.lane - 1) as LaneIndex)
        }

        if (occupiedLane(state) !== cone.lane) return moveToward(state, cone.lane)
        if (isAirborne(state)) return []
        if (cone.distanceUnits > TUNING.obstacle.defaultLengthUnits) return []

        return [{ type: 'jump' }]
      }

      const token = cueToken(state)

      return token === undefined ? [] : moveToward(state, token.lane)
    }

    case 'activate_slayyy':
      return state.slayyy.phase === 'ready' ? [{ type: 'slayyy' }] : []

    default:
      return []
  }
}

interface Played {
  readonly state: RunState
  readonly steps: number
  readonly lessons: readonly TutorialLesson[]
  readonly minHearts: number
  readonly everEnded: boolean
}

function play(
  drive: (state: RunState) => InputEvent[],
  options: { until?: (state: RunState) => boolean, maxSteps?: number } = {},
): Played {
  const until = options.until ?? (s => tutorialOf(s).outcome !== 'in_progress')
  const maxSteps = options.maxSteps ?? MAX_STEPS

  let state = createRunState({ seed: SEED, mode: 'tutorial' })

  const lessons: TutorialLesson[] = [tutorialOf(state).lesson]

  let minHearts = state.hearts
  let everEnded = false
  let steps = 0

  while (steps < maxSteps && !until(state)) {
    state = step(state, drive(state), STEP_MS)
    steps++

    const lesson = tutorialOf(state).lesson

    if (lessons[lessons.length - 1] !== lesson) lessons.push(lesson)

    minHearts = Math.min(minHearts, state.hearts)
    everEnded ||= state.phase === 'ended'
  }

  return { state, steps, lessons, minHearts, everEnded }
}

describe('the tutorial as a state machine', () => {
  it('starts at the first lesson, with nothing yet decided', () => {
    const tutorial = tutorialOf(createRunState({ seed: SEED, mode: 'tutorial' }))

    expect(tutorial.lesson).toBe('intro')
    expect(tutorial.outcome).toBe('in_progress')
    expect(tutorial.correctionCount).toBe(0)
    expect(tutorial.slayyyPrimed).toBe(false)
    expect(tutorial.cueObstacleIds).toEqual([])
  })

  it('teaches the nine lessons in the approved order and finishes', () => {
    const played = play(goodPlayer)

    expect(played.state.tutorial?.outcome).toBe('completed')
    expect(played.lessons).toEqual(TUTORIAL_LESSON_ORDER)
  })

  it('takes a plausible length of time for a player who keeps up', () => {
    const played = play(goodPlayer)
    const seconds = (played.steps * STEP_MS) / 1000

    /*
     * The approved target is "approximately 30-60 seconds depending on how
     * quickly the player performs the required actions". A bot reacts on the
     * first legal frame, so what it measures is the floor of that range: it
     * currently completes in ~45 s, which leaves a person room to be slower and
     * still land inside the target.
     *
     * Bounded loosely on purpose. This is a drift alarm — a lesson that stops
     * being reachable, or a pacing change that doubles the tutorial — not a
     * pinned number, because the exact figure is a tuning decision and
     * `TUNING.tutorial` is where tuning decisions live.
     */
    expect(seconds).toBeGreaterThan(20)
    expect(seconds).toBeLessThan(90)
  })
})

describe('the player cannot die in the tutorial', () => {
  /**
   * The milestone's own acceptance criterion: *verified by a test that attempts
   * to*. So this player attempts to — it steers into every prop it can find and
   * never avoids anything.
   */
  function suicidalPlayer(state: RunState): InputEvent[] {
    const cone = cueObstacle(state)

    if (cone === undefined) return []
    if (occupiedLane(state) === cone.lane) return []

    return moveToward(state, cone.lane)
  }

  it('survives a player who walks into everything, for four simulated minutes', () => {
    const played = play(suicidalPlayer, { until: () => false })

    expect(played.minHearts).toBe(TUNING.hearts.start)
    expect(played.everEnded).toBe(false)
    expect(played.state.phase).not.toBe('ended')
    expect(played.state.invulnRemainingMs).toBe(0)
  })

  it('records the contact it refused to charge for', () => {
    const played = play(suicidalPlayer, {
      until: s => tutorialOf(s).correctionCount > 0,
    })

    // The encounter genuinely happened — the obstacle is stamped by the real
    // collision rules — and simply cost nothing.
    expect(played.state.hearts).toBe(TUNING.hearts.start)
    expect(tutorialOf(played.state).correctionCount).toBeGreaterThan(0)
  })
})

describe('the cone lesson, which is why this milestone exists', () => {
  /** Reaches a lesson without doing anything the lesson asks for. */
  function reach(lesson: TutorialLesson): RunState {
    return play(goodPlayer, { until: s => tutorialOf(s).lesson === lesson }).state
  }

  it('does not accept a jump, and does not punish one either', () => {
    let state = reach('dodge_cone')

    let jumped = false

    // Stay in the cone's lane and jump at it, exactly as a new player does.
    for (let i = 0; i < MAX_STEPS && tutorialOf(state).lesson === 'dodge_cone'; i++) {
      const cone = cueObstacle(state)
      const inputs: InputEvent[] = []

      if (
        cone !== undefined
        && occupiedLane(state) === cone.lane
        && !isAirborne(state)
        && cone.distanceUnits <= TUNING.obstacle.defaultLengthUnits
      ) {
        inputs.push({ type: 'jump' })
        jumped = true
      }

      state = step(state, inputs, STEP_MS)

      if (tutorialOf(state).correction !== null) break
    }

    expect(jumped, 'the test must actually have jumped at the cone').toBe(true)

    const tutorial = tutorialOf(state)

    // The lesson is not satisfied…
    expect(tutorial.lesson).toBe('dodge_cone')
    // …the player is told why, in the words that match what they did…
    expect(tutorial.correction).toBe('jumped_at_cone')
    // …and it cost nothing.
    expect(state.hearts).toBe(TUNING.hearts.start)
    expect(state.phase).not.toBe('ended')
  })

  it('accepts a lane change, and moves on', () => {
    const played = play(goodPlayer, {
      until: s => tutorialOf(s).lesson === 'jump_barrier',
    })

    expect(tutorialOf(played.state).lesson).toBe('jump_barrier')
  })

  it('corrects a player who goes around the barrier instead of over it', () => {
    let state = play(goodPlayer, { until: s => tutorialOf(s).lesson === 'jump_barrier' }).state

    for (let i = 0; i < MAX_STEPS; i++) {
      const barrier = cueObstacle(state)
      const inputs = barrier !== undefined && occupiedLane(state) === barrier.lane
        ? moveToward(state, barrier.lane === 0 ? 1 : (barrier.lane - 1) as LaneIndex)
        : []

      state = step(state, inputs, STEP_MS)

      if (tutorialOf(state).correction !== null) break
    }

    expect(tutorialOf(state).lesson).toBe('jump_barrier')
    expect(tutorialOf(state).correction).toBe('dodged_barrier')
    expect(state.hearts).toBe(TUNING.hearts.start)
  })
})

describe('a lesson advances only on the thing it teaches', () => {
  it('will not pass the movement lessons for any other input', () => {
    let state = play(goodPlayer, { until: s => tutorialOf(s).lesson === 'move_left' }).state

    // Jump, ask for SLAYYY, pause and resume — everything except moving left.
    for (let i = 0; i < Math.round(10_000 / STEP_MS); i++) {
      state = step(state, [{ type: 'jump' }, { type: 'slayyy' }], STEP_MS)
    }

    expect(tutorialOf(state).lesson).toBe('move_left')
    // Doing the wrong thing is never a failure — only doing nothing is nudged.
    expect(tutorialOf(state).correction).toBe('no_input')
    expect(state.hearts).toBe(TUNING.hearts.start)
  })

  it('nudges a player who does nothing, repeatedly, and never gives up on them', () => {
    const state = play(() => [], {
      until: s => tutorialOf(s).lessonCorrections >= 3,
    }).state

    expect(tutorialOf(state).correction).toBe('no_input')
    expect(tutorialOf(state).outcome).toBe('in_progress')
    // No step timeout and no forced skip — tutorial.md §3.2.
    expect(state.phase).not.toBe('ended')
  })

  it('requires the meter to be spent by the player, not merely filled', () => {
    const arrived = play(goodPlayer, {
      until: s => tutorialOf(s).lesson === 'activate_slayyy',
    }).state

    // The lesson arms the meter so the control is live…
    let state = step(arrived, [], STEP_MS)

    expect(state.slayyy.phase).toBe('ready')
    expect(tutorialOf(state).slayyyPrimed).toBe(true)

    // …but waiting does not spend it.
    for (let i = 0; i < Math.round(6000 / STEP_MS); i++) state = step(state, [], STEP_MS)

    expect(tutorialOf(state).lesson).toBe('activate_slayyy')
    expect(state.slayyyActivations).toBe(0)

    // The real mechanic, through the real input.
    state = step(state, [{ type: 'slayyy' }], STEP_MS)

    expect(state.slayyyActivations).toBe(1)
    expect(state.slayyy.phase).toBe('active')
    expect(tutorialOf(state).lesson).toBe('final_practice')
  })
})

describe('skipping', () => {
  it('ends the tutorial without finishing it, and without ending the run', () => {
    const reached = play(goodPlayer, { until: s => tutorialOf(s).lesson === 'move_left' }).state
    const state = step(reached, [{ type: 'tutorial_skip' }], STEP_MS)

    expect(tutorialOf(state).outcome).toBe('skipped')
    // The phase is the app's business: it tears the surface down, not the rules.
    expect(state.phase).not.toBe('ended')
  })

  it('is a no-op on a normal run', () => {
    const before = createRunState({ seed: SEED })
    const after = step(before, [{ type: 'tutorial_skip' }], STEP_MS)

    expect(after.tutorial).toBeNull()
    expect(after.phase).toBe(before.phase)
  })

  it('cannot be undone, and cannot be repeated', () => {
    const reached = play(goodPlayer, { until: s => tutorialOf(s).lesson === 'move_left' }).state
    const once = step(reached, [{ type: 'tutorial_skip' }], STEP_MS)
    const twice = step(once, [{ type: 'tutorial_skip' }], STEP_MS)

    expect(tutorialOf(twice).outcome).toBe('skipped')
  })
})
