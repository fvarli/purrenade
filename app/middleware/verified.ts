/**
 * Requires a session **and** a verified address.
 *
 * Mirrors the server's gate (AUTH-1), which confines an unverified session to
 * four endpoints. A screen behind this guard would receive `email_not_verified`
 * from every call it made, so sending the player to verification first is the
 * only useful behaviour — the guard exists to make that redirect happen once
 * rather than as an error on each request.
 */
export default defineNuxtRouteMiddleware((to) => {
  const auth = useAuthStore()

  if (auth.needsTwoFactorChallenge) {
    return navigateTo('/auth/two-factor')
  }

  if (!auth.isSignedIn) {
    return navigateTo({ path: '/auth/login', query: { redirect: to.fullPath } })
  }

  if (auth.needsEmailVerification) {
    return navigateTo('/auth/verify-email')
  }
})
