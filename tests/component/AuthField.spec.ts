import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AuthField from '~/components/ui/AuthField.vue'

/**
 * The accessibility wiring every form field depends on.
 *
 * These are the requirements in `accessibility.md`, asserted once here so no
 * screen has to remember them — and so removing one is a test failure rather
 * than a defect somebody discovers with a screen reader.
 */

function mountField(props: Record<string, unknown> = {}) {
  return mount(AuthField, {
    props: { id: 'email', label: 'Email', modelValue: '', ...props },
  })
}

describe('labelling', () => {
  it('binds a real label to the input', () => {
    const wrapper = mountField()

    // A placeholder is not a label: it disappears the moment somebody starts
    // typing, and it is not reliably announced.
    expect(wrapper.find('label').attributes('for')).toBe('email')
    expect(wrapper.find('input').attributes('id')).toBe('email')
    expect(wrapper.find('label').text()).toContain('Email')
  })

  it('marks an optional field as such', () => {
    const wrapper = mountField({ required: false })

    expect(wrapper.find('label').text()).toContain('common.optional')
    expect(wrapper.find('input').attributes('required')).toBeUndefined()
  })
})

describe('hints and errors', () => {
  it('associates a hint with aria-describedby', () => {
    const wrapper = mountField({ hint: 'We will verify this.' })

    expect(wrapper.find('input').attributes('aria-describedby')).toBe('email-hint')
    expect(wrapper.find('#email-hint').text()).toBe('We will verify this.')
  })

  it('associates the error too, and marks the input invalid', () => {
    const wrapper = mountField({ error: 'That address is taken.' })
    const input = wrapper.find('input')

    // Associated, not merely nearby: a message that sits next to a field
    // without being bound to it is not announced when the field is focused.
    expect(input.attributes('aria-invalid')).toBe('true')
    expect(input.attributes('aria-describedby')).toBe('email-error')
    expect(wrapper.find('#email-error').text()).toContain('That address is taken.')
  })

  it('describes both a hint and an error at once', () => {
    const wrapper = mountField({ hint: 'Hint.', error: 'Error.' })

    expect(wrapper.find('input').attributes('aria-describedby')).toBe('email-hint email-error')
  })

  it('keeps the live region in the DOM before it has content', () => {
    const wrapper = mountField()
    const region = wrapper.find('#email-error')

    // A region inserted at the same moment as its text is frequently missed by
    // screen readers, so it exists from the start and is filled later.
    expect(region.exists()).toBe(true)
    expect(region.attributes('role')).toBe('alert')
    expect(region.attributes('aria-live')).toBe('polite')
    expect(region.text()).toBe('')
  })

  it('reports valid when there is no error', () => {
    expect(mountField().find('input').attributes('aria-invalid')).toBe('false')
    expect(mountField().find('input').attributes('aria-describedby')).toBeUndefined()
  })

  it('carries a glyph as well as colour', () => {
    const wrapper = mountField({ error: 'Nope.' })

    // Colour is never the only signal.
    expect(wrapper.find('#email-error').text()).toContain('⚠')
  })
})

describe('input plumbing', () => {
  it('passes autocomplete through, so a password manager can work', () => {
    const wrapper = mountField({ autocomplete: 'email', inputmode: 'email' })

    expect(wrapper.find('input').attributes('autocomplete')).toBe('email')
    expect(wrapper.find('input').attributes('inputmode')).toBe('email')
  })

  it('emits the typed value', async () => {
    const wrapper = mountField()

    await wrapper.find('input').setValue('ayse@example.test')

    expect(wrapper.emitted('update:modelValue')).toEqual([['ayse@example.test']])
  })

  it('respects the disabled state', () => {
    expect(mountField({ disabled: true }).find('input').attributes('disabled')).toBeDefined()
  })
})
