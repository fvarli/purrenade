import { createRunLoop } from '../bridge'
import type { RunEvent, RunLoop, RunPhase } from '../bridge'
import { createRunScene } from './scene'

/**
 * `game/engine` — mounting Phaser, and taking it away again.
 *
 * **This is the only module that imports Phaser, and it imports it lazily.**
 * The bundle is large and belongs to one route; pulling it into the entry chunk
 * would cost every visitor who never plays, and would drag a `window`-dependent
 * library into an SSR path. A CI gate asserts both halves of that.
 *
 * The mount returns a handle rather than exposing the game object, so the Vue
 * layer can start, pause and destroy a run without being able to reach into
 * Phaser or into the rules.
 */

export interface MountRunOptions {
  /** The element the canvas goes into. Sized by CSS; Phaser follows it. */
  readonly container: HTMLElement
  readonly seed: number
  /** Coarse run events for the app layer. Never gameplay state. */
  readonly onEvent?: (event: RunEvent) => void
  /**
   * Which game to mount. `'run'` by default.
   *
   * The engine draws both the same way — the tutorial's props are ordinary
   * obstacles and Paw Tokens, in the lanes the script chose — so this travels
   * straight through to the loop and the scene never learns about it. That is
   * what "no new visual asset family" means in practice.
   */
  readonly mode?: 'run' | 'tutorial'
}

export interface MountedRun {
  pause(): void
  resume(): void
  phase(): RunPhase
  /**
   * Ask for SLAYYY.
   *
   * A named action rather than an exposed input queue: the app layer should be
   * able to wire a button without learning the domain's event vocabulary, and
   * the queue is the one place a caller could put something the rules never
   * expected. Whether anything happens is the domain's decision — a request
   * while the meter is charging is a deterministic no-op.
   */
  activateSlayyy(): void
  /** Leave the tutorial without finishing it. A no-op on a normal run. */
  skipTutorial(): void
  /** Tear down the canvas, the listeners and the WebGL context. */
  destroy(): void
}

/**
 * Start a run in the given element.
 *
 * Async because of the dynamic import. The caller is expected to have rendered
 * the container already, and to call `destroy()` on route leave — Phaser holds
 * a WebGL context and a requestAnimationFrame loop, and neither is collected by
 * navigating away.
 */
export async function mountRun({ container, seed, onEvent, mode }: MountRunOptions): Promise<MountedRun> {
  // The lazy boundary. Static-importing Phaser here would put it in every
  // bundle that transitively reaches this module, which is the whole app.
  const phaser = (await import('phaser')).default

  const loop: RunLoop = createRunLoop({ seed, onEvent, mode })

  let destroyed = false

  const scene = createRunScene(phaser, {
    loop,
    // Esc reaches the scene; the scene asks rather than decides, and the toggle
    // is taken here so the phase lives in exactly one place. The app layer
    // learns about it the same way it learns about any phase change — through
    // the loop's `phase_changed` event — rather than through a second path.
    onPauseRequested: () => {
      if (loop.phase() === 'paused') loop.resume()
      else loop.pause()
    },
  })

  /*
   * Phaser assigns `window.onblur` and `window.onfocus` outright when a game
   * starts (`core/VisibilityHandler.js`), destroying whatever the page had
   * there, and it never puts them back. Snapshot and restore.
   *
   * The `document` visibility listener it adds in the same function has no
   * removal path in Phaser at all — an upstream leak this module cannot reach.
   * It is harmless here only because the run's own pause handling lives in
   * `useRunSurface`, so Phaser's copy is redundant rather than load-bearing.
   */
  const priorOnBlur = globalThis.window?.onblur ?? null
  const priorOnFocus = globalThis.window?.onfocus ?? null

  const config: Phaser.Types.Core.GameConfig = {
    type: phaser.AUTO,
    parent: container,
    transparent: true,
    scale: {
      mode: phaser.Scale.RESIZE,
      autoCenter: phaser.Scale.NO_CENTER,
      /*
       * The DPR cap, for real this time.
       *
       * This was `resolution: Math.min(devicePixelRatio, 2)` at the top level —
       * a key Phaser 3 removed and Phaser 4 does not read, kept type-clean by
       * an `as` cast that suppressed the excess-property error which would have
       * caught it. The comment promised a third of the frame budget back on a
       * high-DPR phone and delivered nothing. `zoom` is the knob that exists:
       * the backing store is sized by the parent's CSS box, so rendering at one
       * device pixel per CSS pixel is what `1` already gives, and the cap is
       * expressed by never asking for more.
       */
      zoom: 1,
    },
    banner: false,
    // Nothing here should steal focus from the page: `autoFocus` calls
    // `window.focus()` and installs its own mousedown handler.
    autoFocus: false,
    audio: { noAudio: true },
    scene,
  }

  const game = new phaser.Game(config)

  return {
    pause(): void {
      if (!destroyed) loop.pause()
    },
    activateSlayyy(): void {
      if (!destroyed) loop.enqueue({ type: 'slayyy' })
    },

    skipTutorial(): void {
      if (!destroyed) loop.skipTutorial()
    },

    resume(): void {
      if (!destroyed) loop.resume()
    },

    phase(): RunPhase {
      return loop.phase()
    },

    destroy(): void {
      if (destroyed) return

      destroyed = true

      // `true` removes the canvas from the DOM as well. Leaving it would stack
      // a dead canvas per route visit, each holding a WebGL context — browsers
      // allow a small number of those and then start dropping the oldest.
      game.destroy(true)

      /*
       * Restore after Phaser has finished, not before it has started.
       *
       * `Game.destroy` only sets a flag; the real teardown runs on the next
       * loop step. And `VisibilityHandler` — which assigns these two handlers —
       * runs from `Game.start`, which is itself deferred behind the texture
       * manager being ready. So on the "leave the route while Phaser is still
       * booting" path the synchronous restore was a no-op that ran *before* the
       * assignment, and the page lost its handlers permanently.
       *
       * `queueMicrotask` is not enough — this has to outlive a frame.
       */
      const restore = (): void => {
        if (globalThis.window === undefined) return

        globalThis.window.onblur = priorOnBlur
        globalThis.window.onfocus = priorOnFocus
      }

      restore()
      game.events?.once('destroy', restore)
    },
  }
}
