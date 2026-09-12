import { defineBffHandler } from '~~/server/utils/handler'
import { readJsonBody, requireAuthenticated, stringField } from '~~/server/utils/guard'
import { callApi } from '~~/server/utils/upstream'
import type { RecoveryCodesEnvelope } from '~~/server/utils/contracts'

/** POST /api/auth/2fa/recovery-codes — issue a new set, invalidating the old one. */
export default defineBffHandler(async (event) => {
  const { token } = await requireAuthenticated(event)

  const body = await readJsonBody(event)

  const response = await callApi<RecoveryCodesEnvelope>(event, 'twoFactorRecoveryCodes', {
    token,
    body: { current_password: stringField(body, 'current_password') ?? '' },
  })

  return { recovery_codes: response.body.meta.recovery_codes }
})
