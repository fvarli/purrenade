import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PasswordStrength from '~/components/auth/PasswordStrength.vue'

/**
 * The strength meter from v0.3 board 07.
 *
 * **Copy, not policy.** `docs/security/authentication.md` §2 is explicit, and
 * the test that matters most here is the last one: this component never blocks
 * anything, because the server decides — and it checks things no client
 * heuristic can know, such as whether the password appears in a breach corpus.
 */

function mountMeter(password: string) {
  return mount(PasswordStrength, { props: { password, minLength: 12 } })
}

function filled(wrapper: ReturnType<typeof mountMeter>): number {
  return wrapper.findAll('.strength__segment--filled').length
}

describe('rendering', () => {
  it('shows nothing for an empty field', () => {
    expect(mountMeter('').find('.strength').exists()).toBe(false)
  })

  it('scores length above variety', () => {
    // Length is the property that resists guessing. A short password with every
    // character class must not score above a long simple one.
    const shortComplex = mountMeter('Aa1!Aa1!')
    const longSimple = mountMeter('sahilde kosan kedi ayse')

    expect(filled(longSimple)).toBeGreaterThan(filled(shortComplex))
  })

  it('never claims strength below the server minimum', () => {
    // Saying "strong" about a password the server will refuse is a lie the
    // player acts on.
    for (const password of ['a', 'Aa1!Aa1!', 'elevenchar']) {
      expect(filled(mountMeter(password))).toBeLessThanOrEqual(1)
    }
  })

  it('rewards real length', () => {
    expect(filled(mountMeter('abcdefghijkl'))).toBeGreaterThanOrEqual(2)
    expect(filled(mountMeter('abcdefghijklmnopqr'))).toBeGreaterThanOrEqual(3)
  })

  it('announces the band politely', () => {
    const wrapper = mountMeter('sahilde kosan kedi ayse')
    const label = wrapper.find('.strength__label')

    // Polite, not assertive: a live region firing per keystroke makes a
    // password field unusable with a screen reader.
    expect(label.attributes('aria-live')).toBe('polite')
    expect(label.text()).toMatch(/^auth\.password\.strength\./)
  })

  it('hides the bar itself from assistive technology', () => {
    // The segments are decoration; the text label carries the meaning.
    expect(mountMeter('abcdefghijkl').find('.strength__track').attributes('aria-hidden'))
      .toBe('true')
  })
})

describe('what it never does', () => {
  it('renders no control, so it can block nothing', () => {
    const wrapper = mountMeter('abcdefghijkl')

    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.emitted()).toEqual({})
  })
})
