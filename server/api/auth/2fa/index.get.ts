import { defineBffHandler } from '~~/server/utils/handler'
import { requireAuthenticated } from '~~/server/utils/guard'
import { callApi } from '~~/server/utils/upstream'
import type { TwoFactorStateEnvelope } from '~~/server/utils/contracts'

/** GET /api/auth/2fa — current two-factor state. State only, never the secret. */
export default defineBffHandler(async (event) => {
  const { token } = await requireAuthenticated(event)

  const response = await callApi<TwoFactorStateEnvelope>(event, 'twoFactorShow', { token })

  return response.body.data
})
