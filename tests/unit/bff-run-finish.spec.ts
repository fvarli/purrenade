import { describe, expect, it, vi } from 'vitest'
import { bffProblem } from '~~/server/utils/problem'
import type { RunResult } from '~~/server/utils/contracts'
import {
  isFinalRefusal,
  isUsableRunResult,
  isUsableStartedRun,
  parseTelemetry,
  submitRunFinish,
} from '~~/server/utils/run-finish'
import type { PendingRunFinish, PendingRunFinishStore } from '~~/server/utils/run-finish'
import { Endpoint, UpstreamProblem, gameRunFinishPath } from '~~/server/utils/upstream'

/**
 * The BFF's half of an idempotent finish (M9).
 *
 * The properties that make retrying safe live here: the retry payload is
 * stored **before** the first attempt, the `Idempotency-Key` is generated once
 * and resent unchanged, the stored payload wins over whatever the browser sends
 * later, and it is cleared only on a final answer.
 */

const RUN_ID = '01999999-9999-7999-8999-999999999999'
const OTHER_RUN = '01999999-9999-7999-8999-999999999998'
const TELEMETRY = { reported_duration_ms: 30000, reported_score: 1000, reported_run_paws: 50 }

function memoryStore(): PendingRunFinishStore & { data: Map<string, PendingRunFinish>, log: string[] } {
  const data = new Map<string, PendingRunFinish>()
  const log: string[] = []

  return {
    data,
    log,
    get: async (id) => {
      log.push('get')

      return data.get(id) ?? null
    },
    set: async (id, pending) => {
      log.push('set')
      data.set(id, pending)
    },
    clear: async (id) => {
      log.push('clear')
      data.delete(id)
    },
  }
}

function result(): RunResult {
  return {
    run_id: RUN_ID,
    status: 'accepted',
    score: 1000,
    run_paws: 50,
    is_personal_best: true,
    previous_best_score: 0,
    reasons: [],
    progression: {
      lifetime_paws: 50, loli_cycle_paws: 50, loli_threshold: 200, best_score: 1000, run_count: 1, tutorial_completed: true,
    },
    achievements_unlocked: [],
    characters_unlocked: [],
  }
}

const upstream = (status: number, code = 'x') => new UpstreamProblem(bffProblem('bff_upstream_unavailable', status, code, { code }))

describe('submitRunFinish', () => {
  it('stores the retry payload before the first attempt', async () => {
    const store = memoryStore()
    const send = vi.fn(async (pending: PendingRunFinish) => {
      // At the moment of sending, the payload is already durable.
      expect(store.data.get('s1')).toEqual(pending)

      return result()
    })

    await submitRunFinish({ store, sessionId: 's1', runId: RUN_ID, telemetry: TELEMETRY, send, newKey: () => 'key-1', now: () => 5 })

    expect(send).toHaveBeenCalledWith({ runId: RUN_ID, idempotencyKey: 'key-1', telemetry: TELEMETRY, createdAt: 5 })
    expect(store.log).toEqual(['get', 'set', 'clear'])
  })

  it('resends the stored key and payload on every retry, whatever the browser sends', async () => {
    const store = memoryStore()
    const keys: string[] = []
    const payloads: unknown[] = []
    let failures = 3
    const send = vi.fn(async (pending: PendingRunFinish) => {
      keys.push(pending.idempotencyKey)
      payloads.push(pending.telemetry)

      if (failures-- > 0) throw upstream(502)

      return result()
    })
    let issued = 0
    const newKey = () => `key-${++issued}`

    for (const telemetry of [TELEMETRY, { ...TELEMETRY, reported_score: 999_999 }, null]) {
      await expect(submitRunFinish({ store, sessionId: 's1', runId: RUN_ID, telemetry, send, newKey }))
        .rejects.toBeInstanceOf(UpstreamProblem)
    }

    await submitRunFinish({ store, sessionId: 's1', runId: RUN_ID, telemetry: null, send, newKey })

    expect(new Set(keys)).toEqual(new Set(['key-1']))
    expect(payloads.every(p => JSON.stringify(p) === JSON.stringify(TELEMETRY))).toBe(true)
    expect(issued).toBe(1)
    expect(store.data.size).toBe(0)
  })

  it.each([429, 401, 500, 502, 503, 504])('keeps the payload after a %i', async (status) => {
    const store = memoryStore()

    await expect(submitRunFinish({
      store, sessionId: 's1', runId: RUN_ID, telemetry: TELEMETRY, send: async () => { throw upstream(status) },
    })).rejects.toBeInstanceOf(UpstreamProblem)

    expect(store.data.has('s1')).toBe(true)
  })

  it.each([403, 404, 409, 422])('clears the payload after a final %i', async (status) => {
    const store = memoryStore()

    await expect(submitRunFinish({
      store, sessionId: 's1', runId: RUN_ID, telemetry: TELEMETRY, send: async () => { throw upstream(status) },
    })).rejects.toBeInstanceOf(UpstreamProblem)

    expect(store.data.has('s1')).toBe(false)
  })

  it('keeps the payload when the send fails unexpectedly', async () => {
    const store = memoryStore()

    await expect(submitRunFinish({
      store, sessionId: 's1', runId: RUN_ID, telemetry: TELEMETRY, send: async () => { throw new Error('socket') },
    })).rejects.toThrow('socket')

    expect(store.data.has('s1')).toBe(true)
  })

  it('refuses a finish for another run while one is pending, and leaves it pending', async () => {
    const store = memoryStore()
    store.data.set('s1', { runId: RUN_ID, idempotencyKey: 'key-1', telemetry: TELEMETRY, createdAt: 1 })
    const send = vi.fn()

    const error = await submitRunFinish({ store, sessionId: 's1', runId: OTHER_RUN, telemetry: TELEMETRY, send })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(UpstreamProblem)
    expect((error as UpstreamProblem).problem.code).toBe('bff_run_finish_pending')
    expect((error as UpstreamProblem).problem.status).toBe(409)
    expect(send).not.toHaveBeenCalled()
    expect(store.data.get('s1')?.runId).toBe(RUN_ID)
  })

  it('needs telemetry when nothing is pending', async () => {
    const store = memoryStore()

    const error = await submitRunFinish({ store, sessionId: 's1', runId: RUN_ID, telemetry: null, send: vi.fn() })
      .catch((e: unknown) => e)

    expect((error as UpstreamProblem).problem.status).toBe(422)
    expect(store.data.size).toBe(0)
  })

  it('keeps sessions apart: one account\'s pending finish is never sent as another\'s', async () => {
    const store = memoryStore()
    store.data.set('alice', { runId: RUN_ID, idempotencyKey: 'alice-key', telemetry: TELEMETRY, createdAt: 1 })
    const send = vi.fn(async () => ({ ...result(), run_id: OTHER_RUN }))

    await submitRunFinish({ store, sessionId: 'bob', runId: OTHER_RUN, telemetry: TELEMETRY, send, newKey: () => 'bob-key' })

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'bob-key', runId: OTHER_RUN }))
    expect(store.data.get('alice')?.idempotencyKey).toBe('alice-key')
  })

  it('generates a UUID key by default', async () => {
    const store = memoryStore()
    const send = vi.fn(async () => result())

    await submitRunFinish({ store, sessionId: 's1', runId: RUN_ID, telemetry: TELEMETRY, send })

    expect(send.mock.calls[0]?.[0].idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('the finish classification helpers', () => {
  it('treats only a repeatable refusal as final', () => {
    expect([403, 404, 409, 422].every(isFinalRefusal)).toBe(true)
    expect([401, 408, 429, 500, 502, 503, 504].some(isFinalRefusal)).toBe(false)
  })

  it('accepts only JSON integers as telemetry', () => {
    expect(parseTelemetry(TELEMETRY)).toEqual(TELEMETRY)
    expect(parseTelemetry({ ...TELEMETRY, extra: 5, reported_loli_activations: 9 })).toEqual(TELEMETRY)

    for (const bad of ['12', 12.5, null, true, Number.NaN, 2 ** 60, {}]) {
      expect(parseTelemetry({ ...TELEMETRY, reported_score: bad })).toBeNull()
    }

    expect(parseTelemetry(null)).toBeNull()
    expect(parseTelemetry('x')).toBeNull()
  })

  it('refuses a start response whose seed the domain could not use', () => {
    const run = { run_id: RUN_ID, character_id: 'aysenur', seed: 0, started_at: 'x', loli_cycle_paws: 0 }

    expect(isUsableStartedRun(run)).toBe(true)
    expect(isUsableStartedRun({ ...run, seed: 4294967295 })).toBe(true)

    for (const seed of [-1, 4294967296, 1.5, '12', null]) {
      expect(isUsableStartedRun({ ...run, seed })).toBe(false)
    }

    expect(isUsableStartedRun({ ...run, loli_cycle_paws: 200 })).toBe(false)
    expect(isUsableStartedRun({ ...run, run_id: 'nope' })).toBe(false)
  })

  it('refuses a result that is not one of the three outcomes for this run', () => {
    expect(isUsableRunResult(result(), RUN_ID)).toBe(true)
    expect(isUsableRunResult({ ...result(), status: 'maybe' }, RUN_ID)).toBe(false)
    expect(isUsableRunResult(result(), OTHER_RUN)).toBe(false)
  })
})

describe('the run endpoints', () => {
  it('are admitted to the allow-list, and admitted deliberately', () => {
    expect(Endpoint.gameRunStart).toEqual({ method: 'POST', path: '/api/v1/game-runs' })
    expect(Endpoint.gameRunFinish).toEqual({ method: 'POST', path: '/api/v1/game-runs' })
    expect(Endpoint.progression).toEqual({ method: 'GET', path: '/api/v1/progression' })
  })

  it('builds the finish path only from a UUID, answering anything else as not found', () => {
    expect(gameRunFinishPath(RUN_ID.toUpperCase())).toBe(`/api/v1/game-runs/${RUN_ID}/finish`)

    for (const hostile of ['../../admin/overview', `${RUN_ID}/../../x`, '', '1', 'http://169.254.169.254/']) {
      try {
        gameRunFinishPath(hostile)
        expect.unreachable(`accepted ${hostile}`)
      }
      catch (error) {
        expect(error).toBeInstanceOf(UpstreamProblem)
        expect((error as UpstreamProblem).problem.status).toBe(404)
      }
    }
  })
})
