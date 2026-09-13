import type Phaser from 'phaser'
import type { RunLoop } from '../bridge'
import { GROUND_Y_RATIO, heightToY, laneToX, resolveLayout } from './layout'
import type { PlayfieldLayout } from './layout'
import { inputForKeyCode, shouldHandleKey } from './input/keyboard'
import { IDLE_POINTER, pointerCancel, pointerDown, pointerUp } from './input/pointer'
import type { PointerTracker } from './input/pointer'

/**
 * The Phaser scene: draws the playfield, captures input, decides nothing.
 *
 * Every gameplay question — did that input move the player, is the jump over,
 * which lane are they in — is answered by the domain through the loop. If this
 * file ever decided one, the domain would stop being authoritative and
 * determinism would go with it.
 *
 * The art here is deliberately primitive: coloured rectangles for the sea, the
 * promenade, the lanes and the player. Production sprites are an asset-pipeline
 * concern and no approved artwork exists yet; drawing shapes keeps the boundary
 * honest and testable rather than blocking it on a texture atlas.
 */

/**
 * Colours, from the approved token palette. Presentation only.
 *
 * A copy of the tokens rather than a read of them: a canvas cannot resolve a CSS
 * custom property per frame. `scene.spec.ts` asserts every value here still
 * exists in `tokens.css`, so the copy cannot drift silently.
 */
export const PALETTE = {
  sky: 0xC9ECF2,
  sea: 0x2EC4B6,
  sand: 0xF0E3D2,
  road: 0xE8D9C5,
  laneLine: 0xB9AFA6,
  player: 0xFF6B4A,
  playerAirborne: 0xFF8FAB,
} as const

/**
 * The composition, derived from one number.
 *
 * The player stands at `GROUND_Y_RATIO`, and every band is placed around that so
 * the promenade cannot drift away from the feet standing on it. These ratios were
 * written out five times as literals first, in two functions, which is precisely
 * how the ground and the character end up in different places after someone
 * adjusts one of them.
 *
 * Presentation, not gameplay — the domain has no opinion about where the horizon
 * is — so these live here rather than in the tuning registry, matching the rule
 * already stated in `layout.ts`.
 */
const SAND_HEIGHT_RATIO = 2 * (1 - GROUND_Y_RATIO)
/** Where the sea meets the sand: the top edge of the promenade band. */
const HORIZON_Y_RATIO = GROUND_Y_RATIO - (1 - GROUND_Y_RATIO)

/** Lane boundaries, in lane units: two interior lines for three lanes. */
const LANE_BOUNDARIES = [0.5, 1.5] as const
const LANE_LINE_WIDTH_PX = 2

/** The player's radius as a fraction of the lane pitch. */
const PLAYER_RADIUS_LANE_RATIO = 0.3
/** Above every band, so the player is never occluded by the scenery. */
const PLAYER_DEPTH = 10

/** Dimming while the run is not live. Enough to read as inactive, not a curtain. */
const DIM_ROAD_ALPHA = 0.75
const DIM_PLAYER_ALPHA = 0.6

/** The vertical bands, for a given viewport height. Exported to be tested. */
export function bands(height: number): {
  seaCentreY: number
  seaHeight: number
  groundCentreY: number
  sandHeight: number
} {
  return {
    seaCentreY: (height * HORIZON_Y_RATIO) / 2,
    seaHeight: height * HORIZON_Y_RATIO,
    groundCentreY: height * GROUND_Y_RATIO,
    sandHeight: height * SAND_HEIGHT_RATIO,
  }
}

export interface RunSceneOptions {
  readonly loop: RunLoop
  /** Called when the scene wants the app layer to know a pause happened. */
  readonly onPauseRequested: () => void
}

/**
 * Build the scene class.
 *
 * A factory rather than a top-level class because `Phaser` is imported lazily —
 * the constructor has to exist before `Phaser.Scene` can be extended, and that
 * is only true after the dynamic import resolves.
 */
export function createRunScene(
  phaser: typeof Phaser,
  { loop, onPauseRequested }: RunSceneOptions,
): Phaser.Scene {
  let layout: PlayfieldLayout
  let pointer: PointerTracker = IDLE_POINTER

  let sky: Phaser.GameObjects.Rectangle
  let sea: Phaser.GameObjects.Rectangle
  let sand: Phaser.GameObjects.Rectangle
  let road: Phaser.GameObjects.Rectangle
  let laneLines: Phaser.GameObjects.Rectangle[] = []
  let player: Phaser.GameObjects.Arc

  /** Every listener this scene attached, so shutdown can remove all of them. */
  const teardown: Array<() => void> = []

  class RunScene extends phaser.Scene {
    constructor() {
      super({ key: 'run' })
    }

    create(): void {
      layout = resolveLayout({
        widthPx: this.scale.width,
        heightPx: this.scale.height,
      })

      this.buildPlayfield()
      this.bindInput()

      this.scale.on('resize', this.handleResize, this)
      teardown.push(() => this.scale.off('resize', this.handleResize, this))

      // One place that undoes everything, called however the scene ends. A
      // listener that outlives its scene is a listener that fires into a
      // destroyed renderer on the next route visit.
      /*
       * Both events, and neither is optional.
       *
       * `game.destroy(true)` reaches `Systems.destroy`, which emits `destroy`
       * and then `removeAllListeners()`. It never emits `shutdown` — that comes
       * only from `SceneManager.stop`/`sleep`. Registering on `shutdown` alone,
       * as this did, meant the teardown never ran on the one path the run route
       * actually takes, and every visit left its `document` keydown listener
       * attached: swallowing Space and the arrows on every later page and
       * enqueueing into a loop that would never run another frame.
       *
       * `splice(0)` makes the drain single-shot, so both handlers firing is safe.
       */
      const drain = (): void => {
        for (const undo of teardown.splice(0)) undo()
      }

      this.events.once('shutdown', drain)
      this.events.once('destroy', drain)
    }

    override update(_time: number, deltaMs: number): void {
      loop.frame(deltaMs)
      this.render()
    }

    /**
     * Create the playfield objects, then position them.
     *
     * Creation and resizing share `positionPlayfield` deliberately: they used to
     * carry the same geometry twice, and two copies of a layout is one copy that
     * gets updated.
     */
    private buildPlayfield(): void {
      sky = this.add.rectangle(0, 0, 0, 0, PALETTE.sky)
      sea = this.add.rectangle(0, 0, 0, 0, PALETTE.sea)
      sand = this.add.rectangle(0, 0, 0, 0, PALETTE.sand)
      road = this.add.rectangle(0, 0, 0, 0, PALETTE.road)

      laneLines = LANE_BOUNDARIES.map(() => this.add.rectangle(0, 0, 0, 0, PALETTE.laneLine))

      player = this.add.circle(0, 0, 1, PALETTE.player)
      player.setDepth(PLAYER_DEPTH)

      this.positionPlayfield()
    }

    /** Place every object for the current viewport. */
    private positionPlayfield(): void {
      const { width, height } = this.scale
      const { seaCentreY, seaHeight, groundCentreY, sandHeight } = bands(height)

      sky.setPosition(width / 2, height / 2).setSize(width, height)
      sea.setPosition(width / 2, seaCentreY).setSize(width, seaHeight)
      sand.setPosition(width / 2, groundCentreY).setSize(width, sandHeight)
      road.setPosition(layout.centreXPx, groundCentreY).setSize(layout.roadWidthPx, sandHeight)

      // Lines between lanes, not on them.
      laneLines.forEach((line, index) => {
        line
          .setPosition(laneToX(layout, LANE_BOUNDARIES[index]!), groundCentreY)
          .setSize(LANE_LINE_WIDTH_PX, sandHeight)
      })

      player.setRadius(layout.lanePitchPx * PLAYER_RADIUS_LANE_RATIO)
      player.setPosition(layout.centreXPx, layout.groundYPx)
    }

    /**
     * Draw the current snapshot.
     *
     * Reads only what the bridge exposes. It has no access to `RunState` and
     * could not consult the rules even if a future edit wanted it to.
     */
    private render(): void {
      const snapshot = loop.snapshot()

      player.setPosition(
        laneToX(layout, snapshot.lanePosition),
        heightToY(layout, snapshot.heightPx),
      )

      // A colour change rather than a sprite swap: enough to make the airborne
      // state legible while the character art does not exist.
      player.setFillStyle(snapshot.heightPx > 0 ? PALETTE.playerAirborne : PALETTE.player)

      // Dimmed while paused or waiting, so the surface reads as not-yet-live
      // without a HUD to say so. The HUD is M7.
      const live = snapshot.phase === 'running'

      road.setAlpha(live ? 1 : DIM_ROAD_ALPHA)
      player.setAlpha(live ? 1 : DIM_PLAYER_ALPHA)
    }

    private handleResize(): void {
      layout = resolveLayout({ widthPx: this.scale.width, heightPx: this.scale.height })

      this.positionPlayfield()
      this.render()
    }

    /**
     * Attach input, and record how to detach it.
     *
     * Keyboard listens on the document rather than the canvas, because a canvas
     * only receives keys while focused and a player who has tapped the page
     * should still be able to steer. The focus check in `shouldHandleKey` is
     * what keeps that from stealing keys from form controls.
     */
    private bindInput(): void {
      const onKeyDown = (event: KeyboardEvent): void => {
        const active = document.activeElement

        // A tag name alone missed `contenteditable` (reports `DIV`) and any
        // control with an ARIA role rather than a native one.
        const focused = active === null
          ? null
          : {
              tagName: active.tagName,
              isContentEditable: (active as HTMLElement).isContentEditable === true,
              role: active.getAttribute('role'),
            }

        if (!shouldHandleKey(event, focused)) return

        const intent = inputForKeyCode(event.code)

        if (intent === null) return

        // Only now: the page must keep Space and the arrows for scrolling
        // whenever gameplay is not claiming them.
        event.preventDefault()

        if (intent === 'pause') {
          onPauseRequested()
          return
        }

        loop.enqueue({ type: intent })
      }

      document.addEventListener('keydown', onKeyDown)
      teardown.push(() => document.removeEventListener('keydown', onKeyDown))

      /*
       * One gesture at a time, and it belongs to the finger that started it.
       *
       * A single tracker shared by every pointer let a second finger overwrite
       * the first one's start point, so lifting the *first* finger resolved its
       * release against the *second* finger's origin — a swipe the player never
       * made, in whichever direction the two happened to be apart.
       */
      let gestureId: number | null = null

      const onPointerDown = (p: Phaser.Input.Pointer): void => {
        if (gestureId !== null) return

        gestureId = p.id
        pointer = pointerDown({ x: p.x, y: p.y, timeMs: p.downTime })
      }

      const onPointerUp = (p: Phaser.Input.Pointer): void => {
        /*
         * A cancelled touch is not a gesture.
         *
         * Phaser routes `touchcancel` through the same `pointerup` path and sets
         * `wasCanceled` to say so. The system takes the touch away for its own
         * reasons — a notification shade, an edge swipe, an incoming call — and
         * committing the movement the player was part-way through is a lane
         * change they did not ask for.
         */
        if (p.id !== gestureId) return

        gestureId = null

        if (p.wasCanceled) {
          pointer = pointerCancel()
          return
        }

        const { tracker, input } = pointerUp(pointer, { x: p.x, y: p.y, timeMs: p.upTime })

        pointer = tracker

        if (input !== null) loop.enqueue(input)
      }

      this.input.on('pointerdown', onPointerDown)
      this.input.on('pointerup', onPointerUp)
      this.input.on('pointerupoutside', onPointerUp)

      teardown.push(() => {
        this.input.off('pointerdown', onPointerDown)
        this.input.off('pointerup', onPointerUp)
        this.input.off('pointerupoutside', onPointerUp)
        pointer = IDLE_POINTER
        gestureId = null
      })
    }
  }

  return new RunScene()
}
