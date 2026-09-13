import { TUNING } from '../domain'

/**
 * The only gameplay configuration the engine is allowed to see.
 *
 * The engine used to `import { TUNING } from '../domain'` directly, in
 * `layout.ts` and `input/pointer.ts`. That read the whole tuning module —
 * including every value the renderer has no business knowing — and it made
 * three documents false at once: the bridge is described as "the only place
 * `game/domain` and `game/engine` meet", and it was not.
 *
 * The fix is not to re-export `TUNING`. A barrel would move the import without
 * moving the coupling, and the next value the engine reached for would be one
 * the domain owns outright. What crosses instead is this: two flat, frozen
 * records of exactly the numbers a renderer needs to place things on screen and
 * to recognise a gesture before it becomes an `InputEvent`.
 *
 * Nothing here is a rule. Every value is a presentation or recognition
 * parameter; the domain remains the only place that decides what an input does.
 * No `RunState` is reachable from any of it.
 */

export interface PlayfieldConfig {
  /** How many lanes to draw. */
  readonly laneCount: number
  /** Which lane the character starts in, for the renderer's centre reference. */
  readonly startLane: number
  /** The width the `Px` tuning values are quoted at, for scaling. */
  readonly baselineWidthPx: number
  /** The widest the play column is allowed to get on a large screen. */
  readonly maxColumnPx: number
  /** The road's share of the play column. */
  readonly roadWidthRatio: number
  /** How much road is visible ahead, in units. Sets the depth of the view. */
  readonly visibleUnits: number
  /** An obstacle's longitudinal footprint, for drawing it at the right depth. */
  readonly obstacleLengthUnits: number
  /** The tuned post-hit blink rate. Presentation reads it; the domain owns the state. */
  readonly blinkHz: number
}

export interface GestureConfig {
  /** How far a swipe must travel to count. */
  readonly minDistancePx: number
  /** How long a swipe may take before it is a drag. */
  readonly maxDurationMs: number
  /** How much one axis must beat the other for the swipe to be unambiguous. */
  readonly axisDominanceRatio: number
}

export const PLAYFIELD: PlayfieldConfig = Object.freeze({
  laneCount: TUNING.lane.count,
  startLane: TUNING.lane.startIndex,
  baselineWidthPx: TUNING.layout.baselineViewportWidthPx,
  maxColumnPx: TUNING.layout.desktopPlayColumnPx,
  roadWidthRatio: TUNING.road.widthRatio,
  visibleUnits: TUNING.world.visibleUnits,
  obstacleLengthUnits: TUNING.obstacle.defaultLengthUnits,
  blinkHz: TUNING.invuln.blinkHz,
})

export const GESTURE: GestureConfig = Object.freeze({
  minDistancePx: TUNING.swipe.minDistancePx,
  maxDurationMs: TUNING.swipe.maxDurationMs,
  axisDominanceRatio: TUNING.swipe.axisDominanceRatio,
})

/**
 * The play column's maximum width, in CSS pixels.
 *
 * The app layer needs this to line its chrome up with the playfield, and it may
 * not import `game/domain` — so the boundary carries the one value rather than
 * letting a second copy of it appear in a stylesheet, where nothing would ever
 * notice it drifting.
 */
export const PLAY_COLUMN_MAX_PX = PLAYFIELD.maxColumnPx

/**
 * The heart model, for the app layer's provisional feedback.
 *
 * Projected rather than re-exported, and carrying no state: the count itself
 * arrives as a `heart_lost` event. This is only so a heart row can render the
 * right number of shapes before anything has happened.
 */
export const HEARTS = Object.freeze({
  start: TUNING.hearts.start,
  max: TUNING.hearts.max,
})
