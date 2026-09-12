import { toApiProblem } from './useApiProblem'
import type { ApiProblem } from './useApiProblem'

/**
 * The browser's one door to the BFF.
 *
 * `api-client.md` §2 requires the transport to sit behind a **single swappable
 * module**: one place attaches credentials, one place handles the CSRF token,
 * one place normalises errors. No component or store calls `$fetch` directly.
 *
 * What this module is responsible for:
 *
 *  - **The CSRF token.** Fetched once, cached, and attached to every
 *    state-changing request as a header. A header is the load-bearing detail: a
 *    cross-site form can make the browser send cookies, but it cannot set one.
 *
 *  - **Refreshing it exactly once.** The BFF rotates the session — and with it
 *    the token — on every privilege change, so a token cached across a login is
 *    stale by design. A `419` triggers one silent refresh and one retry; a
 *    second failure is surfaced, because retrying further would be a loop.
 *
 *  - **Normalising failures**, so callers receive an `ApiProblem` and never a
 *    raw `FetchError`.
 *
 * What it deliberately does **not** do: hold a token, a password, or any auth
 * material. The browser's only credential is the `HttpOnly` cookie it cannot
 * read, and nothing here writes to `localStorage` or `sessionStorage`.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD'])
const CSRF_HEADER = 'X-CSRF-Token'
const CSRF_MISMATCH_STATUS = 419

/**
 * Module-scoped cache, read and written only in the browser.
 *
 * Safe because it never holds a credential: the CSRF token grants nothing
 * without the session cookie. `state-management.md` §6 forbids module-level
 * singletons that could leak one request's state into another's response — that
 * rule is about *server* state, and this module's cache is only ever populated
 * on the client.
 */
let csrfToken: string | null = null

export interface BffRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: Record<string, unknown>
}

export class BffError extends Error {
  constructor(public readonly problem: ApiProblem) {
    super(problem.detail)
    this.name = 'BffError'
  }
}

async function fetchCsrfToken(): Promise<string> {
  const response = await $fetch<{ csrf_token: string }>('/api/auth/csrf')

  csrfToken = response.csrf_token

  return csrfToken
}

/** Drop the cached token. Called after anything that rotates the session. */
export function invalidateCsrfToken(): void {
  csrfToken = null
}

/**
 * Call the BFF.
 *
 * @throws BffError carrying an `ApiProblem`, for every failure.
 */
export async function bffRequest<T>(
  path: string,
  options: BffRequestOptions = {},
): Promise<T> {
  const method = options.method ?? 'GET'
  const needsCsrf = !SAFE_METHODS.has(method)

  async function attempt(): Promise<T> {
    const headers: Record<string, string> = {}

    if (needsCsrf) {
      headers[CSRF_HEADER] = csrfToken ?? (await fetchCsrfToken())
    }

    // `as T`, and the one cast in this module. `$fetch` wraps its return in
    // `TypedInternalResponse`, which resolves a literal route path against
    // Nitro's generated route types — useful at a call site, meaningless in a
    // generic pass-through where the path is a variable. The caller's `T` is
    // the real contract, and it is stated by the named helpers below rather
    // than by each component.
    return await $fetch<T>(path, {
      method,
      headers,
      body: options.body,
      // Errors are thrown and converted below, so a caller never has to
      // distinguish "failed" from "returned something that means failed".
      retry: 0,
    }) as T
  }

  try {
    return await attempt()
  }
  catch (error) {
    const problem = toApiProblem(error)

    // One silent retry, and only for a stale token on a state-changing
    // request. The session rotates on login, on a passed challenge and on a
    // password change, so a cached token going stale is expected rather than
    // exceptional — but a second failure is a real one and is surfaced.
    if (needsCsrf && problem.status === CSRF_MISMATCH_STATUS) {
      invalidateCsrfToken()

      try {
        return await attempt()
      }
      catch (retryError) {
        throw new BffError(toApiProblem(retryError))
      }
    }

    throw new BffError(problem)
  }
}

/**
 * Endpoint helpers.
 *
 * Named functions rather than a generic `call(path)`, so the set of things the
 * browser can ask for is visible in one place and a component cannot invent a
 * path.
 */
export function useBffClient() {
  return {
    csrf: () => fetchCsrfToken(),

    me: () => bffRequest<import('~/types/auth').MeResponse>('/api/auth/me'),

    register: (body: {
      display_name: string
      email: string
      password: string
      password_confirmation: string
    }) => bffRequest<{ status: 'authenticated', user: import('~/types/auth').AuthUser, email_verification: import('~/types/auth').EmailVerificationState | null }>(
      '/api/auth/register',
      { method: 'POST', body },
    ),

    login: (body: { email: string, password: string }) =>
      bffRequest<
        | { status: 'authenticated', user: import('~/types/auth').AuthUser }
        | { status: 'two_factor_required', challenge_expires_at: string, recovery_codes_available: boolean }
      >('/api/auth/login', { method: 'POST', body }),

    completeTwoFactorChallenge: (body: { code?: string, recovery_code?: string }) =>
      bffRequest<{
        status: 'authenticated'
        user: import('~/types/auth').AuthUser
        used_recovery_code: boolean
        recovery_codes_remaining: number
      }>('/api/auth/2fa/challenge', { method: 'POST', body }),

    logout: () => bffRequest<{ status: 'signed_out' }>('/api/auth/logout', { method: 'POST' }),

    verifyEmail: (body: { code: string }) =>
      bffRequest<{ user: import('~/types/auth').AuthUser }>('/api/auth/email/verify', { method: 'POST', body }),

    resendVerification: () =>
      bffRequest<import('~/types/auth').EmailVerificationState>('/api/auth/email/resend', { method: 'POST' }),

    forgotPassword: (body: { email: string }) =>
      bffRequest<{ status: 'accepted' }>('/api/auth/password/forgot', { method: 'POST', body }),

    resetPassword: (body: {
      token: string
      email: string
      password: string
      password_confirmation: string
    }) => bffRequest<{ status: 'password_reset' }>('/api/auth/password/reset', { method: 'POST', body }),

    changePassword: (body: {
      current_password: string
      password: string
      password_confirmation: string
    }) => bffRequest<{ status: 'password_changed' }>('/api/auth/password', { method: 'PUT', body }),

    twoFactorState: () =>
      bffRequest<import('~/types/auth').TwoFactorStateResponse>('/api/auth/2fa'),

    beginTwoFactorEnrolment: (body: { current_password: string }) =>
      bffRequest<import('~/types/auth').TwoFactorEnrolmentResponse>('/api/auth/2fa/enable', { method: 'POST', body }),

    confirmTwoFactorEnrolment: (body: { code: string }) =>
      bffRequest<{ user: import('~/types/auth').AuthUser, recovery_codes: string[] }>(
        '/api/auth/2fa/confirm',
        { method: 'POST', body },
      ),

    regenerateRecoveryCodes: (body: { current_password: string }) =>
      bffRequest<{ recovery_codes: string[] }>('/api/auth/2fa/recovery-codes', { method: 'POST', body }),

    disableTwoFactor: (body: { current_password: string }) =>
      bffRequest<{ status: 'two_factor_disabled' }>('/api/auth/2fa/disable', { method: 'POST', body }),

    sessions: () =>
      bffRequest<{ sessions: import('~/types/auth').AuthSession[] }>('/api/auth/sessions'),

    revokeSession: (id: string) =>
      bffRequest<{ status: 'session_revoked', was_current: boolean }>(
        `/api/auth/sessions/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      ),

    revokeOtherSessions: (body: { current_password: string }) =>
      bffRequest<{ revoked_count: number }>('/api/auth/sessions', { method: 'DELETE', body }),

    updateDisplayName: (body: { display_name: string }) =>
      bffRequest<{ user: import('~/types/auth').AuthUser }>('/api/auth/profile', { method: 'PATCH', body }),

    adminOverview: () =>
      bffRequest<{
        administrator: { id: number, display_name: string }
        accounts: { total: number, verified: number, administrators: number, with_two_factor: number }
        capabilities: { available: string[], planned_milestone: string }
      }>('/api/admin/overview'),
  }
}
