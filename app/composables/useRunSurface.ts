import type { MountedRun } from '~~/game/engine'
import { HEARTS } from '~~/game/bridge'
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
  /**
   * Play again, in the same container, as a genuinely new run.
   *
   * A full `stop()` then `start()` rather than a reset applied to the living
   * simulation. The domain seals `ended` and nothing leads out of it, so there
   * is no state to rewind — and going back through the existing teardown is
   * what makes replay free of the leak class this composable exists to prevent:
   * the generation counter, the listener list and `destroy()` are the same ones
   * a route leave uses, already hardened.
   *
   * A no-op before the first `start()`, because there is no container to
   * mount into yet.
   */
  restart: () => Promise<void>
  togglePause: () => void
  readonly hasEnded: ComputedRef<boolean>
  readonly hearts: Readonly<Ref<number>>

  // --- M7 -------------------------------------------------------------------

  /** The displayed score. Arrives only when the whole number changes. */
  readonly score: Readonly<Ref<number>>
  /** Paw Tokens collected in this run. */
  readonly runPaws: Readonly<Ref<number>>
  /** Progress toward the next Loli Bonus, `0..199`. */
  readonly cyclePaws: Readonly<Ref<number>>
  /** Whether a Loli Bonus is running right now. */
  readonly loliActive: Readonly<Ref<boolean>>
  /** The SLAYYY meter's state, for the control's label and appearance. */
  readonly slayyy: Readonly<Ref<'charging' | 'ready' | 'active'>>
  /**
   * How full the meter is, `0..100`.
   *
   * `accessibility.md` §3.1 requires the control to communicate charge progress
   * while charging, and §4.1 requires that progress to be legible without
   * relying on hue — so this is a number the HUD prints, not only a width.
   */
  readonly slayyyPercent: Readonly<Ref<number>>
  /** Fire SLAYYY. A no-op unless the meter is armed — the domain decides. */
  activateSlayyy: () => void
}

/** The approved starting value, projected through the boundary. */
const STARTING_HEARTS = HEARTS.start

export function useRunSurface(options: RunSurfaceOptions = {}): RunSurface {
  const phase = ref<RunPhase>('ready')

  /*
   * Hearts, from coarse events rather than from the simulation.
   *
   * The app never reads `RunState`, and it must not start now: a reactive
   * mirror of gameplay state would re-render Vue at the simulation rate and
   * would let UI code write to something the rules own. `heart_lost` carries
   * the new count, which is all a heart row needs.
   *
   * Seeded from the projected starting value, so the row is correct before the
   * first event arrives.
   */
  const hearts = ref<number>(STARTING_HEARTS)
  const loading = ref(true)
  const failed = ref(false)

  /*
   * M7's HUD state, from coarse events for exactly the same reason.
   *
   * Score moves on almost every simulation step, so the loop only emits it when
   * the *displayed integer* changes — a few times a second rather than 120.
   * Nothing here polls a snapshot, and nothing here can write to the run.
   */
  const score = ref(0)
  const runPaws = ref(0)
  const cyclePaws = ref(0)
  const loliActive = ref(false)
  const slayyy = ref<'charging' | 'ready' | 'active'>('charging')
  const slayyyPercent = ref(0)

  let run: MountedRun | null = null

  /**
   * The element the current run was mounted into, for `restart()`.
   *
   * Held rather than asked for again, so replaying does not require the page to
   * hand back a template ref it has already given once. Cleared by `stop()`:
   * keeping it would pin a detached element after the route is left.
   */
  let mountedContainer: HTMLElement | null = null

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
  const hasEnded = computed(() => phase.value === 'ended')

  /**
   * Pause when the run stops being watched.
   *
   * Deliberately one-way. Coming back does **not** resume: a tab returning to
   * the foreground while the player is looking elsewhere would otherwise
   * restart a live run nobody is watching. Resuming is always an explicit act.
   */
  const pauseIfUnwatched = (): void => {
    /*
     * An ended run is not paused when the player looks away — it is over.
     *
     * The domain refuses the transition now, but this guard matters too: without
     * it every tab switch on the game-over screen fired a `pause()` the rules
     * correctly ignored, and the phase ref would have been written to `'paused'`
     * from here regardless, replacing the run-over message with a pause overlay.
     */
    if (run === null || run.phase() === 'paused' || run.phase() === 'ended') return

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
          if (event.type === 'heart_lost') hearts.value = event.hearts

          if (event.type === 'score_changed') score.value = event.total

          if (event.type === 'paws_changed') {
            runPaws.value = event.runPaws
            cyclePaws.value = event.cyclePaws
          }

          if (event.type === 'loli_started') loliActive.value = true
          if (event.type === 'loli_ended') loliActive.value = false

          if (event.type === 'slayyy_charge') slayyyPercent.value = event.percent
          if (event.type === 'slayyy_ready') slayyy.value = 'ready'
          if (event.type === 'slayyy_activated') slayyy.value = 'active'
          if (event.type === 'slayyy_ended') slayyy.value = 'charging'

          /*
           * A run that ends leaves nothing armed.
           *
           * The domain already stops both systems at the terminal state; this
           * keeps the *presentation* honest, so a game-over screen never shows
           * a live companion or an activation control that would do nothing.
           */
          if (event.type === 'run_ended') {
            loliActive.value = false
            if (slayyy.value === 'active') slayyy.value = 'charging'
          }
        },
      })

      if (mountGeneration !== generation) {
        // The route was left, or another run started, while this one was
        // loading. Destroy it here: nothing else holds a reference to it.
        mounted.destroy()

        return
      }

      run = mounted
      mountedContainer = container

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
    mountedContainer = null
    hearts.value = STARTING_HEARTS

    /*
     * The phase resets with everything else, and it has to.
     *
     * `createRunLoop` emits `run_started` but **no** opening `phase_changed`:
     * `lastPhase` is seeded from the fresh state, so the first phase event a new
     * run produces is the `ready -> running` transition at the end of the
     * readiness beat. Leaving `phase` at `'ended'` here therefore left the
     * run-complete overlay covering a live new run for that whole beat — the
     * one bug replay could not have without this line, and the reason it sits
     * with the other resets rather than inside `restart()`.
     */
    phase.value = 'ready'

    // Every M7 counter resets with the surface. A stale score surviving a
    // teardown would reappear on the next run before its first event arrives.
    score.value = 0
    runPaws.value = 0
    cyclePaws.value = 0
    loliActive.value = false
    slayyy.value = 'charging'
    slayyyPercent.value = 0

    // `splice(0)` empties the list as it reads it, so a second `stop()` — from
    // an unmount racing a navigation — undoes nothing twice.
    for (const undo of teardown.splice(0)) undo()

    run?.destroy()
    run = null
  }

  const restart = async (): Promise<void> => {
    const container = mountedContainer

    // Nothing has been mounted yet, so there is nothing to replay.
    if (container === null) return

    stop()

    await start(container)
  }

  const togglePause = (): void => {
    if (run === null) return

    if (run.phase() === 'paused') run.resume()
    else run.pause()

    phase.value = run.phase()
  }

  /**
   * Fire SLAYYY from a DOM control.
   *
   * Enqueued as an ordinary gameplay intent rather than applied synchronously
   * the way pause is: the domain decides whether the meter is armed, so a tap
   * while charging is a deterministic no-op and the button never has to know
   * the rules.
   */
  const activateSlayyy = (): void => {
    run?.activateSlayyy()
  }

  return {
    phase, loading, failed, isPaused, hasEnded, hearts, start, stop, restart, togglePause,
    score, runPaws, cyclePaws, loliActive, slayyy, slayyyPercent, activateSlayyy,
  }
}

function defaultSeed(): number {
  // Not `Math.random()` for its distribution — for its availability. This is
  // the app layer, where a platform RNG is allowed; the domain's ban applies to
  // the rules, which receive this value rather than producing one.
  return Math.floor(Math.random() * 0xFFFFFFFF)
}
