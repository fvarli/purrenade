/**
 * `game/domain` — the public surface of the game rules.
 *
 * Everything the rest of the application may use, and nothing else. The engine
 * reaches the domain through `game/bridge`; nothing imports a file inside this
 * directory directly.
 *
 * The whole of it is pure TypeScript: no Phaser, no DOM, no Vue, no network, no
 * `Math.random()`, no `Date.now()`. ESLint enforces those four; the tests prove
 * the consequence, which is that a run replays exactly from a seed.
 */

export { TUNING, STEP_MS, JUMP_ARC } from './tuning'
export type { Tuning } from './tuning'

export { createRngState, createStream, nextUint32, nextFloat, nextIntInclusive } from './rng'
export type { RngState, RngStream, RngDraw } from './rng'

export { createRunState } from './state'
export type { CreateRunOptions } from './state'

export { step } from './step'

export { isAirborne, canJump, jumpHeightPx, jumpProgress } from './jump'
export { isLaneIndex, laneStep, occupiedLane, laneProgress, canStartLaneChange } from './lanes'

export { LANE_LEFT, LANE_CENTER, LANE_RIGHT } from './types'
export type {
  BufferedInput,
  InputEvent,
  LaneIndex,
  LaneTransition,
  RunPhase,
  RunState,
  Obstacle,
  ObstacleKind,
  ObstacleOutcome,
  SpawnState,
  ScoreState,
  PawToken,
  PawOutcome,
  LoliState,
  LoliPhase,
  SlayyyState,
  SlayyyPhase,
  TutorialState,
  TutorialLesson,
  TutorialCorrection,
  TutorialOutcome,
} from './types'

// --- M6 -----------------------------------------------------------------

export { tierAt, softCap, speedMultiplier, scrollUnitsPerS, densityTarget, decisionsPerMinute, minGapUnits } from './difficulty'
export type { Tier } from './difficulty'

export { PATTERNS, poolForTier } from './patterns'
export type { Pattern, PatternEntry } from './patterns'

export { advanceObstacles, advanceSpawning, selectPattern, eligiblePatterns, firstHazardDistanceUnits, scrollDeltaUnits } from './obstacles'

export { resolveCollisions, isDamaging, overlapsLongitudinally } from './collision'

export { findEscapePath } from './escape'
export type { EscapeQuery, EscapeResult } from './escape'

// --- M7 -----------------------------------------------------------------

export { scoreComponents, scoreTotal, scoreMultiplier, EMPTY_SCORE } from './score'
export { advancePawTokens, advancePawSpawning, dropBlockedTokens, resolvePawTokens } from './collectibles'
export type { PawCollection } from './collectibles'
export { applyPawsToCycle, advanceLoli, applyMagnet, earnLoliBonuses, magnetIsActive, clearLoli, EMPTY_LOLI } from './loli'
export type { ThresholdResult } from './loli'
export {
  activateSlayyy,
  canActivateSlayyy,
  advanceSlayyy,
  chargeFromPaws,
  chargeFromTime,
  chargeFraction,
  slayyyProtects,
  EMPTY_SLAYYY,
} from './slayyy'
export { protectionSources, isProtected } from './collision'

// --- M8 -----------------------------------------------------------------

export {
  TUTORIAL_LESSON_COUNT,
  advanceTutorial,
  advanceTutorialDirector,
  createTutorialState,
  skipTutorial,
  tutorialLessonIndex,
} from './tutorial'
export { TUTORIAL_LESSON_ORDER, TUTORIAL_SCRIPT } from './tutorial-script'
export type { TutorialBeat, TutorialLessonScript } from './tutorial-script'

/*
 * `primeSlayyy` is deliberately **not** exported.
 *
 * It fills the meter outright, which is the one thing in this domain that
 * hands the player a power they did not earn. It exists for the tutorial's
 * SLAYYY lesson and `tutorial.ts` is its only caller; publishing it here would
 * put "grant a full meter" on the domain's public surface, where a later
 * milestone could reach for it without anyone deciding that it should.
 *
 * Nothing outside `game/domain` needs it: the tutorial is entered by mode, and
 * the readiness grant is a consequence of reaching the lesson.
 */
