import type { MountedRun } from '~~/game/engine'
import type { RunEvent, RunPhase } from '~~/game/bridge'

/**
 * Owning a run's lifetime from the Vue side.
 *
 * Mounting a canvas game is not like rendering a component. Phaser holds a
 * WebGL context, a `requestAnimationFrame` loop and its own listeners, and none
 * of that is collected by navigating away — a route left and re-entered five
 * times leaves five live contexts, and browsers allow only a handful before
 * they start dropping the oldest.
 *
 * So the teardown is the point of this composable, and it is why the logic
 * lives here rather than inline in the page: a fake engine can be driven
 * through mount, pause and unmount in Node, and the listener bookkeeping can be
 * asserted rather than eyeballed.
 *
 * The Vue layer learns the phase from events. It never reads the simulation.
 */

/** Injected so tests can drive a fake engine without loading Phaser. */
export interface RunSurfaceOptions {
  readonly mount?: (options: {
    container: HTMLElement
    seed: number
    onEvent: (event: RunEvent) => void
  }) => Promise<MountedRun>
  /** Injected so a test does not depend on a real random seed. */
  readonly makeSeed?: () => number
}

export interface RunSurface {
  readonly phase: Readonly<Ref<RunPhase>>
  readonly loading: Readonly<Ref<boolean>>
  readonly failed: Readonly<Ref<boolean>>
  readonly isPaused: ComputedRef<boolean>
  start: (container: HTMLElement) => Promise<void>
  stop: () => void
  togglePause: () => void
}

export function useRunSurface(options: RunSurfaceOptions = {}): RunSurface {
  const phase = ref<RunPhase>('ready')
  const loading = ref(true)
  const failed = ref(false)

  let run: MountedRun | null = null

  /**
   * Which mount is current, and whether one is in flight.
   *
   * `run` alone was not enough to answer either question, because it is
   * assigned only *after* the engine's dynamic import resolves. Leaving the
   * route during that window — one impatient tap while 1.3 MB of Phaser is
   * still downloading — ran `stop()` against `run === null` and an empty
   * teardown list, and then the import completed and attached a live game, its
   * WebGL context, its animation loop and three global listeners to a component
   * Vue had already unmounted, with nothing left holding a reference that could
   * ever destroy it. A second `start()` inside the same window passed the guard
   * too and mounted a second engine, after which one key press became two
   * inputs.
   *
   * A generation counter answers both: `stop()` and every new `start()` bump
   * it, and a mount that resolves against a stale generation destroys itself
   * instead of taking hold.
   */
  let generation = 0
  let mounting = false

  /** Every listener attached, undone together. One list, one place. */
  const teardown: Array<() => void> = []

  const isPaused = computed(() => phase.value === 'paused')

  /**
   * Pause when the run stops being watched.
   *
   * Deliberately one-way. Coming back does **not** resume: a tab returning to
   * the foreground while the player is looking elsewhere would otherwise
   * restart a live run nobody is watching. Resuming is always an explicit act.
   */
  const pauseIfUnwatched = (): void => {
    if (run === null || run.phase() === 'paused') return

    run.pause()
    phase.value = 'paused'
  }

  const start = async (container: HTMLElement): Promise<void> => {
    // Guard re-entry, including re-entry *during* a mount.
    if (run !== null || mounting) return

    mounting = true

    const mountGeneration = ++generation

    loading.value = true
    failed.value = false

    try {
      const mount = options.mount ?? (async (args) => {
        // The lazy boundary. Static-importing here would put Phaser in every
        // bundle that reaches this composable — which is the app's entry.
        const { mountRun } = await import('~~/game/engine')

        return mountRun(args)
      })

      // The seed is generated in the app layer: the domain may not read a
      // platform RNG, and whether it becomes server-issued is RNG-1, still
      // OPEN pending ADR-0006. When that settles, it changes here and nowhere
      // else.
      const seed = (options.makeSeed ?? defaultSeed)()

      const mounted = await mount({
        container,
        seed,
        onEvent: (event: RunEvent) => {
          // A late event from an abandoned mount must not drive the UI.
          if (mountGeneration !== generation) return

          if (event.type === 'phase_changed') phase.value = event.phase
        },
      })

      if (mountGeneration !== generation) {
        // The route was left, or another run started, while this one was
        // loading. Destroy it here: nothing else holds a reference to it.
        mounted.destroy()

        return
      }

      run = mounted

      const onVisibility = (): void => {
        if (document.visibilityState === 'hidden') pauseIfUnwatched()
      }

      document.addEventListener('visibilitychange', onVisibility)
      window.addEventListener('blur', pauseIfUnwatched)
      window.addEventListener('pagehide', pauseIfUnwatched)

      teardown.push(
        () => document.removeEventListener('visibilitychange', onVisibility),
        () => window.removeEventListener('blur', pauseIfUnwatched),
        () => window.removeEventListener('pagehide', pauseIfUnwatched),
      )
    }
    catch {
      // A failed engine load must not leave a blank screen with no way out.
      // Only the current attempt may report it.
      if (mountGeneration === generation) failed.value = true
    }
    finally {
      if (mountGeneration === generation) {
        mounting = false
        loading.value = false
      }
    }
  }

  const stop = (): void => {
    // Bumping the generation is what makes an in-flight mount abandon itself
    // when it resolves. It must happen even when there is nothing to tear down.
    generation++
    mounting = false

    // `splice(0)` empties the list as it reads it, so a second `stop()` — from
    // an unmount racing a navigation — undoes nothing twice.
    for (const undo of teardown.splice(0)) undo()

    run?.destroy()
    run = null
  }

  const togglePause = (): void => {
    if (run === null) return

    if (run.phase() === 'paused') run.resume()
    else run.pause()

    phase.value = run.phase()
  }

  return { phase, loading, failed, isPaused, start, stop, togglePause }
}

function defaultSeed(): number {
  // Not `Math.random()` for its distribution — for its availability. This is
  // the app layer, where a platform RNG is allowed; the domain's ban applies to
  // the rules, which receive this value rather than producing one.
  return Math.floor(Math.random() * 0xFFFFFFFF)
}
