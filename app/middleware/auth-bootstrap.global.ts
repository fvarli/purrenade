/**
 * Resolve who the visitor is, once, before any guard runs.
 *
 * A global middleware rather than a call in each guard, so no route can be
 * guarded against `status === 'unknown'` — which would either flash a login
 * screen at a signed-in player or admit a guest for one frame.
 *
 * Client-only. The BFF session cookie is `HttpOnly` and resolving it requires a
 * request the browser must make with its own cookies attached; doing it during
 * SSR would authenticate the *server's* request, not the visitor's.
 */
export default defineNuxtRouteMiddleware(async () => {
  if (import.meta.server) return

  const auth = useAuthStore()

  if (auth.status === 'unknown') {
    await auth.bootstrap()
  }
})
