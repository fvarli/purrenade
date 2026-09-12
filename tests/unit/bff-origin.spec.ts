import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The origin allow-list, against near-matches.
 *
 * This check silently stopped being an allow-list. `nuxt.config.ts` builds an
 * array by splitting `NUXT_TRUSTED_ORIGINS`, but `trustedOrigins` is runtime
 * config and Nitro re-applies the environment at boot — and its `applyEnv`
 * treats an array as a scalar, so with the variable set the array was replaced
 * by the raw unsplit string. `allowed.includes(origin)` then resolved to
 * `String.prototype.includes`: substring containment.
 *
 * The live server accepted `https://purrenade.tes` and `https://purrenade`.
 * Nothing threw, so nothing said so, and a document-shaped gate could not have
 * seen it. Hence these: both configuration shapes, and every near-match worth
 * naming.
 */

let headers: Record<string, string>
let configured: string | string[]

vi.mock('h3', () => ({
  getRequestHeader: (_event: unknown, name: string) => headers[name.toLowerCase()],
  getRequestURL: () => new URL('https://purrenade.test/api/auth/login'),
  readBody: async () => ({}),
}))

vi.mock('~~/server/utils/session', () => ({
  csrfTokenMatches: () => true,
  readSession: async () => null,
  touchSession: async () => undefined,
}))

beforeEach(() => {
  headers = {}
  configured = ['https://purrenade.test']

  ;(globalThis as Record<string, unknown>).useRuntimeConfig = () => ({
    get trustedOrigins() {
      return configured
    },
  })
})

async function requireTrustedOrigin(origin: string | undefined, method = 'POST'): Promise<'allowed' | 'rejected'> {
  const { requireTrustedOrigin: guard } = await import('~~/server/utils/guard')

  if (origin !== undefined) headers.origin = origin

  try {
    guard({ method } as never)
    return 'allowed'
  }
  catch {
    return 'rejected'
  }
}

describe('requireTrustedOrigin', () => {
  it('allows the configured origin', async () => {
    await expect(requireTrustedOrigin('https://purrenade.test')).resolves.toBe('allowed')
  })

  it.each([
    ['a truncated host', 'https://purrenade.tes'],
    ['a bare label', 'https://purrenade'],
    ['a suffixed host', 'https://purrenade.test.evil.example'],
    ['a prefixed host', 'https://evilpurrenade.test'],
    ['userinfo pointing elsewhere', 'https://purrenade.test@evil.example'],
    ['a different scheme', 'http://purrenade.test'],
    ['a different port', 'https://purrenade.test:8443'],
    ['a bare hostname', 'purrenade.test'],
    ['an unrelated origin', 'https://evil.example'],
    ['an empty value', ''],
    ['a non-URL', 'not a url at all'],
    ['a data URL', 'data:text/html,<script>1</script>'],
    ['the literal null origin', 'null'],
  ])('rejects %s', async (_label, origin) => {
    await expect(requireTrustedOrigin(origin)).resolves.toBe('rejected')
  })

  it('rejects a request with no Origin and no Referer', async () => {
    await expect(requireTrustedOrigin(undefined)).resolves.toBe('rejected')
  })

  it('accepts a canonically equivalent spelling', async () => {
    // A trailing slash and an uppercase host parse to the same origin. Browsers
    // send neither, but rejecting a value that *is* the allowed origin would be
    // wrong for the reason the substring match was wrong: the comparison should
    // be about origins, not about strings.
    await expect(requireTrustedOrigin('https://purrenade.test/')).resolves.toBe('allowed')
    await expect(requireTrustedOrigin('HTTPS://PURRENADE.TEST')).resolves.toBe('allowed')
  })

  it('holds when the configuration arrives as an unsplit string', async () => {
    // Exactly what Nitro hands the running server whenever the environment
    // variable is set. This is the shape the defect lived in.
    configured = 'https://purrenade.test'

    await expect(requireTrustedOrigin('https://purrenade.test')).resolves.toBe('allowed')
    await expect(requireTrustedOrigin('https://purrenade.tes')).resolves.toBe('rejected')
  })

  it('holds for a multi-origin list in either shape', async () => {
    // The production case, and where substring matching would have become
    // genuinely exploitable — a fragment spanning the comma was a valid match.
    for (const shape of [
      ['https://purrenade.com', 'https://www.purrenade.com'],
      'https://purrenade.com,https://www.purrenade.com',
    ]) {
      configured = shape

      await expect(requireTrustedOrigin('https://purrenade.com')).resolves.toBe('allowed')
      await expect(requireTrustedOrigin('https://www.purrenade.com')).resolves.toBe('allowed')
      await expect(requireTrustedOrigin('https://purrenade.co')).resolves.toBe('rejected')
      await expect(requireTrustedOrigin('https://www.purrenade.co')).resolves.toBe('rejected')
      await expect(requireTrustedOrigin('https://purrenade.com,https')).resolves.toBe('rejected')
    }
  })

  it('falls back to the Referer origin when Origin is absent', async () => {
    // Firefox omits Origin on some same-origin requests.
    const { requireTrustedOrigin: guard } = await import('~~/server/utils/guard')

    headers.referer = 'https://purrenade.test/auth/login?next=/account'

    expect(() => guard({ method: 'POST' } as never)).not.toThrow()
  })

  it('reads only the origin component of the Referer', async () => {
    const { requireTrustedOrigin: guard } = await import('~~/server/utils/guard')

    headers.referer = 'https://evil.example/pretending?x=https://purrenade.test'

    expect(() => guard({ method: 'POST' } as never)).toThrow()
  })

  it.each(['GET', 'HEAD', 'OPTIONS'])('does not apply to %s', async (method) => {
    await expect(requireTrustedOrigin('https://evil.example', method)).resolves.toBe('allowed')
  })
})

describe('requireSameSiteRequest', () => {
  it('rejects a request the browser labelled cross-site', async () => {
    const { requireSameSiteRequest } = await import('~~/server/utils/guard')

    headers['sec-fetch-site'] = 'cross-site'

    expect(() => requireSameSiteRequest({ method: 'GET' } as never)).toThrow()
  })

  it.each(['same-origin', 'same-site', 'none'])('allows %s', async (site) => {
    const { requireSameSiteRequest } = await import('~~/server/utils/guard')

    headers['sec-fetch-site'] = site

    expect(() => requireSameSiteRequest({ method: 'GET' } as never)).not.toThrow()
  })

  it('allows a caller that sends no fetch metadata at all', async () => {
    // curl, an older browser, a monitor. Not an authentication boundary — and
    // anything willing to omit the header is equally willing to forge it.
    const { requireSameSiteRequest } = await import('~~/server/utils/guard')

    expect(() => requireSameSiteRequest({ method: 'GET' } as never)).not.toThrow()
  })
})
