import { defineStore } from 'pinia'
import type { RunSummary } from '~~/game/bridge'
import { toApiProblem } from '~/composables/useApiProblem'
import type { ApiProblem } from '~/composables/useApiProblem'
import { BffError } from '~/composables/useBffClient'
import { useAuthStore } from '~/stores/auth'
import type { RunResult, RunTelemetry, StartedRun } from '~/types/run'

/**
 * The normal run's lifecycle, as the browser sees it (M9, ADR-0006).
 *
 * **The server owns the run.** This store holds the run's server identity, the
 * submission's progress and the server's answer — never gameplay state, never
 * a local seed, and never an outcome it inferred. Laravel starts the run,
 * issues the seed and classifies the finish; this store sequences the calls
 * and tells the page what to show.
 *
 * ```
 * idle ─begin()→ resolving ─(nothing pending, or delivered)→ starting ─201/200→ ready
 *                    │ (offline, 5xx, 429)                        └─(error)→ start_failed
 *                    └→ blocked (retries on backoff and on `online`)
 * ready ─submit()→ submitting ─200→ outcome (accepted | flagged | rejected)
 *                      │ (offline, 5xx, 429) → retry_wait ─(timer | online | retryNow)→ submitting
 *                      └ (404, 409, 422, 403, 401) → closed
 * ```
 *
 * **Nothing is stored in the browser.** Memory for the life of the tab, and
 * the BFF session for anything that has to survive a reload: the pending
 * finish — the stable retry payload and its `Idempotency-Key` — lives there,
 * written before the first attempt (`server/utils/run-finish.ts`). A reload
 * finds it through `GET /api/game-runs/pending` and resends it before any new
 * run can start.
 *
 * **Retry.** Only for failures a resend of the same request can outlive: no
 * connection, `5xx`, a BFF timeout, `429`. Backoff 2, 4, 8, 16, 30, then 60
 * seconds, ±20% jitter, never sooner than a `retry_after` the server gave; an
 * `online` event retries at once. A final refusal is never retried.
 */

export type RunSessionPhase =
  | 'idle'
  | 'resolving'
  | 'blocked'
  | 'starting'
  | 'start_failed'
  | 'ready'
  | 'submitting'
  | 'retry_wait'
  | 'outcome'
  | 'closed'

/** The only character a new normal run is started as, until M11 unlocks more. */
export const DEFAULT_CHARACTER_ID = 'aysenur'

/** Seconds. The longest wait between automatic retries. */
export const RETRY_BACKOFF_CAP_SECONDS = 60

/** Seconds. Index by attempt; the last entry, the cap, repeats. */
export const RETRY_BACKOFF_SECONDS = [2, 4, 8, 16, 30, RETRY_BACKOFF_CAP_SECONDS] as const

const RETRY_JITTER = 0.2

/**
 * How long to wait before retry number `attempt` (0-based).
 *
 * Pure, so the schedule is tested rather than trusted. `random` is `[0, 1)`.
 */
export function retryDelayMs(attempt: number, retryAfterSeconds: number | undefined, random: number): number {
  const index = Math.min(Math.max(attempt, 0), RETRY_BACKOFF_SECONDS.length - 1)
  const base = (RETRY_BACKOFF_SECONDS[index] ?? RETRY_BACKOFF_CAP_SECONDS) * 1000
  const jittered = Math.round(base * (1 - RETRY_JITTER + 2 * RETRY_JITTER * random))
  const floor = retryAfterSeconds !== undefined && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 0

  return Math.max(jittered, floor)
}

/**
 * Could resending the same request succeed later?
 *
 * Yes for no connection (status 0), a rate limit, the BFF's own timeouts and
 * store failures, and any server error. No for everything else: a refusal the
 * server would repeat — the run is final, not found, or the request invalid —
 * or a session that has ended.
 */
export function isRetryable(problem: ApiProblem): boolean {
  return problem.status === 0
    || problem.status === 429
    || problem.status === 408
    || problem.status >= 500
}

/** The proposal, in the contract's names. `elapsedMs` is floored: the protocol is integers. */
export function toTelemetry(summary: RunSummary): RunTelemetry {
  return {
    reported_duration_ms: Math.floor(summary.elapsedMs),
    reported_score: Math.floor(summary.score),
    reported_run_paws: Math.floor(summary.runPaws),
  }
}

interface RunSessionState {
  phase: RunSessionPhase
  /** The server run the page may play. Set only by a successful start. */
  run: StartedRun | null
  /** Whether that run was resumed rather than created — never shown as fresh. */
  resumed: boolean
  /** Counts successful starts, so a resume of the *same* run still remounts. */
  starts: number
  /** The server's answer to the finish. */
  outcome: RunResult | null
  /** The code of a failure the page explains (start, or a final refusal). */
  problemCode: string | null
  /** When the next automatic retry fires (epoch ms), while waiting. */
  retryAt: number | null
  /** Automatic retries so far in the current wait. */
  attempt: number
  /** What the run proposed, shown while it is being saved. */
  proposed: RunTelemetry | null
  /**
   * A proposal this tab made that has not reached a final answer yet.
   *
   * Kept apart from `phase` so it survives the player leaving the run page and
   * coming back: while the tab lives, a finish that never even reached the BFF
   * — the device was offline — is still delivered before any new run starts.
   */
  undelivered: { runId: string, telemetry: RunTelemetry } | null
  /** A finish left over from before a reload, delivered on the way to a new run. */
  previousDelivered: RunResult | null
  /** Whose run this is. A different signed-in account resets everything. */
  ownerUserId: number | null
  characterId: string
}

let retryTimer: ReturnType<typeof setTimeout> | null = null
let onlineListener: (() => void) | null = null

function clearScheduledRetry(): void {
  if (retryTimer !== null) {
    clearTimeout(retryTimer)
    retryTimer = null
  }

  if (onlineListener !== null) {
    globalThis.window?.removeEventListener('online', onlineListener)
    onlineListener = null
  }
}

function problemOf(error: unknown): ApiProblem {
  if (error instanceof BffError) return error.problem

  return toApiProblem(error)
}

export const useRunSessionStore = defineStore('runSession', {
  state: (): RunSessionState => ({
    phase: 'idle',
    run: null,
    resumed: false,
    starts: 0,
    outcome: null,
    problemCode: null,
    retryAt: null,
    attempt: 0,
    proposed: null,
    undelivered: null,
    previousDelivered: null,
    ownerUserId: null,
    characterId: DEFAULT_CHARACTER_ID,
  }),

  getters: {
    /** A request is in flight: nothing else may be started. */
    busy: (state): boolean =>
      state.phase === 'resolving' || state.phase === 'starting' || state.phase === 'submitting',

    /** The finish has not reached a final answer yet. */
    saving: (state): boolean =>
      state.phase === 'submitting' || state.phase === 'retry_wait',
  },

  actions: {
    /**
     * Get a server run to play: deliver anything pending, then start.
     *
     * A new run is never started while a previous finish is undelivered — the
     * pending one goes first, and if it cannot, this stops at `blocked`.
     */
    async begin(characterId: string = DEFAULT_CHARACTER_ID): Promise<void> {
      if (this.busy) return

      this.guardOwner()
      clearScheduledRetry()

      this.characterId = characterId
      this.run = null
      this.resumed = false
      this.outcome = null
      this.problemCode = null
      this.proposed = null
      this.previousDelivered = null
      this.phase = 'resolving'

      // This tab's own undelivered proposal first — it may never have reached
      // the BFF, so the BFF's pending record cannot be relied on to hold it.
      if (this.undelivered !== null) {
        this.proposed = this.undelivered.telemetry

        const delivered = await this.deliver(this.undelivered.runId, this.undelivered.telemetry, 'blocked')

        if (delivered === 'retrying') return

        if (delivered !== null) this.previousDelivered = delivered
      }

      try {
        const { pending } = await useBffClient().pendingRunFinish()

        if (pending !== null) {
          this.proposed = pending.telemetry

          const delivered = await this.deliver(pending.runId, null, 'blocked')

          if (delivered === 'retrying') return

          if (delivered !== null) this.previousDelivered = delivered
        }
      }
      catch (error) {
        this.waitToRetry(problemOf(error), 'blocked')

        return
      }

      this.proposed = null
      this.phase = 'starting'

      try {
        const { run, resumed } = await useBffClient().startRun(characterId)

        this.run = run
        this.resumed = resumed
        this.starts++
        this.attempt = 0
        this.retryAt = null
        this.phase = 'ready'
      }
      catch (error) {
        const problem = problemOf(error)

        this.problemCode = problem.code
        this.phase = 'start_failed'
      }
    },

    /**
     * Propose the ended run's result. Exactly once per started run: a second
     * call, or one without a run, does nothing.
     */
    async submit(summary: RunSummary): Promise<void> {
      if (this.phase !== 'ready' || this.run === null) return

      clearScheduledRetry()

      this.proposed = toTelemetry(summary)
      this.undelivered = { runId: this.run.run_id, telemetry: this.proposed }
      this.attempt = 0
      this.phase = 'submitting'

      await this.deliver(this.run.run_id, this.proposed, 'retry_wait')
    },

    /** Retry now — the player asked, or the connection came back. */
    async retryNow(): Promise<void> {
      if (this.phase === 'blocked') {
        await this.begin(this.characterId)

        return
      }

      if (this.phase !== 'retry_wait' || this.undelivered === null) return

      clearScheduledRetry()
      this.phase = 'submitting'

      await this.deliver(this.undelivered.runId, this.undelivered.telemetry, 'retry_wait')
    },

    /**
     * One delivery attempt.
     *
     * Returns the server's result; `null` for a final refusal (the page is told
     * the run could not be recorded); `'retrying'` when a retry is scheduled.
     *
     * @internal
     */
    async deliver(
      runId: string,
      telemetry: RunTelemetry | null,
      waitPhase: 'retry_wait' | 'blocked',
    ): Promise<RunResult | null | 'retrying'> {
      try {
        const { result } = await useBffClient().finishRun(runId, telemetry)

        clearScheduledRetry()
        this.attempt = 0
        this.retryAt = null
        if (this.undelivered?.runId === runId) this.undelivered = null

        if (waitPhase === 'retry_wait') {
          this.outcome = result
          this.phase = 'outcome'
        }

        return result
      }
      catch (error) {
        const problem = problemOf(error)

        if (isRetryable(problem)) {
          this.waitToRetry(problem, waitPhase)

          return 'retrying'
        }

        clearScheduledRetry()
        this.retryAt = null
        if (this.undelivered?.runId === runId) this.undelivered = null

        if (waitPhase === 'retry_wait') {
          this.problemCode = problem.code
          this.phase = 'closed'
        }

        return null
      }
    },

    /** @internal */
    waitToRetry(problem: ApiProblem, phase: 'retry_wait' | 'blocked'): void {
      clearScheduledRetry()

      const delay = retryDelayMs(this.attempt, problem.retry_after, Math.random())

      this.problemCode = problem.code
      this.phase = phase
      this.retryAt = Date.now() + delay

      retryTimer = setTimeout(() => {
        retryTimer = null
        this.attempt++
        void this.retryNow()
      }, delay)

      if (globalThis.window !== undefined) {
        onlineListener = () => {
          void this.retryNow()
        }
        globalThis.window.addEventListener('online', onlineListener, { once: true })
      }
    },

    /** The page is leaving a finished outcome: nothing to keep. */
    acknowledge(): void {
      if (this.phase === 'outcome' || this.phase === 'closed') {
        this.phase = 'idle'
        this.outcome = null
        this.problemCode = null
        this.proposed = null
      }
    },

    /**
     * Forget everything, and stop any scheduled retry.
     *
     * Called on sign-out and when a different account appears. The pending
     * finish itself is not in here — it lives in the BFF session, which ends
     * with the sign-out — so nothing of one account can be sent as another.
     */
    reset(): void {
      clearScheduledRetry()
      this.$reset()
    },

    /** @internal */
    guardOwner(): void {
      const userId = useAuthStore().user?.id ?? null

      if (this.ownerUserId !== null && this.ownerUserId !== userId) this.reset()

      this.ownerUserId = userId
    },
  },
})
