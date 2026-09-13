/**
 * Resolve who the visitor is, once, before any guard runs.
 *
 * A global middleware rather than a call in each guard, so no route can be
 * guarded against `status === 'unknown'` — which would either flash a login
 * screen at a signed-in player or admit a guest for one frame.
 *
 * **Runs on the server as well as the client**, and that is the whole point.
 *
 * An earlier version returned early during SSR, reasoning that resolving the
 * `HttpOnly` cookie server-side "would authenticate the *server's* request, not
 * the visitor's". That was wrong twice over. The BFF session is a server-side
 * record in this very Nitro process and the cookie is only a pointer to it
 * (ADR-0005 §3, `server/utils/session.ts`), so the render resolves it by reading
 * the request it is already rendering. And `SameSite=Lax` means the browser
 * *does* send that cookie on a top-level navigation, so the pointer is there.
 * There is no "server's request" to authenticate by accident: Nitro keeps no
 * cookie jar, and the only cookie in play is the one on the event being
 * rendered.
 *
 * What the early return actually bought was `status === 'unknown'` for the whole
 * SSR pass, and four defects from it:
 *
 *  - the home page server-rendered its loading branch — to signed-out visitors
 *    as well as signed-in ones, so *every* load of `/` mismatched on hydration;
 *  - the guest guard let a signed-in visitor server-render the login screen
 *    under `layouts/auth.vue` before the client moved them to `/` under
 *    `layouts/default.vue`;
 *  - `verified` and `admin` issued a *real* server-side redirect to
 *    `/auth/login` for a deep link they should have served, and the destination
 *    was then dropped on the way back;
 *  - the layout nav server-rendered without the links a signed-in player has.
 *
 * The store resolves through the same `GET /api/auth/me` on both sides, so the
 * projection is identical by construction, and `@pinia/nuxt` serialises it into
 * the payload — which is why the client does not ask a second time.
 *
 * If the BFF cannot be reached during SSR the status stays `unknown` rather than
 * becoming `guest`, and this middleware runs again in the browser. See
 * `bootstrap()` for why that distinction is load-bearing.
 */
export default defineNuxtRouteMiddleware(async () => {
  const auth = useAuthStore()

  if (auth.status !== 'unknown') return

  /*
   * Captured here, because here is a Nuxt context and `bootstrap()` is not.
   *
   * `useRequestHeaders` and `useRequestEvent` reach for the Nuxt instance, which
   * is available in route middleware and not in a Pinia action several frames
   * below it. Called down there they fail with `NUXT_E1001`, no cookie is
   * forwarded, and the render concludes the visitor is signed out — the same
   * symptom as the bug this middleware exists to fix, with a different cause.
   */
  await auth.bootstrap(import.meta.server
    ? { headers: useRequestHeaders(['cookie']), event: useRequestEvent() }
    : undefined)
})
