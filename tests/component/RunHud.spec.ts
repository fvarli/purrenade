import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, useTemplateRef } from 'vue'
import RunPage from '~/pages/run.vue'
import { HEARTS, PROGRESS } from '~~/game/bridge'

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
    togglePause: vi.fn(),
    activateSlayyy: vi.fn(),
  }
}

type SurfaceState = ReturnType<typeof surfaceState>

let state: SurfaceState

function render() {
  return mount(RunPage, {
    attachTo: document.body,
    global: {
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
  const globals = globalThis as unknown as Record<string, unknown>
  globals.definePageMeta = () => {}
  globals.useHead = () => {}
  globals.useTemplateRef = useTemplateRef
  globals.useRunSurface = () => state
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the score', () => {
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
    const button = page.get('.run__chrome button')

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
