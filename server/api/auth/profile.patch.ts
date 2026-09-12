import { defineBffHandler } from '~~/server/utils/handler'
import { readJsonBody, requireAuthenticated, stringField } from '~~/server/utils/guard'
import { callApi } from '~~/server/utils/upstream'
import type { MeEnvelope } from '~~/server/utils/contracts'

/**
 * PATCH /api/auth/profile — change the display name.
 *
 * Only `display_name` is forwarded. The upstream endpoint accepts nothing else,
 * and naming the field here means a caller cannot discover that by adding keys
 * to the JSON and watching what happens.
 */
export default defineBffHandler(async (event) => {
  const { token } = await requireAuthenticated(event)

  const body = await readJsonBody(event)

  const response = await callApi<MeEnvelope>(event, 'profileUpdate', {
    token,
    body: { display_name: stringField(body, 'display_name') ?? '' },
  })

  return { user: response.body.data }
})
