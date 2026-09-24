import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiProblem } from '~/composables/useApiProblem'
import { BffError } from '~/composables/useBffClient'
import { isCursorInvalid, useLeaderboardStore } from '~/stores/leaderboard'
import type { LeaderboardEntry, LeaderboardPage, LeaderboardWindow } from '~/types/leaderboard'

/**
 * The leaderboard's view state (M10), against a stubbed BFF client.
 *
 * What is proven here:
 *
 *  - every rank, score and own entry shown is the server's, untouched;
 *  - "load more" appends the next page from the server's cursor, and the own
 *    entry is always the latest answer's;
 *  - a tab switch, a refresh and a rejected cursor all start again from the
 *    first page — the last one silently;
 *  - an answer that arrives after the player moved on is dropped.
 */

function entry(rank: number, overrides: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return { rank, display_name: `player${rank}`, score: 10_000 - rank * 10, is_self: false, ...overrides }
}

function page(window: LeaderboardWindow, ranks: number[], overrides: Partial<LeaderboardPage> = {}): LeaderboardPage {
  return {
    window,
    period: window === 'weekly' ? { starts_at: '2026-09-20T21:00:00.000Z', ends_at: '2026-09-27T21:00:00.000Z' } : null,
    data: ranks.map(rank => entry(rank)),
    own_entry: entry(40, { is_self: true, display_name: 'me' }),
    meta: { next_cursor: null, has_more: false },
    ...overrides,
  }
}

function problem(status: number, code: string, extra: Partial<ApiProblem> = {}): BffError {
  return new BffError({ type: `urn:purrenade:error:${code}`, title: code, status, detail: code, code, ...extra })
}

let leaderboard: ReturnType<typeof vi.fn>

beforeEach(() => {
  setActivePinia(createPinia())
  leaderboard = vi.fn()
  ;(globalThis as Record<string, unknown>).useBffClient = () => ({ leaderboard })
})

describe('loading a board', () => {
  it('starts on the weekly board and shows exactly what the server sent', async () => {
    const answer = page('weekly', [1, 2, 3], { meta: { next_cursor: 'c1', has_more: true } })
    leaderboard.mockResolvedValueOnce(answer)
    const board = useLeaderboardStore()

    await board.load()

    expect(leaderboard).toHaveBeenCalledWith('weekly')
    expect(board.status).toBe('ready')
    expect(board.currentWindow).toBe('weekly')
    expect(board.entries).toEqual(answer.data)
    expect(board.ownEntry).toEqual(answer.own_entry)
    expect(board.period).toEqual(answer.period)
    expect(board.nextCursor).toBe('c1')
    expect(board.hasMore).toBe(true)
  })

  it('reports a failure as an error with the problem, and retries from the top', async () => {
    leaderboard.mockRejectedValueOnce(problem(502, 'bff_upstream_unavailable'))
    const board = useLeaderboardStore()

    await board.load()

    expect(board.status).toBe('error')
    expect(board.problem?.code).toBe('bff_upstream_unavailable')

    leaderboard.mockResolvedValueOnce(page('weekly', [1]))
    await board.refresh()

    expect(board.status).toBe('ready')
    expect(board.problem).toBeNull()
    expect(leaderboard).toHaveBeenLastCalledWith('weekly')
  })

  it('keeps a null own entry null — the client never invents one', async () => {
    leaderboard.mockResolvedValueOnce(page('weekly', [1, 2], { own_entry: null }))
    const board = useLeaderboardStore()

    await board.load()

    expect(board.ownEntry).toBeNull()
  })
})

describe('load more', () => {
  it('appends the next page from the server\'s cursor, ranks as given, and takes the fresher own entry', async () => {
    leaderboard
      .mockResolvedValueOnce(page('all_time', [1, 2], { meta: { next_cursor: 'c1', has_more: true } }))
      // Two players moved above the cursor meanwhile: ranks skip from 2 to 5.
      .mockResolvedValueOnce(page('all_time', [5, 6], {
        own_entry: entry(38, { is_self: true, display_name: 'me' }),
        meta: { next_cursor: null, has_more: false },
      }))
    const board = useLeaderboardStore()

    await board.load('all_time')
    await board.loadMore()

    expect(leaderboard).toHaveBeenLastCalledWith('all_time', 'c1')
    expect(board.entries.map(e => e.rank)).toEqual([1, 2, 5, 6])
    expect(board.ownEntry?.rank).toBe(38)
    expect(board.hasMore).toBe(false)
    expect(board.nextCursor).toBeNull()
  })

  it('does nothing without a cursor, and never runs twice at once', async () => {
    let release: (value: LeaderboardPage) => void = () => {}
    leaderboard.mockResolvedValueOnce(page('weekly', [1], { meta: { next_cursor: 'c1', has_more: true } }))
    const board = useLeaderboardStore()
    await board.load()

    leaderboard.mockImplementationOnce(() => new Promise((resolve) => {
      release = resolve
    }))

    const first = board.loadMore()
    const second = board.loadMore()

    expect(board.loadingMore).toBe(true)
    release(page('weekly', [2]))
    await Promise.all([first, second])

    expect(leaderboard).toHaveBeenCalledTimes(2)

    await board.loadMore()
    expect(leaderboard).toHaveBeenCalledTimes(2)
  })

  it('starts again from the first page when the server refuses the cursor', async () => {
    leaderboard
      .mockResolvedValueOnce(page('weekly', [1, 2], { meta: { next_cursor: 'stale', has_more: true } }))
      .mockRejectedValueOnce(problem(422, 'validation_failed', {
        errors: { cursor: [{ code: 'cursor_invalid', message: 'Start again.' }] },
      }))
      .mockResolvedValueOnce(page('weekly', [1, 2, 3]))
    const board = useLeaderboardStore()

    await board.load()
    await board.loadMore()

    expect(leaderboard.mock.calls).toEqual([['weekly'], ['weekly', 'stale'], ['weekly']])
    expect(board.status).toBe('ready')
    expect(board.entries.map(e => e.rank)).toEqual([1, 2, 3])
    expect(board.moreProblem).toBeNull()
  })

  it('keeps the list and reports the failure when a further page fails otherwise', async () => {
    leaderboard
      .mockResolvedValueOnce(page('weekly', [1, 2], { meta: { next_cursor: 'c1', has_more: true } }))
      .mockRejectedValueOnce(problem(504, 'bff_upstream_timeout'))
    const board = useLeaderboardStore()

    await board.load()
    await board.loadMore()

    expect(board.status).toBe('ready')
    expect(board.entries.map(e => e.rank)).toEqual([1, 2])
    expect(board.moreProblem?.code).toBe('bff_upstream_timeout')
    expect(board.loadingMore).toBe(false)
    expect(board.nextCursor).toBe('c1')
  })
})

describe('tabs', () => {
  it('switches window from the first page, dropping the old cursor', async () => {
    leaderboard
      .mockResolvedValueOnce(page('weekly', [1], { meta: { next_cursor: 'weekly-cursor', has_more: true } }))
      .mockResolvedValueOnce(page('all_time', [1, 2]))
    const board = useLeaderboardStore()

    await board.load()
    await board.select('all_time')

    expect(leaderboard).toHaveBeenLastCalledWith('all_time')
    expect(board.currentWindow).toBe('all_time')
    expect(board.nextCursor).toBeNull()
    expect(board.period).toBeNull()
  })

  it('does not reload when the selected tab is chosen again', async () => {
    leaderboard.mockResolvedValue(page('weekly', [1]))
    const board = useLeaderboardStore()

    await board.load()
    await board.select('weekly')

    expect(leaderboard).toHaveBeenCalledTimes(1)
  })

  it('drops an answer for a tab the player has already left', async () => {
    let releaseWeekly: (value: LeaderboardPage) => void = () => {}
    leaderboard
      .mockImplementationOnce(() => new Promise((resolve) => {
        releaseWeekly = resolve
      }))
      .mockResolvedValueOnce(page('all_time', [7]))
    const board = useLeaderboardStore()

    const weekly = board.load('weekly')
    await board.select('all_time')
    releaseWeekly(page('weekly', [1, 2, 3]))
    await weekly

    expect(board.currentWindow).toBe('all_time')
    expect(board.entries.map(e => e.rank)).toEqual([7])
  })

  it('forgets everything on reset', async () => {
    leaderboard.mockResolvedValue(page('all_time', [1]))
    const board = useLeaderboardStore()

    await board.load('all_time')
    board.reset()

    expect(board.status).toBe('idle')
    expect(board.currentWindow).toBe('weekly')
    expect(board.entries).toEqual([])
    expect(board.ownEntry).toBeNull()
  })
})

describe('isCursorInvalid', () => {
  it('recognises only the cursor field refusal', () => {
    expect(isCursorInvalid(problem(422, 'validation_failed', { errors: { cursor: [{ code: 'cursor_invalid', message: '' }] } }).problem)).toBe(true)
    expect(isCursorInvalid(problem(422, 'validation_failed', { errors: { limit: [{ code: 'out_of_range', message: '' }] } }).problem)).toBe(false)
    expect(isCursorInvalid(problem(422, 'bff_invalid_request').problem)).toBe(false)
  })
})
