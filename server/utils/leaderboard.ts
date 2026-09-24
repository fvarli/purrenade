import { BffProblemCode, bffProblem } from './problem'
import { UpstreamProblem } from './upstream'
import type { LeaderboardEntry, LeaderboardPage, LeaderboardQuery } from './contracts'

/**
 * The leaderboard route's two checks (M10): what the browser may ask for, and
 * whether what came back is a page.
 *
 * **Re-validated here, not only upstream.** The API validates the same query,
 * but the BFF forwards nothing it has not understood: the three known members
 * only, each in its documented shape, rebuilt as fresh strings. A malformed
 * query is refused with `bff_invalid_request` without an upstream call, and an
 * unknown member is dropped rather than relayed.
 *
 * The cursor is opaque here too — its shape is checked, never its content.
 * Whether it is still usable is the API's decision, and its `cursor_invalid`
 * reaches the browser as the API sent it.
 */

const WINDOWS = ['weekly', 'all_time'] as const

/** The API's own bounds: `[A-Za-z0-9_-]`, at most 512 characters. */
const CURSOR = /^[A-Za-z0-9_-]{1,512}$/

/** A plain decimal 1–100, as the API accepts it. */
const LIMIT = /^[1-9][0-9]{0,2}$/

export const LEADERBOARD_MAX_LIMIT = 100

/**
 * The upstream query, built from the browser's.
 *
 * @throws UpstreamProblem `bff_invalid_request` (422) for anything malformed.
 */
export function leaderboardQuery(raw: Record<string, unknown>): Record<string, string> {
  const { window, cursor, limit } = raw

  if (!isWindow(window)) {
    throw invalid('Choose the weekly or the all-time leaderboard.')
  }

  // Only members of the contract's query, and only once each shape is known.
  const query: Record<string, string> = { window }

  if (cursor !== undefined) {
    if (typeof cursor !== 'string' || !CURSOR.test(cursor)) {
      throw invalid('That page reference is not valid.')
    }

    query.cursor = cursor
  }

  if (limit !== undefined) {
    if (typeof limit !== 'string' || !LIMIT.test(limit) || Number(limit) > LEADERBOARD_MAX_LIMIT) {
      throw invalid('The page size must be between 1 and 100.')
    }

    query.limit = limit
  }

  return query
}

/**
 * Is this the contract's `LeaderboardPage`?
 *
 * Checked before it is relayed, like the run responses: a body that is not a
 * page is an upstream fault, answered as one, rather than something the
 * screen has to make sense of.
 */
export function isLeaderboardPage(value: unknown): value is LeaderboardPage {
  if (typeof value !== 'object' || value === null) return false

  const page = value as Record<string, unknown>
  const meta = page.meta as Record<string, unknown> | null | undefined
  const period = page.period as Record<string, unknown> | null | undefined

  return (WINDOWS as readonly unknown[]).includes(page.window)
    && (period === null
      || (typeof period === 'object' && typeof period?.starts_at === 'string' && typeof period?.ends_at === 'string'))
    && Array.isArray(page.data) && page.data.every(isLeaderboardEntry)
    && (page.own_entry === null || isLeaderboardEntry(page.own_entry))
    && typeof meta === 'object' && meta !== null
    && typeof meta.has_more === 'boolean'
    && (meta.next_cursor === null || typeof meta.next_cursor === 'string')
}

function isWindow(value: unknown): value is LeaderboardQuery['window'] {
  return typeof value === 'string' && (WINDOWS as readonly string[]).includes(value)
}

function isLeaderboardEntry(value: unknown): value is LeaderboardEntry {
  if (typeof value !== 'object' || value === null) return false

  const entry = value as Record<string, unknown>

  return Number.isInteger(entry.rank) && (entry.rank as number) >= 1
    && typeof entry.display_name === 'string'
    && Number.isInteger(entry.score) && (entry.score as number) >= 0
    && typeof entry.is_self === 'boolean'
}

function invalid(detail: string): UpstreamProblem {
  return new UpstreamProblem(bffProblem(BffProblemCode.InvalidRequest, 422, detail))
}
