import { defineBffHandler } from '~~/server/utils/handler'
import { requireAuthenticated } from '~~/server/utils/guard'
import { callApi } from '~~/server/utils/upstream'
import type { SessionListEnvelope } from '~~/server/utils/contracts'

/** GET /api/auth/sessions — the caller's own sessions, newest first. */
export default defineBffHandler(async (event) => {
  const { token } = await requireAuthenticated(event)

  const response = await callApi<SessionListEnvelope>(event, 'sessionsIndex', { token })

  return { sessions: response.body.data }
})
