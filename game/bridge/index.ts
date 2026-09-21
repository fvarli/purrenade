/**
 * `game/bridge` — the single typed boundary.
 *
 * The only place `game/domain` and `game/engine` meet. The engine imports from
 * here and never from the domain, and `engine-config.ts` is what makes that
 * possible: the narrow slice of tuning a renderer legitimately needs, projected
 * rather than re-exported. The app imports run events and the play-column width
 * from here, and nothing else.
 *
 * Nothing in this directory makes a gameplay decision. It converts, it
 * interpolates, and it drives the domain at a fixed rate — all of which are
 * adaptations, not rules.
 */

export { GESTURE, HEARTS, PLAYFIELD, PLAY_COLUMN_MAX_PX, PROGRESS } from './engine-config'
export type { GestureConfig, PlayfieldConfig } from './engine-config'

export { createRunLoop } from './loop'
export type { RunLoop, RunLoopOptions } from './loop'

export { toRenderSnapshot, interpolateSnapshot } from './snapshot'

export type {
  InputEvent,
  LaneIndex,
  ObstacleKind,
  RenderObstacle,
  RenderSnapshot,
  RunEvent,
  RunEventSink,
  RunPhase,
  TutorialCorrection,
  TutorialLesson,
  TutorialOutcome,
} from './types'
