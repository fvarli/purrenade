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
 * `ended` arrives with M6, which is the milestone that can trigger it: a run
 * ends when hearts reach zero, and until collisions existed the phase would
 * have been a state nothing could reach and nothing could test.
 *
 * It is terminal. There is no revive and no continue in v1, so nothing leads
 * out of it except starting a new run.
 */
export type RunPhase = 'ready' | 'running' | 'paused' | 'ended'

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
/**
 * The two obstacle behaviour classes, and the only gameplay semantics there are.
 *
 * Behaviour belongs to the class, never to the artwork: the cone and the beach
 * barrier are v1 art for these two, and a seasonal variant that swaps a cone for
 * a deckchair changes an asset id and nothing here. Every rule below reasons
 * over the class, so nothing in the domain can ever branch on a sprite name.
 *
 * There is deliberately no third class and no `jumpable` boolean — a boolean
 * invites a "jumpable *and* dodgeable" state that v1 does not have.
 */
export type ObstacleKind = 'lane_blocking' | 'jumpable'

/**
 * What has already happened between the player and one obstacle.
 *
 * This is what makes "at most one near-miss event per obstacle" structural
 * rather than a debounce: an obstacle leaves `pending` exactly once, and the
 * transition out is the only place an event can be emitted.
 */
export type ObstacleOutcome = 'pending' | 'hit' | 'near_miss' | 'cleared'

/**
 * One obstacle in the world.
 *
 * Plain data in road units. `distanceUnits` is the leading edge measured from
 * the player's reference point at zero, and it decreases as the world scrolls;
 * the obstacle occupies `[distanceUnits, distanceUnits + lengthUnits]`.
 *
 * No pixels, no sprite, no Phaser handle. The engine converts.
 */
export interface Obstacle {
  /** Deterministic and monotonic within a run. Never a UUID — that would not replay. */
  readonly id: number
  readonly kind: ObstacleKind
  readonly lane: LaneIndex
  /** The leading edge, in road units ahead of the player. Decreases over time. */
  readonly distanceUnits: number
  /** Longitudinal footprint. */
  readonly lengthUnits: number
  /** Resolved exactly once, when the obstacle passes the reference point. */
  readonly outcome: ObstacleOutcome
}

/** The generator's bookkeeping, carried in the run so a seed replays exactly. */
export interface SpawnState {
  /** World distance at which the next pattern is emitted. */
  readonly nextAtUnits: number
  /** Recently used pattern ids, most recent first, for `generator.repeatCooldown`. */
  readonly recentPatternIds: readonly string[]
}

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

  // --- M6 -------------------------------------------------------------------

  /** Never above `hearts.max`, never below zero. Nothing in v1 restores one. */
  readonly hearts: number

  /**
   * Post-hit invulnerability remaining, in milliseconds. Zero when vulnerable.
   *
   * A counter rather than a timestamp, for the same reason every other duration
   * here is: the domain has no clock, and a paused run must not age.
   */
  readonly invulnRemainingMs: number

  /** Everything currently in the world, nearest last. Frozen with the state. */
  readonly obstacles: readonly Obstacle[]

  /** How far the world has scrolled, in road units. Only ever increases. */
  readonly distanceUnits: number

  /** The id the next obstacle will take. Deterministic, so a replay matches. */
  readonly nextObstacleId: number

  /** The generator's cursor and cooldown. */
  readonly spawn: SpawnState

  /** Statistics only. A near miss awards no score, directly or indirectly. */
  readonly nearMissCount: number
}
