import { defineBffHandler } from '~~/server/utils/handler'
import { requireAuthenticated } from '~~/server/utils/guard'
import { callApi } from '~~/server/utils/upstream'
import type { ProgressionEnvelope } from '~~/server/utils/contracts'

/**
 * GET /api/progression — the player's durable progression, as the server
 * holds it. Read-only; relayed without interpretation.
 */
export default defineBffHandler(async (event) => {
  const { token } = await requireAuthenticated(event)

  const response = await callApi<ProgressionEnvelope>(event, 'progression', { token })

  return { progression: response.body.data }
})
