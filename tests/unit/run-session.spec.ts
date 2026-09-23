// @vitest-environment happy-dom
//
// A store rather than a component, so it lives with the unit tests — but it
// listens for the browser's `online` event, so it needs a window.

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BffError } from '~/composables/useBffClient'
import type { ApiProblem } from '~/composables/useApiProblem'
import { useAuthStore } from '~/stores/auth'
import {
  RETRY_BACKOFF_SECONDS,
  isRetryable,
  retryDelayMs,
  toTelemetry,
  useRunSessionStore,
} from '~/stores/run-session'
import type { RunResult, StartedRun } from '~/types/run'

/**
 * The browser half of the run lifecycle (M9).
 *
 * What is proven here, against a stubbed BFF client:
 *
 *  - nothing is playable until the **server** has started a run, and a failed
 *    start invents nothing locally;
 *  - a finish is proposed once, and every retry of it is the same request —
 *    the BFF owns the key, so "the same request" is literally the same call;
 *  - retries happen only for failures a resend can outlive, on backoff, never
 *    sooner than `retry_after`, and at once when the connection returns;
 *  - a pending finish from before a reload is delivered before a new run;
 *  - nothing survives a sign-out or a change of account.
 *
 * The client is reached through the `useBffClient` auto-import, so it is
 * stubbed as a global — which also documents exactly what the store calls.
 */

const RUN: StartedRun = {
  run_id: '01999999-9999-7999-8999-999999999999',
  character_id: 'aysenur',
  seed: 4242,
  started_at: '2026-09-23T12:00:00.000Z',
  loli_cycle_paws: 7,
}

function result(overrides: Partial<RunResult> = {}): RunResult {
  return {
    run_id: RUN.run_id,
    status: 'accepted',
    score: 1000,
    run_paws: 50,
    is_personal_best: true,
    previous_best_score: 0,
    reasons: [],
    progression: {
      lifetime_paws: 50,
      loli_cycle_paws: 57,
      loli_threshold: 200,
      best_score: 1000,
      run_count: 1,
      tutorial_completed: true,
    },
    achievements_unlocked: [],
    characters_unlocked: [],
    ...overrides,
  }
}

function problem(status: number, code: string, extra: Partial<ApiProblem> = {}): BffError {
  return new BffError({ type: `urn:purrenade:error:${code}`, title: code, status, detail: code, code, ...extra })
}

const offline = () => problem(0, 'client_network_error')

const SUMMARY = { score: 1000, runPaws: 50, elapsedMs: 30123.9 }

let client: {
  pendingRunFinish: ReturnType<typeof vi.fn>
  startRun: ReturnType<typeof vi.fn>
  finishRun: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0.5)

  client = {
    pendingRunFinish: vi.fn(async () => ({ pending: null })),
    startRun: vi.fn(async () => ({ run: RUN, resumed: false })),
    finishRun: vi.fn(async () => ({ result: result() })),
  }

  vi.stubGlobal('useBffClient', () => client)
  vi.stubGlobal('invalidateCsrfToken', vi.fn())
})

afterEach(() => {
  useRunSessionStore().reset()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('starting', () => {
  it('asks the server, and is ready only with the server\'s run', async () => {
    const session = useRunSessionStore()

    expect(session.run).toBeNull()

    await session.begin('aysenur')

    expect(client.startRun).toHaveBeenCalledWith('aysenur')
    expect(session.phase).toBe('ready')
    expect(session.run).toEqual(RUN)
    expect(session.resumed).toBe(false)
    expect(session.starts).toBe(1)
  })

  it('reports a resumed run as resumed', async () => {
    client.startRun.mockResolvedValueOnce({ run: RUN, resumed: true })
    const session = useRunSessionStore()

    await session.begin()

    expect(session.resumed).toBe(true)
  })

  it('invents nothing when the start fails offline — no run, no seed', async () => {
    client.startRun.mockRejectedValueOnce(offline())
    const session = useRunSessionStore()

    await session.begin()

    expect(session.phase).toBe('start_failed')
    expect(session.problemCode).toBe('client_network_error')
    expect(session.run).toBeNull()
  })

  it('counts a resume of the same run as a new start, so the page remounts it', async () => {
    client.startRun.mockResolvedValue({ run: RUN, resumed: true })
    const session = useRunSessionStore()

    await session.begin()
    await session.begin()

    expect(session.starts).toBe(2)
  })

  it('ignores a second begin while one is in flight', async () => {
    let release: (value: unknown) => void = () => {}
    client.startRun.mockImplementationOnce(() => new Promise((resolve) => {
      release = resolve
    }))
    const session = useRunSessionStore()

    const first = session.begin()
    await vi.waitFor(() => expect(session.phase).toBe('starting'))
    await session.begin()

    release({ run: RUN, resumed: false })
    await first

    expect(client.startRun).toHaveBeenCalledTimes(1)
  })
})

describe('finishing', () => {
  it('proposes the summary once, as integers, and shows the server\'s answer', async () => {
    const session = useRunSessionStore()
    await session.begin()

    await session.submit(SUMMARY)

    expect(client.finishRun).toHaveBeenCalledTimes(1)
    expect(client.finishRun).toHaveBeenCalledWith(RUN.run_id, {
      reported_duration_ms: 30123,
      reported_score: 1000,
      reported_run_paws: 50,
    })
    expect(session.phase).toBe('outcome')
    expect(session.outcome?.status).toBe('accepted')
  })

  it('submits at most once per started run', async () => {
    const session = useRunSessionStore()
    await session.begin()

    await session.submit(SUMMARY)
    await session.submit(SUMMARY)

    expect(client.finishRun).toHaveBeenCalledTimes(1)
  })

  it('does not submit without a server run', async () => {
    const session = useRunSessionStore()

    await session.submit(SUMMARY)

    expect(client.finishRun).not.toHaveBeenCalled()
  })

  it.each(['accepted', 'flagged', 'rejected'] as const)('relays a %s outcome as the server gave it', async (status) => {
    client.finishRun.mockResolvedValueOnce({ result: result({ status }) })
    const session = useRunSessionStore()
    await session.begin()

    await session.submit(SUMMARY)

    expect(session.phase).toBe('outcome')
    expect(session.outcome?.status).toBe(status)
  })
})

describe('retrying', () => {
  it('keeps the same request across retries — and clears the wait only on an answer', async () => {
    client.finishRun
      .mockRejectedValueOnce(offline())
      .mockRejectedValueOnce(problem(502, 'bff_upstream_unavailable'))
      .mockRejectedValueOnce(problem(504, 'bff_upstream_timeout'))
      .mockRejectedValueOnce(problem(503, 'bff_session_unavailable'))
      .mockRejectedValueOnce(offline())
      .mockResolvedValueOnce({ result: result() })

    const session = useRunSessionStore()
    await session.begin()
    await session.submit(SUMMARY)

    expect(session.phase).toBe('retry_wait')

    for (let attempt = 0; attempt < 5; attempt++) {
      await vi.advanceTimersByTimeAsync(retryDelayMs(attempt, undefined, 0.5))
    }

    expect(session.phase).toBe('outcome')
    expect(client.finishRun).toHaveBeenCalledTimes(6)

    // Every attempt named the same run with the same proposal. The key itself
    // never reaches the browser: the BFF resends the payload it stored under it.
    const calls = client.finishRun.mock.calls

    expect(new Set(calls.map(call => JSON.stringify(call))).size).toBe(1)
  })

  it('never retries a final refusal', async () => {
    for (const refusal of [
      problem(409, 'run_not_active'),
      problem(409, 'idempotency_key_reused'),
      problem(404, 'not_found'),
      problem(422, 'validation_failed'),
      problem(403, 'email_not_verified'),
      problem(401, 'unauthenticated'),
    ]) {
      setActivePinia(createPinia())
      client.finishRun.mockReset().mockRejectedValue(refusal)
      const session = useRunSessionStore()
      await session.begin()

      await session.submit(SUMMARY)
      await vi.advanceTimersByTimeAsync(10 * 60_000)

      expect(session.phase).toBe('closed')
      expect(session.problemCode).toBe(refusal.problem.code)
      expect(client.finishRun).toHaveBeenCalledTimes(1)

      session.reset()
    }
  })

  it('waits no less than the server\'s retry_after after a 429', async () => {
    client.finishRun
      .mockRejectedValueOnce(problem(429, 'rate_limited', { retry_after: 45 }))
      .mockResolvedValueOnce({ result: result() })

    const session = useRunSessionStore()
    await session.begin()
    await session.submit(SUMMARY)

    // The backoff alone would have retried after about 2 s.
    await vi.advanceTimersByTimeAsync(44_000)
    expect(client.finishRun).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(client.finishRun).toHaveBeenCalledTimes(2)
    expect(session.phase).toBe('outcome')
  })

  it('retries at once when the connection comes back', async () => {
    client.finishRun
      .mockRejectedValueOnce(offline())
      .mockResolvedValueOnce({ result: result() })

    const session = useRunSessionStore()
    await session.begin()
    await session.submit(SUMMARY)

    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)

    expect(client.finishRun).toHaveBeenCalledTimes(2)
    expect(session.phase).toBe('outcome')
  })

  it('retries when the player asks', async () => {
    client.finishRun
      .mockRejectedValueOnce(offline())
      .mockResolvedValueOnce({ result: result() })

    const session = useRunSessionStore()
    await session.begin()
    await session.submit(SUMMARY)

    await session.retryNow()

    expect(session.phase).toBe('outcome')
  })
})

describe('the backoff schedule', () => {
  it('follows 2, 4, 8, 16, 30, then 60 seconds, capped', () => {
    const seconds = [0, 1, 2, 3, 4, 5, 6, 12].map(attempt => retryDelayMs(attempt, undefined, 0.5) / 1000)

    expect(seconds).toEqual([2, 4, 8, 16, 30, 60, 60, 60])
    expect(RETRY_BACKOFF_SECONDS).toEqual([2, 4, 8, 16, 30, 60])
  })

  it('jitters by ±20%', () => {
    expect(retryDelayMs(0, undefined, 0)).toBe(1600)
    expect(retryDelayMs(0, undefined, 0.999999)).toBe(2400)
  })

  it('never goes below retry_after', () => {
    expect(retryDelayMs(0, 30, 0.5)).toBe(30_000)
    expect(retryDelayMs(5, 30, 0.5)).toBe(60_000)
  })

  it('classifies what a resend can outlive', () => {
    const p = (status: number): ApiProblem => ({ type: '', title: '', detail: '', code: 'x', status })

    for (const status of [0, 408, 429, 500, 502, 503, 504]) expect(isRetryable(p(status))).toBe(true)
    for (const status of [400, 401, 403, 404, 409, 419, 422]) expect(isRetryable(p(status))).toBe(false)
  })
})

describe('recovering a pending finish', () => {
  it('delivers it before starting a new run', async () => {
    client.pendingRunFinish.mockResolvedValueOnce({
      pending: { runId: RUN.run_id, telemetry: { reported_duration_ms: 1, reported_score: 2, reported_run_paws: 0 } },
    })
    const order: string[] = []
    client.finishRun.mockImplementationOnce(async () => {
      order.push('finish')

      return { result: result() }
    })
    client.startRun.mockImplementationOnce(async () => {
      order.push('start')

      return { run: { ...RUN, run_id: '01999999-9999-7999-8999-999999999998' }, resumed: false }
    })

    const session = useRunSessionStore()
    await session.begin()

    // Resent with no proposal of its own: the BFF resends the stored payload.
    expect(client.finishRun).toHaveBeenCalledWith(RUN.run_id, null)
    expect(order).toEqual(['finish', 'start'])
    expect(session.previousDelivered?.status).toBe('accepted')
    expect(session.phase).toBe('ready')
  })

  it('blocks a new run while the pending finish cannot be delivered, then carries on', async () => {
    client.pendingRunFinish.mockResolvedValue({
      pending: { runId: RUN.run_id, telemetry: { reported_duration_ms: 1, reported_score: 2, reported_run_paws: 0 } },
    })
    client.finishRun.mockRejectedValueOnce(offline())

    const session = useRunSessionStore()
    await session.begin()

    expect(session.phase).toBe('blocked')
    expect(client.startRun).not.toHaveBeenCalled()

    client.pendingRunFinish.mockResolvedValue({ pending: null })
    await vi.advanceTimersByTimeAsync(retryDelayMs(0, undefined, 0.5))

    expect(session.phase).toBe('ready')
    expect(client.startRun).toHaveBeenCalledTimes(1)
  })

  it('moves on when the pending finish is definitively refused', async () => {
    client.pendingRunFinish.mockResolvedValueOnce({
      pending: { runId: RUN.run_id, telemetry: { reported_duration_ms: 1, reported_score: 2, reported_run_paws: 0 } },
    })
    client.finishRun.mockRejectedValueOnce(problem(409, 'run_not_active'))

    const session = useRunSessionStore()
    await session.begin()

    expect(session.phase).toBe('ready')
    expect(session.previousDelivered).toBeNull()
  })
})

describe('leaving and coming back in the same tab', () => {
  it('delivers an undelivered proposal before starting again — even one the BFF never saw', async () => {
    client.finishRun.mockRejectedValueOnce(offline())
    const session = useRunSessionStore()
    await session.begin()
    await session.submit(SUMMARY)

    expect(session.phase).toBe('retry_wait')

    // Off to the menu and back: the page acknowledges nothing final, and PLAY
    // begins again. The BFF holds nothing — the first attempt never reached it.
    session.acknowledge()
    client.pendingRunFinish.mockResolvedValue({ pending: null })
    client.finishRun.mockResolvedValueOnce({ result: result() })

    await session.begin()

    expect(client.finishRun).toHaveBeenCalledTimes(2)
    expect(client.finishRun.mock.calls[1]).toEqual(client.finishRun.mock.calls[0])
    expect(session.previousDelivered?.status).toBe('accepted')
    expect(session.undelivered).toBeNull()
    expect(session.phase).toBe('ready')
  })

  it('stays blocked while it still cannot be delivered, and starts nothing', async () => {
    client.finishRun.mockRejectedValue(offline())
    const session = useRunSessionStore()
    await session.begin()
    await session.submit(SUMMARY)

    await session.begin()

    expect(session.phase).toBe('blocked')
    expect(client.startRun).toHaveBeenCalledTimes(1)
    expect(session.undelivered).not.toBeNull()
  })
})

describe('account isolation', () => {
  it('forgets everything, timers included, when the account signs out', async () => {
    client.finishRun.mockRejectedValue(offline())
    const session = useRunSessionStore()
    await session.begin()
    await session.submit(SUMMARY)

    expect(session.phase).toBe('retry_wait')

    useAuthStore().reset()

    expect(session.phase).toBe('idle')
    expect(session.run).toBeNull()
    expect(session.proposed).toBeNull()

    await vi.advanceTimersByTimeAsync(10 * 60_000)

    // No retry fired for an account that is no longer signed in.
    expect(client.finishRun).toHaveBeenCalledTimes(1)
  })

  it('resets when a different account begins', async () => {
    const auth = useAuthStore()
    auth.user = { id: 1 } as never
    const session = useRunSessionStore()
    await session.begin()
    session.outcome = result()

    auth.user = { id: 2 } as never
    client.startRun.mockImplementationOnce(async () => {
      expect(session.outcome).toBeNull()

      return { run: RUN, resumed: false }
    })

    await session.begin()

    expect(session.ownerUserId).toBe(2)
  })
})

describe('the proposal', () => {
  it('floors to integers, the only numbers the protocol accepts', () => {
    expect(toTelemetry({ score: 99.9, runPaws: 3, elapsedMs: 4000.999 })).toEqual({
      reported_duration_ms: 4000,
      reported_score: 99,
      reported_run_paws: 3,
    })
  })
})
