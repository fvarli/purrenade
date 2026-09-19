import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import BrandWordmark from '~/components/ui/BrandWordmark.vue'

describe('BrandWordmark', () => {
  it('exposes one accessible product name and keeps its decorative motif hidden', () => {
    const wrapper = mount(BrandWordmark)

    expect(wrapper.get('[role="img"]').attributes('aria-label')).toBe('Purrenade')
    expect(wrapper.get('.wordmark__motif').attributes('aria-hidden')).toBe('true')
    expect(wrapper.text()).toContain('PURRENADE')
  })
})
