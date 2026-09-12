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
export default defineNuxtRouteMiddleware(() => {
  const auth = useAuthStore()

  if (auth.needsTwoFactorChallenge) {
    return navigateTo('/auth/two-factor')
  }

  if (auth.needsEmailVerification) {
    return navigateTo('/auth/verify-email')
  }

  if (auth.isSignedIn) {
    return navigateTo('/')
  }
})
