import { defineBffHandler } from '~~/server/utils/handler'
import { readJsonBody, requireSessionContext, stringField } from '~~/server/utils/guard'
import { callApi } from '~~/server/utils/upstream'
import { destroySession } from '~~/server/utils/session'

/**
 * POST /api/auth/password/reset
 *
 * A successful reset revokes every session upstream, so any BFF session still
 * pointing at one of those tokens now points at nothing. Destroying the local
 * session here keeps the two layers honest instead of leaving a cookie that
 * fails on its next use.
 *
 * The player then signs in with the new password — and is still challenged for
 * their second factor, because a reset changes one factor and not the other.
 */
export default defineBffHandler(async (event) => {
  await requireSessionContext(event)

  const body = await readJsonBody(event)

  await callApi(event, 'passwordReset', {
    body: {
      token: stringField(body, 'token') ?? '',
      email: stringField(body, 'email') ?? '',
      password: stringField(body, 'password') ?? '',
      password_confirmation: stringField(body, 'password_confirmation') ?? '',
    },
  })

  await destroySession(event)

  return { status: 'password_reset' as const }
})
