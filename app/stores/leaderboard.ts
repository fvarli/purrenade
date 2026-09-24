import { defineStore } from 'pinia'
import { toApiProblem } from '~/composables/useApiProblem'
import type { ApiProblem } from '~/composables/useApiProblem'
import { BffError } from '~/composables/useBffClient'
import type { LeaderboardEntry, LeaderboardPeriod, LeaderboardWindow } from '~/types/leaderboard'

/**
 * The leaderboard screen's view state (M10, board 15).
 *
 * **View lifetime, never persisted, never cached.** Every visit, tab switch
 * and refresh asks the server again: the ranks, the player's own entry and
 * the cursor all come from the server, and nothing here computes or adjusts a
 * rank.
 *
 * ```
 * idle ─load(w)→ loading ─200→ ready ─loadMore()→ (appending) → ready
 *                   └─error→ error ─retry()→ loading
 * ```
 *
 * **Paging a live board.** Each page is internally consistent, but other
 * players keep finishing runs between pages, so ranks across pages may skip
 * (never repeat) — the API's consistency contract. The list shows the ranks it
 * was given; `refresh()` starts again from the top.
 *
 * **A cursor the server no longer accepts** (`cursor_invalid` — for example
 * after a key rotation) is not an error to show: the board silently reloads
 * from its first page, once.
 *
 * **Stale answers are dropped.** Switching tabs while a page is in flight
 * makes that page's answer irrelevant; each request carries a sequence number
 * and only the latest one is applied.
 */

export type LeaderboardStatus = 'idle' | 'loading' | 'ready' | 'error'

export const useLeaderboardStore = defineStore('leaderboard', () => {
  const currentWindow = ref<LeaderboardWindow>('weekly')
  const status = ref<LeaderboardStatus>('idle')
  const entries = ref<LeaderboardEntry[]>([])
  const ownEntry = ref<LeaderboardEntry | null>(null)
  const period = ref<LeaderboardPeriod | null>(null)
  const nextCursor = ref<string | null>(null)
  const hasMore = ref(false)
  const loadingMore = ref(false)
  const problem = ref<ApiProblem | null>(null)
  const moreProblem = ref<ApiProblem | null>(null)

  let sequence = 0

  async function load(target: LeaderboardWindow = currentWindow.value): Promise<void> {
    const request = ++sequence

    currentWindow.value = target
    status.value = 'loading'
    entries.value = []
    ownEntry.value = null
    period.value = null
    nextCursor.value = null
    hasMore.value = false
    loadingMore.value = false
    problem.value = null
    moreProblem.value = null

    try {
      const page = await useBffClient().leaderboard(target)

      if (request !== sequence) return

      entries.value = [...page.data]
      apply(page)
      status.value = 'ready'
    }
    catch (error) {
      if (request !== sequence) return

      problem.value = problemOf(error)
      status.value = 'error'
    }
  }

  async function loadMore(): Promise<void> {
    if (status.value !== 'ready' || loadingMore.value || nextCursor.value === null) return

    const request = sequence
    const cursor = nextCursor.value

    loadingMore.value = true
    moreProblem.value = null

    try {
      const page = await useBffClient().leaderboard(currentWindow.value, cursor)

      if (request !== sequence) return

      entries.value = [...entries.value, ...page.data]
      apply(page)
    }
    catch (error) {
      if (request !== sequence) return

      const failure = problemOf(error)

      if (isCursorInvalid(failure)) {
        await load(currentWindow.value)

        return
      }

      moreProblem.value = failure
    }
    finally {
      if (request === sequence) loadingMore.value = false
    }
  }

  /** Switch tabs. Always from the first page of the chosen window. */
  async function select(target: LeaderboardWindow): Promise<void> {
    if (target === currentWindow.value && status.value !== 'idle') return

    await load(target)
  }

  /** Back to the top of the current window, with fresh ranks. */
  async function refresh(): Promise<void> {
    await load(currentWindow.value)
  }

  function reset(): void {
    sequence++
    currentWindow.value = 'weekly'
    status.value = 'idle'
    entries.value = []
    ownEntry.value = null
    period.value = null
    nextCursor.value = null
    hasMore.value = false
    loadingMore.value = false
    problem.value = null
    moreProblem.value = null
  }

  function apply(page: { own_entry: LeaderboardEntry | null, period: LeaderboardPeriod | null, meta: { next_cursor: string | null, has_more: boolean } }): void {
    // The own entry is fresh on every page, so the latest answer wins.
    ownEntry.value = page.own_entry
    period.value = page.period
    nextCursor.value = page.meta.next_cursor
    hasMore.value = page.meta.has_more
  }

  return {
    currentWindow, status, entries, ownEntry, period, nextCursor, hasMore, loadingMore, problem, moreProblem,
    load, loadMore, select, refresh, reset,
  }
})

function problemOf(error: unknown): ApiProblem {
  return error instanceof BffError ? error.problem : toApiProblem(error)
}

/** The API's refusal of a cursor it did not mint for this board, or no longer accepts. */
export function isCursorInvalid(problem: ApiProblem): boolean {
  return problem.status === 422 && problem.errors?.cursor?.[0]?.code === 'cursor_invalid'
}
