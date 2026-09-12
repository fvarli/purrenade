import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AuthNotice from '~/components/ui/AuthNotice.vue'

/**
 * Form-level messages.
 *
 * A form that fails and shows a message without telling assistive technology
 * is, to a screen-reader user, a form that did nothing. That is the single most
 * common accessibility defect in authentication flows, so the announcement
 * behaviour is what these tests hold.
 */

describe('announcement', () => {
  it('interrupts for an error', () => {
    const wrapper = mount(AuthNotice, {
      props: { variant: 'error' },
      slots: { default: 'That code is not correct.' },
    })

    expect(wrapper.attributes('role')).toBe('alert')
    expect(wrapper.attributes('aria-live')).toBe('assertive')
  })

  it('waits for a pause otherwise', () => {
    for (const variant of ['info', 'success'] as const) {
      const wrapper = mount(AuthNotice, { props: { variant }, slots: { default: 'Done.' } })

      expect(wrapper.attributes('role')).toBe('status')
      expect(wrapper.attributes('aria-live')).toBe('polite')
    }
  })
})

describe('meaning', () => {
  it('carries a glyph, so it never rests on colour alone', () => {
    const glyphs = { info: 'ℹ', error: '⚠', success: '✓' } as const

    for (const [variant, glyph] of Object.entries(glyphs)) {
      const wrapper = mount(AuthNotice, {
        props: { variant: variant as keyof typeof glyphs },
        slots: { default: 'Message.' },
      })

      expect(wrapper.text()).toContain(glyph)
    }
  })

  it('hides the glyph from assistive technology, which reads the text', () => {
    const wrapper = mount(AuthNotice, {
      props: { variant: 'error' },
      slots: { default: 'Message.' },
    })

    expect(wrapper.find('[aria-hidden="true"]').text()).toBe('⚠')
  })
})
