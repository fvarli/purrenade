import { defineBffHandler } from '~~/server/utils/handler'
import { readJsonBody, requireSessionContext, stringField } from '~~/server/utils/guard'
import { UpstreamProblem, callApi } from '~~/server/utils/upstream'
import { startSession } from '~~/server/utils/session'
import { BffProblemCode, bffProblem } from '~~/server/utils/problem'
import type { TwoFactorChallengeEnvelope } from '~~/server/utils/contracts'

/**
 * POST /api/auth/2fa/challenge
 *
 * Second factor. The **challenge token comes from the session**, not from the
 * request: the browser was never given it, so it cannot send it. All the client
 * supplies is the code the player typed.
 *
 * That is the difference between a BFF and a proxy. Were the challenge token in
 * the page, an XSS defect would hand an attacker a first-factor-complete
 * credential, and the second factor would be defending an account whose
 * intermediate state had already leaked.
 */
export default defineBffHandler(async (event) => {
  const { record } = await requireSessionContext(event)

  const pending = record.pendingTwoFactor

  if (!pending) {
    throw new UpstreamProblem(
      bffProblem(
        BffProblemCode.Unauthenticated,
        401,
        'There is no two-factor challenge in progress. Sign in again.',
      ),
    )
  }

  const body = await readJsonBody(event)

  const code = stringField(body, 'code')
  const recoveryCode = stringField(body, 'recovery_code')

  const response = await callApi<TwoFactorChallengeEnvelope>(event, 'twoFactorChallenge', {
    body: {
      challenge_token: pending.challengeToken,
      ...(recoveryCode ? { recovery_code: recoveryCode } : { code: code ?? '' }),
    },
  })

  // Rotated again: passing the second factor is a privilege change, so the
  // identifier the browser holds must change with it.
  await startSession(event, {
    apiToken: response.body.meta.token,
    userId: response.body.data.id,
  })

  return {
    status: 'authenticated' as const,
    user: response.body.data,
    used_recovery_code: response.body.meta.used_recovery_code,
    recovery_codes_remaining: response.body.meta.recovery_codes_remaining,
  }
})
