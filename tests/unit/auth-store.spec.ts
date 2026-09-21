import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '~/stores/auth'
import type { AuthUser, MeResponse } from '~/types/auth'

/**
 * The authentication state machine.
 *
 * The rule under test throughout: **the status is derived from the server's
 * facts, never received**. A state name sent by the server would be one the
 * client had to trust; here every transition is computed from `email_verified`,
 * `requires_two_factor_enrolment` and the session's `two_factor_satisfied`.
 *
 * The store reaches `useBffClient` and `invalidateCsrfToken` through Nuxt
 * auto-imports, so they are stubbed as globals. Stubbing them explicitly also
 * documents exactly what this store depends on.
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
    tutorial_completed: false,
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

const invalidateCsrfToken = vi.fn()
let meResponse: MeResponse | (() => never)

beforeEach(() => {
  setActivePinia(createPinia())

  invalidateCsrfToken.mockClear()
  meResponse = { status: 'guest', user: null }

  vi.stubGlobal('invalidateCsrfToken', invalidateCsrfToken)
  vi.stubGlobal('useBffClient', () => ({
    me: async () => {
      if (typeof meResponse === 'function') return meResponse()

      return meResponse
    },
    logout: async () => ({ status: 'signed_out' as const }),
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('initial state', () => {
  it('starts unknown, not guest', () => {
    const auth = useAuthStore()

    // The distinction earns its place: rendering a login screen to somebody who
    // turns out to be signed in is a visible flash on every page load, and a
    // guard that cannot tell the two apart produces it.
    expect(auth.status).toBe('unknown')
    expect(auth.isGuest).toBe(false)
    expect(auth.isSignedIn).toBe(false)
  })
})

describe('bootstrap', () => {
  it('resolves a guest', async () => {
    const auth = useAuthStore()

    await auth.bootstrap()

    expect(auth.status).toBe('guest')
    expect(auth.user).toBeNull()
  })

  it('resolves a verified player', async () => {
    meResponse = { status: 'authenticated', user: user() }

    const auth = useAuthStore()
    await auth.bootstrap()

    expect(auth.status).toBe('authenticated')
    expect(auth.isVerified).toBe(true)
    expect(auth.user?.display_name).toBe('Aysenur')
  })

  it('resolves an unverified player', async () => {
    meResponse = {
      status: 'authenticated',
      user: user({ email_verified: false, email_verified_at: null }),
      email_verification: { resend_available_in: 30 },
    }

    const auth = useAuthStore()
    await auth.bootstrap()

    expect(auth.status).toBe('unverified')
    expect(auth.isSignedIn).toBe(true)
    expect(auth.isVerified).toBe(false)
    expect(auth.needsEmailVerification).toBe(true)
    expect(auth.emailVerification?.resend_available_in).toBe(30)
  })

  it('resolves a pending two-factor challenge without a user', async () => {
    meResponse = {
      status: 'two_factor_required',
      user: null,
      challenge_expires_at: '2026-01-01T00:05:00+00:00',
      recovery_codes_available: true,
    }

    const auth = useAuthStore()
    await auth.bootstrap()

    expect(auth.status).toBe('two_factor_required')
    expect(auth.needsTwoFactorChallenge).toBe(true)

    // Not authenticated: no credential exists yet.
    expect(auth.isSignedIn).toBe(false)
    expect(auth.user).toBeNull()
    expect(auth.recoveryCodesAvailable).toBe(true)
  })

  it('falls back to guest when the BFF cannot be reached', async () => {
    meResponse = () => {
      throw new Error('network down')
    }

    const auth = useAuthStore()
    await auth.bootstrap()

    // A network problem on first paint must not blank the application, and
    // guessing "guest" is safe in a way guessing "signed in" would not be —
    // every protected action is authorized server-side regardless.
    expect(auth.status).toBe('guest')
  })

  it('does not run twice concurrently', async () => {
    let calls = 0

    vi.stubGlobal('useBffClient', () => ({
      me: async () => {
        calls += 1

        return { status: 'guest', user: null } satisfies MeResponse
      },
      logout: async () => ({ status: 'signed_out' as const }),
    }))

    const auth = useAuthStore()

    await Promise.all([auth.bootstrap(), auth.bootstrap(), auth.bootstrap()])

    expect(calls).toBe(1)
  })
})

describe('admin state', () => {
  it('flags an administrator who has not enrolled', () => {
    const auth = useAuthStore()

    auth.setUser(user({ role: 'admin', requires_two_factor_enrolment: true }))

    // A real, reachable state: an operator can promote a player who has no
    // second factor. Represented rather than collapsed into `authenticated`,
    // where the admin surface would 403 with no explanation.
    expect(auth.status).toBe('admin_two_factor_setup_required')
    expect(auth.needsAdminTwoFactorSetup).toBe(true)
    expect(auth.canUseAdminSurface).toBe(false)
    expect(auth.isVerified).toBe(true)
  })

  it('refuses the admin surface to a session that never passed a challenge', () => {
    const auth = useAuthStore()

    auth.setUser(user({
      role: 'admin',
      two_factor_enabled: true,
      session: {
        id: 'a',
        device: 'Chrome on Linux',
        two_factor_satisfied: false,
        created_at: null,
      },
    }))

    // The account has 2FA; this *session* does not carry it. That distinction
    // is the one the server's admin gate rests on.
    expect(auth.status).toBe('authenticated')
    expect(auth.isAdmin).toBe(true)
    expect(auth.canUseAdminSurface).toBe(false)
  })

  it('admits a fully authenticated administrator', () => {
    const auth = useAuthStore()

    auth.setUser(user({
      role: 'admin',
      two_factor_enabled: true,
      session: {
        id: 'a',
        device: 'Chrome on Linux',
        two_factor_satisfied: true,
        created_at: null,
      },
    }))

    expect(auth.canUseAdminSurface).toBe(true)
  })

  it('refuses the admin surface to a player, however well authenticated', () => {
    const auth = useAuthStore()

    auth.setUser(user({
      two_factor_enabled: true,
      session: { id: 'a', device: 'x', two_factor_satisfied: true, created_at: null },
    }))

    expect(auth.canUseAdminSurface).toBe(false)
  })
})

describe('transitions', () => {
  it('drops the user and the CSRF token when a challenge begins', () => {
    const auth = useAuthStore()

    auth.setUser(user())
    auth.setTwoFactorRequired('2026-01-01T00:05:00+00:00', false)

    expect(auth.user).toBeNull()
    expect(auth.status).toBe('two_factor_required')

    // The session rotated upstream, so a cached CSRF token is stale by design.
    expect(invalidateCsrfToken).toHaveBeenCalled()
  })

  it('clears everything on reset', () => {
    const auth = useAuthStore()

    auth.setUser(user())
    auth.setEmailVerification({ resend_available_in: 42 })
    auth.reset()

    expect(auth.user).toBeNull()
    expect(auth.status).toBe('guest')
    expect(auth.emailVerification).toBeNull()
    expect(invalidateCsrfToken).toHaveBeenCalled()
  })

  it('clears state even when the sign-out call fails', async () => {
    vi.stubGlobal('useBffClient', () => ({
      me: async () => ({ status: 'guest', user: null } satisfies MeResponse),
      logout: async () => {
        throw new Error('upstream down')
      },
    }))

    const auth = useAuthStore()
    auth.setUser(user())

    await expect(auth.signOut()).rejects.toThrow()

    // A browser left looking signed in after the player pressed the button
    // would be a lie about state that no longer exists.
    expect(auth.user).toBeNull()
    expect(auth.status).toBe('guest')
  })
})

describe('what is never stored', () => {
  it('holds exactly the documented state keys and nothing else', async () => {
    meResponse = {
      status: 'authenticated',
      user: user(),
      email_verification: { resend_available_in: 10 },
    }

    const auth = useAuthStore()
    await auth.bootstrap()

    // An exact key list, so a new field cannot be added to auth state without
    // a test failing and forcing a decision about whether it belongs in a
    // browser. A substring scan would not do: the *count* of remaining
    // recovery codes is legitimate state, and its name contains
    // "recovery_code".
    expect(Object.keys(auth.$state).sort()).toEqual([
      'challengeExpiresAt',
      'emailVerification',
      'loading',
      'recoveryCodesAvailable',
      'status',
      'user',
    ])
  })

  it('holds no credential-shaped value', async () => {
    meResponse = { status: 'authenticated', user: user() }

    const auth = useAuthStore()
    await auth.bootstrap()

    // Every string in the state, checked against the shapes a credential in
    // this system actually has: a Sanctum token (`id|prrn_…`), the 64-character
    // challenge token, and a recovery code (`xxxxxxxxxx-xxxxxxxxxx`). Shapes
    // rather than field names, because the risk is a *value* arriving in a
    // field that sounds innocent.
    const strings: string[] = []

    const collect = (value: unknown): void => {
      if (typeof value === 'string') strings.push(value)
      else if (Array.isArray(value)) value.forEach(collect)
      else if (value && typeof value === 'object') Object.values(value).forEach(collect)
    }

    collect(auth.$state)

    expect(strings.length).toBeGreaterThan(0)

    for (const value of strings) {
      expect(value).not.toMatch(/^\d+\|prrn_/)
      expect(value).not.toMatch(/^[A-Za-z0-9]{64}$/)
      expect(value).not.toMatch(/^[A-Za-z0-9]{10}-[A-Za-z0-9]{10}$/)
    }
  })

  it('writes nothing to web storage', async () => {
    // Asserted rather than assumed: a persistence plugin is a one-line change
    // that would put auth state somewhere an XSS defect can read, and ADR-0005
    // exists precisely to keep credentials out of script-readable storage.
    //
    // Checked by watching the storage APIs rather than by inspecting store
    // options, because that catches *any* route to storage — a plugin, a
    // watcher, or a stray line in a component.
    const writes: string[] = []
    const fakeStorage = {
      setItem: (key: string) => writes.push(key),
      getItem: () => null,
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    }

    vi.stubGlobal('localStorage', fakeStorage)
    vi.stubGlobal('sessionStorage', fakeStorage)

    meResponse = { status: 'authenticated', user: user() }

    const auth = useAuthStore()

    await auth.bootstrap()
    auth.setTwoFactorRequired('2026-01-01T00:05:00+00:00', true)
    auth.reset()

    expect(writes).toEqual([])
  })
})

/**
 * Tutorial completion, as the store sees it.
 *
 * The store is a **mirror** of a server fact here, never its owner. The two
 * cases worth pinning are the default direction when the field is absent, and
 * that nothing writes it to browser storage — the completion decides whether a
 * tutorial is mandatory, so a value the browser could set would be authority in
 * the wrong place.
 */
describe('tutorial completion', () => {
  it('is false for a player who has not been through it', async () => {
    meResponse = { status: 'authenticated', user: user({ tutorial_completed: false }) }

    const auth = useAuthStore()
    await auth.bootstrap()

    expect(auth.tutorialCompleted).toBe(false)
  })

  it('is true once the server says so', async () => {
    meResponse = { status: 'authenticated', user: user({ tutorial_completed: true }) }

    const auth = useAuthStore()
    await auth.bootstrap()

    expect(auth.tutorialCompleted).toBe(true)
  })

  it('defaults to teaching when the field never arrives', async () => {
    /*
     * The safe direction, and the reason it is `=== true` rather than truthy.
     * An unknown answer costs the player a minute of tutorial; the other
     * default would silently skip first-run teaching for everybody the moment
     * the field failed to arrive.
     */
    const incomplete = user()

    delete (incomplete as Partial<AuthUser>).tutorial_completed

    meResponse = { status: 'authenticated', user: incomplete }

    const auth = useAuthStore()
    await auth.bootstrap()

    expect(auth.tutorialCompleted).toBe(false)
  })

  it('is false when nobody is signed in', () => {
    expect(useAuthStore().tutorialCompleted).toBe(false)
  })

  it('mirrors a completion the server has already accepted', async () => {
    meResponse = { status: 'authenticated', user: user({ tutorial_completed: false }) }

    const auth = useAuthStore()
    await auth.bootstrap()

    auth.markTutorialCompleted()

    expect(auth.tutorialCompleted).toBe(true)
    // Nothing else about the account moved.
    expect(auth.user?.display_name).toBe('Aysenur')
    expect(auth.status).toBe('authenticated')
  })

  it('does nothing when there is no user to mark', () => {
    const auth = useAuthStore()

    expect(() => auth.markTutorialCompleted()).not.toThrow()
    expect(auth.user).toBeNull()
  })

  it('writes no completion to web storage', async () => {
    /*
     * Watched at the storage APIs, like the general case above, because this is
     * the field with the strongest temptation to mirror: it decides whether the
     * tutorial is mandatory, and a device mirror would be tempting precisely
     * because it would survive a failed request. It must not exist — the server
     * is the authority, and a browser-writable copy would be authority in the
     * wrong place.
     */
    const writes: string[] = []
    const fakeStorage = {
      setItem: (key: string) => writes.push(key),
      getItem: () => null,
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    }

    vi.stubGlobal('localStorage', fakeStorage)
    vi.stubGlobal('sessionStorage', fakeStorage)

    meResponse = { status: 'authenticated', user: user({ tutorial_completed: false }) }

    const auth = useAuthStore()

    await auth.bootstrap()
    auth.markTutorialCompleted()

    expect(writes).toEqual([])
  })
})
