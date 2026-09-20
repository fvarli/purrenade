import type Phaser from 'phaser'
import { PLAYFIELD } from '../bridge'
import { MIN_TEXTURE_PX, RUN_ASSETS, textureKey } from './assets'
import type { RunAssetKey } from './assets'
import { PALETTE } from './palette'
import {
  SCENERY_UNITS,
  distanceToY,
  projectionAt,
  roadHalfWidthAt,
  yToDistance,
} from './layout'
import type { PlayfieldLayout } from './layout'

/**
 * The seaside promenade: sky, coast, road and dressing.
 *
 * Everything here is scenery. It reads the layout and a scroll offset and draws
 * a place; it never touches the snapshot's obstacles, never decides anything,
 * and could be deleted without changing a single gameplay outcome.
 *
 * It is a separate module from the scene for the same reason it is a separate
 * layer on screen: the world turned out to be most of the work, and leaving it
 * inline would have buried the twenty lines that actually drive the characters
 * under three hundred that draw a balustrade.
 *
 * **The road is drawn in projection, not in columns.** Three parallel vertical
 * stripes with a flat floor under them is what the review saw as "a
 * spreadsheet", and no amount of paving seams fixes it, because the seams were
 * evenly spaced too. Here the lane markings, the kerbs, the paving and the
 * balusters are all placed by world distance and projected — so their *spacing*
 * compresses towards the vanishing point, which is the cue that actually says
 * "forward".
 */

export interface PromenadeView {
  readonly layout: PlayfieldLayout
  /** How far the world has travelled, in road units. Drives the road texture. */
  readonly scrollUnits: number
  /** `0`–`1` into the SLAYYY world. Colour only; no geometry moves. */
  readonly bloom: number
  /** False while the run is not live, so the surface reads as not-yet-playing. */
  readonly live: boolean
  readonly reducedMotion: boolean
}

export interface Promenade {
  /** Re-place everything that depends on the viewport. */
  resize: (layout: PlayfieldLayout) => void
  render: (view: PromenadeView) => void
}

/** Lane boundaries, in lane units: two interior lines for three lanes. */
const LANE_BOUNDARIES = [0.5, 1.5] as const

/** One paving seam every this many road units. */
const SEAM_UNITS = 0.62
/** A lane dash and the gap after it, in road units. */
const DASH_UNITS = 0.55
const DASH_GAP_UNITS = 0.55
/** One baluster every this many road units. */
const BALUSTER_UNITS = 0.34
/**
 * One piece of promenade dressing every this many road units, per side.
 *
 * Widened from 2.6 when the rows were extended to the horizon: the same spacing
 * over nearly twice the range filled the mid-distance with overlapping palms and
 * benches, and a crowded promenade is no better than an empty one. The review
 * asked for balance "without artificial symmetry or clutter", and this is the
 * clutter half of that.
 */
const DRESSING_UNITS = 3.6

/**
 * How far beyond the road's edge the balustrade stands, in lane widths.
 *
 * At the *outer* edge of the stone, where a seafront railing actually is. The
 * first pass put it a fifth of a lane off the road, which planted a pale stone
 * railing in the middle of a pale stone terrace — present in every frame and
 * invisible in all of them. Standing it on the boundary between the paving and
 * the planting gives it something to be a boundary of.
 */
const RAILING_OFFSET_LANES = 1.95

/** How far the stone terrace reaches past the road's edge, in lane widths. */
const TERRACE_LANES = 2.3

/**
 * The road is drawn past the player's feet to the bottom of the screen.
 *
 * `yToDistance` of the viewport's bottom row is a negative distance — behind
 * the camera — and that is correct: the promenade the player has already run
 * over is still under them. Cutting the trapezoid off at their feet left a
 * hard horizontal edge across the lower third of every screenshot.
 */
function nearDistance(layout: PlayfieldLayout): number {
  return yToDistance(layout, layout.viewportHeightPx)
}

/**
 * Below this, two consecutive marks are the same pixel row.
 *
 * Every repeating feature of the road — paving, dashes, balusters — is placed
 * at a fixed world interval, so the number of them on screen is decided by the
 * projection rather than by a count. Drawing on past this point costs hundreds
 * of fills a frame and produces a flat grey line; stopping here is what lets
 * the road run all the way to the vanishing point cheaply.
 */
const MIN_MARK_GAP_PX = 1.4

/** A hard stop, so an odd viewport can never turn a frame into a long loop. */
const MAX_MARKS = 96

/**
 * Where the `index`-th repeat of an interval is, given how far the world has
 * scrolled. Returns `null` once the marks are too close together to draw.
 */
function markDistance(
  layout: PlayfieldLayout,
  near: number,
  interval: number,
  scrollUnits: number,
  index: number,
): number | null {
  const phase = ((scrollUnits % interval) + interval) % interval
  const first = Math.ceil((near + phase) / interval)
  const distance = (first + index) * interval - phase

  if (distance > SCENERY_UNITS) return null
  if (distanceToY(layout, distance) - distanceToY(layout, distance + interval) < MIN_MARK_GAP_PX) {
    return null
  }

  return distance
}

/**
 * Mix two packed RGB colours. Derived from tokens, so no new hex enters.
 *
 * Written out per channel rather than through a `mix(shift)` helper, which read
 * better and allocated a closure on **every call** — and this is called for every
 * band of the shore and twice per baluster, which is a few hundred short-lived
 * functions a frame for the collector to deal with.
 */
function blend(from: number, to: number, t: number): number {
  const r = Math.round(((from >> 16) & 0xFF) + (((to >> 16) & 0xFF) - ((from >> 16) & 0xFF)) * t)
  const g = Math.round(((from >> 8) & 0xFF) + (((to >> 8) & 0xFF) - ((from >> 8) & 0xFF)) * t)
  const b = Math.round((from & 0xFF) + ((to & 0xFF) - (from & 0xFF)) * t)

  return ((r & 0xFF) << 16) | ((g & 0xFF) << 8) | (b & 0xFF)
}

/**
 * Values the per-frame drawing loops used to write inline.
 *
 * `for (const side of [-1, 1])` and a nested tuple literal read perfectly well
 * and allocate a fresh array on every frame that runs them. At 120 Hz across
 * three loops that is a steady drip of garbage for no benefit, so they are
 * hoisted to module scope.
 */
const SIDES = Object.freeze([-1, 1] as const)

/** The plinth and the handrail: lift above the ground, and thickness. */
const RAIL_BANDS = Object.freeze([
  Object.freeze([0.04, 0.13] as const),
  Object.freeze([0.62, 0.11] as const),
] as const)

/** The kerb's width, and how far inside the road's edge the course line sits. */
const KERB_LANES = 0.055
const COURSE_INSET_LANES = 0.16

interface DressingPiece {
  readonly key: RunAssetKey
  /** Height at the player's feet, in lane widths. */
  readonly heightLanes: number
  /** How far past the road's edge its base stands, in lane widths. */
  readonly offsetLanes: number
  /**
   * What it actually stands on, in lane widths.
   *
   * Stated per piece rather than taken as a fraction of the drawn width,
   * because a palm's drawn width is its *crown* and the thing touching the
   * ground is its trunk. A shadow sized off the crown floats the tree on a
   * puddle, which is most of what "decorative sticker" looks like.
   */
  readonly shadowLanes: number
}

/** The promenade dressing, in the order it repeats along each side. */
const DRESSING: readonly DressingPiece[] = [
  { key: 'palm', heightLanes: 3.4, offsetLanes: 1.55, shadowLanes: 0.5 },
  { key: 'lamp', heightLanes: 2.5, offsetLanes: 0.62, shadowLanes: 0.32 },
  { key: 'flowerpot', heightLanes: 0.9, offsetLanes: 0.8, shadowLanes: 0.8 },
  { key: 'bench', heightLanes: 0.72, offsetLanes: 1.2, shadowLanes: 1.2 },
]

/**
 * A second row, further out, for the space a desktop has and a phone does not.
 *
 * v0.3's desktop board fills the room beside the protected column with the
 * same seaside rather than with empty page, and one row of palms hard against
 * the railing leaves most of a 1920-wide screen as ground. These stand where
 * there is ground to stand on, and are simply never shown when there is not.
 *
 * Deliberately no taller than the inner row at the same depth. The first
 * version reached 4.2 lane widths at an offset of 6.4, and both are multiplied
 * by a projection that rises to 2.6 under the camera — so the nearest outer
 * lamp was drawn some eight hundred pixels tall, most of it off the side of the
 * screen. A clipped giant with no ground under it is the "floating sticker"
 * the review saw; `OUTER_MIN_DISTANCE_UNITS` is the other half of the fix.
 */
const OUTER_DRESSING: readonly DressingPiece[] = [
  { key: 'palm', heightLanes: 3.6, offsetLanes: 3.3, shadowLanes: 0.55 },
  { key: 'flowerpot', heightLanes: 1.0, offsetLanes: 4.6, shadowLanes: 0.85 },
  { key: 'bench', heightLanes: 0.8, offsetLanes: 3.9, shadowLanes: 1.25 },
  { key: 'lamp', heightLanes: 2.6, offsetLanes: 5.4, shadowLanes: 0.34 },
]

/** The outer row never appears in the clipped foreground. */
const OUTER_MIN_DISTANCE_UNITS = 3.2

/**
 * Where the dressing sits in the display list, and where its ramp ends.
 *
 * The ramp used to run from 4 to 5 while the column light was pinned at 4, so
 * whether a palm painted over the desktop vignette depended on how far away it
 * was — display-list order deciding something nobody chose. The light now sits
 * above the whole ramp and still below the Paw Tokens at 8.
 */
const DRESSING_DEPTH = 4
const DRESSING_DEPTH_MAX = DRESSING_DEPTH + 1

/**
 * How far down the promenade the dressing runs.
 *
 * Further than the gameplay range, because the road does: stopping the palms at
 * `visibleUnits` left a bare band of terrace between the last one and the
 * horizon, and the eye reads that gap as the world ending rather than as
 * distance. Beyond this the pieces are a couple of pixels tall and the haze has
 * them anyway.
 */
const DRESSING_RANGE_UNITS = 18

/** Slots per side, covering the range with one spare to rotate through. */
const DRESSING_SLOTS = Math.ceil(DRESSING_RANGE_UNITS / DRESSING_UNITS) + 1

/**
 * Which piece a pool slot holds, and which side of the road it stands on.
 *
 * The side and the piece must not be decided by the same parity, and for two
 * milestones they were: `side = index % 2` with `piece = row[index % 4]` gives
 * the left side pieces 0 and 2 for ever and the right side pieces 1 and 3. With
 * a palm at index 0 that put **every palm in the scene on the left**, which is
 * exactly the imbalance the review saw. Offsetting the piece by the side breaks
 * the lockstep, and both sides then cycle through all four.
 *
 * Creation and rendering both go through here. A slot's texture is set once, so
 * if the two disagreed a slot built as a palm would be positioned as a bench.
 */
function slotSide(index: number): number {
  return index % 2 === 0 ? -1 : 1
}

function slotPiece(row: readonly DressingPiece[], index: number): DressingPiece {
  const slot = Math.floor(index / 2)

  return row[(slot + (slotSide(index) < 0 ? 0 : 1)) % row.length]!
}

export interface PromenadeOptions {
  /** False when a prepared texture failed to load; scenery images are skipped. */
  readonly artReady: boolean
}

export function createPromenade(
  scene: Phaser.Scene,
  { artReady }: PromenadeOptions,
): Promenade {
  const sky = scene.add.rectangle(0, 0, 0, 0, PALETTE.sky).setDepth(0)

  /**
   * The coast: sky, clouds, mountains, town and sea, in one painted band.
   *
   * A tile sprite rather than a stretched image. The texture is the master's
   * coastline mirrored onto itself, so it repeats with no seam — which means it
   * can both drift for parallax and start part-way along, and the mirror line
   * is never parked in the middle of the screen where the doubled town is
   * impossible to miss.
   */
  const horizon = artReady
    ? scene.add.tileSprite(0, 0, 1, 1, textureKey('horizon')).setDepth(1).setOrigin(0.5, 1)
    : null

  /**
   * The seafront balustrade, left and right of the play column.
   *
   * v0.3's desktop board runs a railing band across the width of the screen at
   * the point where the sea meets the promenade, and that band is most of what
   * makes the surround read as the same place as the playfield. It is two
   * sprites rather than one because the middle of the screen already has a
   * balustrade — the road's own, in perspective — and a second one lying flat
   * across it would be two railings at two different angles in one picture.
   *
   * On a phone the column is the viewport and neither of these has anywhere to
   * be, so both are hidden.
   */
  const seafront = artReady
    ? [-1, 1].map(() => scene.add
        .tileSprite(0, 0, 1, 1, textureKey('railing'))
        .setDepth(2)
        .setOrigin(0.5, 1)
        .setVisible(false))
    : []

  /** Shore, road, markings and balustrade — one geometry pass per frame. */
  const ground = scene.add.graphics().setDepth(3)

  /*
   * Dressing, created once and recycled by distance.
   *
   * Pooled for the same reason the obstacles are: a palm that scrolls out of
   * view is a palm that will be needed again in four seconds, and building and
   * destroying Phaser images at that rate is how a run starts stuttering after
   * a minute.
   */
  interface DressingRow {
    readonly images: Phaser.GameObjects.Image[]
    /** One contact shadow per slot, shown and hidden with its piece. */
    readonly shadows: Phaser.GameObjects.Image[]
  }

  const makeDressing = (row: readonly DressingPiece[]): DressingRow => (artReady
    ? {
        images: Array.from({ length: DRESSING_SLOTS * 2 }, (_, index) => scene.add
          .image(0, 0, textureKey(slotPiece(row, index).key))
          .setOrigin(0.5, 1)
          .setVisible(false)),
        shadows: Array.from({ length: DRESSING_SLOTS * 2 }, () => scene.add
          .image(0, 0, textureKey('shadow'))
          .setOrigin(0.5, 0.5)
          .setVisible(false)),
      }
    : { images: [], shadows: [] })

  const dressing = makeDressing(DRESSING)
  const outerDressing = makeDressing(OUTER_DRESSING)

  /**
   * The protected play column, marked rather than framed.
   *
   * v0.3's desktop board keeps the whole viewport as one seaside picture and
   * *lights* the 460 px strip the game runs in. The previous build drew a
   * bordered, rounded, drop-shadowed box instead, which is a phone sitting on a
   * web page — the exact thing the review rejected. This is a wash of warm
   * light with two soft edges, inside the same canvas as the coast around it,
   * so there is one composition and not two.
   */
  const columnLight = scene.add.graphics().setDepth(DRESSING_DEPTH_MAX + 1)

  let current: PlayfieldLayout | null = null

  function resize(layout: PlayfieldLayout): void {
    current = layout

    const { viewportWidthPx: width, viewportHeightPx: height } = layout

    sky.setPosition(width / 2, height / 2).setSize(width, height)

    if (horizon !== null) {
      /*
       * The painting's full height maps to the sky band, so the coast sits at a
       * believable distance. The first pass scaled by *width* and blew a
       * 1920-wide strip up to 2400, which showed the lower half of the image:
       * hills the size of the sea, and the mirror seam down the middle.
       */
      const source = horizon.texture.getSourceImage() as { height: number }
      const bandHeight = layout.horizonYPx + 2

      horizon.setPosition(width / 2, layout.horizonYPx + 1)
      horizon.setSize(width, bandHeight)
      horizon.setTileScale(bandHeight / source.height)
    }

    const flankWidth = Math.max(0, (width - layout.columnWidthPx) / 2)

    seafront.forEach((rail, index) => {
      const side = index === 0 ? -1 : 1

      rail.setVisible(flankWidth > 24)

      if (flankWidth <= 24) return

      const railHeight = Math.max(14, layout.lanePitchPx * 0.5)
      const source = rail.texture.getSourceImage() as { height: number }

      rail.setPosition(
        width / 2 + side * (layout.columnWidthPx / 2 + flankWidth / 2),
        layout.horizonYPx + railHeight * 0.45,
      )
      rail.setSize(flankWidth + 2, railHeight)
      rail.setTileScale(railHeight / source.height)
    })
  }

  /**
   * The ground the promenade sits on, and what grows beside it.
   *
   * Three materials, not one wash. The first pass filled everything below the
   * horizon with a single beige ramp, and on a wide screen that is most of the
   * picture: a desert with a road down the middle, which is what "the
   * surrounding desktop world is largely empty" describes. Stone under the
   * walkway, planting past its edge and a warmer stone under the player's feet
   * give the same area something to be.
   */
  function drawShore(layout: PlayfieldLayout, view: PromenadeView): void {
    const { viewportWidthPx: width, viewportHeightPx: height, horizonYPx } = layout
    const near = nearDistance(layout)
    const far = SCENERY_UNITS
    const bands = 8
    const span = height - horizonYPx

    // Planting, edge to edge: everything that is not walkway is garden.
    for (let index = 0; index < bands; index++) {
      const top = horizonYPx + (span * index) / bands

      ground.fillStyle(
        blend(
          blend(
            blend(PALETTE.garden, PALETTE.gardenDeep, 0.16),
            PALETTE.promenadeFar,
            0.34 + 0.26 * (index / bands),
          ),
          PALETTE.bloom,
          view.bloom * 0.6,
        ),
        1,
      )
      ground.fillRect(0, top, width, span / bands + 1)
      ground.fillStyle(PALETTE.sky, 0.3 * (1 - index / bands))
      ground.fillRect(0, top, width, span / bands + 1)
    }

    // The walkway: the stone terrace the lanes are cut into, wide enough that
    // the balustrade has something to stand on and narrow enough that the
    // planting still reads.
    ground.fillStyle(blend(PALETTE.shoulder, PALETTE.bloom, view.bloom * 0.45), 1)
    quad(
      layout, near, far,
      () => layout.centreXPx,
      distance => roadHalfWidthAt(layout, distance)
        + layout.lanePitchPx * TERRACE_LANES * projectionAt(distance),
    )
  }

  /**
   * A four-cornered strip, as two triangles.
   *
   * `fillPoints` would read better and allocates an array of points on every
   * call — which, for a road rebuilt at 120 Hz out of a few dozen strips, is a
   * few thousand short-lived objects a second for the collector to deal with.
   * Two `fillTriangle` calls allocate nothing.
   */
  function strip(
    nearLeftX: number, nearRightX: number, nearY: number,
    farLeftX: number, farRightX: number, farY: number,
  ): void {
    ground.fillTriangle(nearLeftX, nearY, nearRightX, nearY, farRightX, farY)
    ground.fillTriangle(nearLeftX, nearY, farRightX, farY, farLeftX, farY)
  }

  /** A strip between two distances, given each one's half-width about a centre. */
  function quad(
    layout: PlayfieldLayout,
    near: number,
    far: number,
    centreAt: (distance: number) => number,
    halfAt: (distance: number) => number,
  ): void {
    const nearC = centreAt(near)
    const farC = centreAt(far)
    const nearH = halfAt(near)
    const farH = halfAt(far)

    strip(
      nearC - nearH, nearC + nearH, distanceToY(layout, near),
      farC - farH, farC + farH, distanceToY(layout, far),
    )
  }

  function drawRoad(layout: PlayfieldLayout, view: PromenadeView): void {
    const near = nearDistance(layout)
    const far = SCENERY_UNITS
    const centre = (): number => layout.centreXPx

    // The carriageway itself.
    ground.fillStyle(blend(PALETTE.promenade, PALETTE.bloom, view.bloom * 0.55), 1)
    quad(layout, near, far, centre, distance => roadHalfWidthAt(layout, distance))

    // Kerbs: a thin darker strip down each edge, converging with everything
    // else. They are what stops the road reading as a lighter rectangle.
    for (const side of SIDES) {
      ground.fillStyle(PALETTE.seam, 0.5)
      quad(
        layout, near, far,
        distance => layout.centreXPx
          + side * (roadHalfWidthAt(layout, distance) + layout.lanePitchPx * KERB_LANES * projectionAt(distance)),
        distance => layout.lanePitchPx * KERB_LANES * projectionAt(distance),
      )

      /*
       * The edge course: the line where the paving's border row meets the rest
       * of it. One faint strip per side, inside the kerb and well clear of the
       * lane centres, so it says "laid stone" without putting anything under an
       * obstacle for the player to read past.
       */
      ground.fillStyle(PALETTE.seam, 0.13)
      quad(
        layout, near, far,
        distance => layout.centreXPx
          + side * (roadHalfWidthAt(layout, distance) - layout.lanePitchPx * COURSE_INSET_LANES * projectionAt(distance)),
        distance => Math.max(0.5, layout.lanePitchPx * 0.012 * projectionAt(distance)),
      )
    }

    /*
     * Paving seams.
     *
     * Placed at fixed *world* intervals and then projected, so they bunch up
     * towards the horizon and sweep apart as they reach the player. Even
     * spacing down the screen was the single biggest reason the old road read
     * as a flat texture rather than as ground moving underneath someone.
     */
    for (let index = 0; index < MAX_MARKS; index++) {
      const distance = markDistance(layout, near, SEAM_UNITS, view.scrollUnits, index)

      if (distance === null) break

      const half = roadHalfWidthAt(layout, distance)
      const y = distanceToY(layout, distance)
      const thickness = Math.max(1, layout.scale * 1.6 * projectionAt(distance))

      ground.fillStyle(PALETTE.seam, 0.22)
      ground.fillRect(layout.centreXPx - half, y, half * 2, thickness)

      /*
       * The bevel: the lit top edge of the course below the joint.
       *
       * One pale line under each seam, which is what turns a flat fill into
       * laid stone at almost no cost. Deliberately fainter than the seam and
       * deliberately not a second full-strength mark — the road has to stay the
       * quietest surface in the picture, because everything the player reacts
       * to is standing on it.
       */
      ground.fillStyle(PALETTE.laneLine, 0.1)
      ground.fillRect(layout.centreXPx - half, y + thickness, half * 2, thickness)
    }
  }

  function drawLaneDashes(layout: PlayfieldLayout, view: PromenadeView): void {
    const near = nearDistance(layout)
    const period = DASH_UNITS + DASH_GAP_UNITS

    ground.fillStyle(PALETTE.laneLine, view.live ? 0.85 : 0.6)

    for (const boundary of LANE_BOUNDARIES) {
      const offset = boundary - PLAYFIELD.startLane
      const centreAt = (distance: number): number =>
        layout.centreXPx + offset * layout.lanePitchPx * projectionAt(distance)
      const halfAt = (distance: number): number =>
        Math.max(0.6, layout.lanePitchPx * 0.026 * projectionAt(distance))

      for (let index = 0; index < MAX_MARKS; index++) {
        const distance = markDistance(layout, near, period, view.scrollUnits, index)

        if (distance === null) break

        quad(layout, Math.max(near, distance - DASH_UNITS), distance, centreAt, halfAt)
      }
    }
  }

  /**
   * The balustrade along each side of the promenade.
   *
   * Drawn rather than tiled from the prop sheet: a repeated image cannot be
   * spaced correctly in projection — its balusters would stay evenly apart
   * while everything else compressed — and the gaps and overlaps that spacing
   * produces are visible at every depth. Two rails and a run of balusters,
   * each placed by world distance, gets the compression for free.
   */
  function drawBalustrade(layout: PlayfieldLayout, view: PromenadeView): void {
    const near = Math.max(nearDistance(layout), -0.6)
    const far = SCENERY_UNITS
    const stone = blend(PALETTE.cream, PALETTE.bloom, view.bloom * 0.7)

    const baluster = blend(stone, PALETTE.seam, 0.42)
    const gap = blend(PALETTE.seam, PALETTE.ink, 0.25)
    const plinth = blend(stone, PALETTE.seam, 0.4)

    for (const side of SIDES) {
      const edgeAt = (distance: number): number => layout.centreXPx
        + side * (roadHalfWidthAt(layout, distance)
          + layout.lanePitchPx * RAILING_OFFSET_LANES * projectionAt(distance))

      // Balusters first, so the rails read as passing in front of them.
      ground.fillStyle(baluster, 0.95)

      for (let index = 0; index < MAX_MARKS; index++) {
        const distance = markDistance(layout, near, BALUSTER_UNITS, view.scrollUnits, index)

        if (distance === null) break

        const scale = projectionAt(distance)
        const width = Math.max(1.5, layout.lanePitchPx * 0.13 * scale)
        const top = distanceToY(layout, distance) - layout.lanePitchPx * 0.6 * scale
        const base = distanceToY(layout, distance) - layout.lanePitchPx * 0.06 * scale
        const x = edgeAt(distance) - width / 2

        // A baluster and the gap beside it. The gap is what reads as a railing
        // rather than as a kerb, so it is drawn rather than left to chance.
        ground.fillRect(x, top, width, base - top)
        ground.fillStyle(gap, 0.22)
        ground.fillRect(x + width, top + (base - top) * 0.15, width * 0.55, (base - top) * 0.85)
        ground.fillStyle(baluster, 0.95)
      }

      // The handrail above and the plinth below, each a band running the whole
      // length of the road and narrowing with it.
      for (const [lift, thickness] of RAIL_BANDS) {
        ground.fillStyle(lift > 0.3 ? stone : plinth, 1)

        const nearY = distanceToY(layout, near) - layout.lanePitchPx * lift * projectionAt(near)
        const farY = distanceToY(layout, far) - layout.lanePitchPx * lift * projectionAt(far)
        const nearH = layout.lanePitchPx * 0.21 * projectionAt(near)
        const farH = layout.lanePitchPx * 0.21 * projectionAt(far)
        const nearT = layout.lanePitchPx * thickness * projectionAt(near)
        const farT = layout.lanePitchPx * thickness * projectionAt(far)

        ground.fillTriangle(
          edgeAt(near) - nearH, nearY,
          edgeAt(near) + nearH, nearY + nearT,
          edgeAt(far) + farH, farY + farT,
        )
        ground.fillTriangle(
          edgeAt(near) - nearH, nearY,
          edgeAt(far) + farH, farY + farT,
          edgeAt(far) - farH, farY,
        )
      }
    }
  }

  /**
   * Depth haze.
   *
   * A wash of the sky's own colour over the far end of the road, so the
   * promenade dissolves into the coast instead of ending at a line. Cheap, and
   * it does more for the sense of distance than another row of props would.
   */
  function drawHaze(layout: PlayfieldLayout, view: PromenadeView): void {
    const bands = 12
    const depth = layout.lanePitchPx * 2.1

    /*
     * The haze starts a little *above* the horizon.
     *
     * Where the painted coast met the drawn ground there was a ruler-straight
     * line across the whole screen — two different pictures butted together.
     * Feathering across the join rather than starting at it is what turns that
     * seam into distance.
     */
    const start = layout.horizonYPx - layout.lanePitchPx * 0.12

    for (let index = 0; index < bands; index++) {
      const top = start + (depth * index) / bands

      ground.fillStyle(
        view.bloom > 0 ? PALETTE.bloom : PALETTE.sky,
        0.4 * (1 - index / bands) ** 1.5,
      )
      ground.fillRect(0, top, layout.viewportWidthPx, depth / bands + 1)
    }
  }

  function drawColumnLight(layout: PlayfieldLayout): void {
    columnLight.clear()

    // On a phone the column *is* the viewport; there is nothing to mark.
    if (layout.columnWidthPx >= layout.viewportWidthPx - 1) return

    const { columnLeftPx: left, columnWidthPx: width, viewportHeightPx: height } = layout

    /*
     * Not a panel, and not a border.
     *
     * The first attempt filled the column with warm light and feathered its two
     * edges, which at any real alpha reads as a pane of glass laid on the
     * picture — the "mobile frame on a web page" the review rejected, drawn in
     * a different way. This is the same job done with nothing that has an edge:
     * the coast darkens gradually towards both ends of the screen, and the
     * column warms gradually towards its middle. Every band is a ramp, so there
     * is no line anywhere for an eye to catch on.
     */
    const steps = 12
    const flank = left
    const right = left + width

    for (let index = 0; index < steps; index++) {
      /*
       * Anchored at the *screen* edges, not at the column's.
       *
       * Anchoring them at the column and shrinking outward stacks every band
       * right beside the playfield and none at the edge of the screen — which
       * is the opposite of a vignette, and drew exactly the hard vertical line
       * this was written to avoid.
       */
      const band = flank * (1 - index / steps)

      columnLight.fillStyle(PALETTE.ink, 0.017)
      columnLight.fillRect(0, 0, band, height)
      columnLight.fillRect(right + flank - band, 0, band, height)

      const inset = (width / 2) * (index / steps)

      columnLight.fillStyle(PALETTE.cream, 0.013)
      columnLight.fillRect(left + inset, 0, width - inset * 2, height)
    }
  }

  function drawDressingRow(
    layout: PlayfieldLayout,
    view: PromenadeView,
    pool: DressingRow,
    row: readonly DressingPiece[],
    stagger: number,
    minDistance: number,
    enabled: boolean,
  ): void {
    if (pool.images.length === 0) return

    const period = DRESSING_UNITS * DRESSING_SLOTS
    const phase = ((view.scrollUnits % period) + period) % period
    const tint = view.bloom > 0
      ? blend(0xFFFFFF, PALETTE.bloomDeep, view.bloom * 0.45)
      : 0xFFFFFF

    pool.images.forEach((image, index) => {
      const side = slotSide(index)
      const slot = Math.floor(index / 2)
      const piece = slotPiece(row, index)
      const shadow = pool.shadows[index]

      // Staggered so the two sides never line up into a corridor of pairs.
      const base = slot * DRESSING_UNITS + (side < 0 ? 0 : DRESSING_UNITS / 2) + stagger
      const distance = ((base - phase) % period + period) % period

      const onScreen = enabled
        && distance <= DRESSING_RANGE_UNITS
        && distance >= minDistance

      image.setVisible(onScreen)
      shadow?.setVisible(onScreen)

      if (!onScreen) return

      const scale = projectionAt(distance)
      const height = layout.lanePitchPx * piece.heightLanes * scale
      const width = height * (image.width / image.height)
      const edge = roadHalfWidthAt(layout, distance)
        + layout.lanePitchPx * piece.offsetLanes * scale
      const x = layout.centreXPx + side * edge
      const baseY = distanceToY(layout, distance) + layout.lanePitchPx * 0.05 * scale

      /*
       * Nearer scenery draws over further scenery, and all of it under the
       * road's own objects — the whole ramp stays below the Paw Tokens.
       */
      const depth = DRESSING_DEPTH
        + (DRESSING_RANGE_UNITS - distance) / DRESSING_RANGE_UNITS

      image.setDisplaySize(width, height)
      image.setPosition(x, baseY)
      image.setDepth(depth)
      image.setAlpha(view.live ? 1 : 0.8)
      image.setTint(tint)

      if (shadow === undefined) return

      /*
       * The contact shadow, from the piece's own footprint.
       *
       * Without it a palm is a cut-out laid on the promenade rather than
       * something standing on it — and the player, Loli and every obstacle
       * already have one, so the scenery was the only thing in the picture not
       * touching the ground.
       */
      const footprint = layout.lanePitchPx * piece.shadowLanes * scale

      shadow.setDisplaySize(footprint, footprint * 0.32)
      shadow.setPosition(x, baseY)
      shadow.setDepth(depth - 0.5)
      shadow.setAlpha((view.live ? 0.38 : 0.26) * scale)
      shadow.setTint(tint)
    })
  }

  function drawDressing(layout: PlayfieldLayout, view: PromenadeView): void {
    drawDressingRow(layout, view, dressing, DRESSING, 0, 0, true)

    /*
     * The outer row exists only where the viewport is wider than the protected
     * column, and never in the near field. On a phone those pieces would stand
     * off the edge of the screen; on a desktop the nearest of them would be
     * drawn several times the height of the screen and clipped, which reads as
     * a sticker rather than as scenery.
     */
    drawDressingRow(
      layout, view, outerDressing, OUTER_DRESSING, DRESSING_UNITS * 0.4,
      OUTER_MIN_DISTANCE_UNITS,
      layout.viewportWidthPx > layout.columnWidthPx * 1.45,
    )
  }

  function render(view: PromenadeView): void {
    const layout = current ?? view.layout

    ground.clear()
    drawShore(layout, view)
    drawRoad(layout, view)
    drawLaneDashes(layout, view)
    drawBalustrade(layout, view)
    drawHaze(layout, view)
    drawDressing(layout, view)
    drawColumnLight(layout)

    sky.setFillStyle(blend(PALETTE.sky, PALETTE.bloom, view.bloom))

    if (horizon !== null) {
      horizon.setAlpha(view.live ? 1 : 0.85)
      horizon.setTint(view.bloom > 0
        ? blend(0xFFFFFF, PALETTE.bloomDeep, view.bloom * 0.5)
        : 0xFFFFFF)
    }

    /*
     * A slow drift, and only a drift.
     *
     * The flanking seafront is the one layer that may move independently of
     * the road, and it moves at a fraction of it — parallax, not a second
     * scroll speed competing with the ground the player is reading. Under a
     * reduced-motion preference it holds still: nothing about it carries
     * gameplay information.
     */
    for (const rail of seafront) {
      rail.setTilePosition(view.reducedMotion ? 0 : view.scrollUnits * 4)
      rail.setAlpha(view.live ? 0.95 : 0.75)
    }
  }

  return { resize, render }
}

/** Whether every prepared texture actually loaded. Exported to be tested. */
export function texturesReady(scene: Phaser.Scene): boolean {
  return Object.keys(RUN_ASSETS).every((key) => {
    const name = textureKey(key as RunAssetKey)

    if (!scene.textures.exists(name)) return false

    const source = scene.textures.get(name).getSourceImage() as {
      width?: number
      height?: number
    }

    return (source.width ?? 0) >= MIN_TEXTURE_PX && (source.height ?? 0) >= MIN_TEXTURE_PX
  })
}
