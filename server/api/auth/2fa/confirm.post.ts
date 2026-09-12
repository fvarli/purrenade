import { defineBffHandler } from '~~/server/utils/handler'
import { readJsonBody, requireAuthenticated, stringField } from '~~/server/utils/guard'
import { callApi } from '~~/server/utils/upstream'
import type { TwoFactorConfirmEnvelope } from '~~/server/utils/contracts'

/**
 * POST /api/auth/2fa/confirm — prove possession and switch 2FA on.
 *
 * The recovery codes in this response are the only time they exist outside the
 * database, and they are relayed straight through without being written to the
 * session, to storage, or to a log. If the player misses them, the answer is to
 * regenerate — which invalidates the set they lost, as it should.
 *
 * The session is **not** rotated and the token is **not** upgraded: enabling
 * 2FA does not retroactively make this session one that passed a challenge.
 * That distinction is what the admin gate rests on, and it is enforced upstream
 * by the ability being welded to the token at issue time.
 */
export default defineBffHandler(async (event) => {
  const { token } = await requireAuthenticated(event)

  const body = await readJsonBody(event)

  const response = await callApi<TwoFactorConfirmEnvelope>(event, 'twoFactorConfirm', {
    token,
    body: { code: stringField(body, 'code') ?? '' },
  })

  return {
    user: response.body.data,
    recovery_codes: response.body.meta.recovery_codes,
  }
})
