/**
 * Guest-only routes: login, register, forgot and reset password.
 *
 * Sends a signed-in visitor where they actually need to be, which is not always
 * the home page: an unverified account belongs on the verification screen, and a
 * pending challenge belongs on the challenge screen. Redirecting everyone to `/`
 * would strand both.
 *
 * UX only. `docs/product/screen-inventory.md` §3: no screen's presence or
 * absence is a security control.
 */
export default defineNuxtRouteMiddleware((to) => {
  const auth = useAuthStore()

  if (auth.needsTwoFactorChallenge) {
    return navigateTo('/auth/two-factor')
  }

  if (auth.needsEmailVerification) {
    return navigateTo('/auth/verify-email')
  }

  if (auth.isSignedIn) {
    /*
     * Honour the destination rather than discarding it.
     *
     * Reached whenever a signed-in visitor arrives at a guest-only screen —
     * including the degraded path where SSR could not resolve the session,
     * `verified` sent them here with the page they wanted in the query, and the
     * browser then found the session after all. Sending them to `/` at that
     * point loses the destination and makes an availability blip look like a
     * broken link.
     *
     * `resolveRedirectTarget` is the same audited predicate the login form
     * applies, so an off-site `?redirect=` still becomes `/`. Reusing it rather
     * than re-testing the string here is deliberate: a second copy of a
     * security predicate is a second thing to get wrong.
     */
    return navigateTo(resolveRedirectTarget(to.query.redirect))
  }
})
