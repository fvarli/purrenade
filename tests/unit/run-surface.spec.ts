// @vitest-environment happy-dom
//
// A composable rather than a component, so it lives with the unit tests — but
// its whole job is DOM listeners and a WebGL teardown, so it needs a document.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TUTORIAL_RUN_INIT, useRunSurface } from '~/composables/useRunSurface'
import { HEARTS } from '~~/game/bridge'
import type { RunEvent, RunPhase } from '~~/game/bridge'

/**
 * The run's lifetime, driven by a fake engine.
 *
 * The failure this guards is not a wrong pixel — it is a WebGL context and a
 * `requestAnimationFrame` loop that survive a route change. Five visits to the
 * run route leave five live contexts, and browsers drop the oldest without
 * telling anyone. That is invisible until the game stops rendering, so it is
 * asserted here rather than discovered later.
 */

interface FakeRun {
  phase: RunPhase
  destroyed: boolean
  pauseCalls: number
  resumeCalls: number
  slayyyCalls: number
  skipCalls: number
}

let fake: FakeRun
let mountCalls: number
let emit: (event: RunEvent) => void

/** Counts listeners per target so a leak is a number, not an impression. */
let listeners: Record<string, number>

function countListeners(target: EventTarget, label: string): void {
  const add = target.addEventListener.bind(target)
  const remove = target.removeEventListener.bind(target)

  vi.spyOn(target, 'addEventListener').mockImplementation((type, fn, opts) => {
    listeners[`${label}:${type}`] = (listeners[`${label}:${type}`] ?? 0) + 1
    add(type, fn, opts)
  })

  vi.spyOn(target, 'removeEventListener').mockImplementation((type, fn, opts) => {
    listeners[`${label}:${type}`] = (listeners[`${label}:${type}`] ?? 0) - 1
    remove(type, fn, opts)
  })
}

/**
 * Every surface a test creates, so `afterEach` can tear them all down.
 *
 * Without this, a test that starts a run and never stops it leaves its
 * listeners attached, and the next test's `visibilitychange` reaches both. The
 * symptom is a pause count that is right for the wrong reason.
 */
let created: Array<ReturnType<typeof useRunSurface>> = []

/** What the page asked the engine to mount, so the mode can be asserted. */
let mountedMode: 'run' | 'tutorial' | undefined
let mountedSeed: number | undefined
let mountedCycle: number | undefined

/** A server-started run's seed and cycle, as `StartedRun` would give them. */
const INIT = { seed: 12345, loliCyclePaws: 0 } as const

function surface(overrides: {
  failMount?: boolean
  gate?: Promise<unknown>
  mode?: 'run' | 'tutorial'
} = {}) {
  const instance = useRunSurface({
    mount: async ({ onEvent, mode, seed, loliCyclePaws }) => {
      mountCalls++
      mountedMode = mode
      mountedSeed = seed
      mountedCycle = loliCyclePaws

      // Lets a test hold the engine mid-import and leave the route underneath it.
      if (overrides.gate) await overrides.gate

      if (overrides.failMount) throw new Error('engine unavailable')

      emit = onEvent

      return {
        phase: () => fake.phase,
        pause: () => {
          fake.pauseCalls++
          fake.phase = 'paused'
        },
        resume: () => {
          fake.resumeCalls++
          fake.phase = 'running'
        },
        activateSlayyy: () => {
          fake.slayyyCalls++
        },
        skipTutorial: () => {
          fake.skipCalls++
        },
        destroy: () => {
          fake.destroyed = true
        },
      }
    },
    mode: overrides.mode,
  })

  created.push(instance)

  return instance
}

beforeEach(() => {
  created = []

  fake = {
    phase: 'running',
    destroyed: false,
    pauseCalls: 0,
    resumeCalls: 0,
    slayyyCalls: 0,
    skipCalls: 0,
  }
  mountCalls = 0
  mountedMode = undefined
  listeners = {}

  countListeners(document, 'document')
  countListeners(window, 'window')
})

afterEach(() => {
  for (const instance of created) instance.stop()

  created = []
  vi.restoreAllMocks()
})

const container = (): HTMLElement => document.createElement('div')

describe('starting a run', () => {
  it('mounts the engine and clears the loading state', async () => {
    const run = surface()

    expect(run.loading.value).toBe(true)

    await run.start(container(), INIT)

    expect(mountCalls).toBe(1)
    expect(run.loading.value).toBe(false)
    expect(run.failed.value).toBe(false)
  })

  it('reports a failed engine load instead of leaving a blank screen', async () => {
    const run = surface({ failMount: true })

    await run.start(container(), INIT)

    expect(run.failed.value).toBe(true)
    expect(run.loading.value).toBe(false)
  })

  it('attaches no listeners when the engine fails to load', async () => {
    const run = surface({ failMount: true })

    await run.start(container(), INIT)

    expect(listeners['document:visibilitychange'] ?? 0).toBe(0)
    expect(listeners['window:blur'] ?? 0).toBe(0)
  })

  it('refuses to mount twice over the same surface', async () => {
    // A double mount leaks the first canvas outright: only the second would be
    // held for `stop()` to destroy.
    const run = surface()

    await run.start(container(), INIT)
    await run.start(container(), INIT)

    expect(mountCalls).toBe(1)
  })

  it('takes the phase from events, never by reading the simulation', async () => {
    const run = surface()
    await run.start(container(), INIT)

    expect(run.phase.value).toBe('ready')

    emit({ type: 'phase_changed', phase: 'running' })

    expect(run.phase.value).toBe('running')
  })

  it('ignores coarse events that carry no phase', async () => {
    const run = surface()
    await run.start(container(), INIT)

    emit({ type: 'run_started' })
    emit({ type: 'run_interactive' })

    expect(run.phase.value).toBe('ready')
  })
})

describe('stopping a run', () => {
  it('destroys the engine', async () => {
    const run = surface()
    await run.start(container(), INIT)

    run.stop()

    expect(fake.destroyed).toBe(true)
  })

  it('removes every listener it attached', async () => {
    const run = surface()
    await run.start(container(), INIT)

    run.stop()

    expect(listeners['document:visibilitychange']).toBe(0)
    expect(listeners['window:blur']).toBe(0)
    expect(listeners['window:pagehide']).toBe(0)
  })

  it('survives being stopped twice', async () => {
    // An unmount racing a navigation calls this more than once.
    const run = surface()
    await run.start(container(), INIT)

    run.stop()
    run.stop()

    expect(listeners['document:visibilitychange']).toBe(0)
  })

  it('is a no-op before anything started', () => {
    expect(() => surface().stop()).not.toThrow()
  })

  it('leaks nothing across repeated mount, unmount, mount', async () => {
    // The route entered and left five times. Every count must return to zero,
    // and exactly one engine must be alive at the end.
    for (let visit = 0; visit < 5; visit++) {
      fake = {
        phase: 'running',
        destroyed: false,
        pauseCalls: 0,
        resumeCalls: 0,
        slayyyCalls: 0,
        skipCalls: 0,
      }

      const run = surface()
      await run.start(container(), INIT)

      expect(listeners['document:visibilitychange']).toBe(1)

      run.stop()

      expect(fake.destroyed).toBe(true)
      expect(listeners['document:visibilitychange']).toBe(0)
      expect(listeners['window:blur']).toBe(0)
      expect(listeners['window:pagehide']).toBe(0)
    }
  })
})

describe('pausing when the run stops being watched', () => {
  it('pauses when the tab is hidden', async () => {
    const run = surface()
    await run.start(container(), INIT)

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))

    expect(fake.pauseCalls).toBe(1)
    expect(run.phase.value).toBe('paused')
  })

  it('pauses when the window loses focus', async () => {
    const run = surface()
    await run.start(container(), INIT)

    window.dispatchEvent(new Event('blur'))

    expect(fake.pauseCalls).toBe(1)
  })

  it('does not resume when the tab comes back', async () => {
    // One-way, deliberately: a tab regaining focus while the player is looking
    // elsewhere must not restart a live run.
    const run = surface()
    await run.start(container(), INIT)

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))

    expect(fake.resumeCalls).toBe(0)
    expect(run.phase.value).toBe('paused')
  })

  it('does not pause twice when several signals arrive together', async () => {
    // Hiding a tab fires blur and visibilitychange and pagehide. One pause.
    const run = surface()
    await run.start(container(), INIT)

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('blur'))
    window.dispatchEvent(new Event('pagehide'))

    expect(fake.pauseCalls).toBe(1)
  })

  it('stops responding to visibility once the run is torn down', async () => {
    const run = surface()
    await run.start(container(), INIT)
    run.stop()

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))

    expect(fake.pauseCalls).toBe(0)
  })
})

describe('the pause control', () => {
  it('toggles both ways', async () => {
    const run = surface()
    await run.start(container(), INIT)

    run.togglePause()

    expect(run.isPaused.value).toBe(true)
    expect(fake.pauseCalls).toBe(1)

    run.togglePause()

    expect(run.isPaused.value).toBe(false)
    expect(fake.resumeCalls).toBe(1)
  })

  it('does nothing before the engine exists', () => {
    const run = surface()

    expect(() => run.togglePause()).not.toThrow()
    expect(run.isPaused.value).toBe(false)
  })

  it('does nothing after teardown', async () => {
    const run = surface()
    await run.start(container(), INIT)
    run.stop()

    run.togglePause()

    expect(fake.pauseCalls).toBe(0)
  })
})

describe('leaving while the engine is still loading', () => {
  /*
   * The ordering that has no test: `start()` is fired from `onMounted` and not
   * awaited, so a player who leaves the route during the 1.3 MB Phaser download
   * unmounts the component while the promise is still in flight.
   *
   * Nothing about that is exotic — it is one impatient tap on a slow phone.
   */
  it('destroys an engine that finishes mounting after the route was left', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })

    const run = surface({ gate })

    const starting = run.start(container(), INIT)

    // The player leaves before the import resolves.
    run.stop()

    release()
    await starting

    expect(fake.destroyed, 'the late engine must be destroyed, not left running').toBe(true)
  })

  it('leaves no listener attached when the route was left mid-mount', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })

    const run = surface({ gate })
    const starting = run.start(container(), INIT)

    run.stop()

    release()
    await starting

    expect(listeners, 'a run nobody is watching must hold no listeners').toEqual({})
  })

  it('does not mount twice when start is called again during the first mount', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })

    const run = surface({ gate })

    const first = run.start(container(), INIT)
    const second = run.start(container(), INIT)

    release()
    await Promise.all([first, second])

    expect(mountCalls, 'a second start during the first must not build a second engine').toBe(1)
  })
})

describe('the provisional heart feedback', () => {
  it('starts at the approved count', () => {
    const run = surface()

    expect(run.hearts.value).toBe(3)
  })

  it('follows the coarse event, not the simulation', async () => {
    // The app must never read run state. `heart_lost` carries the new count,
    // which is the whole contract between the rules and a heart row.
    const run = surface()

    await run.start(container(), INIT)

    emit({ type: 'heart_lost', hearts: 2 })

    expect(run.hearts.value).toBe(2)

    emit({ type: 'heart_lost', hearts: 1 })

    expect(run.hearts.value).toBe(1)
  })

  it('reports the terminal phase', async () => {
    const run = surface()

    await run.start(container(), INIT)

    expect(run.hasEnded.value).toBe(false)

    emit({ type: 'phase_changed', phase: 'ended' })

    expect(run.hasEnded.value).toBe(true)
  })

  it('resets the heart row when the surface is torn down', async () => {
    const run = surface()

    await run.start(container(), INIT)
    emit({ type: 'heart_lost', hearts: 1 })
    run.stop()

    expect(run.hearts.value).toBe(3)
  })
})

describe('the M7 heads-up display', () => {
  it('starts every counter at zero', () => {
    const run = surface()

    expect(run.score.value).toBe(0)
    expect(run.runPaws.value).toBe(0)
    expect(run.cyclePaws.value).toBe(0)
    expect(run.loliActive.value).toBe(false)
    expect(run.slayyy.value).toBe('charging')
  })

  it('follows the coarse score event rather than the simulation', async () => {
    /*
     * The score moves on nearly every one of 120 steps a second. The loop only
     * emits when the *displayed integer* changes, and the HUD reads the event —
     * mirroring run state into Vue would re-render at the simulation rate.
     */
    const run = surface()

    await run.start(container(), INIT)

    emit({ type: 'score_changed', total: 140 })

    expect(run.score.value).toBe(140)

    emit({ type: 'score_changed', total: 141 })

    expect(run.score.value).toBe(141)
  })

  it('tracks both paw counters from one event', async () => {
    const run = surface()

    await run.start(container(), INIT)

    emit({ type: 'paws_changed', runPaws: 12, cyclePaws: 199 })

    expect(run.runPaws.value).toBe(12)
    expect(run.cyclePaws.value).toBe(199)
  })

  it('shows the companion only while it is running', async () => {
    const run = surface()

    await run.start(container(), INIT)

    emit({ type: 'loli_started' })
    expect(run.loliActive.value).toBe(true)

    emit({ type: 'loli_ended' })
    expect(run.loliActive.value).toBe(false)
  })

  it('follows the SLAYYY meter through its states', async () => {
    const run = surface()

    await run.start(container(), INIT)

    emit({ type: 'slayyy_ready' })
    expect(run.slayyy.value).toBe('ready')

    emit({ type: 'slayyy_activated' })
    expect(run.slayyy.value).toBe('active')

    emit({ type: 'slayyy_ended' })
    expect(run.slayyy.value).toBe('charging')
  })

  it('follows the meter\'s fill, as a whole percent', async () => {
    const run = surface()

    await run.start(container(), INIT)
    expect(run.slayyyPercent.value).toBe(0)

    emit({ type: 'slayyy_charge', percent: 41 })
    expect(run.slayyyPercent.value).toBe(41)

    // Activation spends the meter; the loop says so in the same coarse way.
    emit({ type: 'slayyy_charge', percent: 0 })
    emit({ type: 'slayyy_activated' })

    expect(run.slayyyPercent.value).toBe(0)
    expect(run.slayyy.value).toBe('active')
  })

  it('asks the engine to activate, and lets the domain decide', async () => {
    // The button never checks whether the meter is armed. A press while
    // charging is a no-op the rules make, not one the UI guesses at.
    const run = surface()

    await run.start(container(), INIT)
    run.activateSlayyy()

    expect(fake.slayyyCalls).toBe(1)
  })

  it('does nothing when asked to activate with no run mounted', () => {
    const run = surface()

    expect(() => run.activateSlayyy()).not.toThrow()
    expect(fake.slayyyCalls).toBe(0)
  })

  it('clears the companion and the active power when the run ends', async () => {
    const run = surface()

    await run.start(container(), INIT)

    emit({ type: 'loli_started' })
    emit({ type: 'slayyy_activated' })
    emit({ type: 'run_ended' })

    expect(run.loliActive.value).toBe(false)
    expect(run.slayyy.value).toBe('charging')
  })

  it('resets every counter when the surface is torn down', async () => {
    // A stale score surviving a teardown would show on the next run before its
    // first event arrived.
    const run = surface()

    await run.start(container(), INIT)

    emit({ type: 'score_changed', total: 900 })
    emit({ type: 'paws_changed', runPaws: 40, cyclePaws: 40 })
    emit({ type: 'loli_started' })
    emit({ type: 'slayyy_charge', percent: 100 })
    emit({ type: 'slayyy_ready' })

    run.stop()

    expect(run.score.value).toBe(0)
    expect(run.runPaws.value).toBe(0)
    expect(run.cyclePaws.value).toBe(0)
    expect(run.loliActive.value).toBe(false)
    expect(run.slayyy.value).toBe('charging')
    expect(run.slayyyPercent.value).toBe(0)
  })
})

describe('replaying a run', () => {
  /**
   * Drive the fake to the state a lost run leaves behind.
   *
   * The domain seals `ended`, so this is genuinely terminal: the only way out
   * of it is a new run.
   */
  const loseTheRun = (): void => {
    emit({ type: 'score_changed', total: 4210 })
    emit({ type: 'paws_changed', runPaws: 37, cyclePaws: 37 })
    emit({ type: 'heart_lost', hearts: 0 })
    emit({ type: 'phase_changed', phase: 'ended' })
    emit({ type: 'run_ended' })
    fake.phase = 'ended'
  }

  it('destroys the finished run and mounts a new one', async () => {
    const run = surface()
    await run.start(container(), INIT)

    loseTheRun()
    await run.restart()

    expect(mountCalls).toBe(2)
    expect(fake.destroyed).toBe(true)
  })

  /*
   * The bug this exists for.
   *
   * `createRunLoop` emits `run_started` but no opening `phase_changed` — its
   * `lastPhase` is seeded from the fresh state, so the first phase event a new
   * run produces is `ready -> running`, at the *end* of the readiness beat.
   * A replay that left `phase` at `'ended'` therefore showed the run-complete
   * overlay over a live new run for that whole second and a half.
   */
  it('is back at the readiness beat before the new run says anything', async () => {
    const run = surface()
    await run.start(container(), INIT)

    loseTheRun()
    expect(run.hasEnded.value).toBe(true)

    await run.restart()

    expect(run.phase.value).toBe('ready')
    expect(run.hasEnded.value).toBe(false)
    expect(run.isPaused.value).toBe(false)
  })

  it('resets every run-scoped counter', async () => {
    const run = surface()
    await run.start(container(), INIT)

    emit({ type: 'slayyy_charge', percent: 80 })
    emit({ type: 'slayyy_ready' })
    emit({ type: 'loli_started' })
    loseTheRun()

    await run.restart()

    expect(run.score.value).toBe(0)
    expect(run.runPaws.value).toBe(0)
    expect(run.cyclePaws.value).toBe(0)
    expect(run.hearts.value).toBe(HEARTS.start)
    expect(run.slayyy.value).toBe('charging')
    expect(run.slayyyPercent.value).toBe(0)
    expect(run.loliActive.value).toBe(false)
  })

  /*
   * The leak this composable exists to prevent, in its replay form.
   *
   * Three replays is three mounts, and a `start()` that added its listeners
   * without the matching `stop()` having removed them would read as three
   * copies here — after which one tab switch would fire three pauses.
   */
  it('does not multiply listeners however often it is replayed', async () => {
    const run = surface()
    await run.start(container(), INIT)

    await run.restart()
    await run.restart()
    await run.restart()

    expect(mountCalls).toBe(4)
    expect(listeners['document:visibilitychange']).toBe(1)
    expect(listeners['window:blur']).toBe(1)
    expect(listeners['window:pagehide']).toBe(1)

    run.stop()

    expect(listeners['document:visibilitychange']).toBe(0)
    expect(listeners['window:blur']).toBe(0)
    expect(listeners['window:pagehide']).toBe(0)
  })

  it('leaves exactly one live engine behind, not a stack of them', async () => {
    const run = surface()
    await run.start(container(), INIT)

    await run.restart()
    await run.restart()

    // Every mount but the current one was destroyed on its way out, so a single
    // `stop()` is enough to leave nothing running.
    run.stop()

    expect(listeners['document:visibilitychange']).toBe(0)
  })

  it('is a no-op before anything has been mounted', async () => {
    const run = surface()

    await run.restart()

    expect(mountCalls).toBe(0)
    expect(run.loading.value).toBe(true)
  })

  /*
   * Leaving the route releases the container.
   *
   * Holding it would pin a detached element for as long as the composable
   * lives, and would let a late `restart()` — from a handler that outlived the
   * page — mount a game into an element no longer in the document.
   */
  it('does not mount into a surface the page has already left', async () => {
    const run = surface()
    await run.start(container(), INIT)
    run.stop()

    await run.restart()

    expect(mountCalls).toBe(1)
  })
})

/**
 * The tutorial's share of the surface.
 *
 * The prompt state lives here for the same reason the score does: it arrives on
 * coarse events, and it has to be cleared by the same teardown. The comment
 * beside `stop()`'s phase reset records what happens when one of these is
 * forgotten — the previous run's overlay covering the next run's first frame —
 * and this is the test that stops it happening again one milestone later.
 */
describe('the tutorial, from the Vue side', () => {
  it('mounts the mode it was created with', async () => {
    const run = surface({ mode: 'tutorial' })

    await run.start(container(), INIT)

    expect(mountedMode).toBe('tutorial')
    expect(run.mode).toBe('tutorial')
  })

  it('mounts a normal run by default', async () => {
    const run = surface()

    await run.start(container(), INIT)

    expect(mountedMode).toBe('run')
    expect(run.mode).toBe('run')
  })

  it('stays a tutorial across a replay', async () => {
    const run = surface({ mode: 'tutorial' })

    await run.start(container(), INIT)
    await run.restart()

    // A replay of a tutorial is another tutorial. The mode is held beside the
    // container rather than re-derived, so a restart cannot silently change
    // which game the player is in.
    expect(mountCalls).toBe(2)
    expect(mountedMode).toBe('tutorial')
  })

  it('follows the lessons, and clears the guidance when one is passed', async () => {
    const run = surface({ mode: 'tutorial' })

    await run.start(container(), INIT)

    emit({ type: 'tutorial_lesson', lesson: 'dodge_cone', index: 3, total: 9 })

    expect(run.lesson.value).toBe('dodge_cone')
    expect(run.lessonIndex.value).toBe(3)
    expect(run.lessonTotal.value).toBe(9)

    emit({ type: 'tutorial_correction', lesson: 'dodge_cone', correction: 'jumped_at_cone', attempt: 1 })

    expect(run.correction.value).toBe('jumped_at_cone')
    expect(run.correctionAttempt.value).toBe(1)

    emit({ type: 'tutorial_lesson', lesson: 'jump_barrier', index: 4, total: 9 })

    // The previous lesson's guidance must not survive into a prompt that is no
    // longer about it.
    expect(run.correction.value).toBeNull()
    expect(run.correctionAttempt.value).toBe(0)
  })

  it('reports how the tutorial ended', async () => {
    const run = surface({ mode: 'tutorial' })

    await run.start(container(), INIT)

    emit({ type: 'tutorial_completed', outcome: 'skipped' })

    expect(run.tutorialOutcome.value).toBe('skipped')
  })

  it('clears every scrap of tutorial state on teardown', async () => {
    const run = surface({ mode: 'tutorial' })

    await run.start(container(), INIT)

    emit({ type: 'tutorial_lesson', lesson: 'collect_paw', index: 5, total: 9 })
    emit({ type: 'tutorial_correction', lesson: 'collect_paw', correction: 'missed_paw', attempt: 2 })
    emit({ type: 'tutorial_completed', outcome: 'completed' })

    run.stop()

    expect(run.lesson.value).toBeNull()
    expect(run.lessonIndex.value).toBe(0)
    expect(run.lessonTotal.value).toBe(0)
    expect(run.correction.value).toBeNull()
    expect(run.correctionAttempt.value).toBe(0)
    expect(run.tutorialOutcome.value).toBeNull()
  })

  it('asks the engine to skip, and does nothing before a run exists', () => {
    const run = surface({ mode: 'tutorial' })

    // No engine yet: a skip must not throw on a surface that never mounted.
    run.skipTutorial()

    expect(fake.skipCalls).toBe(0)
  })

  it('asks the engine to skip once a run exists', async () => {
    const run = surface({ mode: 'tutorial' })

    await run.start(container(), INIT)
    run.skipTutorial()

    expect(fake.skipCalls).toBe(1)
  })

  it('ignores tutorial events from a mount the route already abandoned', async () => {
    let open = (): void => {}
    const gate = new Promise<undefined>((resolve) => {
      open = () => resolve(undefined)
    })

    const run = surface({ mode: 'tutorial', gate })

    const pending = run.start(container(), INIT)

    run.stop()
    open()
    await pending

    // The abandoned mount's sink is still reachable from this test; the
    // composable must refuse it, or a destroyed run would drive a live prompt.
    emit({ type: 'tutorial_lesson', lesson: 'move_left', index: 1, total: 9 })

    expect(run.lesson.value).toBeNull()
  })
})

describe('the server seed (M9)', () => {
  it('mounts the seed and cycle it is given, verbatim', async () => {
    const run = surface()

    await run.start(container(), { seed: 4294967295, loliCyclePaws: 199 })

    expect(mountedSeed).toBe(4294967295)
    expect(mountedCycle).toBe(199)
    // The readout starts from the persistent cycle, before any paw event.
    expect(run.cyclePaws.value).toBe(199)
  })

  it('mounts the boundary seed 0', async () => {
    const run = surface()

    await run.start(container(), { seed: 0, loliCyclePaws: 0 })

    expect(mountedSeed).toBe(0)
  })

  it('replays a normal run from the new seed it is given', async () => {
    const run = surface()

    await run.start(container(), INIT)
    await run.restart({ seed: 777, loliCyclePaws: 42 })

    expect(mountedSeed).toBe(777)
    expect(mountedCycle).toBe(42)
  })

  it('replays the tutorial from its fixed start', async () => {
    const run = surface({ mode: 'tutorial' })

    await run.start(container(), TUTORIAL_RUN_INIT)
    await run.restart()

    expect(mountedSeed).toBe(0)
    expect(mountedCycle).toBe(0)
    expect(TUTORIAL_RUN_INIT).toEqual({ seed: 0, loliCyclePaws: 0 })
  })

  it('exposes the summary when the run ends, and clears it on teardown', async () => {
    const run = surface()

    await run.start(container(), INIT)
    expect(run.summary.value).toBeNull()

    emit({ type: 'run_ended', summary: { score: 1234, runPaws: 12, elapsedMs: 45678 } })

    expect(run.summary.value).toEqual({ score: 1234, runPaws: 12, elapsedMs: 45678 })

    run.stop()

    expect(run.summary.value).toBeNull()
  })

  it('generates no seed of its own', () => {
    // RNG-1: a normal run's seed is server-issued. The composable has no
    // platform RNG left to reach for.
    // The repository root: this file runs under happy-dom, whose
    // `import.meta.url` is not a file URL.
    const source = readFileSync(join(process.cwd(), 'app/composables/useRunSurface.ts'), 'utf8')

    expect(source).not.toMatch(/Math\.random/)
    expect(source).not.toMatch(/makeSeed|defaultSeed/)
  })
})
