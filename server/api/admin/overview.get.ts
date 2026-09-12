import { defineBffHandler } from '~~/server/utils/handler'
import { requireAuthenticated } from '~~/server/utils/guard'
import { callApi } from '~~/server/utils/upstream'
import type { AdminOverviewEnvelope } from '~~/server/utils/contracts'

/**
 * GET /api/admin/overview
 *
 * The BFF performs **no** role check. Not an oversight: authorization is
 * Laravel's, on every request, and the API refuses this with a distinct code
 * for each of the four possible reasons — wrong role, unverified address, no
 * second factor enrolled, or a session that never passed a challenge.
 *
 * A role check here would be a second implementation of a rule that must have
 * exactly one, and the client-side route guard that hides the admin link is
 * explicitly a convenience rather than a control
 * (docs/product/screen-inventory.md §3).
 */
export default defineBffHandler(async (event) => {
  const { token } = await requireAuthenticated(event)

  const response = await callApi<AdminOverviewEnvelope>(event, 'adminOverview', { token })

  return response.body.data
})
