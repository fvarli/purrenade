import type Phaser from 'phaser'
import type { RunLoop, RenderSnapshot } from '../bridge'
import { PLAYFIELD } from '../bridge'
import { RUN_ASSETS, textureKey } from './assets'
import type { RunAssetKey } from './assets'
import { createCast } from './actors'
import type { Cast } from './actors'
import { createPromenade, texturesReady } from './promenade'
import type { Promenade } from './promenade'
import { resolveLayout } from './layout'
import type { PlayfieldLayout } from './layout'
import { inputForKeyCode, shouldHandleKey } from './input/keyboard'
import { IDLE_POINTER, pointerCancel, pointerDown, pointerUp } from './input/pointer'
import type { PointerTracker } from './input/pointer'

/**
 * The Phaser scene: loads the art, owns the lifetime, captures input, decides
 * nothing.
 *
 * Every gameplay question — did that input move the player, is the jump over,
 * which lane are they in — is answered by the domain through the loop. If this
 * file ever decided one, the domain would stop being authoritative and
 * determinism would go with it.
 *
 * What it draws lives next door: `promenade.ts` is the place, `actors.ts` is
 * everything standing on it. What is left here is the part that has to be
 * exactly right rather than merely good-looking — texture loading, teardown,
 * and the keyboard and pointer handling that three milestones of defects have
 * been fixed in.
 */

/*
 * Re-exported, so the rest of the codebase has one door into the engine's
 * presentation layer. `scene.spec.ts`'s palette gate and asset gate both read
 * them from here.
 */
export { PALETTE } from './palette'
export { RUN_ASSETS } from './assets'

/**
 * How far the world has travelled, measured rather than assumed.
 *
 * The promenade's paving, its lane dashes, its balusters and its palms are laid
 * out in world units and projected, so they need to know how far the world has
 * moved — and the snapshot does not carry a speed. It does not need to: an
 * obstacle that is in two consecutive frames reports its own distance in both,
 * and the difference *is* the distance travelled. Watching the data the
 * renderer already receives keeps the bridge exactly as narrow as it was; the
 * alternative was a new field on a frozen contract, for scenery.
 *
 * The last known rate carries the gaps between obstacles, which are short and
 * rare. It is deliberately never zero after the first measurement, because a
 * road that stops scrolling for half a second reads as a stutter.
 */
function createOdometer() {
  const seen = new Map<number, number>()
  let unitsPerMs = 0
  let travelled = 0

  return {
    /** Advance by whatever the world moved since the previous frame. */
    advance(snapshot: RenderSnapshot, deltaMs: number): number {
      if (deltaMs > 0) {
        for (const obstacle of snapshot.obstacles) {
          const previous = seen.get(obstacle.id)

          if (previous !== undefined && previous > obstacle.distanceUnits) {
            unitsPerMs = (previous - obstacle.distanceUnits) / deltaMs
            break
          }
        }
      }

      seen.clear()
      for (const obstacle of snapshot.obstacles) seen.set(obstacle.id, obstacle.distanceUnits)

      // Paused and ended runs freeze the world; the scenery freezes with it.
      if (snapshot.phase === 'running') travelled += unitsPerMs * deltaMs

      return travelled
    },
  }
}

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

/** How quickly the SLAYYY world fades in and out, in milliseconds. */
const BLOOM_FADE_MS = 420

/**
 * The reduced-motion preference, watched for the life of the scene.
 *
 * Presentation only, and deliberately so. Slowing the world for a
 * reduced-motion player would change how hard the game is, which is not an
 * accessibility accommodation — it is a different game. What changes is the
 * decoration: the blink becomes slower and shallower, the run bob and the
 * SLAYYY petals hold still, the far coast stops drifting. The road keeps
 * scrolling, because motion that carries gameplay information is preserved.
 *
 * Returns the query rather than a boolean, because the preference is not a
 * constant: a player can turn it on from the system settings with a run already
 * on screen, and until M-C that change was invisible until the scene was
 * destroyed and built again — in practice, until they left the route and came
 * back. Every consumer reads `reducedMotion` off the view object once per
 * frame, so flipping one variable is enough to make the change land on the next
 * frame with no reload and no rebuild.
 */
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function reducedMotionQuery(): MediaQueryList | null {
  if (typeof globalThis.matchMedia !== 'function') return null

  const query = globalThis.matchMedia(REDUCED_MOTION_QUERY)

  // `matchMedia` is stubbed in more than one test environment, and a stub that
  // returns only `matches` is a reasonable stub. Treat the listener as the
  // optional part rather than requiring the whole interface.
  return typeof query?.addEventListener === 'function' ? query : null
}

function readsReducedMotion(): boolean {
  if (typeof globalThis.matchMedia !== 'function') return false

  return globalThis.matchMedia(REDUCED_MOTION_QUERY).matches === true
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
  let promenade: Promenade
  let cast: Cast

  const odometer = createOdometer()
  let prefersReducedMotion = readsReducedMotion()

  /** The SLAYYY wash, eased rather than switched. `0`–`1`. */
  let bloom = 0

  /** Every listener this scene attached, so shutdown can remove all of them. */
  const teardown: Array<() => void> = []

  class RunScene extends phaser.Scene {
    constructor() {
      super({ key: 'run' })
    }

    preload(): void {
      for (const [key, path] of Object.entries(RUN_ASSETS)) {
        this.load.image(textureKey(key as RunAssetKey), path)
      }
    }

    create(): void {
      layout = resolveLayout({ widthPx: this.scale.width, heightPx: this.scale.height })

      /*
       * One decision, taken here, for the whole run.
       *
       * Phaser has finished loading by the time `create` runs, so whether the
       * prepared art is usable is a fact rather than a per-frame question. The
       * world and the cast each build only the objects their chosen
       * presentation needs.
       */
      const artReady = texturesReady(this)

      promenade = createPromenade(this, { artReady })
      cast = createCast(this, { artReady })

      promenade.resize(layout)
      cast.resize(layout)

      this.bindInput()

      this.scale.on('resize', this.handleResize, this)
      teardown.push(() => this.scale.off('resize', this.handleResize, this))

      /*
       * One listener for the whole scene, removed with everything else.
       *
       * It goes into the same `teardown` list as the resize and input handlers,
       * so it is removed on `shutdown` and on `destroy` alike. That is what
       * keeps replay honest: replaying destroys the scene and builds a new one,
       * so a listener that outlived its scene would be added again on every
       * play-again and the preference would be applied N times per change.
       *
       * The preference is re-read here as well as at construction, because
       * `create` runs after the asset load and the setting can have changed in
       * between.
       */
      const motionQuery = reducedMotionQuery()

      if (motionQuery !== null) {
        prefersReducedMotion = motionQuery.matches === true

        const onMotionPreferenceChange = (event: MediaQueryListEvent): void => {
          prefersReducedMotion = event.matches
        }

        motionQuery.addEventListener('change', onMotionPreferenceChange)
        teardown.push(() => motionQuery.removeEventListener('change', onMotionPreferenceChange))
      }

      /*
       * One place that undoes everything, called however the scene ends.
       *
       * Both events, and neither is optional. `game.destroy(true)` reaches
       * `Systems.destroy`, which emits `destroy` and then
       * `removeAllListeners()`. It never emits `shutdown` — that comes only
       * from `SceneManager.stop`/`sleep`. Registering on `shutdown` alone, as
       * this did, meant the teardown never ran on the one path the run route
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
      this.render(deltaMs)
    }

    /**
     * Draw the current snapshot.
     *
     * Reads only what the bridge exposes. It has no access to `RunState` and
     * could not consult the rules even if a future edit wanted it to.
     */
    private render(deltaMs: number): void {
      const snapshot = loop.snapshot()
      const live = snapshot.phase === 'running'
      const scrollUnits = odometer.advance(snapshot, deltaMs)

      /*
       * The SLAYYY world arrives and leaves, it does not switch.
       *
       * A hard cut between two palettes on a surface the player is reading at
       * speed is a flash, and the reduced-motion preference does not help with
       * it — the fade is what keeps it out of flash territory in the first
       * place, so it stays on for everyone.
       */
      const wanted = snapshot.slayyy.phase === 'active' ? 1 : 0
      const step = deltaMs / BLOOM_FADE_MS

      bloom = wanted > bloom
        ? Math.min(wanted, bloom + step)
        : Math.max(wanted, bloom - step)

      /*
       * The post-hit blink.
       *
       * A partial-alpha pulse on the character, never a full-screen flash: the
       * tuned rate sits inside the range associated with photosensitive
       * seizures, so the rule is that it stays on the sprite and stays partial.
       * Under a reduced-motion preference it becomes slower and shallower
       * rather than a steady dim — the state is still visible, and it is still
       * a pulse.
       */
      const blinkHz = prefersReducedMotion
        ? PLAYFIELD.blinkHz / REDUCED_MOTION_BLINK_DIVISOR
        : PLAYFIELD.blinkHz

      const dimAlpha = prefersReducedMotion ? REDUCED_MOTION_ALPHA : INVULN_STEADY_ALPHA

      const blink = snapshot.invulnerable
        ? (Math.floor(snapshot.elapsedMs / (MS_PER_SECOND / blinkHz)) % 2 === 0 ? dimAlpha : 1)
        : 1

      promenade.render({
        layout,
        scrollUnits,
        bloom,
        live,
        reducedMotion: prefersReducedMotion,
      })

      cast.render({
        layout,
        snapshot,
        live,
        reducedMotion: prefersReducedMotion,
        blink,
        bloom,
      })
    }

    private handleResize(): void {
      layout = resolveLayout({ widthPx: this.scale.width, heightPx: this.scale.height })

      promenade.resize(layout)
      cast.resize(layout)
      this.render(0)
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
