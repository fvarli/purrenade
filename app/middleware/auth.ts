/**
 * Requires a session — verified or not.
 *
 * Used by the verification screen itself, which is reachable precisely when the
 * address is unconfirmed.
 *
 * The attempted path is preserved in the query so login can return the player to
 * it, rather than depositing everyone on the home page and making them navigate
 * again.
 */
export default defineNuxtRouteMiddleware((to) => {
  const auth = useAuthStore()

  if (auth.needsTwoFactorChallenge) {
    return navigateTo('/auth/two-factor')
  }

  if (!auth.isSignedIn) {
    return navigateTo({ path: '/auth/login', query: { redirect: to.fullPath } })
  }
})
