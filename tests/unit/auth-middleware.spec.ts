import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '~/stores/auth'
import { resolveRedirectTarget } from '~/utils/redirect'
import type { AuthUser } from '~/types/auth'

/**
 * Route guards.
 *
 * Tested as **UX**, which is all they are. `docs/product/screen-inventory.md`
 * §3: no screen's presence or absence is a security control, and every call
 * these screens make is authorized by Laravel regardless. What is worth testing
 * is that each state is sent somewhere *useful* — an unverified account to
 * verification rather than to a denial, an unenrolled admin to enrolment rather
 * than to a 403.
 *
 * `defineNuxtRouteMiddleware` and `navigateTo` are stubbed, so the middleware
 * modules can be imported and called directly.
 */

const navigations: Array<string | Record<string, unknown>> = []

function stubNuxtGlobals(): void {
  navigations.length = 0

  vi.stubGlobal('defineNuxtRouteMiddleware', (handler: unknown) => handler)
  vi.stubGlobal('navigateTo', (target: string | Record<string, unknown>) => {
    navigations.push(target)

    return target
  })
  vi.stubGlobal('useAuthStore', useAuthStore)

  // The store drops the cached CSRF token whenever it clears state. Nothing in
  // a guard depends on that, but `reset()` is how a test sets up a guest.
  vi.stubGlobal('invalidateCsrfToken', () => {})

  // Only reached on the server; stubbed so the module evaluates in Node.
  vi.stubGlobal('useRequestHeaders', () => ({}))
  vi.stubGlobal('useRequestEvent', () => null)
  /*
   * The *real* predicate, not a re-implementation.
   *
   * Stubbing a second copy here would mean the off-site cases below tested the
   * stub — they would keep passing after `resolveRedirectTarget` itself
   * regressed, which is the exact failure the shared module was extracted to
   * prevent.
   */
  vi.stubGlobal('resolveRedirectTarget', resolveRedirectTarget)
}

/** Load a guard fresh, so the stubs are in place when its module evaluates. */
async function loadMiddleware(name: string) {
  vi.resetModules()

  const module = await import(`~/middleware/${name}.ts`)

  return module.default as (to: { fullPath: string, query: Record<string, unknown> }) => unknown
}

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 1,
    display_name: 'Aysenur',
    email: 'ayse@example.test',
    role: 'player',
    email_verified: true,
    email_verified_at: '2026-01-01T00:00:00+00:00',
    two_factor_enabled: false,
    two_factor_pending: false,
    two_factor_recovery_codes_remaining: 0,
    requires_two_factor_enrolment: false,
    created_at: null,
    session: { id: 'a', device: 'Chrome on Linux', two_factor_satisfied: false, created_at: null },
    ...overrides,
  }
}

// `query` is part of a real route object, and `guest` now reads it. Widening
// the fixture is the right fix: a guard should not have to defend itself
// against a malformed route.
const route = { fullPath: '/account/security', query: {} as Record<string, unknown> }

beforeEach(() => {
  setActivePinia(createPinia())
  stubNuxtGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('guest guard', () => {
  it('lets a guest through', async () => {
    const auth = useAuthStore()
    auth.reset()

    const guard = await loadMiddleware('guest')
    guard(route)

    expect(navigations).toEqual([])
  })

  it('sends a pending challenge to the challenge screen', async () => {
    const auth = useAuthStore()
    auth.setTwoFactorRequired('2026-01-01T00:05:00+00:00', false)

    const guard = await loadMiddleware('guest')
    guard(route)

    // Not the home page: a half-authenticated visitor stranded there can
    // neither finish nor start over.
    expect(navigations).toEqual(['/auth/two-factor'])
  })

  it('sends an unverified account to verification', async () => {
    const auth = useAuthStore()
    auth.setUser(user({ email_verified: false }))

    const guard = await loadMiddleware('guest')
    guard(route)

    expect(navigations).toEqual(['/auth/verify-email'])
  })

  it('sends a signed-in player home', async () => {
    const auth = useAuthStore()
    auth.setUser(user())

    const guard = await loadMiddleware('guest')
    guard(route)

    expect(navigations).toEqual(['/'])
  })
})

describe('the guest guard honours where the visitor was going', () => {
  /*
   * Reached when a signed-in visitor lands on a guest-only screen carrying a
   * destination — which is exactly what happens on the degraded path: SSR could
   * not resolve the session, `verified` sent them to login with the page they
   * wanted in the query, and the browser then found the session after all.
   * Sending them to `/` there loses the destination and makes an availability
   * blip look like a broken link.
   */
  it('sends them to the page they were sent to sign in for', async () => {
    const auth = useAuthStore()
    auth.setUser(user())

    const guard = await loadMiddleware('guest')
    guard({ fullPath: '/auth/login', query: { redirect: '/account/security' } })

    expect(navigations).toEqual(['/account/security'])
  })

  it('still refuses an off-site destination', async () => {
    // The same audited predicate the login form uses. A second copy of a
    // security check is a second thing to get wrong, so this asserts the reuse.
    const auth = useAuthStore()
    auth.setUser(user())

    const guard = await loadMiddleware('guest')
    guard({ fullPath: '/auth/login', query: { redirect: 'https://evil.example' } })

    expect(navigations).toEqual(['/'])
  })

  it('still refuses a protocol-relative destination', async () => {
    const auth = useAuthStore()
    auth.setUser(user())

    const guard = await loadMiddleware('guest')
    guard({ fullPath: '/auth/login', query: { redirect: '//evil.example' } })

    expect(navigations).toEqual(['/'])
  })

  it('falls back to the home page when there is no destination', async () => {
    const auth = useAuthStore()
    auth.setUser(user())

    const guard = await loadMiddleware('guest')
    guard(route)

    expect(navigations).toEqual(['/'])
  })
})

describe('the bootstrap middleware', () => {
  /*
   * The middleware that resolves who the visitor is before any guard runs. It
   * used to return early during SSR, which left every guard above deciding
   * against `status === 'unknown'` on the server.
   *
   * Note what this project *cannot* assert: `import.meta.server` is folded away
   * at build time, so the server branch is unreachable here by construction.
   * That is precisely why the original defect survived a green suite, and why
   * the `unit-ssr` project exists.
   */
  it('asks who the visitor is when nothing is known yet', async () => {
    const auth = useAuthStore()
    auth.reset()
    auth.status = 'unknown'

    const bootstrap = vi.spyOn(auth, 'bootstrap').mockResolvedValue()
    const middleware = await loadMiddleware('auth-bootstrap.global')

    await middleware(route)

    expect(bootstrap).toHaveBeenCalledTimes(1)
  })

  it('does not ask again once the answer is in hand', async () => {
    // On the client this is what stops a second `/api/auth/me` after the server
    // already resolved one into the payload.
    const auth = useAuthStore()
    auth.setUser(user())

    const bootstrap = vi.spyOn(auth, 'bootstrap').mockResolvedValue()
    const middleware = await loadMiddleware('auth-bootstrap.global')

    await middleware(route)

    expect(bootstrap).not.toHaveBeenCalled()
  })
})

describe('verified guard', () => {
  it('lets a verified player through', async () => {
    const auth = useAuthStore()
    auth.setUser(user())

    const guard = await loadMiddleware('verified')
    guard(route)

    expect(navigations).toEqual([])
  })

  it('sends a guest to login, preserving where they were going', async () => {
    const auth = useAuthStore()
    auth.reset()

    const guard = await loadMiddleware('verified')
    guard(route)

    // The intent is preserved rather than the player being deposited on the
    // home page and made to navigate again.
    expect(navigations).toEqual([
      { path: '/auth/login', query: { redirect: '/account/security' } },
    ])
  })

  it('sends an unverified account to verification', async () => {
    const auth = useAuthStore()
    auth.setUser(user({ email_verified: false }))

    const guard = await loadMiddleware('verified')
    guard(route)

    expect(navigations).toEqual(['/auth/verify-email'])
  })
})

describe('auth guard', () => {
  it('allows an unverified account, because verification is what it guards', async () => {
    const auth = useAuthStore()
    auth.setUser(user({ email_verified: false }))

    const guard = await loadMiddleware('auth')
    guard(route)

    expect(navigations).toEqual([])
  })
})

describe('admin guard', () => {
  it('admits a fully authenticated administrator', async () => {
    const auth = useAuthStore()
    auth.setUser(user({
      role: 'admin',
      two_factor_enabled: true,
      session: { id: 'a', device: 'x', two_factor_satisfied: true, created_at: null },
    }))

    const guard = await loadMiddleware('admin')
    guard({ fullPath: '/admin' })

    expect(navigations).toEqual([])
  })

  it('sends a player home rather than showing a denial', async () => {
    const auth = useAuthStore()
    auth.setUser(user())

    const guard = await loadMiddleware('admin')
    guard({ fullPath: '/admin' })

    expect(navigations).toEqual(['/'])
  })

  it('sends an unenrolled administrator to enrol, with a reason', async () => {
    const auth = useAuthStore()
    auth.setUser(user({ role: 'admin', requires_two_factor_enrolment: true }))

    const guard = await loadMiddleware('admin')
    guard({ fullPath: '/admin' })

    // The useful response to "your role needs 2FA" is "set it up", not
    // "forbidden" — and the query is what lets the target screen say why.
    expect(navigations).toEqual([
      { path: '/account/security', query: { enrol: 'required' } },
    ])
  })

  it('sends an enrolled administrator with an unchallenged session back to login', async () => {
    const auth = useAuthStore()
    auth.setUser(user({
      role: 'admin',
      two_factor_enabled: true,
      session: { id: 'a', device: 'x', two_factor_satisfied: false, created_at: null },
    }))

    const guard = await loadMiddleware('admin')
    guard({ fullPath: '/admin' })

    // No endpoint upgrades an existing session, so signing in again is the
    // only route to a session that carries the second factor.
    expect(navigations).toEqual([
      { path: '/auth/login', query: { reason: 'two_factor_required' } },
    ])
  })

  it('sends an unverified administrator to verification first', async () => {
    const auth = useAuthStore()
    auth.setUser(user({ role: 'admin', email_verified: false, two_factor_enabled: true }))

    const guard = await loadMiddleware('admin')
    guard({ fullPath: '/admin' })

    expect(navigations).toEqual(['/auth/verify-email'])
  })
})
