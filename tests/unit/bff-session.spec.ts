import { describe, expect, it } from 'vitest'
import { csrfTokenMatches, newCsrfToken } from '~~/server/utils/session'

/**
 * The CSRF token comparison.
 *
 * The token is the actual control, not `SameSite` (ADR-0005 §2), so the two
 * properties tested here — real entropy and a constant-time comparison — are
 * what the control rests on.
 */

describe('newCsrfToken', () => {
  it('produces a high-entropy, URL-safe value', () => {
    const token = newCsrfToken()

    // 32 random bytes, base64url: 43 characters, no padding, no `+` or `/` to
    // be mangled in a header or a cookie.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('does not repeat', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newCsrfToken()))

    expect(tokens.size).toBe(200)
  })
})

describe('csrfTokenMatches', () => {
  it('accepts the expected token', () => {
    const token = newCsrfToken()

    expect(csrfTokenMatches(token, token)).toBe(true)
  })

  it('rejects a different token', () => {
    expect(csrfTokenMatches(newCsrfToken(), newCsrfToken())).toBe(false)
  })

  it('rejects a prefix rather than throwing', () => {
    // `timingSafeEqual` throws on mismatched lengths, so the length check has
    // to come first — and a truncated token must be a plain rejection, not a
    // 500 that hides which requests were refused.
    const token = newCsrfToken()

    expect(csrfTokenMatches(token.slice(0, 10), token)).toBe(false)
    expect(csrfTokenMatches('', token)).toBe(false)
    expect(csrfTokenMatches(token, '')).toBe(false)
  })
})
