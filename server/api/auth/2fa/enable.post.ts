import { defineBffHandler } from '~~/server/utils/handler'
import { readJsonBody, requireAuthenticated, stringField } from '~~/server/utils/guard'
import { callApi } from '~~/server/utils/upstream'
import type { TwoFactorEnrolmentEnvelope } from '~~/server/utils/contracts'

/**
 * POST /api/auth/2fa/enable — begin enrolment.
 *
 * `current_password` is passed straight through to the API, which is the only
 * thing that may decide whether it is correct. The BFF neither checks it nor
 * remembers it.
 *
 * The provisioning data that comes back — secret, URI, QR image — does reach
 * the browser, necessarily: the player has to scan or type it. It is not a
 * credential yet; 2FA stays off until `confirm` proves possession, and an
 * abandoned enrolment is replaced by the next one.
 */
export default defineBffHandler(async (event) => {
  const { token } = await requireAuthenticated(event)

  const body = await readJsonBody(event)

  const response = await callApi<TwoFactorEnrolmentEnvelope>(event, 'twoFactorEnable', {
    token,
    body: { current_password: stringField(body, 'current_password') ?? '' },
  })

  return response.body.data
})
