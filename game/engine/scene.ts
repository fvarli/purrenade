import type Phaser from 'phaser'
import type { RunLoop } from '../bridge'
import { PLAYFIELD } from '../bridge'
import { GROUND_Y_RATIO, distanceScale, distanceToY, heightToY, laneToX, resolveLayout } from './layout'
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
  cone: 0xFF8C42,
  barrier: 0x6A8CAF,
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
/** Below the player, above the road. */
const OBSTACLE_DEPTH = 5

/**
 * How many obstacle shapes to keep around.
 *
 * Pooled rather than created per spawn: the world turns over continuously, and
 * building and destroying Phaser objects at that rate is how a run starts
 * stuttering after a minute. The pool is sized well above what the generator
 * can put on screen — a long-run test asserts the world stays under forty — and
 * unused slots are simply hidden.
 */
const OBSTACLE_POOL_SIZE = 48

/** A lane blocker is tall and narrow; a barrier is low and wide. */
const CONE_WIDTH_LANE_RATIO = 0.42
const CONE_HEIGHT_PX = 34
const BARRIER_WIDTH_LANE_RATIO = 0.86
const BARRIER_HEIGHT_PX = 14

/** How far the character fades on the dim half of the post-hit pulse. */
const INVULN_STEADY_ALPHA = 0.45

/*
 * Reduced motion asks for a *slower, lower-contrast pulse* — not a static dim.
 *
 * The first version froze the alpha, which is neither slower nor lower
 * contrast; it simply removed the cue's motion entirely and happened to use the
 * same value as the normal pulse's dim half. A 2.5 Hz pulse at a shallower
 * depth keeps the state legible while staying far below the flash thresholds
 * associated with photosensitive seizures.
 */
const REDUCED_MOTION_BLINK_DIVISOR = 4
const REDUCED_MOTION_ALPHA = 0.7
const MS_PER_SECOND = 1000

/**
 * The reduced-motion preference, read once per scene.
 *
 * Presentation only, and deliberately so. Slowing the world for a
 * reduced-motion player would change how hard the game is, which is not an
 * accessibility accommodation — it is a different game. What changes is the
 * blink: a steady dim instead of a pulse, so the state stays legible without
 * flickering. The road keeps scrolling, because motion that carries gameplay
 * information is preserved.
 */
function readsReducedMotion(): boolean {
  if (typeof globalThis.matchMedia !== 'function') return false

  return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
}

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
  let obstacleShapes: Phaser.GameObjects.Rectangle[] = []

  const prefersReducedMotion = readsReducedMotion()
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

      obstacleShapes = Array.from({ length: OBSTACLE_POOL_SIZE }, () => {
        const shape = this.add.rectangle(0, 0, 0, 0, PALETTE.cone)

        shape.setDepth(OBSTACLE_DEPTH)
        shape.setVisible(false)

        return shape
      })

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

      /*
       * The post-hit blink.
       *
       * A partial-alpha pulse on the character, never a full-screen flash: the
       * tuned rate sits inside the range associated with photosensitive
       * seizures, so the rule is that it stays on the sprite and stays partial.
       * Under a reduced-motion preference it becomes a steady dim instead of a
       * pulse — the state is still visible, it just stops flickering.
       */
      const blinkHz = prefersReducedMotion
        ? PLAYFIELD.blinkHz / REDUCED_MOTION_BLINK_DIVISOR
        : PLAYFIELD.blinkHz

      const dimAlpha = prefersReducedMotion ? REDUCED_MOTION_ALPHA : INVULN_STEADY_ALPHA

      const blink = snapshot.invulnerable
        ? (Math.floor(snapshot.elapsedMs / (MS_PER_SECOND / blinkHz)) % 2 === 0 ? dimAlpha : 1)
        : 1

      /*
       * The world.
       *
       * Read straight off the snapshot and drawn; nothing here decides whether
       * anything was hit. Slots beyond the current obstacle count are hidden
       * rather than destroyed, so the pool stays stable across the run.
       */
      snapshot.obstacles.forEach((obstacle, index) => {
        const shape = obstacleShapes[index]

        if (shape === undefined) return

        const depthScale = distanceScale(obstacle.distanceUnits)
        const isCone = obstacle.kind === 'lane_blocking'

        const widthPx = layout.lanePitchPx
          * (isCone ? CONE_WIDTH_LANE_RATIO : BARRIER_WIDTH_LANE_RATIO)
          * depthScale

        const heightPx = (isCone ? CONE_HEIGHT_PX : BARRIER_HEIGHT_PX) * layout.scale * depthScale
        const groundY = distanceToY(layout, obstacle.distanceUnits)

        /*
         * Visible only while it is on the road ahead.
         *
         * The far edge was checked and the near one was not, so a passed
         * obstacle kept full size, slid down past the player's feet and
         * vanished mid-frame instead of leaving at the bottom of the picture.
         */
        const onScreen = obstacle.distanceUnits <= PLAYFIELD.visibleUnits
          && obstacle.distanceUnits + obstacle.lengthUnits > 0

        shape.setVisible(onScreen)
        shape.setFillStyle(isCone ? PALETTE.cone : PALETTE.barrier)
        shape.setSize(widthPx, heightPx)
        // Standing on the road rather than centred on it.
        shape.setPosition(laneToX(layout, obstacle.lane), groundY - heightPx / 2)

        /*
         * Nearer obstacles draw on top.
         *
         * Every shape shared one depth, so Phaser fell back to display-list
         * order — which is pool index, which is snapshot order, which is
         * nearest *first*. The nearest obstacle was painted underneath the one
         * behind it, visible wherever a pattern puts two in the same lane.
         */
        shape.setDepth(OBSTACLE_DEPTH + (PLAYFIELD.visibleUnits - obstacle.distanceUnits))
      })

      for (let index = snapshot.obstacles.length; index < obstacleShapes.length; index++) {
        obstacleShapes[index]?.setVisible(false)
      }

      /*
       * An obstacle with no shape is an invisible hazard that still costs a
       * heart. The pool is sized well above anything the generator can produce,
       * so this is a developer error rather than a runtime condition — but it
       * must be loud rather than a silent `return`.
       */
      if (snapshot.obstacles.length > obstacleShapes.length) {
        throw new Error(
          `run scene: ${snapshot.obstacles.length} obstacles exceed the pool of ${obstacleShapes.length}`,
        )
      }

      // Dimmed while paused or waiting, so the surface reads as not-yet-live
      // without a HUD to say so. The HUD is M7.
      const live = snapshot.phase === 'running'

      road.setAlpha(live ? 1 : DIM_ROAD_ALPHA)
      player.setAlpha((live ? 1 : DIM_PLAYER_ALPHA) * blink)

      // The hazards dim with the road. They were left at full brightness, so a
      // paused world sat vividly on top of a greyed-out one.
      for (const shape of obstacleShapes) shape.setAlpha(live ? 1 : DIM_ROAD_ALPHA)
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
