import { getRouterParam } from 'h3'
import { defineBffHandler } from '~~/server/utils/handler'
import { requireAuthenticated } from '~~/server/utils/guard'
import { callApi, sessionRevokePath } from '~~/server/utils/upstream'
import { destroySession } from '~~/server/utils/session'
import type { SessionListEnvelope } from '~~/server/utils/contracts'

/**
 * DELETE /api/auth/sessions/:id — revoke one session.
 *
 * The only route with a client-supplied path segment, and the only place SSRF
 * could enter this BFF. `sessionRevokePath` refuses anything that is not a
 * UUID, so the upstream path cannot be steered — a segment containing `../..`
 * would otherwise address a different endpoint entirely.
 *
 * Ownership is decided upstream, by Laravel, and a session belonging to someone
 * else returns 404 rather than 403 so the endpoint is not an existence oracle.
 *
 * Revoking one's own session is allowed and is simply a sign-out; the local
 * session is destroyed to match, or the browser would keep a cookie pointing at
 * a credential that no longer exists.
 */
export default defineBffHandler(async (event) => {
  const { token } = await requireAuthenticated(event)

  const id = getRouterParam(event, 'id') ?? ''

  // Read before revoking: afterwards the list no longer contains the row, so
  // there is no way to tell whether it was the current one.
  const list = await callApi<SessionListEnvelope>(event, 'sessionsIndex', { token })
  const wasCurrent = list.body.data.some(session => session.id === id && session.is_current)

  await callApi(event, 'sessionRevoke', {
    token,
    path: sessionRevokePath(id),
  })

  if (wasCurrent) {
    await destroySession(event)
  }

  return { status: 'session_revoked' as const, was_current: wasCurrent }
})
