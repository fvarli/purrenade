# ADR-0009 — Server-rendered session awareness

**Status:** Accepted
**Scope:** Frontend (`purrenade`). No backend change; `purrenade-api` is untouched.
**Supersedes:** nothing. **Amends:** nothing. ADR-0005 stands unchanged.

---

## Context

Nuxt renders every route except `/run` on the server. Until M6 the auth store was
deliberately **not** resolved during that render: `app/middleware/auth-bootstrap.global.ts`
returned early with `if (import.meta.server) return`, and its comment justified this by
saying that resolving the `HttpOnly` cookie server-side "would authenticate the *server's*
request, not the visitor's".

That justification was false, and nothing in the documentation contradicted it — there was
no ADR on the subject at all, so a comment became the de facto architecture.

It is false because:

- the BFF session is a **server-side record in this same Nitro process**, and the cookie is
  only a pointer to it (ADR-0005 §3, `server/utils/session.ts`);
- `SameSite=Lax` means the browser **does** send that cookie on a top-level navigation, so
  the pointer is present on the very request being rendered;
- Nitro keeps no cookie jar of its own, so there is no "server's request" to authenticate by
  accident — the only cookie in play is the visitor's.

The cost of the early return was `status === 'unknown'` for the whole SSR pass, and four
defects flowed from it:

1. `/` server-rendered its "we do not know yet" branch — to signed-out visitors as well as
   signed-in ones, so **every** load of the home page mismatched on hydration.
2. The layout navigation server-rendered without the links a signed-in player has.
3. The `guest` guard saw `unknown` on the server, did not redirect, and let a signed-in
   visitor server-render the login screen under the wrong layout before the client moved
   them.
4. `verified` and `admin` issued a **real server-side redirect** to `/auth/login` for deep
   links they should have served, and the destination was then dropped on the way back.

Vue states that it does not rectify a hydration mismatch in a production build. So this was
not only a console warning: a signed-in player could be left looking at signed-out
navigation.

## Decision

**SSR resolves the existing BFF session, through the existing session mechanism.**

- The bootstrap middleware runs on the server as well as the client. It captures the
  visitor's `Cookie` header — and only that header — while it is inside a Nuxt context, and
  hands it to the store.
- The store resolves through the **same** `GET /api/auth/me` used by the browser. On the
  server `$fetch` is Nitro's in-process fetcher, so this is a function call rather than a
  network request. No second session mechanism is introduced.
- Only the credential-free projection crosses into the render. The Sanctum token, the CSRF
  secret and the 2FA challenge token stay in the session record, as before.
- **`unknown` is not `guest`.** If the BFF cannot be reached, the render leaves the status
  `unknown`, logs once with the reason, and the browser asks again. Concluding `guest` would
  strand a signed-in visitor, because the client only bootstraps from `unknown`.
- The SSR resolution is bounded at **2.5 s**, well below `apiTimeoutMs`, because this is
  time-to-first-byte rather than a background request.
- **A render never changes anything**: state-changing BFF requests are refused during SSR.
- The guards are unchanged. They now decide against real state on both sides; nothing is
  deferred, weakened or disabled.

## What this does *not* change

- The API credential never reaches the browser (ADR-0005 §1). What SSR serialises is what
  `GET /api/auth/me` already sent the browser after hydration — the medium changed, not the
  trust boundary.
- The cookie remains an opaque pointer, `HttpOnly`, `Secure`, `__Host-` prefixed.
- Laravel/Fortify/Sanctum remains the authentication authority. No backend code changed.
- CSRF, 2FA, session-version, revocation and logout semantics are untouched. Revocation
  during a render still destroys the record, and the resulting cookie deletions are carried
  out to the browser rather than dropped with the internal event.

## Consequences

**Better.** The correct screen is in the first byte. No flash, no mismatch, and deep links to
protected pages work for the people entitled to them.

**Harder.** Signed-in page HTML is now **user-specific and uncacheable**. `swr`, `isr`, a
`cache` route rule, or a proxy cache in front of a page route would serve one player's
greeting to another. This is recorded as a rule in `state-management.md` §6 and is the single
most dangerous way to undo this decision.

**Slower, boundedly.** A signed-in page render now waits on one upstream call before its
first byte, capped at 2.5 s. Anonymous visitors are unaffected: `readSession` returns null
and the BFF answers `guest` locally without touching Laravel.

**Newly exercised.** `/account/security` and `/admin` are server-rendered for the first time,
because the guards used to redirect away from them during SSR. Both were verified free of
setup-time browser globals; the failure mode for a future one is now a 500 rather than a
redirect, and the deep-link E2E cases are what guard it.

## Alternatives considered

**Render an auth-neutral shell and defer the auth-dependent branches to the client.** It
would satisfy the hydration requirement without SSR knowing anything. Rejected: every
signed-in visitor would see a neutral shell first on every full page load, and it does not
fix defect 4 — the guards would still have to be deferred, which means deferring
authorisation decisions to make a rendering problem go away.

**Read the session record directly from `app/` code.** `server/utils/*` are Nitro
auto-imports, unavailable in the Vue bundle; importing them would either fail at render time
or pull h3 into the client graph, and duplicating `me.get.ts`'s projection logic would create
the second source of truth this decision exists to avoid.

**`useRequestFetch()`.** It forwards the entire inbound header set, and at runtime it is a
bare function without `.raw` despite being typed as an ofetch instance — so `Set-Cookie`
forwarding would silently stop working. Rejected on both counts.
