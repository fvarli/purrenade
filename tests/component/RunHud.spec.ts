import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, useTemplateRef } from 'vue'
import RunPage from '~/pages/run.vue'
import RunCompleteOverlay from '~/components/run/CompleteOverlay.vue'
import RunOverlayDialog from '~/components/run/OverlayDialog.vue'
import RunPauseOverlay from '~/components/run/PauseOverlay.vue'
import { runSessionStub } from '../support/run-session-stub'
import type { RunSessionStub } from '../support/run-session-stub'
import { HEARTS, PROGRESS } from '~~/game/bridge'
import type { TutorialCorrection, TutorialLesson, TutorialOutcome } from '~~/game/bridge'
import type { RunResult } from '~/types/run'

/**
 * The heads-up display.
 *
 * `accessibility.md` §4 requires every gameplay fact the player is expected to
 * act on to exist as DOM outside the canvas, and none of it to rest on hue
 * alone. That is a testable claim and this is where it is tested: the E2E suite
 * proves the HUD is wired to a real run, and these prove it says the right
 * thing for a given state — including the states a scripted player cannot
 * reach, which is most of the interesting ones.
 *
 * The page is mounted against a fake `useRunSurface`. The real one owns a
 * WebGL context, and this is a test of the readout, not of the engine.
 */

/** A server result, with overridable fields. */
function runResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    run_id: '01999999-9999-7999-8999-999999999999',
    status: 'accepted',
    score: 1000,
    run_paws: 50,
    is_personal_best: false,
    previous_best_score: 900,
    reasons: [],
    progression: {
      lifetime_paws: 50,
      loli_cycle_paws: 50,
      loli_threshold: 200,
      best_score: 1000,
      run_count: 1,
      tutorial_completed: true,
    },
    achievements_unlocked: [],
    characters_unlocked: [],
    ...overrides,
  }
}

/** Every value the page destructures, so the fake cannot silently omit one. */
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

    // --- M8 -----------------------------------------------------------------
    mode: 'run' as 'run' | 'tutorial',
    lesson: ref<TutorialLesson | null>(null),
    lessonIndex: ref(0),
    lessonTotal: ref(0),
    correction: ref<TutorialCorrection | null>(null),
    correctionAttempt: ref(0),
    tutorialOutcome: ref<TutorialOutcome | null>(null),
    skipTutorial: vi.fn(),

    // --- M9 -----------------------------------------------------------------
    summary: ref<{ score: number, runPaws: number, elapsedMs: number } | null>(null),
  }
}

/**
 * The route, faked at its narrowest.
 *
 * The page reads exactly one thing from it — `query.mode` — and reads it once,
 * at setup. A fuller stub would invite a test to change it mid-render and
 * assert behaviour the real page cannot have, because the mode is fixed for the
 * life of a mounted engine.
 */
let routeQuery: Record<string, string> = {}

/** Only what the page asks of the store: has this player seen the tutorial? */
let tutorialCompleted = true

type SurfaceState = ReturnType<typeof surfaceState>

let state: SurfaceState

/** The run session the page talks to. Fresh per test. */
let session: RunSessionStub

function render() {
  return mount(RunPage, {
    attachTo: document.body,
    global: {
      /*
       * The overlays are mounted for real, not stubbed.
       *
       * Their modal semantics and their focus behaviour are the point of the
       * cases below, and a stub would assert the page's `v-if` and nothing
       * else. Only the shared button is stubbed, for the same reason it is
       * stubbed everywhere else here.
       */
      components: { RunPauseOverlay, RunCompleteOverlay, RunOverlayDialog },
      stubs: {
        NuxtLink: { template: '<a><slot /></a>' },
        // Forwards attrs and listeners, so the pause control behaves like the
        // real button. A stub that swallowed `@click` would make the focus
        // tests below pass without the page doing anything.
        UiAuthButton: {
          inheritAttrs: false,
          template: '<button v-bind="$attrs"><slot /></button>',
        },
        UiAuthNotice: { template: '<div><slot /></div>' },
      },
    },
  })
}

beforeEach(() => {
  state = surfaceState()
  session = runSessionStub()
  routeQuery = {}
  tutorialCompleted = true

  const globals = globalThis as unknown as Record<string, unknown>
  globals.definePageMeta = () => {}
  globals.useHead = () => {}
  globals.useTemplateRef = useTemplateRef
  globals.useRunSessionStore = () => session
  globals.navigateTo = vi.fn()
  globals.useRunSurface = () => state
  globals.useRoute = () => ({ query: routeQuery })
  globals.useAuthStore = () => ({
    get tutorialCompleted() {
      return tutorialCompleted
    },
    markTutorialCompleted: vi.fn(),
  })
  globals.useBffClient = () => ({ completeTutorial: vi.fn(async () => ({ tutorialCompleted: true })) })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the score', () => {
  it('groups the desktop-movable display in one structural readout rail', () => {
    const page = render()
    const rail = page.get('.run__readouts')

    expect(rail.find('.run__hud').exists()).toBe(true)
    expect(rail.find('.run__slayyy').exists()).toBe(true)
    expect(rail.find('.run__meta').exists()).toBe(true)
  })

  it('is text, not a bar', () => {
    state.score.value = 1234
    const page = render()

    expect(page.get('.run__score-value').text()).toBe('1234')
    expect(page.get('.run__score-label').text()).toBe('run.scoreLabel')
  })

  it('follows the ref rather than a mount-time snapshot', async () => {
    const page = render()
    expect(page.get('.run__score-value').text()).toBe('0')

    state.score.value = 87
    await page.vm.$nextTick()

    expect(page.get('.run__score-value').text()).toBe('87')
  })
})

describe('the paw readout', () => {
  it('shows the cycle count when the next bonus is far away', () => {
    state.runPaws.value = 42
    state.cyclePaws.value = 42
    const page = render()

    expect(page.get('.run__paws').text()).toContain('run.paws(count=42)')
  })

  it('switches to the fraction inside the proximity window', () => {
    state.runPaws.value = 376
    state.cyclePaws.value = PROGRESS.loliThreshold - PROGRESS.hudThresholdProximity
    const page = render()

    expect(page.get('.run__paws').text()).toContain(
      `run.cycleProgress(count=${PROGRESS.loliThreshold - PROGRESS.hudThresholdProximity},total=${PROGRESS.loliThreshold})`,
    )
  })

  it('is the cycle count, not the run count, that decides the presentation', () => {
    // A player who has already had three bonuses is nowhere near the next one.
    // Reading `runPaws` here would pin the fraction on permanently after 175.
    state.runPaws.value = 601
    state.cyclePaws.value = 1
    const page = render()

    expect(page.get('.run__paws').text()).toContain('run.paws(count=1)')
  })

  it('reports progress toward the next bonus, never the run total', () => {
    /*
     * `scoring-and-progression.md` §2.3. These were the same number until the
     * first bonus, which is why showing `runPaws` looked right and was not: a
     * player on their second cycle saw 205 and then, 20 paws later, `5 / 200`.
     */
    state.runPaws.value = 205
    state.cyclePaws.value = 5
    const page = render()

    expect(page.get('.run__paws').text()).toContain('run.paws(count=5)')
    expect(page.get('.run__paws').text()).not.toContain('205')
  })

  it('keeps the glyph decorative', () => {
    expect(render().get('.run__paw-glyph').attributes('aria-hidden')).toBe('true')
  })
})

describe('the Loli row', () => {
  it('is absent while no companion is out', () => {
    expect(render().find('.run__loli').exists()).toBe(false)
  })

  it('announces itself politely when one arrives', async () => {
    const page = render()
    state.loliActive.value = true
    await page.vm.$nextTick()

    const row = page.get('.run__loli')
    expect(row.attributes('role')).toBe('status')
    expect(row.text()).toContain('run.loliActive')
  })
})

describe('the SLAYYY control', () => {
  it('is a real button', () => {
    expect(render().get('.run__slayyy-button').element.tagName).toBe('BUTTON')
  })

  it('is disabled and says so while charging', () => {
    const page = render()
    const button = page.get('.run__slayyy-button')

    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('aria-label')).toBe('run.slayyyCharging(percent=0)')
  })

  it('states how full the meter is, as a number and not only as a fill', async () => {
    const page = render()
    state.slayyyPercent.value = 63
    await page.vm.$nextTick()

    // `accessibility.md` §4.1: the meter must be readable without relying on
    // the fill's colour, so the percentage belongs in the text.
    expect(page.get('.run__slayyy-text').text()).toBe('run.slayyyCharging(percent=63)')
    expect(page.get('.run__slayyy-button').attributes('style')).toContain('--slayyy-fill: 63%')
  })

  it('drops the percentage once there is nothing left to fill', async () => {
    const page = render()
    state.slayyy.value = 'ready'
    state.slayyyPercent.value = 100
    await page.vm.$nextTick()

    expect(page.get('.run__slayyy-text').text()).toBe('run.slayyyReady')
  })

  it('arms when the meter fills, and the name carries the state', async () => {
    const page = render()
    state.slayyy.value = 'ready'
    await page.vm.$nextTick()

    const button = page.get('.run__slayyy-button')
    expect(button.attributes('disabled')).toBeUndefined()
    expect(button.attributes('aria-label')).toBe('run.slayyyReady')
  })

  it('is disabled again while it is being spent, so a second press cannot queue one', async () => {
    const page = render()
    state.slayyy.value = 'active'
    await page.vm.$nextTick()

    const button = page.get('.run__slayyy-button')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('aria-label')).toBe('run.slayyyActive')
  })

  it('activates on press, once per press', async () => {
    const page = render()
    state.slayyy.value = 'ready'
    await page.vm.$nextTick()

    await page.get('.run__slayyy-button').trigger('click')
    expect(state.activateSlayyy).toHaveBeenCalledTimes(1)
  })

  it('cannot be pressed after the run ends, even fully charged', async () => {
    const page = render()
    state.slayyy.value = 'ready'
    state.hasEnded.value = true
    await page.vm.$nextTick()

    expect(page.get('.run__slayyy-button').attributes('disabled')).toBeDefined()
  })

  it('cannot be pressed before the engine is up', async () => {
    const page = render()
    state.slayyy.value = 'ready'
    state.loading.value = true
    await page.vm.$nextTick()

    expect(page.get('.run__slayyy-button').attributes('disabled')).toBeDefined()
  })

  it('keeps the sparkle decorative — the state is in the text', () => {
    const page = render()

    expect(page.get('.run__slayyy-mark').attributes('aria-hidden')).toBe('true')
    expect(page.get('.run__slayyy-text').text()).toBe('run.slayyyCharging(percent=0)')
  })
})

describe('the active power-state cue', () => {
  it('communicates score doubling and protection as text, not only scene colour', async () => {
    const page = render()

    state.slayyy.value = 'active'
    await page.vm.$nextTick()

    const cue = page.get('.run__slayyy-state')
    expect(cue.attributes('role')).toBe('status')
    expect(cue.text()).toContain('run.slayyyMultiplier')
  })
})

describe('what a screen reader is told', () => {
  /*
   * A changing `aria-label` announces nothing: a name is read when the control
   * is reached, and a player watching the road is not on it. `accessibility.md`
   * §3.1 requires the armed state to be *announced*, which needs a live region.
   */
  it('says nothing while the meter is filling', async () => {
    const page = render()
    state.slayyyPercent.value = 88
    await page.vm.$nextTick()

    expect(page.get('[role="status"].sr-only').text()).toBe('')
  })

  it('announces the armed state', async () => {
    const page = render()
    state.slayyy.value = 'ready'
    await page.vm.$nextTick()

    expect(page.get('[role="status"].sr-only').text()).toBe('run.slayyyReady')
  })

  it('announces activation, then falls silent again', async () => {
    const page = render()

    state.slayyy.value = 'active'
    await page.vm.$nextTick()
    expect(page.get('[role="status"].sr-only').text()).toBe('run.slayyyActive')

    state.slayyy.value = 'charging'
    await page.vm.$nextTick()
    expect(page.get('[role="status"].sr-only').text()).toBe('')
  })
})

describe('using an on-screen control hands the keyboard back', () => {
  /*
   * The defect this covers.
   *
   * `shouldHandleKey` refuses every gameplay binding but Escape while
   * `document.activeElement` claims activation, and a `<button>` keeps focus
   * after a click. So tapping SLAYYY — the approved activation affordance —
   * left the player unable to move, jump or fire for the whole five-second
   * window, and tapping Resume left them unable to move at all. Only Escape
   * still worked, which is exactly why it went unnoticed.
   *
   * These assert the mechanism rather than the symptom: the keyboard rule is
   * tested in `game/engine/engine.spec.ts`, and what has to be true here is
   * that focus does not stay on the button.
   */
  it('returns focus to the play surface after the SLAYYY control', async () => {
    const page = render()
    state.slayyy.value = 'ready'
    await page.vm.$nextTick()

    const button = page.get('.run__slayyy-button')
    ;(button.element as HTMLButtonElement).focus()
    expect(document.activeElement).toBe(button.element)

    await button.trigger('click')

    expect(state.activateSlayyy).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(page.get('.run__surface').element)
    page.unmount()
  })

  it('returns focus to the play surface after the pause control', async () => {
    const page = render()
    const button = page.get('.run__pause')

    ;(button.element as HTMLButtonElement).focus()
    expect(document.activeElement).toBe(button.element)

    await button.trigger('click')

    expect(state.togglePause).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(page.get('.run__surface').element)
    page.unmount()
  })

  it('moves focus rather than dropping it, so nothing becomes a trap', async () => {
    // Blurring instead of focusing would also pass a naive "not the button"
    // assertion, and would leave the page with nothing focused — which is a
    // worse outcome for a keyboard player than the bug.
    const page = render()
    state.slayyy.value = 'ready'
    await page.vm.$nextTick()

    await page.get('.run__slayyy-button').trigger('click')

    expect(document.activeElement).not.toBe(document.body)
    expect((document.activeElement as HTMLElement).tabIndex).toBe(0)
    page.unmount()
  })
})

describe('hearts', () => {
  it('states the count as text beside the shapes', async () => {
    const page = render()
    state.hearts.value = 1
    await page.vm.$nextTick()

    expect(page.get('.run__hearts-count').text()).toBe(
      `run.hearts(count=1,max=${HEARTS.max})`,
    )
    expect(page.findAll('.run__heart--spent')).toHaveLength(HEARTS.max - 1)
  })
})

describe('the pause control', () => {
  /*
   * It was a text button carrying "Pause"/"Resume" in three languages of
   * differing length, which is what made the top strip reflow when the run was
   * paused. An icon has no such width — but an icon with no name is a control a
   * screen reader cannot describe, so the state moves into the accessible name
   * rather than disappearing with the label.
   */
  it('carries its state in the accessible name rather than in visible text', async () => {
    const page = render()
    const button = page.get('.run__pause')

    expect(button.attributes('aria-label')).toBe('run.pause')
    expect(button.get('.run__pause-glyph').attributes('aria-hidden')).toBe('true')

    state.isPaused.value = true
    await page.vm.$nextTick()

    expect(page.get('.run__pause').attributes('aria-label')).toBe('run.resume')
  })

  it('is gone entirely when the engine failed, rather than disabled and lying', () => {
    state.failed.value = true

    expect(render().find('.run__pause').exists()).toBe(false)
  })
})

describe('the desktop side cards', () => {
  /*
   * v0.3's desktop board puts two things beside the play column and nothing
   * else. They are rendered at every width and hidden by a media query rather
   * than branched on in script: a JavaScript width check would have to re-run
   * on resize, and a HUD that decides its own layout in script is a HUD that
   * disagrees with the stylesheet the first time one of them is edited.
   */
  it('label themselves, so neither is an unnamed landmark', () => {
    const page = render()

    expect(page.get('.run__aside--keys').attributes('aria-label')).toBe('run.keysTitle')
    expect(page.get('.run__aside--goal').attributes('aria-label')).toBe('run.nextGoalTitle')
  })

  it('states every binding the engine actually accepts', () => {
    const keys = render().get('.run__keys').text()

    for (const binding of ['run.keysLanes', 'run.keysJump', 'run.keysSlayyy', 'run.keysPause']) {
      expect(keys).toContain(binding)
    }
  })

  it('reports progress toward the next bonus, not the run total', () => {
    state.runPaws.value = 617
    state.cyclePaws.value = 17
    const page = render()

    expect(page.get('.run__goal-value').text()).toContain(
      `run.cycleProgress(count=17,total=${PROGRESS.loliThreshold})`,
    )
    expect(page.get('.run__goal-value').text()).not.toContain('617')
  })

  it('keeps the goal meter decorative, with the count carrying the fact', async () => {
    /*
     * `accessibility.md` §4.1: progress may not rest on a fill's colour. The
     * meter is a second reading of the number printed above it — delete it and
     * the card still says exactly how many Paw Tokens are left — so it is
     * hidden from the accessibility tree rather than given a role of its own.
     */
    state.cyclePaws.value = 50
    const page = render()
    const meter = page.get('.run__goal-meter')

    expect(meter.attributes('aria-hidden')).toBe('true')
    expect(meter.attributes('style')).toContain('--goal-fill: 25%')

    state.cyclePaws.value = PROGRESS.loliThreshold
    await page.vm.$nextTick()

    expect(page.get('.run__goal-meter').attributes('style')).toContain('--goal-fill: 100%')
  })

  it('never paints the goal meter past its own track', async () => {
    // A threshold crossing is the domain's to handle on its own clock, and the
    // counter can read past it for a frame before the bonus starts.
    state.cyclePaws.value = PROGRESS.loliThreshold + 40
    const page = render()
    await page.vm.$nextTick()

    expect(page.get('.run__goal-meter').attributes('style')).toContain('--goal-fill: 100%')
  })
})

describe('the display claims nothing the run does not know', () => {
  /*
   * v0.3's score card shows a personal best under the score, and during a run
   * there is no such number: the best is the server's, it arrives only with the
   * run's result (M9), and `useRunSurface` has no field for it. Printing one in
   * the HUD would be inventing state — so the card carries the caption and the
   * score, and stops there.
   */
  it('shows no personal best, no unlocks and no profile progression', () => {
    state.score.value = 4210
    const page = render()

    expect(page.get('.run__score').text()).toBe('run.scoreLabel4210')
    expect(page.find('.run__record').exists()).toBe(false)
    expect(page.find('.run__highscore').exists()).toBe(false)
  })
})

describe('the pause screen', () => {
  it('is mounted only while the domain says the run is paused', async () => {
    const page = render()
    expect(page.find('.run__pause-screen').exists()).toBe(false)

    state.isPaused.value = true
    await page.vm.$nextTick()

    expect(page.find('.run__pause-screen').exists()).toBe(true)
  })

  it('is a modal dialog named by its own heading', () => {
    state.isPaused.value = true
    const page = render()
    const dialog = page.get('[role="dialog"]')

    expect(dialog.attributes('aria-modal')).toBe('true')

    const heading = page.get('.run__pause-screen .run__overlay-title')
    expect(dialog.attributes('aria-labelledby')).toBe(heading.attributes('id'))
    expect(heading.text()).toBe('run.pauseScreen.title')
  })

  it('says the score is safe, with the score', () => {
    state.isPaused.value = true
    state.score.value = 1240
    const page = render()

    expect(page.get('.run__overlay-line').text()).toBe('run.pauseScreen.scoreSafe(score=1240)')
  })

  it('offers resume, restart and return to menu — the approved three', () => {
    state.isPaused.value = true
    const page = render()

    expect(page.find('.run__resume').exists()).toBe(true)
    expect(page.find('.run__restart').exists()).toBe(true)
    expect(page.find('.run__menu').exists()).toBe(true)
  })

  it('resumes the same run rather than restarting it', async () => {
    state.isPaused.value = true
    const page = render()

    await page.get('.run__resume').trigger('click')

    expect(state.togglePause).toHaveBeenCalledTimes(1)
    expect(state.restart).not.toHaveBeenCalled()
  })

  it('restarts exactly once per activation — by asking the server, which resumes the run', async () => {
    state.isPaused.value = true
    const page = render()
    await flushPromises()
    session.begin.mockClear()

    await page.get('.run__restart').trigger('click')

    // A normal run is never restarted locally: the server run is still active,
    // so the server resumes it and the page remounts it from its own seed.
    expect(session.begin).toHaveBeenCalledTimes(1)
    expect(state.restart).not.toHaveBeenCalled()
  })

  /*
   * No audio controls, and that is deliberate rather than unfinished.
   *
   * Board 12 shows a quick music and effects mute. The contract is approved,
   * but nothing exists to mute: Phaser is started with `audio: { noAudio: true
   * }`, there is no settings store, and no preference is persisted. A toggle
   * that changed nothing would be a claim this build cannot keep.
   */
  it('shows no audio control it could not honour', () => {
    state.isPaused.value = true
    const page = render()

    expect(page.find('.run__mute-music').exists()).toBe(false)
    expect(page.find('.run__mute-effects').exists()).toBe(false)
  })

  it('takes focus when it opens and hands it back to the surface when it closes', async () => {
    state.isPaused.value = true
    const page = render()
    await page.vm.$nextTick()

    expect(document.activeElement).toBe(page.get('.run__resume').element)

    state.isPaused.value = false
    await page.vm.$nextTick()

    expect(document.activeElement).toBe(page.get('.run__surface').element)
  })

  it('keeps Tab inside the dialog', async () => {
    state.isPaused.value = true
    const page = render()
    await page.vm.$nextTick()

    const first = page.get('.run__resume')
    const last = page.get('.run__menu')

    // Backwards off the first stop wraps to the last, rather than reaching the
    // pause control behind the scrim.
    await first.trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last.element)

    await last.trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(first.element)
  })
})

describe('the run-complete screen', () => {
  it('is mounted only when the run has ended', async () => {
    const page = render()
    expect(page.find('.run__complete').exists()).toBe(false)

    state.hasEnded.value = true
    await page.vm.$nextTick()

    expect(page.find('.run__complete').exists()).toBe(true)
  })

  it('replaces the sentence that told the player to leave and come back', () => {
    state.hasEnded.value = true
    const page = render()

    expect(page.find('.run__status--ended').exists()).toBe(false)
    expect(page.find('.run__replay').exists()).toBe(true)
  })

  it('is a modal dialog named by its own heading', () => {
    state.hasEnded.value = true
    const page = render()
    const dialog = page.get('[role="dialog"]')

    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.attributes('aria-labelledby'))
      .toBe(page.get('.run__complete .run__overlay-title').attributes('id'))
  })

  it('shows the score as played while it is being saved, and labels it so', async () => {
    const page = render()
    await flushPromises()
    session.phase = 'submitting'
    state.hasEnded.value = true
    state.score.value = 4210
    state.runPaws.value = 37
    await page.vm.$nextTick()

    expect(page.get('.run__final-score-value').text()).toBe('4210')
    expect(page.get('.run__final-score-label').text()).toBe('run.submit.playedScore')
    expect(page.get('.run__overlay-note').text()).toBe('run.submit.saving')
    // No paw gain and no verdict before the server has given one.
    expect(page.find('.run__final-paws').exists()).toBe(false)
    expect(page.find('.run__outcome').exists()).toBe(false)
  })

  it('shows the server\'s numbers once it has answered, not its own', async () => {
    const page = render()
    await flushPromises()
    session.outcome = runResult({ status: 'accepted', score: 4000, run_paws: 30 })
    session.phase = 'outcome'
    state.hasEnded.value = true
    state.score.value = 4210
    state.runPaws.value = 37
    await page.vm.$nextTick()

    expect(page.get('.run__final-score-value').text()).toBe('4000')
    expect(page.get('.run__final-score-label').text()).toBe('run.scoreLabel')
    expect(page.get('.run__final-paws').text()).toContain('run.complete.pawsGained(count=30)')
  })

  /*
   * The run total, not the Loli cycle counter.
   *
   * The HUD deliberately shows `cyclePaws` — progress toward the next bonus —
   * and those two numbers stop agreeing the moment the first bonus lands. The
   * summary is about the run, so it takes `runPaws`.
   */
  it('summarises the run total rather than the bonus cycle', async () => {
    const page = render()
    await flushPromises()
    session.outcome = runResult({ status: 'accepted', run_paws: 240 })
    session.phase = 'outcome'
    state.hasEnded.value = true
    state.runPaws.value = 240
    state.cyclePaws.value = 40
    await page.vm.$nextTick()

    expect(page.get('.run__final-paws').text()).toContain('count=240')
  })

  it('claims no record or best the server has not stated', async () => {
    const page = render()
    await flushPromises()
    session.phase = 'submitting'
    state.hasEnded.value = true
    state.score.value = 4210
    await page.vm.$nextTick()

    expect(page.find('.run__record').exists()).toBe(false)
    expect(page.find('.run__highscore').exists()).toBe(false)
    expect(page.text()).not.toContain('run.outcome.personalBest')
  })

  it('replays exactly once per activation — as a new server run', async () => {
    const page = render()
    await flushPromises()
    session.outcome = runResult({ status: 'accepted' })
    session.phase = 'outcome'
    state.hasEnded.value = true
    await page.vm.$nextTick()
    session.begin.mockClear()

    await page.get('.run__replay').trigger('click')

    expect(session.acknowledge).toHaveBeenCalledTimes(1)
    expect(session.begin).toHaveBeenCalledTimes(1)
    expect(state.restart).not.toHaveBeenCalled()
  })

  it('returns to the menu without restarting', async () => {
    state.hasEnded.value = true
    const page = render()

    await page.get('.run__menu').trigger('click')

    expect(navigateTo).toHaveBeenCalledWith('/')
    expect(state.restart).not.toHaveBeenCalled()
  })
})

describe('abandoning a run', () => {
  it('pauses rather than leaving, so the exit is a decision and not a slip', async () => {
    const page = render()

    await page.get('.run__exit').trigger('click')

    expect(state.togglePause).toHaveBeenCalledTimes(1)
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('still leaves directly when there is no run to lose', async () => {
    state.failed.value = true
    const page = render()

    await page.get('.run__exit').trigger('click')

    expect(navigateTo).toHaveBeenCalledWith('/')
    expect(state.togglePause).not.toHaveBeenCalled()
  })

  it('leaves directly from the pause screen, which is already the confirmation', async () => {
    state.isPaused.value = true
    const page = render()

    await page.get('.run__menu').trigger('click')

    expect(navigateTo).toHaveBeenCalledWith('/')
  })
})

describe('the server run (M9)', () => {
  it('mounts nothing until the server has started the run, then mounts its seed and cycle', async () => {
    let release: () => void = () => {}
    session.begin.mockImplementationOnce(async () => {
      session.phase = 'starting'
      await new Promise<void>((resolve) => {
        release = resolve
      })
      session.run = {
        run_id: '01999999-9999-7999-8999-999999999999',
        character_id: 'aysenur',
        seed: 4294967295,
        started_at: '2026-09-23T12:00:00.000Z',
        loli_cycle_paws: 199,
      }
      session.phase = 'ready'
      session.starts++
    })

    const page = render()
    await flushPromises()

    expect(session.begin).toHaveBeenCalledWith('aysenur')
    expect(state.start).not.toHaveBeenCalled()
    expect(page.get('.run__status').text()).toBe('run.start.starting')

    release()
    await flushPromises()

    expect(state.start).toHaveBeenCalledTimes(1)
    expect(state.start.mock.calls[0]?.[1]).toEqual({ seed: 4294967295, loliCyclePaws: 199 })
  })

  it('offers only a retry when the start fails — never a local run', async () => {
    session.begin.mockImplementationOnce(async () => {
      session.phase = 'start_failed'
      session.problemCode = 'client_network_error'
    })

    const page = render()
    await flushPromises()

    expect(state.start).not.toHaveBeenCalled()
    expect(page.text()).toContain('run.start.offline')

    await page.get('.run__start-retry').trigger('click')

    expect(session.begin).toHaveBeenCalledTimes(2)
  })

  it('says a resumed run is resumed, never fresh', async () => {
    session.begin.mockImplementationOnce(async () => {
      session.run = {
        run_id: '01999999-9999-7999-8999-999999999999',
        character_id: 'aysenur',
        seed: 1,
        started_at: '2026-09-23T12:00:00.000Z',
        loli_cycle_paws: 0,
      }
      session.resumed = true
      session.phase = 'ready'
      session.starts++
    })

    const page = render()
    await flushPromises()

    expect(page.get('.run__status--resumed').text()).toBe('run.start.resumed')
  })

  it('submits the summary once the run ends', async () => {
    const page = render()
    await flushPromises()

    state.summary.value = { score: 1234, runPaws: 12, elapsedMs: 45678.9 }
    await page.vm.$nextTick()

    expect(session.submit).toHaveBeenCalledTimes(1)
    expect(session.submit).toHaveBeenCalledWith({ score: 1234, runPaws: 12, elapsedMs: 45678.9 })
  })

  it.each([
    ['accepted', 'run.outcome.accepted(best=1000)'],
    ['flagged', 'run.outcome.flagged'],
    ['rejected', 'run.outcome.rejected'],
  ] as const)('tells the truth about a %s run', async (status, copy) => {
    const page = render()
    await flushPromises()
    session.outcome = runResult({
      status,
      score: status === 'rejected' ? null : 1000,
      run_paws: status === 'rejected' ? null : 50,
      reasons: status === 'accepted' ? [] : ['score_rate_high'],
    })
    session.phase = 'outcome'
    state.hasEnded.value = true
    await page.vm.$nextTick()

    expect(page.get('.run__outcome').text()).toBe(copy)

    if (status !== 'accepted') {
      expect(page.text()).toContain('run.reason.score_rate_high')
      // No gain is shown for a run that changed nothing.
      expect(page.find('.run__final-paws').exists()).toBe(false)
    }

    if (status === 'rejected') expect(page.find('.run__final-score').exists()).toBe(false)
  })

  it('announces a new personal best only when the server says so', async () => {
    const page = render()
    await flushPromises()
    session.outcome = runResult({ status: 'accepted', is_personal_best: true })
    session.phase = 'outcome'
    state.hasEnded.value = true
    await page.vm.$nextTick()

    expect(page.get('.run__outcome').text()).toBe('run.outcome.personalBest')
  })

  it('keeps an offline finish waiting with a retry, and blocks replay until it resolves', async () => {
    const page = render()
    await flushPromises()
    session.phase = 'retry_wait'
    state.hasEnded.value = true
    await page.vm.$nextTick()

    expect(page.text()).toContain('run.submit.retrying')
    expect(page.get('.run__replay').attributes('busy')).toBe('true')

    await page.get('.run__retry').trigger('click')

    expect(session.retryNow).toHaveBeenCalledTimes(1)
  })

  it('says so when the run could no longer be recorded', async () => {
    const page = render()
    await flushPromises()
    session.phase = 'closed'
    session.problemCode = 'run_not_active'
    state.hasEnded.value = true
    await page.vm.$nextTick()

    expect(page.get('.run__outcome').text()).toBe('run.outcome.closed')
  })
})
