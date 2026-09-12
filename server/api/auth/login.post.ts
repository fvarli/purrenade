import { defineBffHandler } from '~~/server/utils/handler'
import { readJsonBody, requireSessionContext, stringField } from '~~/server/utils/guard'
import { callApi } from '~~/server/utils/upstream'
import { startSession } from '~~/server/utils/session'
import type { LoginEnvelope } from '~~/server/utils/contracts'

/**
 * POST /api/auth/login
 *
 * First factor. Two possible outcomes, and the sensitive half of each stays on
 * this side of the boundary:
 *
 *  - authenticated → the API token goes into the session; the browser gets a
 *    cookie and the user projection.
 *
 *  - two_factor_required → the **challenge token** goes into the session, not
 *    to the browser. The browser is told only that a code is needed. A
 *    challenge token in a page is one XSS defect away from being the second
 *    factor's undoing.
 */
export default defineBffHandler(async (event) => {
  await requireSessionContext(event)

  const body = await readJsonBody(event)

  const response = await callApi<LoginEnvelope>(event, 'login', {
    body: {
      email: stringField(body, 'email') ?? '',
      password: stringField(body, 'password') ?? '',
    },
  })

  const envelope = response.body

  if (envelope.status === 'two_factor_required') {
    await startSession(event, {
      pendingTwoFactor: {
        challengeToken: envelope.meta.challenge_token,
        expiresAt: envelope.meta.challenge_expires_at,
        recoveryCodesAvailable: envelope.meta.recovery_codes_available,
      },
    })

    // The challenge token stays server-side. The browser learns only that a
    // code is needed, when the window closes, and whether a recovery code is
    // an option.
    return {
      status: 'two_factor_required' as const,
      challenge_expires_at: envelope.meta.challenge_expires_at,
      recovery_codes_available: envelope.meta.recovery_codes_available,
    }
  }

  await startSession(event, {
    apiToken: envelope.meta.token,
    userId: envelope.data.id,
  })

  return {
    status: 'authenticated' as const,
    user: envelope.data,
  }
})
