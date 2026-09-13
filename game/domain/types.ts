import type { RngState } from './rng'

/**
 * The shapes the game rules are written in.
 *
 * Everything here is plain serializable data. No class, no method, no
 * reference to anything the domain cannot see — that is what lets a run be
 * snapshotted, replayed, diffed, or one day validated server-side.
 */

/** `0` left · `1` centre · `2` right. The only lateral state the rules know. */
export type LaneIndex = 0 | 1 | 2

export const LANE_LEFT: LaneIndex = 0
export const LANE_CENTER: LaneIndex = 1
export const LANE_RIGHT: LaneIndex = 2

/**
 * What a run can be doing.
 *
 * `ENDED` is deliberately absent: a run ends when hearts reach zero, and hearts
 * arrive with collisions at M6. Adding the phase now would mean adding a
 * transition nothing can trigger and a state nothing can test.
 */
export type RunPhase = 'ready' | 'running' | 'paused'

/**
 * An input after the engine has normalized it.
 *
 * Raw key codes and raw swipe geometry are resolved in `game/engine` and never
 * cross the bridge. The domain reasons about intent, which is why the same
 * rules serve a keyboard and a thumb without a second code path.
 */
export type InputEvent =
  | { readonly type: 'move_left' }
  | { readonly type: 'move_right' }
  | { readonly type: 'jump' }
  | { readonly type: 'pause' }
  | { readonly type: 'resume' }

/** An input that arrived while it could not be acted on, waiting to become legal. */
export interface BufferedInput {
  readonly event: InputEvent
  /** How long it has been waiting. Discarded past `TUNING.input.bufferMs`. */
  readonly ageMs: number
}

/**
 * A lane change in progress.
 *
 * `from` and `to` are both carried because the collision lane switches at the
 * midpoint rather than at either end, so during a transition the question
 * "which lane is the player in" has an answer that neither endpoint gives.
 */
export interface LaneTransition {
  readonly from: LaneIndex
  readonly to: LaneIndex
  /** Elapsed within the transition. Reaches `TUNING.lane.transitionMs` and settles. */
  readonly elapsedMs: number
}

/**
 * The whole run, as data.
 *
 * Every field is readonly and every value is a primitive or a plain object.
 * `step()` returns a new one rather than mutating this — not for elegance, but
 * because replay, interpolation between two states, and any future server-side
 * verification all need the previous state to still exist.
 */
export interface RunState {
  readonly phase: RunPhase

  /** Milliseconds simulated while running. Not wall-clock: pause does not advance it. */
  readonly elapsedMs: number

  /** Counts down during `ready`; the run becomes interactive at zero. */
  readonly readyRemainingMs: number

  /** Where the player is settled. During a transition, the lane they started from. */
  readonly lane: LaneIndex

  /** Non-null only while a lane change is resolving. */
  readonly laneTransition: LaneTransition | null

  /** Elapsed within the jump arc, or null when grounded. */
  readonly jumpElapsedMs: number | null

  /** At most one, per `TUNING.input.bufferDepth`. A later input replaces it. */
  readonly buffered: BufferedInput | null

  /** The phase to return to when a pause is lifted. */
  readonly resumePhase: Exclude<RunPhase, 'paused'>

  /** Not advanced by `step()` yet: nothing draws from the streams before M6. */
  readonly rng: RngState

  /** The value the run was seeded with, carried so a run can be replayed. */
  readonly seed: number
}
