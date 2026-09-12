import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import LocaleSwitcher from '~/components/ui/LocaleSwitcher.vue'

/**
 * Türkçe / English / Español on the login screen (v0.3 board 03).
 *
 * The load-bearing fact: it appears **before a session exists**, so locale has
 * to work without one.
 */

describe('the switcher', () => {
  it('offers the three approved locales', () => {
    const wrapper = mount(LocaleSwitcher)
    const options = wrapper.findAll('button')

    expect(options.map(option => option.text())).toEqual(['Türkçe', 'English', 'Español'])
  })

  it('is a labelled group of real buttons', () => {
    const wrapper = mount(LocaleSwitcher)

    // A group, so a screen reader announces what the three options are for.
    expect(wrapper.attributes('role')).toBe('group')
    expect(wrapper.attributes('aria-label')).toBe('common.language')

    for (const option of wrapper.findAll('button')) {
      expect(option.attributes('type')).toBe('button')
    }
  })

  it('announces the active locale as pressed', () => {
    const wrapper = mount(LocaleSwitcher)
    const options = wrapper.findAll('button')

    // Looking different is not enough: the current choice must be announced.
    expect(options[0]?.attributes('aria-pressed')).toBe('true')
    expect(options[1]?.attributes('aria-pressed')).toBe('false')
    expect(options[2]?.attributes('aria-pressed')).toBe('false')
  })
})
