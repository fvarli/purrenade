import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import OtpInput from '~/components/ui/OtpInput.vue'

/**
 * The six-digit code entry (v0.3 boards 04 and 05).
 *
 * Six boxes is what the design shows, but the usability of that pattern lives
 * entirely in the details tested here. Get them wrong and it is worse than one
 * plain input — a `maxlength="1"` box without paste handling silently discards
 * five of the six characters a player pasted out of an email.
 */

function mountOtp(modelValue = '') {
  return mount(OtpInput, {
    props: { modelValue, label: 'Verification code' },
  })
}

describe('structure', () => {
  it('renders six numeric boxes', () => {
    const wrapper = mountOtp()
    const boxes = wrapper.findAll('input')

    expect(boxes).toHaveLength(6)

    for (const box of boxes) {
      // A number pad on mobile, and the platform offered a code it has seen.
      expect(box.attributes('inputmode')).toBe('numeric')
      expect(box.attributes('autocomplete')).toBe('one-time-code')
    }
  })

  it('labels the group once, not each box', () => {
    const wrapper = mountOtp()
    const group = wrapper.find('[role="group"]')

    // Otherwise a screen reader announces six unlabelled boxes instead of one
    // field called "verification code".
    expect(group.exists()).toBe(true)
    expect(group.attributes('aria-labelledby')).toBeTruthy()

    const labelId = group.attributes('aria-labelledby')
    expect(wrapper.find(`#${labelId}`).text()).toBe('Verification code')
  })

  it('gives each box a positional label', () => {
    const wrapper = mountOtp()

    expect(wrapper.findAll('input')[0]?.attributes('aria-label'))
      .toBe('auth.otp.digit(position=1,total=6)')
    expect(wrapper.findAll('input')[5]?.attributes('aria-label'))
      .toBe('auth.otp.digit(position=6,total=6)')
  })

  it('spreads the model across the boxes', () => {
    const wrapper = mountOtp('123456')
    const values = wrapper.findAll('input').map(box => (box.element as HTMLInputElement).value)

    expect(values).toEqual(['1', '2', '3', '4', '5', '6'])
  })
})

describe('typing', () => {
  it('emits one digit at a time', async () => {
    const wrapper = mountOtp()
    const first = wrapper.findAll('input')[0]!

    await first.setValue('7')

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['7'])
  })

  it('rejects non-digits rather than storing them', async () => {
    const wrapper = mountOtp()
    const first = wrapper.findAll('input')[0]!

    await first.setValue('a')

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([''])
    // And the box is cleared, so what is on screen matches what is stored.
    expect((first.element as HTMLInputElement).value).toBe('')
  })

  it('announces completion once six digits are present', async () => {
    const wrapper = mountOtp('12345')

    await wrapper.findAll('input')[5]!.setValue('6')

    expect(wrapper.emitted('complete')).toEqual([['123456']])
  })

  it('does not announce completion early', async () => {
    const wrapper = mountOtp('1234')

    await wrapper.findAll('input')[4]!.setValue('5')

    expect(wrapper.emitted('complete')).toBeUndefined()
  })
})

describe('paste', () => {
  it('fills every box from one paste', async () => {
    // Codes arrive in an email and are pasted. This is the case a naive
    // implementation silently breaks.
    const wrapper = mountOtp()

    await wrapper.findAll('input')[0]!.trigger('paste', {
      clipboardData: { getData: () => '123456' },
    })

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['123456'])
    expect(wrapper.emitted('complete')).toEqual([['123456']])
  })

  it('strips separators and extra characters from a pasted code', async () => {
    const wrapper = mountOtp()

    await wrapper.findAll('input')[0]!.trigger('paste', {
      clipboardData: { getData: () => 'Your code is 123 456.' },
    })

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['123456'])
  })

  it('ignores a paste with no digits', async () => {
    const wrapper = mountOtp()

    await wrapper.findAll('input')[0]!.trigger('paste', {
      clipboardData: { getData: () => 'no digits here' },
    })

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('handles a multi-character value arriving in one box', async () => {
    // What a platform autofill does: drops the whole code into the focused box.
    const wrapper = mountOtp()

    await wrapper.findAll('input')[0]!.setValue('654321')

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['654321'])
  })
})

describe('correcting a mistake', () => {
  it('moves back on backspace from an empty box', async () => {
    const wrapper = mountOtp('12')
    const third = wrapper.findAll('input')[2]!

    await third.trigger('keydown', { key: 'Backspace' })

    // Without this, fixing a typo needs the mouse.
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['1'])
  })

  it('leaves a filled box to the browser on backspace', async () => {
    const wrapper = mountOtp('123')

    await wrapper.findAll('input')[2]!.trigger('keydown', { key: 'Backspace' })

    // The native behaviour clears the character; intercepting it here would
    // delete two.
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('does not move back from the first box', async () => {
    const wrapper = mountOtp('')

    await wrapper.findAll('input')[0]!.trigger('keydown', { key: 'Backspace' })

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

describe('errors', () => {
  it('associates and announces the message', async () => {
    const wrapper = mount(OtpInput, {
      props: { modelValue: '', label: 'Code', error: 'That code is not correct.' },
    })

    const group = wrapper.find('[role="group"]')
    const errorId = group.attributes('aria-describedby')

    expect(errorId).toBeTruthy()

    const error = wrapper.find(`#${errorId}`)

    // Associated, announced, and carrying a glyph — so the message is not
    // conveyed by colour alone.
    expect(error.attributes('role')).toBe('alert')
    expect(error.attributes('aria-live')).toBe('polite')
    expect(error.text()).toContain('That code is not correct.')
    expect(error.text()).toContain('⚠')

    for (const box of wrapper.findAll('input')) {
      expect(box.attributes('aria-invalid')).toBe('true')
    }
  })

  it('reports valid when there is no error', () => {
    const wrapper = mountOtp()

    for (const box of wrapper.findAll('input')) {
      expect(box.attributes('aria-invalid')).toBe('false')
    }
  })
})
