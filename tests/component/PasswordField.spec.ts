import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PasswordField from '~/components/ui/PasswordField.vue'

/**
 * The show/hide toggle (v0.3 board 03: "göster").
 */

function mountPassword(props: Record<string, unknown> = {}) {
  return mount(PasswordField, {
    props: { id: 'password', label: 'Password', modelValue: '', ...props },
  })
}

describe('the toggle', () => {
  it('is a real button that cannot submit the form', () => {
    const toggle = mountPassword().find('button')

    // `type="button"` is load-bearing: without it, pressing Enter in the
    // password field submits through the toggle instead of the form — a bug
    // that only appears for keyboard users.
    expect(toggle.attributes('type')).toBe('button')
  })

  it('starts hidden and flips the input type', async () => {
    const wrapper = mountPassword()

    expect(wrapper.find('input').attributes('type')).toBe('password')

    await wrapper.find('button').trigger('click')
    expect(wrapper.find('input').attributes('type')).toBe('text')

    await wrapper.find('button').trigger('click')
    expect(wrapper.find('input').attributes('type')).toBe('password')
  })

  it('announces its state, not just its icon', async () => {
    const wrapper = mountPassword()
    const toggle = wrapper.find('button')

    // "The eye icon" tells a screen-reader user nothing about whether the
    // password is currently visible.
    expect(toggle.attributes('aria-pressed')).toBe('false')
    expect(toggle.text()).toBe('auth.password.show')

    await toggle.trigger('click')

    expect(wrapper.find('button').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('button').text()).toBe('auth.password.hide')
  })

  it('is disabled with the field', () => {
    expect(mountPassword({ disabled: true }).find('button').attributes('disabled')).toBeDefined()
  })
})

describe('accessibility', () => {
  it('binds the label and the error', () => {
    const wrapper = mountPassword({ error: 'Too short.' })

    expect(wrapper.find('label').attributes('for')).toBe('password')
    expect(wrapper.find('input').attributes('aria-invalid')).toBe('true')
    expect(wrapper.find('input').attributes('aria-describedby')).toBe('password-error')
    expect(wrapper.find('#password-error').attributes('role')).toBe('alert')
  })

  it('defaults autocomplete to the current password, and allows an override', () => {
    expect(mountPassword().find('input').attributes('autocomplete')).toBe('current-password')
    expect(mountPassword({ autocomplete: 'new-password' }).find('input').attributes('autocomplete'))
      .toBe('new-password')
  })
})

describe('value', () => {
  it('emits what was typed', async () => {
    const wrapper = mountPassword()

    await wrapper.find('input').setValue('sahilde-kosan-kedi')

    expect(wrapper.emitted('update:modelValue')).toEqual([['sahilde-kosan-kedi']])
  })
})
