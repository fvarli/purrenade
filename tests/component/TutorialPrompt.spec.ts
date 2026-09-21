import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import TutorialPrompt from '~/components/run/TutorialPrompt.vue'
import tr from '~~/i18n/locales/tr.json'
import type { TutorialCorrection, TutorialLesson } from '~~/game/bridge'

/**
 * The lesson prompt.
 *
 * Two things are worth testing here and the rest is copy. **Does it ask for the
 * gesture the player can actually perform** — swipes on a phone, keys on a
 * keyboard — and **does it stay out of the way of the game**, which is the
 * requirement that makes this component not a dialog.
 *
 * `te` is backed by the real Turkish messages rather than the harness's
 * always-true stub, because this component *branches* on whether a key exists:
 * a lesson with a gesture pair renders the pair, and a lesson with prose renders
 * the prose. An always-true `te` would take the first branch every time and the
 * fallback would never be exercised.
 */

function has(path: string): boolean {
  return path.split('.').reduce<unknown>(
    (node, key) => (typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[key] : undefined),
    tr,
  ) !== undefined
}

function translate(key: string, values?: Record<string, unknown>): string {
  if (!values) return key

  return `${key}(${Object.entries(values).map(([n, v]) => `${n}=${String(v)}`).join(',')})`
}

function setCoarsePointer(coarse: boolean): void {
  // `vi.stubGlobal` rather than assignment: happy-dom defines `matchMedia` as a
  // prototype accessor, so a plain write lands on the instance and the component
  // keeps reading the original.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('coarse') && coarse,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
}

function render(props: Partial<{
  lesson: TutorialLesson
  index: number
  total: number
  correction: TutorialCorrection | null
  attempt: number
  busy: boolean
}> = {}) {
  return mount(TutorialPrompt, {
    props: {
      lesson: 'move_left',
      index: 1,
      total: 9,
      correction: null,
      attempt: 0,
      ...props,
    },
  })
}

beforeEach(() => {
  ;(globalThis as unknown as Record<string, unknown>).useI18n = () => ({
    t: translate,
    te: has,
    locale: ref('tr'),
    locales: ref([]),
    setLocale: () => {},
  })

  setCoarsePointer(false)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the prompt asks for the gesture the player actually has', () => {
  it('names keys on a pointer that hovers', () => {
    const wrapper = render({ lesson: 'move_left' })

    expect(wrapper.text()).toContain('tutorial.lesson.moveLeft.keyboard')
    expect(wrapper.text()).not.toContain('tutorial.lesson.moveLeft.touch')
  })

  it('names swipes on a coarse pointer', () => {
    setCoarsePointer(true)

    const wrapper = render({ lesson: 'move_left' })

    expect(wrapper.text()).toContain('tutorial.lesson.moveLeft.touch')
    expect(wrapper.text()).not.toContain('tutorial.lesson.moveLeft.keyboard')
  })

  it('falls back to prose for the lessons that describe rather than instruct', () => {
    // The greeting and the closing practice have no gesture to name, so a
    // `keyboard`/`touch` lookup would render a missing key as its own name.
    for (const lesson of ['intro', 'final_practice'] as const) {
      const wrapper = render({ lesson })

      expect(wrapper.text()).toContain(`.body`)
      expect(wrapper.text()).not.toContain('.keyboard')
    }
  })

  it('has a real message for every lesson and every correction, in Turkish', () => {
    // The source locale, checked here rather than trusted: a lesson the domain
    // can reach with no copy behind it renders its own key at the player.
    const lessons: TutorialLesson[] = [
      'intro', 'move_left', 'move_right', 'dodge_cone', 'jump_barrier',
      'collect_paw', 'activate_slayyy', 'final_practice',
    ]

    for (const lesson of lessons) {
      const key = lesson.replace(/_(\w)/g, (_m, c: string) => c.toUpperCase())

      expect(has(`tutorial.lesson.${key}.title`), `${lesson} title`).toBe(true)
      expect(
        has(`tutorial.lesson.${key}.keyboard`) || has(`tutorial.lesson.${key}.body`),
        `${lesson} instruction`,
      ).toBe(true)
    }

    const corrections: TutorialCorrection[] = [
      'no_input', 'jumped_at_cone', 'contacted_cone',
      'dodged_barrier', 'contacted_barrier', 'missed_paw',
    ]

    for (const correction of corrections) {
      const key = correction.replace(/_(\w)/g, (_m, c: string) => c.toUpperCase())

      expect(has(`tutorial.correction.${key}`), correction).toBe(true)
    }
  })
})

describe('corrections are guidance, not alarms', () => {
  it('shows the correction for what the player actually did', () => {
    const wrapper = render({ lesson: 'dodge_cone', correction: 'jumped_at_cone', attempt: 1 })

    expect(wrapper.text()).toContain('tutorial.correction.jumpedAtCone')
  })

  it('announces politely, so it does not interrupt a player mid-lesson', () => {
    const wrapper = render({ lesson: 'dodge_cone', correction: 'jumped_at_cone', attempt: 1 })
    const live = wrapper.findAll('[aria-live]')

    expect(live.length).toBeGreaterThan(0)
    // Nothing here is urgent, because nothing here can hurt the player.
    for (const node of live) expect(node.attributes('aria-live')).toBe('polite')
  })

  it('re-announces a repeated correction, because it is a second thing to hear', () => {
    const wrapper = render({ lesson: 'dodge_cone', correction: 'jumped_at_cone', attempt: 1 })
    const first = wrapper.find('.run__tutorial-correction').element

    // Keyed on the attempt: the same words twice are two events, and a live
    // region whose text did not change would announce only the first.
    return wrapper.setProps({ attempt: 2 }).then(() => {
      expect(wrapper.find('.run__tutorial-correction').element).not.toBe(first)
    })
  })

  it('shows nothing when there is nothing to correct', () => {
    expect(render().find('.run__tutorial-correction').exists()).toBe(false)
  })
})

describe('the prompt does not fight the game', () => {
  it('is not a dialog, and traps nothing', () => {
    const wrapper = render()

    // A scrim would stop swipes reaching the canvas and a focus trap would park
    // the keyboard on a button, where gameplay keys are suppressed — so the
    // prompt asking for ← would be the reason ← stopped working.
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.find('[aria-modal]').exists()).toBe(false)
  })

  it('offers exactly one control, and it is the restrained one', () => {
    const wrapper = render()
    const buttons = wrapper.findAll('button')

    expect(buttons).toHaveLength(1)
    expect(buttons[0]?.text()).toBe('tutorial.skip')
  })

  it('asks to skip when the skip control is used', async () => {
    const wrapper = render()

    await wrapper.find('.run__tutorial-skip').trigger('click')

    expect(wrapper.emitted('skip')).toHaveLength(1)
  })

  it('cannot be skipped twice while the first one is still saving', async () => {
    const wrapper = render({ busy: true })

    expect(wrapper.find<HTMLButtonElement>('.run__tutorial-skip').element.disabled).toBe(true)
  })
})

describe('progress is legible without counting', () => {
  it('draws one marker per lesson, with the live one marked', () => {
    const wrapper = render({ index: 3, total: 9 })

    expect(wrapper.findAll('.run__tutorial-dot')).toHaveLength(9)
    expect(wrapper.findAll('.run__tutorial-dot--done')).toHaveLength(3)
    expect(wrapper.findAll('.run__tutorial-dot--live')).toHaveLength(1)
  })

  it('still says the number, for anyone who cannot see the markers', () => {
    const wrapper = render({ index: 3, total: 9 })

    expect(wrapper.text()).toContain('tutorial.progress(step=4,total=9)')
    expect(wrapper.find('.run__tutorial-dots').attributes('aria-label')).toBe('tutorial.progressLabel')
  })
})
