import { defineBffHandler } from '~~/server/utils/handler'
import { requireAuthenticated } from '~~/server/utils/guard'
import { callApi } from '~~/server/utils/upstream'
import type { EmailVerificationMeta } from '~~/server/utils/contracts'

/**
 * POST /api/auth/email/verify/resend
 *
 * The cooldown arrives as a 429 carrying `retry_after`, which the problem
 * sanitiser preserves precisely so the screen can render the countdown v0.3
 * board 04 specifies. Treating it as a plain error would leave the client
 * guessing at 42 seconds and drifting out of step with the server.
 */
export default defineBffHandler(async (event) => {
  const { token } = await requireAuthenticated(event)

  const response = await callApi<{ meta: { email_verification: EmailVerificationMeta } }>(
    event,
    'emailResend',
    { token },
  )

  return response.body.meta.email_verification
})
