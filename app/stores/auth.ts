import { defineStore } from 'pinia'
import type { AuthStatus, AuthUser, EmailVerificationState } from '~/types/auth'
import type { SsrCall } from '~/composables/useBffClient'
import { useRunSessionStore } from '~/stores/run-session'

/**
 * Authentication state.
 *
 * `state-management.md` §1 puts session and auth status in this store, and the
 * rest of that document imposes the constraints:
 *
 *  - **Nothing sensitive is stored.** No token, no challenge token, no password.
 *    The browser's only credential is the `HttpOnly` cookie it cannot read; this
 *    store holds a *projection* of who that cookie belongs to.
 *
 *  - **Nothing is persisted to web storage.** Not `localStorage`, not
 *    `sessionStorage`. State is rebuilt on every load by asking the BFF, which
 *    is the only party that can answer. That also means signing out in one tab
 *    cannot leave a stale "signed in" view behind in another.
 *
 *  - **The status is derived, never received.** The server sends facts — is the
 *    address verified, is 2FA enabled, did this session pass a challenge — and
 *    `status` is computed from them. A state name sent by the server would be a
 *    state the client had to trust.
 *
 *  - **None of this is authorization.** Every gate here is a convenience;
 *    removing one exposes nothing, because Laravel authorizes every request.
 *
 *  - **It is serialised into the page source.** SSR resolves this store, so
 *    everything in it appears in `__NUXT_DATA__` — visible in view-source, in
 *    the browser's disk cache, and in anything that logs a response body. That
 *    does not change *what* may be held here; it raises the cost of getting it
 *    wrong, and it is why the credential-shape assertions in the store's tests
 *    and the server-rendered-HTML gate in CI both exist.
 */

interface AuthState {
  user: AuthUser | null
  status: AuthStatus
  emailVerification: EmailVerificationState | null

  /** Present only while a challenge is owed. Never the token itself. */
  challengeExpiresAt: string | null
  recoveryCodesAvailable: boolean

  /** True while `bootstrap()` is in flight, so guards can wait rather than guess. */
  loading: boolean
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    user: null,
    status: 'unknown',
    emailVerification: null,
    challengeExpiresAt: null,
    recoveryCodesAvailable: false,
    loading: false,
  }),

  getters: {
    isGuest: (state): boolean => state.status === 'guest',

    /** Signed in, whether or not the address is verified. */
    isSignedIn: (state): boolean =>
      state.status === 'unverified'
      || state.status === 'authenticated'
      || state.status === 'admin_two_factor_setup_required',

    /** Signed in **and** verified — the gate most of the product sits behind. */
    isVerified: (state): boolean =>
      state.status === 'authenticated' || state.status === 'admin_two_factor_setup_required',

    needsTwoFactorChallenge: (state): boolean => state.status === 'two_factor_required',

    needsEmailVerification: (state): boolean => state.status === 'unverified',

    isAdmin: (state): boolean => state.user?.role === 'admin',

    /**
     * May this session actually use the admin surface?
     *
     * All four conditions, mirroring the server's gate — but as *UX*, so the
     * admin link is not offered to a session that would be refused. The server
     * decides; this only decides what to render.
     */
    canUseAdminSurface: (state): boolean =>
      state.user?.role === 'admin'
      && state.user.email_verified
      && state.user.two_factor_enabled
      && state.user.session?.two_factor_satisfied === true,

    /** An administrator who has not enrolled: a real, reachable state. */
    needsAdminTwoFactorSetup: (state): boolean =>
      state.status === 'admin_two_factor_setup_required',

    recoveryCodesRemaining: (state): number =>
      state.user?.two_factor_recovery_codes_remaining ?? 0,

    /**
     * Has this player already been through the tutorial?
     *
     * Defaults to **false** when the field is missing, and that direction is
     * deliberate: an unknown answer sends the player to the tutorial, which
     * costs them a minute, while the other default would silently skip
     * first-run teaching for everyone the moment the field failed to arrive.
     */
    tutorialCompleted: (state): boolean => state.user?.tutorial_completed === true,
  },

  actions: {
    /**
     * Ask the BFF who this browser is.
     *
     * Called once per app load. Never throws: a failure leaves the visitor a
     * guest, because a network problem on first paint must not blank the
     * application — and every protected action is authorized server-side anyway,
     * so guessing "guest" is safe in a way guessing "signed in" would not be.
     */
    async bootstrap(ssr?: SsrCall): Promise<void> {
      if (this.loading) return

      this.loading = true

      try {
        const client = useBffClient()
        const response = await client.me(ssr)

        this.applyMeResponse(response)
      }
      catch (error) {
        /*
         * `unknown` means "we could not find out". `guest` means "there is no
         * session". Only the browser is allowed to reach the second.
         *
         * On the client, an unreachable BFF leaving the visitor a guest is
         * safe: a network problem on first paint must not blank the
         * application, the person is there and can retry, and every protected
         * action is authorised server-side regardless.
         *
         * During SSR it would not be safe, because `guest` is a *conclusion*
         * and the client only bootstraps when the status is `unknown`.
         * Concluding "guest" on the server would strand a signed-in visitor in
         * guest UI for the life of the page, with nothing left to retry and no
         * way for them to know. Leaving it `unknown` hands the decision back to
         * the browser, which asks again.
         *
         * This is a degraded *availability* path, not evidence about the
         * visitor. It is bounded — `SSR_BOOTSTRAP_TIMEOUT_MS` caps the wait —
         * and it is observable: it says so, once, with the reason.
         */
        if (import.meta.server) {
          console.warn('[auth] SSR session bootstrap failed; leaving the status unknown for the client to resolve', {
            reason: error instanceof Error ? error.message : String(error),
          })

          return
        }

        this.reset()
        this.status = 'guest'
      }
      finally {
        this.loading = false
      }
    },

    /** @internal */
    applyMeResponse(response: import('~/types/auth').MeResponse): void {
      if (response.status === 'two_factor_required') {
        this.user = null
        this.status = 'two_factor_required'
        this.challengeExpiresAt = response.challenge_expires_at ?? null
        this.recoveryCodesAvailable = response.recovery_codes_available ?? false
        this.emailVerification = null

        return
      }

      if (response.status === 'guest' || !response.user) {
        this.reset()
        this.status = 'guest'

        return
      }

      this.setUser(response.user)
      this.emailVerification = response.email_verification ?? null
    },

    /**
     * Record the signed-in account and derive the status from its facts.
     *
     * The order of the checks is the order of the gates: verification first,
     * because an unverified account reaches almost nothing; then admin
     * enrolment, which is a warning rather than a blocker for the player-facing
     * product.
     */
    setUser(user: AuthUser): void {
      this.user = user
      this.challengeExpiresAt = null
      this.recoveryCodesAvailable = false

      if (!user.email_verified) {
        this.status = 'unverified'

        return
      }

      this.status = user.requires_two_factor_enrolment
        ? 'admin_two_factor_setup_required'
        : 'authenticated'
    },

    setTwoFactorRequired(challengeExpiresAt: string, recoveryCodesAvailable: boolean): void {
      this.user = null
      this.status = 'two_factor_required'
      this.challengeExpiresAt = challengeExpiresAt
      this.recoveryCodesAvailable = recoveryCodesAvailable
      this.emailVerification = null

      // The session was rotated upstream, so the cached CSRF token is stale.
      invalidateCsrfToken()
    },

    setEmailVerification(state: EmailVerificationState | null): void {
      this.emailVerification = state
    },

    /**
     * Mirror a completion the server has already accepted.
     *
     * Called **only** after `POST /api/progression/tutorial` has resolved, so
     * that PLAY stops offering the tutorial without a second `/auth/me`. If the
     * request fails this is never called, and the player keeps being offered
     * the tutorial — which is the honest outcome: the server is the authority,
     * and pretending otherwise would mean the tutorial reappears on the next
     * sign-in with nobody able to explain why.
     */
    markTutorialCompleted(): void {
      if (this.user === null) return

      this.user = { ...this.user, tutorial_completed: true }
    },

    /**
     * Clear everything.
     *
     * Also drops the cached CSRF token: it belonged to a session that no longer
     * exists, and a stale one would cost the next request a needless round trip.
     */
    reset(): void {
      this.user = null
      this.status = 'guest'
      this.emailVerification = null
      this.challengeExpiresAt = null
      this.recoveryCodesAvailable = false

      invalidateCsrfToken()

      // The run session belongs to the account that was signed in. Its pending
      // finish lives in the BFF session, which ends with this; the in-memory
      // half goes too, so nothing of one account is shown to — or retried
      // as — the next.
      useRunSessionStore().reset()
    },

    /**
     * Sign out.
     *
     * Local state is cleared **whatever the BFF says**. The BFF destroys its own
     * session even when the upstream revoke fails, so a browser left looking
     * signed in after the player pressed the button would be a lie about state
     * that no longer exists.
     */
    async signOut(): Promise<void> {
      try {
        await useBffClient().logout()
      }
      finally {
        this.reset()
      }
    },
  },
})
