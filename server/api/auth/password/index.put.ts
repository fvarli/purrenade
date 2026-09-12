import { defineBffHandler } from '~~/server/utils/handler'
import { readJsonBody, requireAuthenticated, stringField } from '~~/server/utils/guard'
import { callApi } from '~~/server/utils/upstream'

/**
 * PUT /api/auth/password — change password from inside a session.
 *
 * The API keeps this session and ends the others, so the local session survives
 * too. It is rotated all the same: a password change is a privilege change, and
 * ADR-0005 §3 asks for a new identifier on each one.
 */
export default defineBffHandler(async (event) => {
  const { record, token } = await requireAuthenticated(event)

  const body = await readJsonBody(event)

  await callApi(event, 'passwordUpdate', {
    token,
    body: {
      current_password: stringField(body, 'current_password') ?? '',
      password: stringField(body, 'password') ?? '',
      password_confirmation: stringField(body, 'password_confirmation') ?? '',
    },
  })

  const { startSession } = await import('~~/server/utils/session')

  await startSession(event, { apiToken: token, userId: record.userId })

  return { status: 'password_changed' as const }
})
