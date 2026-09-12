/**
 * Administrator routes.
 *
 * Checks the same four conditions as the server — role, verified address,
 * enrolled second factor, and a session that passed a challenge — but only to
 * choose a destination. **This is not the control.** Remove it and the admin
 * page still cannot show anything, because every call it makes is refused by
 * Laravel with a distinct code.
 *
 * An administrator who has not enrolled is sent to enrol rather than shown a
 * denial: that state is reachable by an operator promoting a player, and the
 * useful response is "set up 2FA", not "forbidden".
 *
 * An administrator whose session merely lacks a passed challenge is sent to sign
 * in again, because no endpoint can upgrade an existing session.
 */
export default defineNuxtRouteMiddleware((to) => {
  const auth = useAuthStore()

  if (!auth.isSignedIn) {
    return navigateTo({ path: '/auth/login', query: { redirect: to.fullPath } })
  }

  if (auth.needsEmailVerification) {
    return navigateTo('/auth/verify-email')
  }

  if (!auth.isAdmin) {
    return navigateTo('/')
  }

  if (auth.needsAdminTwoFactorSetup) {
    return navigateTo({ path: '/account/security', query: { enrol: 'required' } })
  }

  if (!auth.canUseAdminSurface) {
    return navigateTo({ path: '/auth/login', query: { reason: 'two_factor_required' } })
  }
})
