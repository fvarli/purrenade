import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, useTemplateRef } from 'vue'
import RunPage from '~/pages/run.vue'
import RunOverlayDialog from '~/components/run/OverlayDialog.vue'
import RunPauseOverlay from '~/components/run/PauseOverlay.vue'
import RunTutorialCompleteOverlay from '~/components/run/TutorialCompleteOverlay.vue'
import RunTutorialPrompt from '~/components/run/TutorialPrompt.vue'
import RunTutorialSkipConfirm from '~/components/run/TutorialSkipConfirm.vue'
import { HEARTS } from '~~/game/bridge'
import type { TutorialCorrection, TutorialLesson, TutorialOutcome } from '~~/game/bridge'

/**
 * The run page, in tutorial mode.
 *
 * Three things are tested here that no other layer can show. **Which mode the
 * page chooses**, because that is the whole of first-run routing. **What the HUD
 * withholds**, because a score or a paw counter during the tutorial would be
 * offering a reward the tutorial does not grant. And **what happens when the
 * completion cannot be saved**, because the only wrong answer there is to
 * continue as though it had been.
 */

function surfaceState() {
  return {
    phase: ref('running'),
    loading: ref(false),
    failed: ref(false),
    isPaused: ref(false),
    hasEnded: ref(false),
    hearts: ref(HEARTS.max),
    score: ref(0),
    runPaws: ref(0),
    cyclePaws: ref(0),
    loliActive: ref(false),
    slayyy: ref<'charging' | 'ready' | 'active'>('charging'),
    slayyyPercent: ref(0),
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    restart: vi.fn(async () => {}),
    togglePause: vi.fn(),
    activateSlayyy: vi.fn(),
    mode: 'tutorial' as 'run' | 'tutorial',
    lesson: ref<TutorialLesson | null>('dodge_cone'),
    lessonIndex: ref(3),
    lessonTotal: ref(9),
    correction: ref<TutorialCorrection | null>(null),
    correctionAttempt: ref(0),
    tutorialOutcome: ref<TutorialOutcome | null>(null),
    skipTutorial: vi.fn(),
  }
}

type SurfaceState = ReturnType<typeof surfaceState>

let state: SurfaceState
let routeQuery: Record<string, string>
let tutorialCompleted: boolean
let completeTutorial: ReturnType<typeof vi.fn>
let markTutorialCompleted: ReturnType<typeof vi.fn>
let navigateTo: ReturnType<typeof vi.fn>
let requestedMode: 'run' | 'tutorial' | undefined

function render() {
  return mount(RunPage, {
    attachTo: document.body,
    global: {
      components: {
        RunOverlayDialog,
        RunPauseOverlay,
        RunTutorialPrompt,
        RunTutorialSkipConfirm,
        RunTutorialCompleteOverlay,
      },
      stubs: {
        NuxtLink: { template: '<a><slot /></a>' },
        UiAuthButton: {
          inheritAttrs: false,
          template: '<button v-bind="$attrs"><slot /></button>',
        },
        UiAuthNotice: { template: '<div class="notice"><slot /></div>' },
      },
    },
  })
}

beforeEach(() => {
  state = surfaceState()
  routeQuery = {}
  tutorialCompleted = false
  requestedMode = undefined

  completeTutorial = vi.fn(async () => ({ tutorialCompleted: true }))
  markTutorialCompleted = vi.fn(() => {
    tutorialCompleted = true
  })
  navigateTo = vi.fn()

  const globals = globalThis as unknown as Record<string, unknown>

  globals.definePageMeta = () => {}
  globals.useHead = () => {}
  globals.useTemplateRef = useTemplateRef
  globals.navigateTo = navigateTo
  globals.useRoute = () => ({ query: routeQuery })
  globals.useAuthStore = () => ({
    get tutorialCompleted() {
      return tutorialCompleted
    },
    markTutorialCompleted,
  })
  globals.useBffClient = () => ({ completeTutorial })

  // Capture what the page asked for, which is the routing decision itself.
  globals.useRunSurface = (options?: { mode?: 'run' | 'tutorial' }) => {
    requestedMode = options?.mode

    return state
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('which game PLAY actually reaches', () => {
  it('teaches a player who has not been taught', () => {
    tutorialCompleted = false

    render()

    expect(requestedMode).toBe('tutorial')
  })

  it('goes straight to a run for a player who has', () => {
    tutorialCompleted = true

    render()

    expect(requestedMode).toBe('run')
  })

  it('honours an explicit replay, even for a player who has finished', () => {
    tutorialCompleted = true
    routeQuery = { mode: 'tutorial' }

    render()

    expect(requestedMode).toBe('tutorial')
  })

  it('honours an explicit run, even before the store has caught up', () => {
    // The handover sets `?mode=run`, and it must not depend on the store having
    // already been updated — otherwise finishing the tutorial would mount
    // another one.
    tutorialCompleted = false
    routeQuery = { mode: 'run' }

    render()

    expect(requestedMode).toBe('run')
  })

  it('treats an unknown mode as a normal run for a finished player', () => {
    tutorialCompleted = true
    routeQuery = { mode: 'nonsense' }

    render()

    expect(requestedMode).toBe('run')
  })
})

describe('the tutorial HUD withholds what it must not reward', () => {
  it('shows no score and no paw counter', () => {
    const wrapper = render()

    // Both are progression surfaces. A score the tutorial throws away, and a
    // paw counter that reads `loliCyclePaws` — which a tutorial paw never adds
    // to — would each be showing a reward that is not being granted.
    expect(wrapper.find('.run__score').exists()).toBe(false)
    expect(wrapper.find('.run__paws').exists()).toBe(false)
    expect(wrapper.find('.run__aside--goal').exists()).toBe(false)
  })

  it('still shows the hearts, which are the proof they are never spent', () => {
    const wrapper = render()

    expect(wrapper.find('.run__hearts-count').text()).toContain(`count=${HEARTS.max}`)
  })

  it('keeps the keyboard legend, which is more useful while learning', () => {
    expect(render().find('.run__aside--keys').exists()).toBe(true)
  })

  it('shows all of it in a normal run', () => {
    tutorialCompleted = true
    state.mode = 'run'
    state.lesson.value = null

    const wrapper = render()

    expect(wrapper.find('.run__score').exists()).toBe(true)
    expect(wrapper.find('.run__paws').exists()).toBe(true)
    expect(wrapper.find('.run__aside--goal').exists()).toBe(true)
    expect(wrapper.find('.run__tutorial').exists()).toBe(false)
  })
})

describe('the prompt is present exactly while a lesson is being taught', () => {
  it('shows the live lesson', () => {
    const wrapper = render()

    expect(wrapper.find('.run__tutorial').exists()).toBe(true)
    expect(wrapper.text()).toContain('tutorial.lesson.dodgeCone.title')
  })

  it('stands down once the tutorial is over', async () => {
    const wrapper = render()

    state.tutorialOutcome.value = 'completed'
    await flushPromises()

    expect(wrapper.find('.run__tutorial').exists()).toBe(false)
  })

  it('stands down while the run is paused, so it does not sit over the pause screen', async () => {
    const wrapper = render()

    state.isPaused.value = true
    await flushPromises()

    expect(wrapper.find('.run__tutorial').exists()).toBe(false)
  })
})

describe('skipping', () => {
  it('pauses and asks before it does anything', async () => {
    const wrapper = render()

    await wrapper.find('.run__tutorial-skip').trigger('click')

    // Asked, not done: the rules have not been told yet.
    expect(wrapper.find('.run__tutorial-confirm').exists()).toBe(true)
    expect(state.togglePause).toHaveBeenCalledTimes(1)
    expect(state.skipTutorial).not.toHaveBeenCalled()
    expect(completeTutorial).not.toHaveBeenCalled()
  })

  it('does not raise the pause screen behind the question', async () => {
    const wrapper = render()

    state.isPaused.value = true
    await wrapper.find('.run__tutorial-skip').trigger('click')

    expect(wrapper.find('.run__tutorial-confirm').exists()).toBe(true)
    expect(wrapper.find('.run__pause-screen').exists()).toBe(false)
  })

  it('carries on, and resumes, when the player changes their mind', async () => {
    const wrapper = render()

    await wrapper.find('.run__tutorial-skip').trigger('click')
    state.isPaused.value = true
    await wrapper.find('.run__tutorial-continue').trigger('click')

    expect(wrapper.find('.run__tutorial-confirm').exists()).toBe(false)
    expect(state.skipTutorial).not.toHaveBeenCalled()
    // Paused to ask, resumed on answering.
    expect(state.togglePause).toHaveBeenCalledTimes(2)
  })

  it('tells the rules first, then the server', async () => {
    const wrapper = render()

    await wrapper.find('.run__tutorial-skip').trigger('click')
    await wrapper.find('.run__tutorial-confirm-skip').trigger('click')
    await flushPromises()

    expect(state.skipTutorial).toHaveBeenCalledTimes(1)
    expect(completeTutorial).toHaveBeenCalledTimes(1)
    expect(markTutorialCompleted).toHaveBeenCalledTimes(1)
  })

  it('records a skip through the same call a finish makes', async () => {
    const wrapper = render()

    await wrapper.find('.run__tutorial-skip').trigger('click')
    await wrapper.find('.run__tutorial-confirm-skip').trigger('click')
    await flushPromises()

    // The server is deliberately not told which happened.
    expect(completeTutorial).toHaveBeenCalledWith()
  })
})

describe('completion is only true once the server says so', () => {
  it('stores the completion and then starts a fresh run', async () => {
    const wrapper = render()

    state.tutorialOutcome.value = 'completed'
    await flushPromises()

    await wrapper.find('.run__tutorial-play').trigger('click')
    await flushPromises()

    expect(completeTutorial).toHaveBeenCalledTimes(1)
    expect(markTutorialCompleted).toHaveBeenCalledTimes(1)
    expect(navigateTo).toHaveBeenCalledWith({ path: '/run', query: { mode: 'run' }, replace: true })
  })

  it('does not lie to the player when the save fails', async () => {
    completeTutorial.mockRejectedValueOnce(new Error('offline'))

    const wrapper = render()

    state.tutorialOutcome.value = 'completed'
    await flushPromises()

    await wrapper.find('.run__tutorial-play').trigger('click')
    await flushPromises()

    /*
     * The important half: it did **not** navigate. Routing onward would tell
     * the player they had finished and then hand them the mandatory tutorial
     * again on their next sign-in, with nothing to explain why.
     */
    expect(navigateTo).not.toHaveBeenCalled()
    expect(markTutorialCompleted).not.toHaveBeenCalled()
    expect(wrapper.find('.notice').exists()).toBe(true)
    expect(wrapper.text()).toContain('tutorial.saveFailed')
  })

  it('offers the same idempotent call again, and succeeds on the retry', async () => {
    completeTutorial.mockRejectedValueOnce(new Error('offline'))

    const wrapper = render()

    state.tutorialOutcome.value = 'completed'
    await flushPromises()

    await wrapper.find('.run__tutorial-play').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('tutorial.retry')

    await wrapper.find('.run__tutorial-play').trigger('click')
    await flushPromises()

    expect(completeTutorial).toHaveBeenCalledTimes(2)
    expect(navigateTo).toHaveBeenCalledTimes(1)
  })

  it('does not send the request twice while the first is in flight', async () => {
    let release: (value: { tutorialCompleted: boolean }) => void = () => {}

    completeTutorial.mockImplementationOnce(async () => new Promise((resolve) => {
      release = resolve
    }))

    const wrapper = render()

    state.tutorialOutcome.value = 'completed'
    await flushPromises()

    await wrapper.find('.run__tutorial-play').trigger('click')
    await wrapper.find('.run__tutorial-play').trigger('click')

    expect(completeTutorial).toHaveBeenCalledTimes(1)

    release({ tutorialCompleted: true })
    await flushPromises()
  })

  it('lets a Settings replay leave without storing anything again', async () => {
    tutorialCompleted = true
    routeQuery = { mode: 'tutorial' }

    const wrapper = render()

    state.tutorialOutcome.value = 'completed'
    await flushPromises()

    await wrapper.find('.run__tutorial-play').trigger('click')
    await flushPromises()

    // Already completed: nothing to persist, and nothing that could re-stamp it.
    expect(completeTutorial).not.toHaveBeenCalled()
    expect(navigateTo).toHaveBeenCalledWith({ path: '/run', query: { mode: 'run' }, replace: true })
  })
})
