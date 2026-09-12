import { defineBffHandler } from '~~/server/utils/handler'
import { requireAuthenticated } from '~~/server/utils/guard'
import { UpstreamProblem, callApi } from '~~/server/utils/upstream'
import { destroySession } from '~~/server/utils/session'

/**
 * POST /api/auth/logout
 *
 * Revokes the upstream token **and** destroys the BFF session. Both, in that
 * order, and the local one happens even if the upstream call fails: a BFF
 * session that outlives its API credential is a bug (ADR-0005 §1), but a
 * browser left holding a cookie after the player pressed "sign out" is worse
 * than an orphaned token row that Sanctum's expiry will collect.
 */
export default defineBffHandler(async (event) => {
  const { token } = await requireAuthenticated(event)

  try {
    await callApi(event, 'logout', { token })
  }
  catch (error) {
    // A 401 means the token was already gone — the desired end state. Anything
    // else is logged and swallowed, because the local session must still go.
    if (error instanceof UpstreamProblem && error.problem.status !== 401) {
      console.warn('[bff] upstream logout failed; destroying local session anyway', {
        code: error.problem.code,
      })
    }
  }

  await destroySession(event)

  return { status: 'signed_out' as const }
})
