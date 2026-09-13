import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BffError, bffRequest } from '~/composables/useBffClient'

/**
 * The BFF client as the **server** compiles it.
 *
 * Until M6 this module was client-only, and its module-scoped CSRF cache was
 * documented as safe *because* the server never reached it. The server reaches
 * it now, so the two properties that used to be true by construction have to be
 * true by test:
 *
 *  - it forwards **only** the visitor's `Cookie`, and
 *  - it never caches a CSRF token, because it never issues a request that
 *    would fetch one.
 *
 * `$fetch` is stubbed as a global with a `.raw` — which is also the shape the
 * real thing has on the server and, notably, the shape `useRequestFetch()` does
 * *not* have.
 */

interface RawCall { path: string, options: Record<string, unknown> }

let calls: RawCall[] = []
let plainCalls: RawCall[] = []
let rawResponse: { _data: unknown, headers: Headers }

function makeFetch() {
  const plain = vi.fn(async (path: string, options: Record<string, unknown> = {}) => {
    plainCalls.push({ path, options })

    return {}
  })

  return Object.assign(plain, {
    raw: vi.fn(async (path: string, options: Record<string, unknown> = {}) => {
      calls.push({ path, options })

      return rawResponse
    }),
  })
}

const appendHeader = vi.fn()

function ssr(cookie = '__Host-purrenade_session=abc') {
  return {
    headers: { cookie },
    event: { node: { res: { appendHeader } } },
  }
}

beforeEach(() => {
  calls = []
  plainCalls = []
  appendHeader.mockClear()
  rawResponse = { _data: { status: 'guest', user: null }, headers: new Headers() }

  vi.stubGlobal('$fetch', makeFetch())
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('a server-rendered call to the BFF', () => {
  it('forwards the visitor’s session cookie', async () => {
    await bffRequest('/api/auth/me', { ssr: ssr() })

    const headers = calls[0]?.options.headers as Record<string, string>

    expect(headers.cookie).toBe('__Host-purrenade_session=abc')
  })

  it('forwards nothing except the cookie', async () => {
    /*
     * The reason `useRequestFetch()` was not used. It forwards the whole
     * inbound header set minus a small deny-list, which means an inbound
     * `Authorization` reaches the BFF and an inbound `content-length` is
     * attached to a bodyless internal GET.
     */
    await bffRequest('/api/auth/me', { ssr: ssr() })

    expect(Object.keys(calls[0]?.options.headers as object)).toEqual(['cookie'])
  })

  it('gives up long before the upstream timeout', async () => {
    // This is time-to-first-byte now, not a background request. Without a
    // deadline a hung API turns every signed-in page render into a blank tab
    // for as long as `apiTimeoutMs` allows.
    await bffRequest('/api/auth/me', { ssr: ssr() })

    expect(calls[0]?.options.timeout).toBe(2_500)
  })

  it('carries a cookie the BFF set back out to the browser', async () => {
    /*
     * The internal call gets its own H3 event, so `destroySession`'s cookie
     * deletions would otherwise be dropped on the floor — the record really is
     * gone, but the browser keeps a pointer to nothing. Revocation has to
     * behave the same on both sides or it is not one mechanism.
     */
    const headers = new Headers()

    headers.append('set-cookie', '__Host-purrenade_session=; Max-Age=0; Path=/; Secure')
    headers.append('set-cookie', '__Host-purrenade_csrf=; Max-Age=0; Path=/; Secure')
    rawResponse = { _data: { status: 'guest', user: null }, headers }

    await bffRequest('/api/auth/me', { ssr: ssr() })

    expect(appendHeader).toHaveBeenCalledTimes(2)
    expect(appendHeader).toHaveBeenCalledWith('set-cookie', expect.stringContaining('__Host-purrenade_session='))
  })

  it('survives a render with no request event', async () => {
    await expect(bffRequest('/api/auth/me', { ssr: { headers: {}, event: null } })).resolves.toBeTruthy()
  })
})

describe('a server render never changes anything', () => {
  it('refuses a state-changing request outright', async () => {
    const attempt = bffRequest('/api/auth/logout', { method: 'POST', ssr: ssr() })

    await expect(attempt).rejects.toBeInstanceOf(BffError)
    await attempt.catch((error: BffError) => {
      expect(error.problem.code).toBe('ssr_mutation_refused')
    })
  })

  it('does not reach the network to refuse it', async () => {
    await bffRequest('/api/auth/logout', { method: 'POST', ssr: ssr() }).catch(() => {})

    expect(calls).toEqual([])
    expect(plainCalls).toEqual([])
  })

  it('never fetches — and so never caches — a CSRF token', async () => {
    /*
     * The whole argument for the module-scoped cache being safe on the server.
     * The only writer is `fetchCsrfToken`, reached only for a state-changing
     * method, and that path is refused above. Prove the fetch never happens
     * rather than asserting the cache is empty, which a getter could fake.
     */
    await bffRequest('/api/auth/password', { method: 'PUT', ssr: ssr() }).catch(() => {})

    expect(plainCalls.map(c => c.path)).not.toContain('/api/auth/csrf')
  })

  it('says so, so a refusal is not a silent no-op', async () => {
    await bffRequest('/api/auth/logout', { method: 'POST', ssr: ssr() }).catch(() => {})

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('refused a state-changing request'),
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
