import type { LaneIndex, ObstacleKind, TutorialLesson } from './types'

/**
 * The authored tutorial road.
 *
 * Data, reviewed as data — the same standing `patterns.ts` has, and for a
 * stronger reason. The procedural generator is switched off in tutorial mode
 * precisely so the lesson the player meets is the lesson that was written, not
 * whatever a seed produced. A tutorial that drew from the pattern pool could
 * present a cone during the jump lesson and teach the opposite of the point.
 *
 * Positions are road units from the beat's own origin, exactly as a pattern's
 * `offsetUnits` are, so a beat can be placed anywhere without rewriting it.
 *
 * ## Why lanes are mostly relative
 *
 * A prop in a fixed lane is a prop the player may already be standing clear of,
 * which turns a lesson into a coincidence. `'player'` places the prop in the
 * lane the player actually occupies at the moment it is placed, so the cone is
 * always in the way and the lesson always requires the action it teaches.
 * `'adjacent'` does the opposite for the Paw Token: it must be reachable but
 * never free, so collecting it takes the movement the first two lessons taught.
 */

/** Where a prop goes, resolved against the player at the instant it is placed. */
export type TutorialLane = LaneIndex | 'player' | 'adjacent'

export interface TutorialObstacleProp {
  readonly kind: ObstacleKind
  readonly lane: TutorialLane
  readonly offsetUnits: number
}

export interface TutorialPawProp {
  readonly lane: TutorialLane
  readonly offsetUnits: number
}

/** One placement. A lesson is one or more of these. */
export interface TutorialBeat {
  readonly obstacles: readonly TutorialObstacleProp[]
  readonly pawTokens: readonly TutorialPawProp[]
}

export interface TutorialLessonScript {
  readonly beats: readonly TutorialBeat[]
  /**
   * Re-present the live beat while the lesson is unsatisfied.
   *
   * This is how the world "holds" without the scroll ever stopping: a missed
   * cone simply comes round again. Freezing the road instead would break the
   * jump lesson outright — a barrier that never travels is a barrier a jump
   * cannot clear — and would stop the promenade dead, which reads as a stall
   * rather than a pause.
   */
  readonly repeats: boolean
}

const EMPTY: TutorialLessonScript = Object.freeze({
  beats: Object.freeze([]),
  repeats: false,
})

/**
 * The nine lessons, in teaching order.
 *
 * `dodge_cone` precedes `jump_barrier` on purpose: the misconception is
 * corrected before the verb that looks like it should have worked is shown at
 * all.
 */
export const TUTORIAL_LESSON_ORDER: readonly TutorialLesson[] = Object.freeze([
  'intro',
  'move_left',
  'move_right',
  'dodge_cone',
  'jump_barrier',
  'collect_paw',
  'activate_slayyy',
  'final_practice',
  'complete',
])

export const TUTORIAL_SCRIPT: Readonly<Record<TutorialLesson, TutorialLessonScript>> = Object.freeze({
  // The greeting, the two movement lessons and the SLAYYY lesson put nothing on
  // the road: what they teach is an input, and an obstacle would only be
  // something else to think about while learning it.
  intro: EMPTY,
  move_left: EMPTY,
  move_right: EMPTY,

  /*
   * The lesson this milestone exists for.
   *
   * One cone, in the player's own lane, repeating until they go *around* it.
   * Jumping is not special-cased anywhere — `isDamaging` already refuses to
   * clear a `lane_blocking` obstacle for an airborne player, so a jump produces
   * a contact and the contact becomes the correction. The rule teaches itself.
   */
  dodge_cone: Object.freeze({
    beats: Object.freeze([Object.freeze({
      obstacles: Object.freeze([
        Object.freeze({ kind: 'lane_blocking' as ObstacleKind, lane: 'player' as TutorialLane, offsetUnits: 0 }),
      ]),
      pawTokens: Object.freeze([]),
    })]),
    repeats: true,
  }),

  // And now the other half of the pair, so the two verbs are learned against
  // each other rather than one of them being assumed to be optional.
  jump_barrier: Object.freeze({
    beats: Object.freeze([Object.freeze({
      obstacles: Object.freeze([
        Object.freeze({ kind: 'jumpable' as ObstacleKind, lane: 'player' as TutorialLane, offsetUnits: 0 }),
      ]),
      pawTokens: Object.freeze([]),
    })]),
    repeats: true,
  }),

  // One lane over, so taking it is the movement already taught rather than a
  // token that arrives by standing still.
  collect_paw: Object.freeze({
    beats: Object.freeze([Object.freeze({
      obstacles: Object.freeze([]),
      pawTokens: Object.freeze([
        Object.freeze({ lane: 'adjacent' as TutorialLane, offsetUnits: 0 }),
      ]),
    })]),
    repeats: true,
  }),

  activate_slayyy: EMPTY,

  /*
   * A short run of what was just taught, in order, with no prompt naming the
   * verb. Three beats rather than one placement: each is laid down against the
   * lane the player is in when it arrives, so dodging the cone does not
   * accidentally clear the barrier too.
   */
  final_practice: Object.freeze({
    beats: Object.freeze([
      Object.freeze({
        obstacles: Object.freeze([
          Object.freeze({ kind: 'lane_blocking' as ObstacleKind, lane: 'player' as TutorialLane, offsetUnits: 0 }),
        ]),
        pawTokens: Object.freeze([]),
      }),
      Object.freeze({
        obstacles: Object.freeze([
          Object.freeze({ kind: 'jumpable' as ObstacleKind, lane: 'player' as TutorialLane, offsetUnits: 0 }),
        ]),
        pawTokens: Object.freeze([]),
      }),
      Object.freeze({
        obstacles: Object.freeze([]),
        pawTokens: Object.freeze([
          Object.freeze({ lane: 'adjacent' as TutorialLane, offsetUnits: 0 }),
        ]),
      }),
    ]),
    repeats: false,
  }),

  complete: EMPTY,
})
