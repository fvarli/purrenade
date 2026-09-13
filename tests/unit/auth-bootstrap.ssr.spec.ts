import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '~/stores/auth'

/**
 * The bootstrap middleware as the **server** compiles it.
 *
 * This file exists because of a specific hole. The defect it guards was one
 * line — `if (import.meta.server) return` — and the entire existing middleware
 * suite could not see it: `import.meta.server` is folded away at build time, so
 * in the `unit` project that line is a no-op and every guard test passes with or
 * without it. The suite was green for the whole of M6 while the server rendered
 * every page as "we do not know who this is".
 *
 * Compiled with the constant the other way, the same line is load-bearing.
 */

const navigations: unknown[] = []

async function loadBootstrap() {
  vi.resetModules()

  const module = await import('~/middleware/auth-bootstrap.global.ts')

  return module.default as (to: unknown) => Promise<void>
}

let forwarded: Record<string, string>

beforeEach(() => {
  setActivePinia(createPinia())
  navigations.length = 0
  forwarded = { cookie: '__Host-purrenade_session=abc' }

  vi.stubGlobal('defineNuxtRouteMiddleware', (handler: unknown) => handler)
  vi.stubGlobal('navigateTo', (target: unknown) => { navigations.push(target) })
  vi.stubGlobal('useAuthStore', useAuthStore)
  vi.stubGlobal('invalidateCsrfToken', () => {})
  vi.stubGlobal('useRequestHeaders', () => forwarded)
  vi.stubGlobal('useRequestEvent', () => ({ node: { res: { appendHeader: () => {} } } }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('resolving the visitor during a server render', () => {
  it('asks who the visitor is, rather than assuming nobody', async () => {
    const auth = useAuthStore()
    const bootstrap = vi.spyOn(auth, 'bootstrap').mockResolvedValue()

    await (await loadBootstrap())({ fullPath: '/' })

    expect(bootstrap, 'the render must resolve the session, not skip it').toHaveBeenCalledTimes(1)
  })

  it('hands down the visitor’s own cookie', async () => {
    /*
     * The captured header is the whole mechanism. Without it the render asks
     * the BFF who *nobody* is and gets an authoritative `guest`, which is worse
     * than not asking: it is a wrong answer with a right shape.
     */
    const auth = useAuthStore()
    const bootstrap = vi.spyOn(auth, 'bootstrap').mockResolvedValue()

    await (await loadBootstrap())({ fullPath: '/' })

    expect(bootstrap).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { cookie: '__Host-purrenade_session=abc' } }),
    )
  })

  it('captures the request context in the middleware, where it exists', async () => {
    // `useRequestHeaders`/`useRequestEvent` only work inside a Nuxt context.
    // Reaching for them deeper in the call chain fails with NUXT_E1001, no
    // cookie is forwarded, and the page renders signed-out — the original bug
    // with a different cause.
    const seen: string[] = []

    vi.stubGlobal('useRequestHeaders', () => { seen.push('headers'); return forwarded })

    const auth = useAuthStore()
    vi.spyOn(auth, 'bootstrap').mockResolvedValue()

    await (await loadBootstrap())({ fullPath: '/' })

    expect(seen).toEqual(['headers'])
  })

  it('does not ask twice when the answer is already in hand', async () => {
    const auth = useAuthStore()

    auth.status = 'guest'

    const bootstrap = vi.spyOn(auth, 'bootstrap').mockResolvedValue()

    await (await loadBootstrap())({ fullPath: '/' })

    expect(bootstrap).not.toHaveBeenCalled()
  })
})
