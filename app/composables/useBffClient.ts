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
 * How long a server-rendered page waits for the BFF before giving up.
 *
 * Much shorter than `apiTimeoutMs`, and deliberately so. That bound protects the
 * *process* from an upstream that never answers, and ten seconds of it is an
 * acceptable cost to a background request nobody is watching. This is
 * time-to-first-byte: the visitor is looking at a blank tab, and every signed-in
 * page render now waits behind it.
 *
 * Missing the deadline is not fatal. `bootstrap()` leaves the status `unknown`
 * and the browser asks again, so a slow API degrades the page's *auth state*
 * rather than the page.
 */
const SSR_BOOTSTRAP_TIMEOUT_MS = 2_500

/**
 * Module-scoped cache, read and written only in the browser.
 *
 * It never holds a credential — the CSRF token grants nothing without the
 * session cookie — but `state-management.md` §6 forbids module-level singletons
 * that could carry one request's state into another's response, and on the
 * server this module is one.
 *
 * That rule used to be satisfied by a comment asserting this file was never
 * reached during SSR. It is reached during SSR now, so the rule is *enforced*
 * instead, in two independent places: `rememberCsrfToken` refuses to write on
 * the server, and `bffRequest` refuses to issue a state-changing request there
 * at all — so the only code path that could produce a token is unreachable.
 */
let csrfToken: string | null = null

/** Cache a token, but never on the server. See the note above. */
function rememberCsrfToken(value: string): void {
  if (import.meta.server) return

  csrfToken = value
}

export interface BffRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: Record<string, unknown>
  /** Server-render context, captured by the caller. See `SsrCall`. */
  ssr?: SsrCall
}

/**
 * What a server-rendered call needs, captured where it can be.
 *
 * `useRequestHeaders` and `useRequestEvent` read the Nuxt instance, and that is
 * only reachable from a plugin, a Nuxt hook, route middleware or a `setup()`.
 * A Pinia action three frames down is none of those: calling them there fails
 * with `NUXT_E1001` and no cookie is forwarded, which looks exactly like a
 * signed-out visitor. So the caller captures them while it still can and hands
 * them down.
 *
 * The response object is typed structurally rather than as h3's `H3Event`, so
 * nothing here imports h3 into the client graph.
 */
export interface SsrCall {
  /** Exactly the visitor's `Cookie` header. Nothing else is forwarded. */
  headers: Record<string, string>
  event?: { node: { res: { appendHeader: (name: string, value: string) => void } } } | null
}

export class BffError extends Error {
  constructor(public readonly problem: ApiProblem) {
    super(problem.detail)
    this.name = 'BffError'
  }
}

async function fetchCsrfToken(): Promise<string> {
  const response = await $fetch<{ csrf_token: string }>('/api/auth/csrf')

  rememberCsrfToken(response.csrf_token)

  return response.csrf_token
}

/** Drop the cached token. Called after anything that rotates the session. */
export function invalidateCsrfToken(): void {
  csrfToken = null
}

/**
 * Carry a cookie the BFF set on the internal SSR request out to the browser.
 *
 * During SSR `/api/auth/me` is dispatched in-process against a *new* H3 event,
 * so anything the handler writes to that event's response is discarded with it.
 * In practice that is `destroySession`'s cookie deletions, reached when a 2FA
 * challenge has expired or the upstream token was revoked on another device.
 *
 * The storage record is deleted either way — revocation is real, and that is
 * what ADR-0005 §3 requires. But without this the browser keeps a cookie
 * pointing at nothing, and the deletion the client-side path performs would
 * silently not happen during SSR. Revocation has to behave identically on both
 * sides or it is not one mechanism.
 *
 * `event.node.res.appendHeader` rather than h3's `appendResponseHeader`: the
 * latter is a Nitro auto-import that does not exist in `app/`, and importing it
 * from `h3` would pull h3 into the client graph.
 */
function adoptSetCookie(headers: Headers, ssr: SsrCall): void {
  const event = ssr.event

  if (!event) return

  for (const cookie of headers.getSetCookie?.() ?? []) {
    event.node.res.appendHeader('set-cookie', cookie)
  }
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

  /*
   * Supplied by the caller, never read here.
   *
   * See `SsrCall`: the composables that produce it only work inside a Nuxt
   * context, and this function is not one. It carries exactly the visitor's
   * `Cookie` header — not `authorization`, not `content-length`, not
   * `if-none-match`. Forwarding the whole inbound set, which is what
   * `useRequestFetch()` does, would push an inbound `Authorization` into the
   * BFF and an inbound `content-length` onto a bodyless internal GET.
   *
   * In the browser there is nothing to forward; the browser attaches its own.
   */
  const forwarded = options.ssr?.headers ?? {}

  if (import.meta.server && needsCsrf) {
    /*
     * Rendering a page must not change anything.
     *
     * This is also what makes the CSRF cache provably client-only rather than
     * conventionally client-only: the one path that populates it runs only for
     * a state-changing method, and that is refused here.
     */
    console.error('[bff] refused a state-changing request during server rendering', { method, path })

    throw new BffError({
      type: 'urn:purrenade:error:ssr_mutation_refused',
      title: 'Refused',
      status: 0,
      detail: `A ${method} to ${path} was attempted during server rendering.`,
      code: 'ssr_mutation_refused',
    })
  }

  async function attempt(): Promise<T> {
    const headers: Record<string, string> = { ...forwarded }

    if (needsCsrf) {
      headers[CSRF_HEADER] = csrfToken ?? (await fetchCsrfToken())
    }

    if (import.meta.server && options.ssr) {
      /*
       * `.raw`, so the internal response's cookies can be carried out to the
       * browser — see `adoptSetCookie`. No body: unsafe methods were refused
       * above, so there is never one to send.
       *
       * On the server `$fetch` is already Nitro's in-process fetcher: a path
       * beginning `/` is dispatched straight to the handler, with no socket and
       * no TLS. This is a function call wearing a request's clothes.
       */
      const response = await $fetch.raw<T>(path, {
        method,
        headers,
        retry: 0,
        timeout: SSR_BOOTSTRAP_TIMEOUT_MS,
      })

      adoptSetCookie(response.headers, options.ssr)

      return response._data as T
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

    me: (ssr?: SsrCall) => bffRequest<import('~/types/auth').MeResponse>('/api/auth/me', { ssr }),

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

    /**
     * Record that the first-run tutorial is finished, or was skipped.
     *
     * No body: the player is whoever holds the session, and the upstream
     * endpoint accepts nothing. Idempotent, so a retry after a failed attempt
     * is safe and cannot move the stored completion.
     */
    completeTutorial: () =>
      bffRequest<{ tutorialCompleted: boolean }>('/api/progression/tutorial', { method: 'POST' }),

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
