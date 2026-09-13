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
  /** The road, inset within the column — the remainder is sand shoulder. */
  readonly roadWidthPx: number
  /** Distance between adjacent lane centres. */
  readonly lanePitchPx: number
  /** Viewport centre of the column, and so of the middle lane. */
  readonly centreXPx: number
  /** The ground the player stands on, measured from the top. */
  readonly groundYPx: number
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
 * Anchored near the bottom: the approved composition puts the sea horizon in
 * the upper portion and the promenade below it, with the character low in the
 * frame and obstacles arriving from the horizon edge.
 *
 * Presentation, not a rule — the domain has no opinion about it — so it lives
 * here rather than in the tuning registry, which is for gameplay values.
 */
export const GROUND_Y_RATIO = 0.78

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
    roadWidthPx,
    lanePitchPx: roadWidthPx / PLAYFIELD.laneCount,
    centreXPx: columnLeftPx + columnWidthPx / 2,
    groundYPx: heightPx * GROUND_Y_RATIO,
    scale: columnWidthPx / PLAYFIELD.baselineWidthPx,
  }
}

/**
 * The x position for a lane, whole or fractional.
 *
 * Fractional during a transition: `0.5` is exactly between the left and centre
 * lanes. The snapshot reports the position linearly and the easing is applied
 * by the caller, so this stays a straight mapping.
 */
export function laneToX(layout: PlayfieldLayout, lanePosition: number): number {
  const fromCentre = lanePosition - PLAYFIELD.startLane

  return layout.centreXPx + fromCentre * layout.lanePitchPx
}

/** The y position for a height above the ground, in baseline pixels. */
export function heightToY(layout: PlayfieldLayout, heightPx: number): number {
  return layout.groundYPx - heightPx * layout.scale
}
