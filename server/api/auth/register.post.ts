import { defineBffHandler } from '~~/server/utils/handler'
import { readJsonBody, requireSessionContext, stringField } from '~~/server/utils/guard'
import { callApi } from '~~/server/utils/upstream'
import { startSession } from '~~/server/utils/session'
import type { MeEnvelope } from '~~/server/utils/contracts'

/**
 * POST /api/auth/register
 *
 * Creates the account upstream, then converts the token the API returns into a
 * BFF session. The token is stored server-side; the browser receives a cookie
 * and the user projection, and never the credential itself.
 */
export default defineBffHandler(async (event) => {
  await requireSessionContext(event)

  const body = await readJsonBody(event)

  // Field by field. Forwarding the body wholesale would let a caller add
  // `role` or `email_verified_at` to the JSON and have it arrive upstream.
  const response = await callApi<MeEnvelope>(event, 'register', {
    body: {
      display_name: stringField(body, 'display_name') ?? '',
      email: stringField(body, 'email') ?? '',
      password: stringField(body, 'password') ?? '',
      password_confirmation: stringField(body, 'password_confirmation') ?? '',
    },
  })

  const user = response.body.data
  const token = response.body.meta?.token

  // A new identifier, always: rotation on privilege change is the session
  // fixation defence (ADR-0005 §3), and startSession is the only writer.
  await startSession(event, { apiToken: token, userId: user.id })

  return {
    status: 'authenticated' as const,
    user,
    email_verification: response.body.meta?.email_verification ?? null,
  }
})
