import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCooldown } from '~/composables/useCooldown'

/**
 * The resend countdown (v0.3 board 04 renders `0:42`).
 *
 * The rule these tests hold: the countdown is **always seeded by the server**.
 * If the client assumed 42, it would drift from the server's actual refusal and
 * a player would be told "try now" and then refused.
 *
 * `onUnmounted` is a no-op outside a component instance, which is what makes
 * this composable testable without mounting anything.
 */

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useCooldown', () => {
  it('counts down and stops at zero', () => {
    const cooldown = useCooldown()

    cooldown.start(3)

    expect(cooldown.remaining.value).toBe(3)
    expect(cooldown.active.value).toBe(true)

    vi.advanceTimersByTime(3000)

    expect(cooldown.remaining.value).toBe(0)
    expect(cooldown.active.value).toBe(false)

    // Stopped, not merely at zero: a timer that keeps firing drives a render
    // loop for nothing.
    vi.advanceTimersByTime(5000)
    expect(cooldown.remaining.value).toBe(0)
  })

  it('formats as m:ss, matching the design', () => {
    const cooldown = useCooldown()

    cooldown.start(42)
    expect(cooldown.formatted.value).toBe('0:42')

    cooldown.start(9)
    expect(cooldown.formatted.value).toBe('0:09')

    cooldown.start(65)
    expect(cooldown.formatted.value).toBe('1:05')

    cooldown.start(600)
    expect(cooldown.formatted.value).toBe('10:00')
  })

  it('is inactive when the server says zero', () => {
    const cooldown = useCooldown()

    cooldown.start(0)

    expect(cooldown.active.value).toBe(false)
    expect(cooldown.formatted.value).toBe('0:00')
  })

  it('restarts from a fresh server value rather than accumulating', () => {
    // What happens when a resend is refused with `retry_after`: the countdown
    // is replaced, not added to.
    const cooldown = useCooldown()

    cooldown.start(30)
    vi.advanceTimersByTime(10_000)
    expect(cooldown.remaining.value).toBe(20)

    cooldown.start(42)
    expect(cooldown.remaining.value).toBe(42)

    vi.advanceTimersByTime(1000)
    expect(cooldown.remaining.value).toBe(41)
  })

  it('ignores a negative or fractional value', () => {
    const cooldown = useCooldown()

    cooldown.start(-5)
    expect(cooldown.remaining.value).toBe(0)

    cooldown.start(4.7)
    expect(cooldown.remaining.value).toBe(4)
  })
})
