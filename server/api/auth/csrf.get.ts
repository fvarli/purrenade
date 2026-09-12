import { requireSameSiteRequest } from '~~/server/utils/guard'
import { defineBffHandler } from '~~/server/utils/handler'
import { readSession, startSession } from '~~/server/utils/session'

/**
 * GET /api/auth/csrf
 *
 * Hands the client the CSRF token it must echo on every state-changing call,
 * and starts a session to hold the expected value if there is not one already.
 *
 * A session before authentication is not a contradiction: login and register
 * are themselves state-changing, so they need a token, so they need somewhere
 * server-side to compare it against. That pre-authentication session carries no
 * credential — only the token — and is replaced (with a new identifier) the
 * moment a real one is issued.
 *
 * Safe method, so it needs no token of its own — but it is the one safe method
 * that *creates* something, and an endpoint that mints a stored record for any
 * caller with no cookie is an unauthenticated way to grow the store. A
 * cross-site `<img>` or a `fetch(mode: 'no-cors')` reaches it perfectly well.
 *
 * So it is fetch-metadata gated: a browser labels its own same-origin requests,
 * and the ones that arrive labelled as cross-site get the token they need for
 * nothing. That plus the sweeper bounds the store from both ends.
 */
export default defineBffHandler(async (event) => {
  requireSameSiteRequest(event)

  const existing = await readSession(event)

  if (existing) {
    return { csrf_token: existing.record.csrfToken }
  }

  const { record } = await startSession(event, {})

  return { csrf_token: record.csrfToken }
})
