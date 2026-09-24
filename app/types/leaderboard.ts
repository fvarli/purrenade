import type { components, paths } from '~~/shared/contracts/api.generated'

/**
 * The leaderboard types the browser works with (M10).
 *
 * Aliases of the generated contract: the backend's OpenAPI document is the
 * only definition of these shapes. The BFF relays the page exactly as the API
 * computed it, so these are also what the browser receives.
 */
type Schemas = components['schemas']

export type LeaderboardPage = paths['/leaderboards']['get']['responses'][200]['content']['application/json']

export type LeaderboardEntry = Schemas['LeaderboardEntry']

export type LeaderboardPeriod = Schemas['LeaderboardPeriod']

/** `weekly` or `all_time` — the two windows of board 15. */
export type LeaderboardWindow = LeaderboardPage['window']
