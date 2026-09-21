import type {
  InputEvent,
  LaneIndex,
  LoliPhase,
  ObstacleKind,
  RunPhase,
  SlayyyPhase,
  TutorialCorrection,
  TutorialLesson,
  TutorialOutcome,
} from '../domain'

/**
 * The only vocabulary `game/domain` and `game/engine` share.
 *
 * Three payloads, three directions, and nothing else crosses. The value of a
 * narrow boundary is not tidiness — it is that neither side can reach into the
 * other's model, so the domain stays provable and the engine stays replaceable.
 */

/** Engine → domain. Re-exported so the engine never imports the domain directly. */
export type { InputEvent, LaneIndex, ObstacleKind, RunPhase, TutorialCorrection, TutorialLesson, TutorialOutcome }

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

  /** Protected from damage, from any source. See `protection` for which. */
  readonly invulnerable: boolean

  // --- M7 -------------------------------------------------------------------

  /**
   * Why the player is protected, kept as two facts rather than one.
   *
   * The renderer draws them differently — hit recovery blinks, SLAYYY
   * celebrates — and a single boolean would force it to guess. Both may be true
   * at once, and each ends on its own clock.
   */
  readonly protection: RenderProtection

  /** The displayed score and the components it is the sum of. */
  readonly score: RenderScore

  /** Paw Tokens on the road, nearest last, frozen with the snapshot. */
  readonly pawTokens: readonly RenderPawToken[]

  /** Paw Tokens collected in this run. */
  readonly runPaws: number

  /** Progress toward the next Loli threshold, `0..199`. */
  readonly loliCyclePaws: number

  /** The companion's lifecycle, for the HUD and the scene. */
  readonly loli: RenderLoli

  /** The meter and its window. */
  readonly slayyy: RenderSlayyy
}

export interface RenderProtection {
  readonly hitRecovery: boolean
  readonly slayyy: boolean
}

/**
 * Score as whole points.
 *
 * `total` is the sum of the three, exactly — the domain floors each component
 * independently so the parts a player can see always add up to the whole they
 * can see. No fractional accumulator crosses the boundary.
 */
export interface RenderScore {
  readonly total: number
  readonly distance: number
  readonly collection: number
  readonly bonus: number
}

/** One Paw Token. `laneOffset` is fractional while the magnet is pulling it. */
export interface RenderPawToken {
  readonly id: number
  readonly laneOffset: number
  readonly distanceUnits: number
}

export interface RenderLoli {
  readonly phase: LoliPhase
  /** `0`–`1` through the current phase, for entrance and exit animation. */
  readonly phaseProgress: number
  /** Bonuses earned and waiting. Run-scoped; never carried into another run. */
  readonly queuedLoliBonuses: number
}

export interface RenderSlayyy {
  readonly phase: SlayyyPhase
  /** `0`–`1` of a full meter. For the renderer, which draws a continuous fill. */
  readonly charge: number
  /**
   * The same value as a whole percent, `0`–`100`. For the HUD, which shows a
   * number: rounding here rather than in Vue means the app layer and the
   * `slayyy_charge` event can never disagree about what is on screen.
   */
  readonly percent: number
  /** Milliseconds left in the active window; `0` unless active. */
  readonly activeRemainingMs: number
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
  /**
   * The score changed, carrying the new total.
   *
   * Coarse despite the score moving every step: the loop emits this only when
   * the *displayed integer* changes, which is a few times a second rather than
   * 120. The HUD reads the number from the event, never from a snapshot poll.
   */
  | { readonly type: 'score_changed', readonly total: number }
  /** One or more Paw Tokens were taken. Carries the run total, not a delta. */
  | { readonly type: 'paws_changed', readonly runPaws: number, readonly cyclePaws: number }
  /** A Loli Bonus actually started. Not emitted for a threshold, nor for a queue entry. */
  | { readonly type: 'loli_started' }
  | { readonly type: 'loli_ended' }
  /**
   * The meter's filled percentage, whole numbers only.
   *
   * `accessibility.md` §3.1 requires the control to communicate charge progress
   * while charging, and §4.1 requires that cue to be readable without relying
   * on hue. Emitting the fraction raw would be 120 events a second; emitting
   * the whole percent is at most one every seven-tenths of a second at the
   * proposed rate, and it is exactly what the display can show.
   */
  | { readonly type: 'slayyy_charge', readonly percent: number }
  | { readonly type: 'slayyy_ready' }
  | { readonly type: 'slayyy_activated' }
  | { readonly type: 'slayyy_ended' }

  // --- M8 -------------------------------------------------------------------

  /**
   * The tutorial's coarse moments, and deliberately only these.
   *
   * The app renders a prompt from a lesson id and a correction id. It is not
   * told which lane the cone is in, how far away it is, or what the player just
   * pressed — the same boundary every other event here respects, for the same
   * reason: a UI that reads gameplay state is a UI that will eventually try to
   * write it.
   *
   * `index` and `total` travel with the lesson so the progress indicator does
   * not need its own copy of the lesson order, which would be a second place
   * for the sequence to live.
   */
  | {
    readonly type: 'tutorial_lesson'
    readonly lesson: TutorialLesson
    readonly index: number
    readonly total: number
  }
  /**
   * The player did something the lesson cannot accept, or nothing at all.
   *
   * `attempt` counts within the current lesson, so guidance can become more
   * explicit without the app tracking how often it has spoken.
   */
  | {
    readonly type: 'tutorial_correction'
    readonly lesson: TutorialLesson
    readonly correction: TutorialCorrection
    readonly attempt: number
  }
  /** Finished or skipped. Both mean the same thing to first-run routing. */
  | { readonly type: 'tutorial_completed', readonly outcome: TutorialOutcome }

/** What the app hands the engine when it mounts a run. */
export interface RunEventSink {
  (event: RunEvent): void
}
