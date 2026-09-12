import { defineBffHandler } from '~~/server/utils/handler'
import { readJsonBody, requireAuthenticated, stringField } from '~~/server/utils/guard'
import { callApi } from '~~/server/utils/upstream'

/**
 * DELETE /api/auth/sessions — sign out every other device.
 *
 * The caller's own session survives, upstream and here. Requires
 * `current_password`, because it evicts sessions the caller cannot see.
 */
export default defineBffHandler(async (event) => {
  const { token } = await requireAuthenticated(event)

  const body = await readJsonBody(event)

  const response = await callApi<{ meta: { revoked_count: number } }>(
    event,
    'sessionsDestroyOthers',
    {
      token,
      body: { current_password: stringField(body, 'current_password') ?? '' },
    },
  )

  return { revoked_count: response.body.meta.revoked_count }
})
