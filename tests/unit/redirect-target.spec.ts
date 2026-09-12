import { describe, expect, it } from 'vitest'
import { resolveRedirectTarget as redirectTarget } from '~/utils/redirect'

/**
 * Open-redirect resistance on the login screen.
 *
 * Login honours a `redirect` query so a player who was sent to sign in lands
 * back where they were going. Taken at face value that is a phishing primitive:
 * `?redirect=https://evil.example` would send a *freshly authenticated* player
 * straight off-site, at the moment they are most likely to trust the page.
 *
 * The predicate lives in `app/utils/redirect.ts` and is imported by both the
 * page and this test, so the rule has exactly one definition. Re-declaring it
 * here would let the test keep passing after the page diverged.
 */

describe('an in-app path is honoured', () => {
  it('accepts a rooted path', () => {
    expect(redirectTarget('/account/security')).toBe('/account/security')
    expect(redirectTarget('/')).toBe('/')
    expect(redirectTarget('/admin?tab=accounts')).toBe('/admin?tab=accounts')
  })
})

describe('anything else falls back to the home page', () => {
  it('refuses an absolute URL', () => {
    for (const hostile of [
      'https://evil.example',
      'http://evil.example/login',
      '//evil.example',
      '//evil.example/account/security',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'about:blank',
    ]) {
      expect(redirectTarget(hostile), hostile).toBe('/')
    }
  })

  it('refuses a protocol-relative path, which looks rooted but is not', () => {
    // The case a naive `startsWith('/')` check lets through: `//evil.example`
    // begins with a slash and is a fully qualified URL to another host.
    expect(redirectTarget('//evil.example')).toBe('/')
    expect(redirectTarget('/\\evil.example')).toBe('/\\evil.example')
  })

  it('refuses a non-string, which is what a repeated query parameter produces', () => {
    expect(redirectTarget(undefined)).toBe('/')
    expect(redirectTarget(null)).toBe('/')
    expect(redirectTarget(['/a', '/b'])).toBe('/')
    expect(redirectTarget(42)).toBe('/')
  })

  it('refuses a relative path, which could escape the app root', () => {
    expect(redirectTarget('account/security')).toBe('/')
    expect(redirectTarget('../admin')).toBe('/')
  })
})
