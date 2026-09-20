import { PLAYFIELD } from '../bridge'

/**
 * Lane units to pixels.
 *
 * The domain never sees a pixel — it reasons in lane indices and baseline-
 * relative heights — so this is where the abstraction is cashed in. Keeping the
 * conversion here rather than in the scene means one set of rules drives a
 * 390 px phone and a 460 px desktop column without a second code path, and
 * means the arithmetic can be tested without a browser.
 *
 * Pure. No Phaser, no DOM: it takes a viewport size and returns numbers.
 */

export interface PlayfieldLayout {
  /** The column gameplay happens in. Full-bleed on mobile, capped on desktop. */
  readonly columnWidthPx: number
  /** Where that column sits horizontally within the viewport. */
  readonly columnLeftPx: number
  /** The whole viewport, which the promenade and the coast fill on desktop. */
  readonly viewportWidthPx: number
  readonly viewportHeightPx: number
  /** The road at the player's feet, inset within the column. */
  readonly roadWidthPx: number
  /** Distance between adjacent lane centres, at the player's feet. */
  readonly lanePitchPx: number
  /** Viewport centre of the column, and so of the middle lane. */
  readonly centreXPx: number
  /** The ground the player stands on, measured from the top. */
  readonly groundYPx: number
  /**
   * The vanishing point: where the promenade closes to nothing and the sea
   * begins. Obstacles enter the view here and grow towards the player.
   */
  readonly horizonYPx: number
  /**
   * Baseline pixels to real pixels.
   *
   * Tuning values marked `Px` are quoted at the 390 px design baseline. A
   * 96 px jump apex must look like the same jump on a 460 px column, so
   * every such value passes through here.
   */
  readonly scale: number
}

export interface ViewportSize {
  readonly widthPx: number
  readonly heightPx: number
}

/**
 * Where the player stands, as a fraction of the viewport height.
 *
 * Low in the frame, because everything above the character's feet is road the
 * player still has to read. The first perspective pass put the feet at 0.78 and
 * the vanishing point at 0.56, which left twenty-two percent of the screen for
 * the entire playfield — the review's "not enough road ahead" in one number.
 *
 * Presentation, not a rule — the domain has no opinion about it — so these live
 * here rather than in the tuning registry, which is for gameplay values.
 */
export const GROUND_Y_RATIO = 0.82

/**
 * Where the promenade converges, as a fraction of the viewport height.
 *
 * Independent of the ground rather than derived from it. It used to be
 * `2 * GROUND_Y_RATIO - 1`, which is the reflection that makes sense for a flat
 * band seen side-on and makes none for a road seen down its length: the two
 * numbers answer different questions, and tying them together meant the
 * playfield shrank every time the character moved down the frame.
 */
export const HORIZON_Y_RATIO = 0.42

/**
 * How fast the promenade converges. Lower is a longer, flatter road.
 *
 * This is the one number that decides the perspective. It is the projective
 * depth at which an object is drawn half size — `0.5` puts the halfway point at
 * five of the ten visible units, so near obstacles are large and readable and
 * the far end still compresses convincingly into the horizon.
 */
const CONVERGENCE = 0.5

/**
 * Resolve the playfield for a viewport.
 *
 * Desktop caps the column at the approved 460 px and lets the seaside expand
 * decoratively around it; mobile takes the full width. The cap is what stops a
 * wide monitor turning three lanes into three distant stripes.
 */
export function resolveLayout({ widthPx, heightPx }: ViewportSize): PlayfieldLayout {
  const columnWidthPx = Math.min(widthPx, PLAYFIELD.maxColumnPx)
  const columnLeftPx = (widthPx - columnWidthPx) / 2
  const roadWidthPx = columnWidthPx * PLAYFIELD.roadWidthRatio

  return {
    columnWidthPx,
    columnLeftPx,
    viewportWidthPx: widthPx,
    viewportHeightPx: heightPx,
    roadWidthPx,
    lanePitchPx: roadWidthPx / PLAYFIELD.laneCount,
    centreXPx: columnLeftPx + columnWidthPx / 2,
    groundYPx: heightPx * GROUND_Y_RATIO,
    horizonYPx: heightPx * HORIZON_Y_RATIO,
    scale: columnWidthPx / PLAYFIELD.baselineWidthPx,
  }
}

/**
 * How much a thing at this distance shrinks, and how far up the screen it sits.
 *
 * One function, because in a one-point projection those are the same number.
 * `f(0) = 1` at the player's feet and `f` falls off as `p / (d + p)` — the
 * shape a pinhole camera actually produces, not a straight line between two
 * chosen sizes. That matters for more than looks: with a linear ramp the road's
 * edges are straight but its *texture* spacing is uniform, and a uniform floor
 * under converging edges is what made the previous promenade read as three
 * vertical columns rather than as distance.
 *
 * Unclamped, because the promenade is longer than the game is. Gameplay lives
 * in the first ten units and scenery runs on to the vanishing point behind it;
 * clamping here would flatten the far end of the road into a band and leave a
 * hard edge between it and the sea.
 */
export function projectionAt(distanceUnits: number): number {
  const depth = distanceUnits / PLAYFIELD.visibleUnits

  return Math.min(NEAR_SCALE_CAP, CONVERGENCE / Math.max(depth + CONVERGENCE, CONVERGENCE / NEAR_SCALE_CAP))
}

/**
 * How big a *gameplay* object at this distance is drawn.
 *
 * Clamped to the playable range, which is the part that has to stay fair: an
 * obstacle rendered at a sub-pixel size the frame before it is culled flickers,
 * and one the player cannot see is one they cannot avoid. Beyond the visible
 * road nothing gameplay-bearing exists, so the clamp costs nothing.
 */
export function distanceScale(distanceUnits: number): number {
  return projectionAt(Math.min(PLAYFIELD.visibleUnits, Math.max(0, distanceUnits)))
}

/** The biggest anything is drawn, for the road immediately under the camera. */
const NEAR_SCALE_CAP = 2.6

/** The smallest `distanceScale` can be: the far end of the *playable* road. */
export const FAR_SCALE = CONVERGENCE / (1 + CONVERGENCE)

/** The distance at which the projection has shrunk something to this factor. */
export function distanceForScale(scale: number): number {
  return (CONVERGENCE / scale - CONVERGENCE) * PLAYFIELD.visibleUnits
}

/**
 * How far down the road the scenery is drawn.
 *
 * Far enough that the promenade closes to a couple of pixels and the haze takes
 * it the rest of the way, so there is no seam where the road stops and the sea
 * starts. Gameplay never reaches here — `PLAYFIELD.visibleUnits` is a
 * twenty-fifth of it — which is exactly why the two numbers are separate.
 */
export const SCENERY_UNITS = distanceForScale(0.012)

/**
 * The x position for a lane, whole or fractional, at the player's feet.
 *
 * Fractional during a transition: `0.5` is exactly between the left and centre
 * lanes. The snapshot reports the position linearly and the easing is applied
 * by the caller, so this stays a straight mapping.
 */
export function laneToX(layout: PlayfieldLayout, lanePosition: number): number {
  const fromCentre = lanePosition - PLAYFIELD.startLane

  return layout.centreXPx + fromCentre * layout.lanePitchPx
}

/**
 * The x position for a lane at a distance down the road.
 *
 * The same lane, drawn where the projection puts it: lanes converge on the
 * vanishing point, so an obstacle two lanes out at the far end is nearly above
 * the middle of the screen. Drawing it at its near-field x — which is what
 * `laneToX` alone does — is what makes a perspective road look like it is
 * painted on a flat wall.
 *
 * Nothing here decides anything. The rules already know which lane this is.
 */
export function laneToXAtDistance(
  layout: PlayfieldLayout,
  lanePosition: number,
  distanceUnits: number,
): number {
  const fromCentre = lanePosition - PLAYFIELD.startLane

  return layout.centreXPx
    + fromCentre * layout.lanePitchPx * distanceScale(distanceUnits)
}

/** The y position for a height above the ground, in baseline pixels. */
export function heightToY(layout: PlayfieldLayout, heightPx: number): number {
  return layout.groundYPx - heightPx * layout.scale
}

/**
 * Where an obstacle sits on screen, from its distance along the road.
 *
 * Strictly monotonic and continuous from the player's feet to the vanishing
 * point, so an approaching obstacle never appears to stall or jump — and now
 * genuinely projective, so it slows down as it recedes the way a real road
 * does.
 *
 * Nothing here decides anything either. The rules already know whether this
 * obstacle hit the player; this only says where to draw it.
 */
export function distanceToY(layout: PlayfieldLayout, distanceUnits: number): number {
  const span = layout.groundYPx - layout.horizonYPx

  return layout.horizonYPx + span * projectionAt(distanceUnits)
}

/**
 * The inverse: how far down the road a screen row is.
 *
 * The promenade's own texture is drawn in screen rows — a seam every so many
 * pixels would be a flat floor — so the renderer needs to ask "what distance is
 * this row?" as well as "what row is this distance?".
 */
export function yToDistance(layout: PlayfieldLayout, y: number): number {
  const span = layout.groundYPx - layout.horizonYPx
  const f = Math.min(NEAR_SCALE_CAP, Math.max(0.0001, (y - layout.horizonYPx) / span))

  return distanceForScale(f)
}

/** Half the road's width at a distance, in pixels. The promenade's edge. */
export function roadHalfWidthAt(layout: PlayfieldLayout, distanceUnits: number): number {
  return (layout.roadWidthPx / 2) * projectionAt(distanceUnits)
}
