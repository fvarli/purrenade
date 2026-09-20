import { describe, expect, it } from 'vitest'
import { GESTURE, PLAYFIELD } from '../bridge'

import {
  FAR_SCALE,
  SCENERY_UNITS,
  distanceScale,
  distanceToY,
  heightToY,
  laneToX,
  laneToXAtDistance,
  projectionAt,
  resolveLayout,
  roadHalfWidthAt,
  yToDistance,
} from './layout'
import { inputForKeyCode, isGameplayKey, shouldHandleKey } from './input/keyboard'
import { IDLE_POINTER, gestureToInput, pointerDown, pointerUp } from './input/pointer'

/**
 * A sample height in baseline pixels.
 *
 * Deliberately a local constant rather than the domain's jump apex: `heightToY`
 * converts whatever height the snapshot carries, and the engine has no business
 * knowing how high a jump goes. Reading the real tuning value here would have
 * been the spec quietly re-opening the boundary the module just closed.
 */
const SAMPLE_HEIGHT_PX = 96

/**
 * The engine's pure half.
 *
 * Layout arithmetic and input normalization do not need Phaser, a canvas or a
 * touchscreen, so they are written as functions over plain values and tested
 * here in Node. What is left in the scene is the part that genuinely needs a
 * renderer, and that part makes no decisions.
 */

describe('resolveLayout', () => {
  it('is full-bleed on a phone', () => {
    const layout = resolveLayout({ widthPx: 360, heightPx: 640 })

    expect(layout.columnWidthPx).toBe(360)
    expect(layout.columnLeftPx).toBe(0)
  })

  it('caps the column on a wide screen and centres it', () => {
    // Without the cap a wide monitor turns three lanes into three distant
    // stripes; the seaside is meant to expand decoratively instead.
    const layout = resolveLayout({ widthPx: 1920, heightPx: 1080 })

    expect(layout.columnWidthPx).toBe(PLAYFIELD.maxColumnPx)
    expect(layout.columnLeftPx).toBe((1920 - PLAYFIELD.maxColumnPx) / 2)
    expect(layout.centreXPx).toBe(960)
  })

  it('insets the road inside the column, leaving shoulders', () => {
    const layout = resolveLayout({ widthPx: 390, heightPx: 844 })

    expect(layout.roadWidthPx).toBeCloseTo(390 * PLAYFIELD.roadWidthRatio, 9)
    expect(layout.roadWidthPx).toBeLessThan(layout.columnWidthPx)
  })

  it('divides the road into three equal lanes', () => {
    const layout = resolveLayout({ widthPx: 390, heightPx: 844 })

    expect(layout.lanePitchPx * PLAYFIELD.laneCount).toBeCloseTo(layout.roadWidthPx, 9)
  })

  it('scales baseline pixels to the column', () => {
    // A 96 px jump apex must read as the same jump on a 460 px column.
    expect(resolveLayout({ widthPx: 390, heightPx: 844 }).scale).toBe(1)
    expect(resolveLayout({ widthPx: 780, heightPx: 844 }).scale)
      .toBeCloseTo(PLAYFIELD.maxColumnPx / 390, 9)
  })
})

describe('laneToX', () => {
  const layout = resolveLayout({ widthPx: 390, heightPx: 844 })

  it('puts the centre lane at the centre of the column', () => {
    expect(laneToX(layout, PLAYFIELD.startLane)).toBe(layout.centreXPx)
  })

  it('spaces the outer lanes by one pitch either side', () => {
    expect(laneToX(layout, 0)).toBeCloseTo(layout.centreXPx - layout.lanePitchPx, 9)
    expect(laneToX(layout, 2)).toBeCloseTo(layout.centreXPx + layout.lanePitchPx, 9)
  })

  it('maps a fractional position to a point between lanes', () => {
    const midway = laneToX(layout, 0.5)

    expect(midway).toBeGreaterThan(laneToX(layout, 0))
    expect(midway).toBeLessThan(laneToX(layout, 1))
    expect(midway).toBeCloseTo((laneToX(layout, 0) + laneToX(layout, 1)) / 2, 9)
  })

  it('keeps every lane inside the column', () => {
    for (const wide of [320, 360, 390, 768, 1920]) {
      const l = resolveLayout({ widthPx: wide, heightPx: 800 })

      for (const lane of [0, 1, 2]) {
        expect(laneToX(l, lane)).toBeGreaterThanOrEqual(l.columnLeftPx)
        expect(laneToX(l, lane)).toBeLessThanOrEqual(l.columnLeftPx + l.columnWidthPx)
      }
    }
  })
})

describe('heightToY', () => {
  it('puts a grounded player on the ground', () => {
    const layout = resolveLayout({ widthPx: 390, heightPx: 844 })

    expect(heightToY(layout, 0)).toBe(layout.groundYPx)
  })

  it('moves up the screen as height increases', () => {
    const layout = resolveLayout({ widthPx: 390, heightPx: 844 })

    expect(heightToY(layout, SAMPLE_HEIGHT_PX)).toBeLessThan(layout.groundYPx)
  })

  it('scales the arc with the column', () => {
    const phone = resolveLayout({ widthPx: 390, heightPx: 844 })
    const desktop = resolveLayout({ widthPx: 1920, heightPx: 1080 })

    const phoneRise = phone.groundYPx - heightToY(phone, SAMPLE_HEIGHT_PX)
    const desktopRise = desktop.groundYPx - heightToY(desktop, SAMPLE_HEIGHT_PX)

    expect(desktopRise / phoneRise).toBeCloseTo(desktop.scale / phone.scale, 9)
  })
})

describe('keyboard normalization', () => {
  it.each([
    ['ArrowLeft', 'move_left'],
    ['KeyA', 'move_left'],
    ['ArrowRight', 'move_right'],
    ['KeyD', 'move_right'],
    ['ArrowUp', 'jump'],
    ['KeyW', 'jump'],
    ['Space', 'jump'],
    ['Escape', 'pause'],
  ])('maps %s to %s', (code, expected) => {
    expect(inputForKeyCode(code)).toBe(expected)
  })

  it('claims no key it has no use for', () => {
    // `KeyE` left this list at M7, when SLAYYY gave it something to do. The
    // rest still have no meaning, and a key that silently does nothing is a
    // control that appears to exist.
    for (const code of ['ArrowDown', 'KeyS', 'Enter', 'Tab', 'KeyQ']) {
      expect(inputForKeyCode(code)).toBeNull()
      expect(isGameplayKey(code)).toBe(false)
    }
  })

  it('binds the approved SLAYYY key', () => {
    // `E` is APPROVED for desktop activation. Whether it *does* anything is the
    // domain's decision — the meter has to be armed — so this asserts only that
    // the intent reaches it.
    expect(inputForKeyCode('KeyE')).toBe('slayyy')
    expect(isGameplayKey('KeyE')).toBe(true)
  })

  const key = (over: Partial<Parameters<typeof shouldHandleKey>[0]> = {}) => ({
    code: 'Space',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    repeat: false,
    ...over,
  })

  it('handles a plain gameplay key with nothing focused', () => {
    expect(shouldHandleKey(key(), null)).toBe(true)
  })

  it('leaves modified keys to the browser', () => {
    // Ctrl+W closes the tab. A game that swallowed it is a game people cannot
    // leave.
    expect(shouldHandleKey(key({ ctrlKey: true }), null)).toBe(false)
    expect(shouldHandleKey(key({ altKey: true }), null)).toBe(false)
    expect(shouldHandleKey(key({ metaKey: true }), null)).toBe(false)
  })

  it('ignores auto-repeat', () => {
    // One press is one input. Holding left is not a request to cross three lanes.
    expect(shouldHandleKey(key({ repeat: true }), null)).toBe(false)
  })

  it.each(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'input', 'button'])(
    'leaves the key to a focused %s',
    (tag) => {
      // The approved rule is explicit: Space must not also activate a focused
      // button, and gameplay keys must never reach a form field.
      expect(shouldHandleKey(key(), tag)).toBe(false)
    },
  )

  it('still handles a key when focus is on something inert', () => {
    expect(shouldHandleKey(key(), 'DIV')).toBe(true)
  })
})

describe('swipe recognition', () => {
  const at = (x: number, y: number, timeMs: number) => ({ x, y, timeMs })
  const far = GESTURE.minDistancePx * 2

  it('reads a horizontal flick as a lane change', () => {
    expect(gestureToInput(at(200, 400, 0), at(200 - far, 400, 100))).toEqual({ type: 'move_left' })
    expect(gestureToInput(at(200, 400, 0), at(200 + far, 400, 100))).toEqual({ type: 'move_right' })
  })

  it('reads an upward flick as a jump', () => {
    expect(gestureToInput(at(200, 400, 0), at(200, 400 - far, 100))).toEqual({ type: 'jump' })
  })

  it('reads a downward flick as nothing — there is no slide in v1', () => {
    expect(gestureToInput(at(200, 400, 0), at(200, 400 + far, 100))).toBeNull()
  })

  it('treats a short movement as a tap', () => {
    const short = GESTURE.minDistancePx - 1

    expect(gestureToInput(at(200, 400, 0), at(200 + short, 400, 50))).toBeNull()
  })

  it('treats a slow drag as not a swipe', () => {
    const slow = GESTURE.maxDurationMs + 1

    expect(gestureToInput(at(200, 400, 0), at(200 + far, 400, slow))).toBeNull()
  })

  it('refuses an ambiguous diagonal rather than guessing', () => {
    // A wrong lane change costs a heart at M6. Doing nothing is the better
    // failure.
    expect(gestureToInput(at(200, 400, 0), at(200 + far, 400 - far, 100))).toBeNull()
  })

  it('resolves a dominant diagonal', () => {
    const minor = far / (GESTURE.axisDominanceRatio * 2)

    expect(gestureToInput(at(200, 400, 0), at(200 + far, 400 - minor, 100)))
      .toEqual({ type: 'move_right' })
  })

  it('ignores a gesture that travels backwards in time', () => {
    expect(gestureToInput(at(200, 400, 100), at(200 + far, 400, 0))).toBeNull()
  })
})

describe('the pointer tracker', () => {
  it('resolves a tracked gesture and resets itself', () => {
    const tracker = pointerDown({ x: 200, y: 400, timeMs: 0 })
    const result = pointerUp(tracker, { x: 260, y: 400, timeMs: 100 })

    expect(result.input).toEqual({ type: 'move_right' })
    expect(result.tracker).toBe(IDLE_POINTER)
  })

  it('produces nothing from a pointer-up with no matching down', () => {
    // A pointer that entered the canvas mid-gesture, or a scene torn down and
    // rebuilt between the two halves.
    expect(pointerUp(IDLE_POINTER, { x: 260, y: 400, timeMs: 100 }).input).toBeNull()
  })

  it('lets a second pointer-down replace the first', () => {
    pointerDown({ x: 0, y: 0, timeMs: 0 })

    const tracker = pointerDown({ x: 200, y: 400, timeMs: 50 })

    // Resolves against the second start, not the first — otherwise the next tap
    // becomes a swipe from wherever the last gesture began.
    expect(pointerUp(tracker, { x: 260, y: 400, timeMs: 100 }).input)
      .toEqual({ type: 'move_right' })
  })
})

describe('the promenade projection', () => {
  /*
   * The road is the milestone's central visual claim, so these pin the claim
   * rather than the numbers: it converges, it converges *projectively*, and the
   * lanes converge with it. A linear ramp passes the first of those and fails
   * the second, which is exactly what the previous "three vertical columns"
   * road was.
   */
  const layout = resolveLayout({ widthPx: 390, heightPx: 844 })

  it('puts the player\'s feet on the road and runs the promenade to the vanishing point', () => {
    const span = layout.groundYPx - layout.horizonYPx

    expect(distanceToY(layout, 0)).toBeCloseTo(layout.groundYPx, 6)

    // The scenery, not the gameplay range: the promenade is longer than the
    // game is, and it has to close on the horizon or there is a visible seam
    // where the road stops and the sea starts.
    expect(distanceToY(layout, SCENERY_UNITS) - layout.horizonYPx).toBeLessThan(span * 0.02)
    expect(distanceToY(layout, SCENERY_UNITS)).toBeGreaterThan(layout.horizonYPx)
  })

  it('keeps a gameplay obstacle large enough to react to at the far end', () => {
    // The clamp that separates the two ranges. An obstacle spawning at the edge
    // of the playable road is a third of its near size, not a sub-pixel speck.
    expect(distanceScale(PLAYFIELD.visibleUnits)).toBeCloseTo(FAR_SCALE, 9)
    expect(FAR_SCALE).toBeGreaterThan(0.3)
    expect(distanceScale(SCENERY_UNITS)).toBe(distanceScale(PLAYFIELD.visibleUnits))
  })

  it('moves an approaching obstacle towards the player without ever reversing', () => {
    let previous = distanceToY(layout, PLAYFIELD.visibleUnits)

    for (let units = PLAYFIELD.visibleUnits - 0.1; units >= 0; units -= 0.1) {
      const y = distanceToY(layout, units)

      expect(y).toBeGreaterThan(previous)
      previous = y
    }
  })

  it('compresses distance towards the horizon rather than spacing it evenly', () => {
    // The near half of the road takes up more screen than the far half. Under
    // the old linear mapping these two were equal, which is why evenly spaced
    // paving read as a flat texture instead of as ground going away.
    const near = distanceToY(layout, 0) - distanceToY(layout, PLAYFIELD.visibleUnits / 2)
    const far = distanceToY(layout, PLAYFIELD.visibleUnits / 2)
      - distanceToY(layout, PLAYFIELD.visibleUnits)

    expect(near).toBeGreaterThan(far * 1.5)
  })

  it('shrinks and narrows by the same factor, which is what makes it one projection', () => {
    for (const units of [0, 1, 3.5, 7, PLAYFIELD.visibleUnits, 40]) {
      const scale = projectionAt(units)
      const heightAbove = distanceToY(layout, units) - layout.horizonYPx

      expect(heightAbove / (layout.groundYPx - layout.horizonYPx)).toBeCloseTo(scale, 9)
      expect(roadHalfWidthAt(layout, units)).toBeCloseTo(layout.roadWidthPx / 2 * scale, 9)
    }
  })

  it('converges the lanes on the vanishing point', () => {
    const nearLeft = laneToXAtDistance(layout, 0, 0)
    const farLeft = laneToXAtDistance(layout, 0, PLAYFIELD.visibleUnits)

    expect(nearLeft).toBeCloseTo(laneToX(layout, 0), 9)
    expect(farLeft).toBeGreaterThan(nearLeft)
    expect(farLeft).toBeLessThan(layout.centreXPx)

    // The centre lane is the axis of the projection and does not move.
    expect(laneToXAtDistance(layout, PLAYFIELD.startLane, PLAYFIELD.visibleUnits))
      .toBeCloseTo(layout.centreXPx, 9)
  })

  it('inverts cleanly, so the road can be drawn in screen rows as well', () => {
    for (const units of [0, 0.75, 4, 9.5]) {
      expect(yToDistance(layout, distanceToY(layout, units))).toBeCloseTo(units, 6)
    }
  })

  it('leaves the player most of the screen to read ahead in', () => {
    // The failure the reconstruction was commissioned for: with the feet at
    // 0.78 and the vanishing point at 0.56, the entire playfield was 22% of a
    // phone screen.
    const roadband = (layout.groundYPx - layout.horizonYPx) / layout.viewportHeightPx

    expect(roadband).toBeGreaterThan(0.35)
  })
})
