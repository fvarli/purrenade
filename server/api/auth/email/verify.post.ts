import { defineBffHandler } from '~~/server/utils/handler'
import { readJsonBody, requireAuthenticated, stringField } from '~~/server/utils/guard'
import { callApi } from '~~/server/utils/upstream'
import type { MeEnvelope } from '~~/server/utils/contracts'

/**
 * POST /api/auth/email/verify
 *
 * Reachable with an unverified session, because that is the whole point: the
 * verified-email gate upstream lets exactly four endpoints through, and this is
 * one of them.
 */
export default defineBffHandler(async (event) => {
  const { token } = await requireAuthenticated(event)

  const body = await readJsonBody(event)

  const response = await callApi<MeEnvelope>(event, 'emailVerify', {
    token,
    body: { code: stringField(body, 'code') ?? '' },
  })

  return { user: response.body.data }
})
