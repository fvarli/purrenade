import { defineBffHandler } from '~~/server/utils/handler'
import { readJsonBody, requireAuthenticated, stringField } from '~~/server/utils/guard'
import { callApi } from '~~/server/utils/upstream'

/**
 * POST /api/auth/2fa/disable
 *
 * The API refuses this for administrators (403 `admin_two_factor_mandatory`).
 * The BFF does not pre-empt that check: role is an authorization question, and
 * authorization belongs to Laravel. Duplicating it here would create a second
 * place for the rule to be wrong.
 */
export default defineBffHandler(async (event) => {
  const { token } = await requireAuthenticated(event)

  const body = await readJsonBody(event)

  await callApi(event, 'twoFactorDisable', {
    token,
    body: { current_password: stringField(body, 'current_password') ?? '' },
  })

  return { status: 'two_factor_disabled' as const }
})
