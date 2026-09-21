import { overlapsLongitudinally } from './collision'
import { isAirborne } from './jump'
import { occupiedLane } from './lanes'
import { primeSlayyy } from './slayyy'
import { TUNING } from './tuning'
import { TUTORIAL_LESSON_ORDER, TUTORIAL_SCRIPT } from './tutorial-script'
import type { TutorialBeat, TutorialLane } from './tutorial-script'
import { LANE_LEFT, LANE_RIGHT } from './types'
import type {
  LaneIndex,
  Obstacle,
  PawToken,
  RunState,
  TutorialCorrection,
  TutorialLesson,
  TutorialState,
} from './types'

/**
 * The tutorial: a mode of the game core, not a second game.
 *
 * `tutorial.md` §3.1 asks for exactly this shape — a dedicated mode with damage
 * disabled **at the rules level** and an authored scene rather than a
 * generated one — and the reason it asks for a mode rather than a gentle
 * difficulty is that a difficulty can be survived by luck. An invariant cannot.
 *
 * ## What this module is allowed to touch
 *
 * Three things, and they are the three the mode exists for: the generator is
 * off, damage does not spend a heart, and the props are placed from a script.
 * Everything else — lanes, the jump arc, collision geometry, scoring, the paw
 * cycle, the meter — runs exactly as it does in a real run, because the point
 * of teaching inside the real rules is that what the player learns is true.
 *
 * ## How a lesson decides it passed
 *
 * By watching **the fact it teaches**, never a number that happens to move at
 * the same time. `collect_paw` waits for *its own* token to be collected, by
 * id, rather than for `runPaws` to tick — the two agree today only because the
 * generator is off, and a lesson that relies on that agreement is a lesson that
 * breaks the day something else can award a paw.
 *
 * The cone and barrier lessons watch two recorded facts — was the player in the
 * prop's lane while overlapping it, and were they airborne when they were —
 * rather than the obstacle's `outcome`. An outcome is the damage rules'
 * conclusion; these are what the player did, and what the player did is the
 * curriculum. It also avoids a real trap: when two obstacles would damage on
 * one step, only the first is `hit` and the rest are `cleared`, so `cleared`
 * does not reliably mean "avoided".
 *
 * Nothing here draws from an RNG stream or reads a clock. The tutorial advances
 * on distance and on the `deltaMs` it is handed, so it replays exactly.
 */

export const TUTORIAL_LESSON_COUNT = TUTORIAL_LESSON_ORDER.length

export function tutorialLessonIndex(lesson: TutorialLesson): number {
  return TUTORIAL_LESSON_ORDER.indexOf(lesson)
}

/** A tutorial at its first instant. */
export function createTutorialState(): TutorialState {
  return {
    lesson: 'intro',
    lessonElapsedMs: 0,
    correction: null,
    correctionCount: 0,
    lessonCorrections: 0,
    beatIndex: 0,
    nextCueAtUnits: null,
    cueObstacleIds: [],
    cuePawTokenIds: [],
    cueOverlapInLane: false,
    cueJumped: false,
    celebrateRemainingMs: 0,
    slayyyPrimed: false,
    outcome: 'in_progress',
  }
}

/**
 * Leave without finishing.
 *
 * Terminal for the tutorial and nothing else: the run phase is untouched, so
 * the app tears the surface down on its own terms rather than the rules
 * inventing an ending. `outcome` distinguishes this from a finish for the
 * app's copy — the server is told the same thing either way, because a skipped
 * tutorial counts as completed for routing.
 */
export function skipTutorial(state: RunState): RunState {
  const tutorial = state.tutorial

  if (tutorial === null || tutorial.outcome !== 'in_progress') return state

  return { ...state, tutorial: { ...tutorial, outcome: 'skipped' } }
}

/** The lane a scripted prop resolves to, against the player as they stand now. */
function resolveLane(state: RunState, lane: TutorialLane): LaneIndex {
  if (lane === 'player') return occupiedLane(state)

  if (lane === 'adjacent') {
    const here = occupiedLane(state)

    // Never off the road, and never the lane the player is already in — the
    // token has to cost a movement or it teaches nothing.
    return (here === TUNING.lane.count - 1 ? here - 1 : here + 1) as LaneIndex
  }

  return lane
}

function currentBeat(tutorial: TutorialState): TutorialBeat | null {
  const script = TUTORIAL_SCRIPT[tutorial.lesson]

  return script.beats[tutorial.beatIndex] ?? null
}

/**
 * Place the live beat once the world has scrolled far enough to owe it.
 *
 * Called where `advanceSpawning` would have run, so an authored prop enters the
 * world at exactly the point a generated one would have and travels by the same
 * rules afterwards.
 */
export function advanceTutorialDirector(state: RunState): RunState {
  const tutorial = state.tutorial

  if (tutorial === null || state.phase !== 'running') return state
  if (tutorial.outcome !== 'in_progress') return state
  if (tutorial.nextCueAtUnits === null || state.distanceUnits < tutorial.nextCueAtUnits) return state

  const beat = currentBeat(tutorial)

  if (beat === null) return { ...state, tutorial: { ...tutorial, nextCueAtUnits: null } }

  // The same overshoot correction pattern placement uses: how far past the
  // scheduled point the world already travelled is subtracted, so a prop lands
  // where the script intended rather than at twice the overshoot beyond it.
  const overshoot = state.distanceUnits - tutorial.nextCueAtUnits
  const origin = TUNING.world.spawnLookaheadUnits - overshoot

  const obstacles: Obstacle[] = []
  const pawTokens: PawToken[] = []
  const cueObstacleIds: number[] = []
  const cuePawTokenIds: number[] = []

  let nextObstacleId = state.nextObstacleId
  let nextPawTokenId = state.nextPawTokenId

  for (const prop of beat.obstacles) {
    obstacles.push(Object.freeze({
      id: nextObstacleId,
      kind: prop.kind,
      lane: resolveLane(state, prop.lane),
      distanceUnits: origin + prop.offsetUnits,
      lengthUnits: TUNING.obstacle.defaultLengthUnits,
      outcome: 'pending' as const,
    }))

    cueObstacleIds.push(nextObstacleId)
    nextObstacleId++
  }

  for (const prop of beat.pawTokens) {
    const lane = resolveLane(state, prop.lane)

    pawTokens.push(Object.freeze({
      id: nextPawTokenId,
      lane,
      laneOffset: lane,
      distanceUnits: origin + prop.offsetUnits,
      outcome: 'pending' as const,
    }))

    cuePawTokenIds.push(nextPawTokenId)
    nextPawTokenId++
  }

  return {
    ...state,
    obstacles: [...state.obstacles, ...obstacles],
    pawTokens: [...state.pawTokens, ...pawTokens],
    nextObstacleId,
    nextPawTokenId,
    tutorial: {
      ...tutorial,
      nextCueAtUnits: null,
      cueObstacleIds,
      cuePawTokenIds,
      cueOverlapInLane: false,
      cueJumped: false,
    },
  }
}

/** Has every obstacle this cue owns stopped being pending? */
function cueObstaclesResolved(state: RunState, tutorial: TutorialState): boolean {
  if (tutorial.cueObstacleIds.length === 0) return false

  return tutorial.cueObstacleIds.every((id) => {
    const obstacle = state.obstacles.find(candidate => candidate.id === id)

    return obstacle === undefined || obstacle.outcome !== 'pending'
  })
}

/** Has every token this cue owns left the road, one way or the other? */
function cueTokensGone(state: RunState, tutorial: TutorialState): boolean {
  if (tutorial.cuePawTokenIds.length === 0) return false

  return tutorial.cuePawTokenIds.every(id => !state.pawTokens.some(token => token.id === id))
}

/**
 * Record what the player did to the cue, this step.
 *
 * Sticky: once the player has been in the prop's lane while overlapping it, the
 * fact stays true for the rest of the beat. A lesson asks what happened over
 * the whole encounter, not what was true on the frame it happened to resolve.
 */
function observeCue(state: RunState, tutorial: TutorialState): TutorialState {
  if (tutorial.cueObstacleIds.length === 0) return tutorial

  let overlapInLane = tutorial.cueOverlapInLane
  let jumped = tutorial.cueJumped

  for (const id of tutorial.cueObstacleIds) {
    const obstacle = state.obstacles.find(candidate => candidate.id === id)

    if (obstacle === undefined) continue
    if (!overlapsLongitudinally(obstacle)) continue
    if (occupiedLane(state) !== obstacle.lane) continue

    overlapInLane = true

    if (isAirborne(state)) jumped = true
  }

  if (overlapInLane === tutorial.cueOverlapInLane && jumped === tutorial.cueJumped) return tutorial

  return { ...tutorial, cueOverlapInLane: overlapInLane, cueJumped: jumped }
}

interface Verdict {
  readonly passed: boolean
  readonly correction: TutorialCorrection | null
  /** Present the beat again. Never true for a lesson that passed. */
  readonly retry: boolean
}

const WAIT: Verdict = { passed: false, correction: null, retry: false }
const PASS: Verdict = { passed: true, correction: null, retry: false }

function fail(correction: TutorialCorrection): Verdict {
  return { passed: false, correction, retry: true }
}

/**
 * Judge the live lesson.
 *
 * `collectedIds` is the identity of what was taken this step, which is what
 * lets `collect_paw` wait for its own token rather than for a counter.
 */
function judge(
  state: RunState,
  before: RunState,
  tutorial: TutorialState,
  collectedIds: readonly number[],
): Verdict {
  switch (tutorial.lesson) {
    case 'intro':
      return tutorial.lessonElapsedMs >= TUNING.tutorial.introDwellMs ? PASS : WAIT

    // The settled lane, not the transition: the lesson is "you can be in the
    // left lane", and a change that was started and interrupted did not teach it.
    case 'move_left':
      return state.lane === LANE_LEFT ? PASS : WAIT

    case 'move_right':
      return state.lane === LANE_RIGHT ? PASS : WAIT

    /*
     * The cone. Being in its lane at all is the failure, however it happened —
     * which is exactly the rule the player has to learn, and why jumping is not
     * special-cased anywhere in the domain. `isDamaging` already refuses to
     * clear a lane blocker for an airborne player; all this does is notice, and
     * then say the useful thing about it.
     */
    case 'dodge_cone':
      if (!cueObstaclesResolved(state, tutorial)) return WAIT
      if (!tutorial.cueOverlapInLane) return PASS

      return fail(tutorial.cueJumped ? 'jumped_at_cone' : 'contacted_cone')

    /*
     * The barrier, and the point of the pair: going around it is not an error
     * the rules punish, but it is not the lesson either, so it is corrected
     * rather than accepted.
     */
    case 'jump_barrier':
      if (!cueObstaclesResolved(state, tutorial)) return WAIT
      if (!tutorial.cueOverlapInLane) return fail('dodged_barrier')
      if (!tutorial.cueJumped) return fail('contacted_barrier')

      return PASS

    // By id. Not by `runPaws`, which only agrees while nothing else can grant one.
    case 'collect_paw':
      if (tutorial.cuePawTokenIds.some(id => collectedIds.includes(id))) return PASS
      if (cueTokensGone(state, tutorial)) return fail('missed_paw')

      return WAIT

    // The real mechanic, through the real control. The meter was filled for
    // this lesson; the decision to spend it is still the player's.
    case 'activate_slayyy':
      return state.slayyyActivations > before.slayyyActivations ? PASS : WAIT

    case 'final_practice':
      return WAIT

    case 'complete':
      return WAIT
  }
}

/** Move to the next lesson, clearing everything that belonged to the last one. */
function openLesson(state: RunState, tutorial: TutorialState, lesson: TutorialLesson): TutorialState {
  const script = TUTORIAL_SCRIPT[lesson]

  return {
    ...tutorial,
    lesson,
    lessonElapsedMs: 0,
    lessonCorrections: 0,
    correction: null,
    beatIndex: 0,
    nextCueAtUnits: script.beats.length === 0
      ? null
      : state.distanceUnits + TUNING.tutorial.firstCueUnits,
    cueObstacleIds: [],
    cuePawTokenIds: [],
    cueOverlapInLane: false,
    cueJumped: false,
    celebrateRemainingMs: TUNING.tutorial.celebrateMs,
    outcome: lesson === 'complete' ? 'completed' : tutorial.outcome,
  }
}

/** Schedule the live beat again, after a miss. */
function retryBeat(state: RunState, tutorial: TutorialState): TutorialState {
  return {
    ...tutorial,
    nextCueAtUnits: state.distanceUnits + TUNING.tutorial.repeatGapUnits,
    cueObstacleIds: [],
    cuePawTokenIds: [],
    cueOverlapInLane: false,
    cueJumped: false,
  }
}

/**
 * The closing practice: the same beats, in order, with nothing named.
 *
 * Contacts here still produce guidance, but they never block — the lesson is
 * over, this is the part where the player finds out they already know it.
 */
function advancePractice(state: RunState, tutorial: TutorialState): TutorialState {
  const script = TUTORIAL_SCRIPT.final_practice
  const beat = currentBeat(tutorial)

  if (beat === null) return openLesson(state, tutorial, 'complete')

  const placed = tutorial.cueObstacleIds.length > 0 || tutorial.cuePawTokenIds.length > 0

  if (!placed) return tutorial

  const settled = beat.obstacles.length > 0
    ? cueObstaclesResolved(state, tutorial)
    : cueTokensGone(state, tutorial)

  if (!settled) return tutorial

  const beatIndex = tutorial.beatIndex + 1

  if (beatIndex >= script.beats.length) return openLesson(state, tutorial, 'complete')

  return {
    ...tutorial,
    beatIndex,
    nextCueAtUnits: state.distanceUnits + TUNING.tutorial.firstCueUnits,
    cueObstacleIds: [],
    cuePawTokenIds: [],
    cueOverlapInLane: false,
    cueJumped: false,
  }
}

/**
 * Should this lesson nudge a player who has not done anything?
 *
 * Only the lessons whose success *is* an input. A lesson waiting on a prop that
 * has not arrived yet is not a player who is stuck.
 */
function awaitsInput(lesson: TutorialLesson): boolean {
  return lesson === 'move_left' || lesson === 'move_right' || lesson === 'activate_slayyy'
}

/**
 * Advance the tutorial by one step.
 *
 * Runs after collisions and collection have settled, so it sees the finished
 * state of everything it judges.
 */
export function advanceTutorial(
  state: RunState,
  before: RunState,
  collectedIds: readonly number[],
  deltaMs: number,
): RunState {
  const existing = state.tutorial

  if (existing === null || existing.outcome !== 'in_progress') return state

  let tutorial = observeCue(state, existing)

  tutorial = {
    ...tutorial,
    lessonElapsedMs: tutorial.lessonElapsedMs + deltaMs,
    celebrateRemainingMs: Math.max(0, tutorial.celebrateRemainingMs - deltaMs),
  }

  // The meter is filled the moment the lesson opens, not while it is taught, so
  // the control is live before the prompt claims it is.
  if (tutorial.lesson === 'activate_slayyy' && !tutorial.slayyyPrimed) {
    return {
      ...state,
      slayyy: primeSlayyy(state.slayyy),
      tutorial: { ...tutorial, slayyyPrimed: true },
    }
  }

  if (tutorial.lesson === 'final_practice') {
    return { ...state, tutorial: advancePractice(state, tutorial) }
  }

  const verdict = judge(state, before, tutorial, collectedIds)

  if (verdict.passed) {
    const next = TUTORIAL_LESSON_ORDER[tutorialLessonIndex(tutorial.lesson) + 1]

    return { ...state, tutorial: openLesson(state, tutorial, next ?? 'complete') }
  }

  if (verdict.correction !== null) {
    const corrected: TutorialState = {
      ...tutorial,
      correction: verdict.correction,
      correctionCount: tutorial.correctionCount + 1,
      lessonCorrections: tutorial.lessonCorrections + 1,
    }

    return { ...state, tutorial: verdict.retry ? retryBeat(state, corrected) : corrected }
  }

  /*
   * A player who has not pressed anything gets a more explicit prompt, on a
   * cadence rather than once — and never a failure, because doing nothing is
   * not a mistake. `tutorial.md` §3.2: no step timeout, no forced skip.
   */
  if (awaitsInput(tutorial.lesson)) {
    const due = TUNING.tutorial.repromptMs * (tutorial.lessonCorrections + 1)

    if (tutorial.lessonElapsedMs >= due) {
      return {
        ...state,
        tutorial: {
          ...tutorial,
          correction: 'no_input',
          correctionCount: tutorial.correctionCount + 1,
          lessonCorrections: tutorial.lessonCorrections + 1,
        },
      }
    }
  }

  return { ...state, tutorial }
}
