import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '~/stores/auth'
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
}

/** Load a guard fresh, so the stubs are in place when its module evaluates. */
async function loadMiddleware(name: string) {
  vi.resetModules()

  const module = await import(`~/middleware/${name}.ts`)

  return module.default as (to: { fullPath: string }) => unknown
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

const route = { fullPath: '/account/security' }

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
