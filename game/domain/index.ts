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
} from './types'
