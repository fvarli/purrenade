import { getQuery } from 'h3'
import { defineBffHandler } from '~~/server/utils/handler'
import { requireAuthenticated } from '~~/server/utils/guard'
import { isLeaderboardPage, leaderboardQuery } from '~~/server/utils/leaderboard'
import { BffProblemCode, bffProblem } from '~~/server/utils/problem'
import { UpstreamProblem, callApi } from '~~/server/utils/upstream'
import type { LeaderboardPage } from '~~/server/utils/contracts'

/**
 * GET /api/leaderboards?window=…[&cursor=…][&limit=…] — one page of a
 * leaderboard, relayed (M10).
 *
 * Not a proxy: the query is re-validated and rebuilt from its three known
 * members (`server/utils/leaderboard.ts`), and the upstream call can carry
 * only the members `ENDPOINT_QUERY` allows. The page comes back exactly as
 * the API computed it — ranks, the caller's own entry and the cursor
 * included; nothing is ranked, cached or reshaped here. The API's problems,
 * `cursor_invalid` among them, pass through with their codes.
 */
export default defineBffHandler(async (event): Promise<LeaderboardPage> => {
  const { token } = await requireAuthenticated(event)

  const query = leaderboardQuery(getQuery(event))

  const response = await callApi<LeaderboardPage>(event, 'leaderboards', { token, query })

  if (!isLeaderboardPage(response.body)) {
    throw new UpstreamProblem(bffProblem(
      BffProblemCode.UpstreamUnavailable,
      502,
      'The service returned an unexpected response.',
      { correlation_id: response.correlationId },
    ))
  }

  return response.body
})
