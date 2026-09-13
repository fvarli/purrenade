import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '~/stores/auth'
import type { AuthUser, MeResponse } from '~/types/auth'

/**
 * The auth store as the **server** compiles it.
 *
 * Everything here turns on `import.meta.server`, which is folded away at build
 * time — so these assertions are unreachable from the `unit` project no matter
 * how it stubs. The `unit-ssr` project compiles the same modules with the
 * constant set the other way; see the comment in `vitest.config.ts`.
 *
 * The rule under test: **`unknown` means "we could not find out", `guest` means
 * "there is no session", and only the browser may reach the second.** Getting
 * that backwards is not a cosmetic bug — the client only bootstraps from
 * `unknown`, so a server that concludes `guest` strands a signed-in visitor in
 * guest UI for the life of the page, with nothing left to retry.
 */

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
    created_at: '2026-01-01T00:00:00+00:00',
    session: {
      id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      device: 'Chrome on Linux',
      two_factor_satisfied: false,
      created_at: '2026-01-01T00:00:00+00:00',
    },
    ...overrides,
  }
}

let meResponse: MeResponse | (() => never)
let meCalls: unknown[] = []

beforeEach(() => {
  setActivePinia(createPinia())

  meCalls = []
  meResponse = { status: 'guest', user: null }

  vi.stubGlobal('invalidateCsrfToken', vi.fn())
  vi.stubGlobal('useBffClient', () => ({
    me: async (ssr?: unknown) => {
      meCalls.push(ssr)

      if (typeof meResponse === 'function') return meResponse()

      return meResponse
    },
  }))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('resolving the session during a server render', () => {
  it('reports a signed-in visitor from the projection', async () => {
    meResponse = { status: 'authenticated', user: user(), email_verification: null }

    const auth = useAuthStore()

    await auth.bootstrap({ headers: { cookie: '__Host-purrenade_session=abc' } })

    expect(auth.status).toBe('authenticated')
    expect(auth.user?.display_name).toBe('Aysenur')
  })

  it('passes the captured request context through to the BFF call', async () => {
    const auth = useAuthStore()
    const ssr = { headers: { cookie: '__Host-purrenade_session=abc' } }

    await auth.bootstrap(ssr)

    // Without this the render asks the BFF who *nobody* is, gets `guest`, and
    // server-renders a signed-out page to a signed-in player — the original bug
    // wearing a different hat.
    expect(meCalls).toEqual([ssr])
  })
})

describe('a server render that cannot reach the BFF', () => {
  beforeEach(() => {
    meResponse = () => { throw new Error('The request did not reach the server.') }
  })

  it('leaves the status unknown rather than concluding guest', async () => {
    const auth = useAuthStore()

    await auth.bootstrap({ headers: {} })

    expect(auth.status).toBe('unknown')
    expect(auth.isGuest).toBe(false)
    expect(auth.user).toBeNull()
  })

  it('says so, once, with the reason', async () => {
    // Degraded availability has to be observable, or it is indistinguishable
    // from a visitor who really is signed out.
    const auth = useAuthStore()

    await auth.bootstrap({ headers: {} })

    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(vi.mocked(console.warn).mock.calls[0]?.[0]).toContain('SSR session bootstrap failed')
  })

  it('does not wipe a state that was already resolved', async () => {
    const auth = useAuthStore()

    auth.setUser(user())
    expect(auth.status).toBe('authenticated')

    auth.status = 'unknown'
    await auth.bootstrap({ headers: {} })

    expect(auth.user?.display_name, 'a failed retry must not discard what we knew').toBe('Aysenur')
  })

  it('releases the loading flag, so the client can retry', async () => {
    // The early `return` sits inside a `try`, so it runs `finally`. If it ever
    // stops doing so, `bootstrap()` becomes a one-shot and the client's retry
    // silently does nothing.
    const auth = useAuthStore()

    await auth.bootstrap({ headers: {} })

    expect(auth.loading).toBe(false)
  })
})

describe('an authoritative answer is still honoured on the server', () => {
  it('accepts a real guest', async () => {
    // The failure branch must not swallow a successful "there is no session".
    meResponse = { status: 'guest', user: null }

    const auth = useAuthStore()

    await auth.bootstrap({ headers: {} })

    expect(auth.status).toBe('guest')
    expect(auth.isGuest).toBe(true)
  })
})
