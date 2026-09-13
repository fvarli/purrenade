// @vitest-environment happy-dom
//
// A composable rather than a component, so it lives with the unit tests — but
// its whole job is DOM listeners and a WebGL teardown, so it needs a document.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRunSurface } from '~/composables/useRunSurface'
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

function surface(overrides: { failMount?: boolean, gate?: Promise<void> } = {}) {
  const instance = useRunSurface({
    makeSeed: () => 12345,
    mount: async ({ onEvent }) => {
      mountCalls++

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
        destroy: () => {
          fake.destroyed = true
        },
      }
    },
  })

  created.push(instance)

  return instance
}

beforeEach(() => {
  created = []

  fake = { phase: 'running', destroyed: false, pauseCalls: 0, resumeCalls: 0 }
  mountCalls = 0
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

    await run.start(container())

    expect(mountCalls).toBe(1)
    expect(run.loading.value).toBe(false)
    expect(run.failed.value).toBe(false)
  })

  it('reports a failed engine load instead of leaving a blank screen', async () => {
    const run = surface({ failMount: true })

    await run.start(container())

    expect(run.failed.value).toBe(true)
    expect(run.loading.value).toBe(false)
  })

  it('attaches no listeners when the engine fails to load', async () => {
    const run = surface({ failMount: true })

    await run.start(container())

    expect(listeners['document:visibilitychange'] ?? 0).toBe(0)
    expect(listeners['window:blur'] ?? 0).toBe(0)
  })

  it('refuses to mount twice over the same surface', async () => {
    // A double mount leaks the first canvas outright: only the second would be
    // held for `stop()` to destroy.
    const run = surface()

    await run.start(container())
    await run.start(container())

    expect(mountCalls).toBe(1)
  })

  it('takes the phase from events, never by reading the simulation', async () => {
    const run = surface()
    await run.start(container())

    expect(run.phase.value).toBe('ready')

    emit({ type: 'phase_changed', phase: 'running' })

    expect(run.phase.value).toBe('running')
  })

  it('ignores coarse events that carry no phase', async () => {
    const run = surface()
    await run.start(container())

    emit({ type: 'run_started' })
    emit({ type: 'run_interactive' })

    expect(run.phase.value).toBe('ready')
  })
})

describe('stopping a run', () => {
  it('destroys the engine', async () => {
    const run = surface()
    await run.start(container())

    run.stop()

    expect(fake.destroyed).toBe(true)
  })

  it('removes every listener it attached', async () => {
    const run = surface()
    await run.start(container())

    run.stop()

    expect(listeners['document:visibilitychange']).toBe(0)
    expect(listeners['window:blur']).toBe(0)
    expect(listeners['window:pagehide']).toBe(0)
  })

  it('survives being stopped twice', async () => {
    // An unmount racing a navigation calls this more than once.
    const run = surface()
    await run.start(container())

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
      fake = { phase: 'running', destroyed: false, pauseCalls: 0, resumeCalls: 0 }

      const run = surface()
      await run.start(container())

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
    await run.start(container())

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))

    expect(fake.pauseCalls).toBe(1)
    expect(run.phase.value).toBe('paused')
  })

  it('pauses when the window loses focus', async () => {
    const run = surface()
    await run.start(container())

    window.dispatchEvent(new Event('blur'))

    expect(fake.pauseCalls).toBe(1)
  })

  it('does not resume when the tab comes back', async () => {
    // One-way, deliberately: a tab regaining focus while the player is looking
    // elsewhere must not restart a live run.
    const run = surface()
    await run.start(container())

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
    await run.start(container())

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('blur'))
    window.dispatchEvent(new Event('pagehide'))

    expect(fake.pauseCalls).toBe(1)
  })

  it('stops responding to visibility once the run is torn down', async () => {
    const run = surface()
    await run.start(container())
    run.stop()

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))

    expect(fake.pauseCalls).toBe(0)
  })
})

describe('the pause control', () => {
  it('toggles both ways', async () => {
    const run = surface()
    await run.start(container())

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
    await run.start(container())
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

    const starting = run.start(container())

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
    const starting = run.start(container())

    run.stop()

    release()
    await starting

    expect(listeners, 'a run nobody is watching must hold no listeners').toEqual({})
  })

  it('does not mount twice when start is called again during the first mount', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })

    const run = surface({ gate })

    const first = run.start(container())
    const second = run.start(container())

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

    await run.start(container())

    emit({ type: 'heart_lost', hearts: 2 })

    expect(run.hearts.value).toBe(2)

    emit({ type: 'heart_lost', hearts: 1 })

    expect(run.hearts.value).toBe(1)
  })

  it('reports the terminal phase', async () => {
    const run = surface()

    await run.start(container())

    expect(run.hasEnded.value).toBe(false)

    emit({ type: 'phase_changed', phase: 'ended' })

    expect(run.hasEnded.value).toBe(true)
  })

  it('resets the heart row when the surface is torn down', async () => {
    const run = surface()

    await run.start(container())
    emit({ type: 'heart_lost', hearts: 1 })
    run.stop()

    expect(run.hearts.value).toBe(3)
  })
})
