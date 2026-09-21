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
  | { readonly type: 'slayyy' }
  | { readonly type: 'pause' }
  | { readonly type: 'resume' }
  /**
   * Leave the tutorial without finishing it.
   *
   * A control input rather than a gameplay one: it changes what the run *is*,
   * not what the player is doing inside it, so it travels the same path as
   * pause and resume and is never buffered. A no-op on a normal run — the
   * rules refuse it rather than the caller remembering not to send it.
   */
  | { readonly type: 'tutorial_skip' }

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

  // --- M7 -------------------------------------------------------------------

  /** The three score components. There is deliberately no fourth total field. */
  readonly score: ScoreState

  /** Paw Tokens currently in the world, nearest last. Frozen with the state. */
  readonly pawTokens: readonly PawToken[]

  /** The id the next Paw Token will take. Deterministic, so a replay matches. */
  readonly nextPawTokenId: number

  /** World distance at which the next Paw Token group is considered. */
  readonly nextPawAtUnits: number

  /** Paw Tokens collected in this run. Never decreases. */
  readonly runPaws: number

  /**
   * Progress toward the next Loli threshold.
   *
   * Seeded at run creation from whatever the caller knows, and advanced by
   * collection. There is no persistence behind it at M7 — the default is zero,
   * and that is the truth rather than a stand-in for a database column.
   */
  readonly loliCyclePaws: number

  readonly loli: LoliState
  readonly slayyy: SlayyyState

  /**
   * Times a Loli Bonus **actually started** in this run.
   *
   * Not thresholds crossed, and not bonuses queued. A bonus that is earned and
   * never starts — because the run ended first — is not an activation, and the
   * distinction is the whole reason this is a separate counter.
   */
  readonly loliActivations: number

  /** Times SLAYYY actually entered its active window in this run. */
  readonly slayyyActivations: number

  // --- M8 -------------------------------------------------------------------

  /**
   * The tutorial, or `null` for the ordinary game.
   *
   * One nullable field rather than a mode enum threaded through the rules: a
   * normal run carries `null`, every tutorial branch is guarded on it, and
   * there is exactly one question to ask anywhere in the domain. `null` is
   * also what a reader sees first, which keeps the ordinary case ordinary.
   */
  readonly tutorial: TutorialState | null
}

/**
 * Score, in thousandths of a point.
 *
 * Integer arithmetic on purpose. Distance score accrues a fraction of a point
 * every 8.33 ms step, and a float accumulator over a five-minute run is exactly
 * the kind of thing that drifts differently once anything about the step
 * sequence changes. Thousandths are exact, sum exactly, and floor predictably.
 *
 * The displayed total is the sum of the three floored components, so
 * `total === distance + collection + bonus` holds as integers with no rounding
 * slack anywhere. There is no separate mutable total to fall out of step.
 */
export interface ScoreState {
  readonly distanceMilli: number
  readonly collectionMilli: number
  readonly bonusMilli: number
}

/** Has this token been taken, and if so how? */
export type PawOutcome = 'pending' | 'collected' | 'missed'

/**
 * One Paw Token on the road.
 *
 * Geometry mirrors `Obstacle` so the same longitudinal reasoning applies:
 * `distanceUnits` is the leading edge and decreases as the world scrolls.
 * `laneOffset` is a lateral position in lane units, which is how the Loli
 * magnet can pull a token *between* lanes without inventing a second geometry.
 */
export interface PawToken {
  readonly id: number
  readonly lane: LaneIndex
  /** Lateral position in lane units. Equals `lane` until the magnet moves it. */
  readonly laneOffset: number
  readonly distanceUnits: number
  readonly outcome: PawOutcome
}

/** Where a Loli Bonus is in its lifecycle. */
export type LoliPhase = 'inactive' | 'entering' | 'active' | 'exiting'

export interface LoliState {
  readonly phase: LoliPhase
  /** Milliseconds remaining in the current non-inactive phase. */
  readonly phaseRemainingMs: number
  /**
   * Bonuses earned that could not start yet.
   *
   * Named as `scoring-and-progression.md` §2.4 names it, which is APPROVED
   * down to the identifier — `queuedLoliBonuses`, a counter and not a boolean,
   * because more than one bonus may be queued in a single run and a flag
   * silently discards the second. Run-scoped, and cleared at the terminal
   * state: nothing is ever owed into a later run.
   */
  readonly queuedLoliBonuses: number
}

/**
 * SLAYYY's meter and window.
 *
 * `cooldown` exists as a named phase because the state machine is documented
 * with four states, but it is deterministic and transient: the active window
 * ends into `cooldown` and the same step leaves it for `charging`. It is not a
 * lockout — inventing one would be a mechanic nobody approved.
 */
export type SlayyyPhase = 'charging' | 'ready' | 'active' | 'cooldown'

/**
 * The lessons, in the order they are taught.
 *
 * `dodge_cone` comes **before** `jump_barrier` deliberately. Physical-phone
 * testing found that a new player meeting a traffic cone tries to jump it, is
 * hit, and does not understand why — so the misconception is corrected before
 * the verb that looks like it should have worked is introduced at all.
 */
export type TutorialLesson =
  | 'intro'
  | 'move_left'
  | 'move_right'
  | 'dodge_cone'
  | 'jump_barrier'
  | 'collect_paw'
  | 'activate_slayyy'
  | 'final_practice'
  | 'complete'

/**
 * Why a lesson did not pass.
 *
 * Named by what the player *did*, not by what they should have done, because
 * the copy has to answer the action they actually took. `jumped_at_cone` is
 * the one this milestone exists for.
 */
export type TutorialCorrection =
  | 'no_input'
  | 'jumped_at_cone'
  | 'contacted_cone'
  | 'dodged_barrier'
  | 'contacted_barrier'
  | 'missed_paw'

/** How a tutorial finished. Both terminal states count as completed for routing. */
export type TutorialOutcome = 'in_progress' | 'completed' | 'skipped'

/**
 * The tutorial, as data, exactly like everything else the rules reason over.
 *
 * `null` on a normal run — and that null is the whole isolation story. Every
 * branch the tutorial adds is guarded on it, so a normal run takes the path it
 * took before this type existed, which `tests/unit/normal-run-golden.spec.ts`
 * proves rather than asserts.
 */
export interface TutorialState {
  readonly lesson: TutorialLesson
  /** How long the current lesson has been showing. Drives the re-prompt only. */
  readonly lessonElapsedMs: number
  /**
   * The live correction, paired with the counter below and never read alone.
   *
   * The counter is what the bridge compares: two identical corrections in a row
   * are two events a player needs to see twice, and comparing the value would
   * emit one. The same reason `slayyyActivations` is a counter and not a flag.
   */
  readonly correction: TutorialCorrection | null
  readonly correctionCount: number
  /** Corrections within the current lesson, so guidance can become more explicit. */
  readonly lessonCorrections: number
  /**
   * Which beat of the current lesson's script is live.
   *
   * Most lessons have exactly one beat and re-present it until they pass. The
   * closing practice has several, played in order, which is the only reason
   * this is an index rather than a boolean.
   */
  readonly beatIndex: number
  /** World distance at which the director places this lesson's prop; null when it has none. */
  readonly nextCueAtUnits: number | null
  /** The obstacles the live cue owns, so the lesson judges its own prop and no other. */
  readonly cueObstacleIds: readonly number[]
  /** The Paw Tokens the live cue owns. Identity, not a count — see `collect_paw`. */
  readonly cuePawTokenIds: readonly number[]
  /**
   * Was the player ever in the cue obstacle's lane while overlapping it?
   *
   * This — not the obstacle's `outcome` — is what the lessons judge. An outcome
   * says what the damage rules concluded; these two say what the player
   * actually *did*, which is the thing being taught. Reading the outcome would
   * also be quietly wrong: a second damaging obstacle in one step resolves as
   * `cleared` because only one heart may be lost, and "cleared" would then mean
   * "avoided" when it meant "absorbed".
   */
  readonly cueOverlapInLane: boolean
  /** Was the player airborne, in the cue obstacle's lane, while overlapping it? */
  readonly cueJumped: boolean
  /** Counts down after a pass, so a success is legible before the next prompt. */
  readonly celebrateRemainingMs: number
  /** Set once, when the SLAYYY lesson opens. Never true on a normal run. */
  readonly slayyyPrimed: boolean
  readonly outcome: TutorialOutcome
}

export interface SlayyyState {
  readonly phase: SlayyyPhase
  /**
   * Millionths of a charge point, bounded at `slayyy.chargeMax`.
   *
   * Finer than the score's thousandths, and for a measurable reason: at 1.4
   * points per second a 8.33 ms step earns 0.01167 points, and rounding that to
   * thousandths every step runs the meter ~2.8 % fast. Millionths bring the
   * error to about three parts in a hundred thousand while keeping the
   * arithmetic exact integers.
   */
  readonly chargeMicro: number
  /** Milliseconds remaining in the active window. Zero unless active. */
  readonly activeRemainingMs: number
}
