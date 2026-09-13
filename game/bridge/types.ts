import type { InputEvent, LaneIndex, ObstacleKind, RunPhase } from '../domain'

/**
 * The only vocabulary `game/domain` and `game/engine` share.
 *
 * Three payloads, three directions, and nothing else crosses. The value of a
 * narrow boundary is not tidiness — it is that neither side can reach into the
 * other's model, so the domain stays provable and the engine stays replaceable.
 */

/** Engine → domain. Re-exported so the engine never imports the domain directly. */
export type { InputEvent, LaneIndex, ObstacleKind, RunPhase }

/**
 * Domain → engine.
 *
 * **Lane and longitudinal units, never pixels.** The engine converts; the domain
 * does not know how wide the screen is. That is what lets one set of rules drive
 * a 390 px phone and a 460 px desktop column without a second code path, and
 * what would let the same rules run headless on a server.
 *
 * A snapshot is a **value**: derived fresh, frozen, and safe to hand to a
 * renderer that might hold onto it for a frame. The mutable state object never
 * leaves the domain.
 */
/**
 * One obstacle, as much as a renderer is allowed to know.
 *
 * Deliberately not the domain's `Obstacle`: the outcome field is a rule, and a
 * renderer that could read it would be a renderer that could start deciding
 * things. Position is in road units — the engine converts to pixels.
 */
export interface RenderObstacle {
  readonly id: number
  readonly kind: ObstacleKind
  readonly lane: LaneIndex
  readonly distanceUnits: number
  readonly lengthUnits: number
}

export interface RenderSnapshot {
  readonly phase: RunPhase

  /**
   * Where to draw the player laterally, in lane units.
   *
   * Fractional during a transition — `0.5` is exactly between the left and
   * centre lanes. Interpolated by the engine for the easing curve, because how
   * a movement *looks* is a presentation decision.
   */
  readonly lanePosition: number

  /** The lane the rules consider the player to be in. Switches at the midpoint. */
  readonly occupiedLane: LaneIndex

  /** Height above the ground in baseline pixels, `0` when grounded. */
  readonly heightPx: number

  /** `0`–`1` through the jump arc, for animation state selection. */
  readonly jumpProgress: number

  /** `0`–`1` through a lane change, `1` when settled. */
  readonly laneProgress: number

  /** Milliseconds remaining in the readiness beat; `0` once interactive. */
  readonly readyRemainingMs: number

  /** Run time in milliseconds. Does not advance while paused. */
  readonly elapsedMs: number

  /**
   * The world, nearest last, frozen along with every obstacle in it.
   *
   * A frozen array *and* frozen elements, not just a frozen wrapper: a renderer
   * holds a snapshot for the length of a frame, and one that could splice this
   * array would be editing the world the rules are running.
   */
  readonly obstacles: readonly RenderObstacle[]

  /** Hearts remaining, so the app can show them without reading run state. */
  readonly hearts: number

  /** Post-hit invulnerability, as a fact rather than as a timer. */
  readonly invulnerable: boolean
}

/**
 * Domain/engine → app.
 *
 * **Coarse only.** The Vue layer learns that a run started or that the phase
 * changed; it does not learn the player's lane, and it must not — a UI that
 * re-renders on every simulation step is a UI fighting a 120 Hz loop, and one
 * that reads gameplay state is one that will eventually try to write it.
 *
 * The list is short because M5's run has few coarse moments. `HEART_LOST`,
 * `SLAYYY_ACTIVATED`, `LOLI_STARTED` and `RUN_ENDED` arrive with the milestones
 * that own them.
 */
export type RunEvent =
  | { readonly type: 'run_started' }
  | { readonly type: 'run_interactive' }
  | { readonly type: 'phase_changed', readonly phase: RunPhase }
  | { readonly type: 'heart_lost', readonly hearts: number }
  | { readonly type: 'near_miss' }
  | { readonly type: 'run_ended' }

/** What the app hands the engine when it mounts a run. */
export interface RunEventSink {
  (event: RunEvent): void
}
