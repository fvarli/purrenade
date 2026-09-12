/**
 * Sign out and land somewhere sensible.
 *
 * A composable rather than an inline handler in each screen, for two reasons:
 * the order matters (clear state, *then* navigate, or the guard on the next
 * route reads a stale store), and `navigateTo` returns a union that cannot be
 * used as a promise callback — the mistake compiles as `.then(() => navigateTo(…))`
 * only because the return value is discarded, and the compiler rejects it.
 */
export function useSignOut() {
  const auth = useAuthStore()

  return async function signOut(destination = '/auth/login'): Promise<void> {
    await auth.signOut()
    await navigateTo(destination)
  }
}
