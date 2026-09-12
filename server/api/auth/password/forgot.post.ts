import { defineBffHandler } from '~~/server/utils/handler'
import { readJsonBody, requireSessionContext, stringField } from '~~/server/utils/guard'
import { callApi } from '~~/server/utils/upstream'

/**
 * POST /api/auth/password/forgot
 *
 * Relays the API's uniform answer unchanged. The API deliberately responds
 * identically whether or not the address exists, and the BFF must not undo that
 * by adding a branch of its own — a different message, a different status, even
 * a different latency, and the endpoint becomes the account-existence oracle it
 * was written to avoid.
 */
export default defineBffHandler(async (event) => {
  await requireSessionContext(event)

  const body = await readJsonBody(event)

  await callApi(event, 'passwordForgot', {
    body: { email: stringField(body, 'email') ?? '' },
  })

  return { status: 'accepted' as const }
})
