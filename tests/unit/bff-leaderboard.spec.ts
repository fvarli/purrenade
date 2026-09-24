import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LeaderboardPage } from '~~/server/utils/contracts'

/**
 * The leaderboard's BFF route (M10): not a proxy.
 *
 * What is proven here:
 *
 *  - the browser's query is **re-validated and rebuilt** — three known
 *    members, each in its documented shape; anything malformed is refused
 *    without an upstream call, and anything unknown is dropped;
 *  - the upstream call can carry **only** the members the endpoint allow-list
 *    names, whatever a route tries to send;
 *  - the API's page is relayed untouched, and its problems — `cursor_invalid`
 *    among them — pass through with their codes;
 *  - a body that is not a page is an upstream fault, not data.
 */

let query: Record<string, unknown>
let upstream: { status: number, _data: unknown, headers: Headers }
let rawCalls: Array<{ path: string, options: Record<string, unknown> }>

vi.mock('h3', () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: () => query,
  getRequestHeader: () => undefined,
  getRequestURL: () => new URL('https://purrenade.test/api/leaderboards'),
  readBody: async () => ({}),
  setResponseStatus: (event: { status?: number }, status: number) => {
    event.status = status
  },
  setResponseHeader: () => {},
}))

vi.mock('~~/server/utils/session', () => ({
  csrfTokenMatches: () => true,
  readSession: async () => ({ id: 'session-1', token: 'upstream-token' }),
  touchSession: async () => undefined,
}))

vi.mock('~~/server/utils/guard', () => ({
  requireAuthenticated: async () => ({ id: 'session-1', token: 'upstream-token' }),
}))

const PAGE: LeaderboardPage = {
  window: 'weekly',
  period: { starts_at: '2026-09-20T21:00:00.000Z', ends_at: '2026-09-27T21:00:00.000Z' },
  data: [
    { rank: 1, display_name: 'aysenur', score: 5847, is_self: true },
    { rank: 2, display_name: 'ilker', score: 4100, is_self: false },
  ],
  own_entry: { rank: 1, display_name: 'aysenur', score: 5847, is_self: true },
  meta: { next_cursor: 'abc_DEF-123', has_more: true },
}

beforeEach(() => {
  query = {}
  rawCalls = []
  upstream = { status: 200, _data: PAGE, headers: new Headers({ 'x-correlation-id': 'corr-12345678' }) }

  ;(globalThis as Record<string, unknown>).useRuntimeConfig = () => ({
    apiBase: 'https://api.purrenade.test',
    apiTimeoutMs: 10_000,
  })

  vi.stubGlobal('$fetch', Object.assign(vi.fn(), {
    raw: vi.fn(async (path: string, options: Record<string, unknown>) => {
      rawCalls.push({ path, options })

      return upstream
    }),
  }))
})

async function route(): Promise<{ event: { status?: number, path: string, method: string }, body: unknown }> {
  const handler = (await import('~~/server/api/leaderboards/index.get')).default as unknown as (event: unknown) => Promise<unknown>
  const event = { path: '/api/leaderboards', method: 'GET' } as { status?: number, path: string, method: string }

  return { event, body: await handler(event) }
}

describe('leaderboardQuery', () => {
  it('rebuilds the three known members and drops everything else', async () => {
    const { leaderboardQuery } = await import('~~/server/utils/leaderboard')

    expect(leaderboardQuery({ window: 'all_time', cursor: 'abc_DEF-123', limit: '25', user_id: '7', sort: 'score' }))
      .toEqual({ window: 'all_time', cursor: 'abc_DEF-123', limit: '25' })
    expect(leaderboardQuery({ window: 'weekly' })).toEqual({ window: 'weekly' })
  })

  it.each([
    ['no window', {}],
    ['an unknown window', { window: 'daily' }],
    ['a repeated window', { window: ['weekly', 'all_time'] }],
    ['a cursor with a slash', { window: 'weekly', cursor: 'abc/def' }],
    ['a cursor with a plus', { window: 'weekly', cursor: 'abc+def' }],
    ['an empty cursor', { window: 'weekly', cursor: '' }],
    ['an over-long cursor', { window: 'weekly', cursor: 'a'.repeat(513) }],
    ['a repeated cursor', { window: 'weekly', cursor: ['a', 'b'] }],
    ['limit 0', { window: 'weekly', limit: '0' }],
    ['limit 101', { window: 'weekly', limit: '101' }],
    ['limit 1.5', { window: 'weekly', limit: '1.5' }],
    ['limit -1', { window: 'weekly', limit: '-1' }],
    ['limit with a sign', { window: 'weekly', limit: '+5' }],
    ['limit with a leading zero', { window: 'weekly', limit: '05' }],
  ])('refuses %s as bff_invalid_request', async (_label, raw) => {
    const { leaderboardQuery } = await import('~~/server/utils/leaderboard')
    const { UpstreamProblem } = await import('~~/server/utils/upstream')

    try {
      leaderboardQuery(raw as Record<string, unknown>)
      expect.unreachable('should have thrown')
    }
    catch (error) {
      expect(error).toBeInstanceOf(UpstreamProblem)
      expect((error as InstanceType<typeof UpstreamProblem>).problem).toMatchObject({ status: 422, code: 'bff_invalid_request' })
    }
  })

  it('accepts the bounds 1 and 100', async () => {
    const { leaderboardQuery } = await import('~~/server/utils/leaderboard')

    expect(leaderboardQuery({ window: 'weekly', limit: '1' }).limit).toBe('1')
    expect(leaderboardQuery({ window: 'weekly', limit: '100' }).limit).toBe('100')
  })
})

describe('the endpoint allow-list', () => {
  it('admits GET /leaderboards, deliberately, with exactly its three query members', async () => {
    const { ENDPOINT_QUERY, Endpoint } = await import('~~/server/utils/upstream')

    expect(Endpoint.leaderboards).toEqual({ method: 'GET', path: '/api/v1/leaderboards' })
    expect(ENDPOINT_QUERY).toEqual({ leaderboards: ['window', 'cursor', 'limit'] })
  })

  it('refuses to send a query member the endpoint does not allow, before any request', async () => {
    const { callApi } = await import('~~/server/utils/upstream')

    await expect(callApi({} as never, 'leaderboards', { query: { window: 'weekly', user_id: '1' } })).rejects.toThrow(/user_id/)
    await expect(callApi({} as never, 'progression', { query: { window: 'weekly' } })).rejects.toThrow(/window/)
    expect(rawCalls).toEqual([])
  })
})

describe('GET /api/leaderboards', () => {
  it('calls the API with the rebuilt query and the session token, and relays the page untouched', async () => {
    query = { window: 'weekly', cursor: 'abc_DEF-123', limit: '10', user_id: '9' }

    const { event, body } = await route()

    expect(event.status).toBeUndefined()
    expect(body).toEqual(PAGE)
    expect(rawCalls).toHaveLength(1)
    expect(rawCalls[0]!.path).toBe('/api/v1/leaderboards')
    expect(rawCalls[0]!.options).toMatchObject({
      method: 'GET',
      baseURL: 'https://api.purrenade.test',
      query: { window: 'weekly', cursor: 'abc_DEF-123', limit: '10' },
    })
    expect((rawCalls[0]!.options.headers as Record<string, string>).Authorization).toBe('Bearer upstream-token')
    expect(rawCalls[0]!.options.query).not.toHaveProperty('user_id')
  })

  it('sends only the window for a first page', async () => {
    query = { window: 'all_time' }

    await route()

    expect(rawCalls[0]!.options.query).toEqual({ window: 'all_time' })
  })

  it('refuses a malformed query without calling the API', async () => {
    query = { window: 'weekly', cursor: '../../admin' }

    const { event, body } = await route()

    expect(event.status).toBe(422)
    expect(body).toMatchObject({ code: 'bff_invalid_request', status: 422 })
    expect(rawCalls).toEqual([])
  })

  it('passes the API\'s cursor_invalid through with its field code', async () => {
    query = { window: 'weekly', cursor: 'stale' }
    upstream = {
      status: 422,
      headers: new Headers({ 'x-correlation-id': 'corr-12345678' }),
      _data: {
        type: 'urn:purrenade:error:validation_failed',
        title: 'Validation failed',
        status: 422,
        detail: 'The given data was invalid.',
        code: 'validation_failed',
        correlation_id: 'corr-12345678',
        errors: { cursor: [{ code: 'cursor_invalid', message: 'Start again from the first page.' }] },
        trace: 'must not leak',
      },
    }

    const { event, body } = await route()

    expect(event.status).toBe(422)
    expect(body).toMatchObject({
      code: 'validation_failed',
      errors: { cursor: [{ code: 'cursor_invalid' }] },
      correlation_id: 'corr-12345678',
    })
    expect(body).not.toHaveProperty('trace')
  })

  it('passes a rate limit through with retry_after', async () => {
    query = { window: 'weekly' }
    upstream = {
      status: 429,
      headers: new Headers(),
      _data: { type: 'urn:purrenade:error:rate_limited', title: 'Too many', status: 429, detail: 'Slow down.', code: 'rate_limited', retry_after: 12 },
    }

    const { event, body } = await route()

    expect(event.status).toBe(429)
    expect(body).toMatchObject({ code: 'rate_limited', retry_after: 12 })
  })

  it.each([
    ['a rank computed as a string', { ...PAGE, data: [{ ...PAGE.data[0], rank: '1' }] }],
    ['an entry carrying an extra shape but no score', { ...PAGE, data: [{ rank: 1, display_name: 'x', is_self: false }] }],
    ['an unknown window', { ...PAGE, window: 'daily' }],
    ['no meta', { ...PAGE, meta: undefined }],
    ['an HTML page', '<html>gateway</html>'],
  ])('answers %s as an upstream fault, not data', async (_label, data) => {
    query = { window: 'weekly' }
    upstream = { status: 200, headers: new Headers(), _data: data }

    const { event, body } = await route()

    expect(event.status).toBe(502)
    expect(body).toMatchObject({ code: 'bff_upstream_unavailable' })
  })
})
