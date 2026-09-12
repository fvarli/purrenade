import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Session-fixation resistance, asserted rather than asserted-in-a-comment.
 *
 * `startSession()` documents itself as the fixation defence — "always a new
 * identifier", the only function permitted to write a session — and until now
 * nothing imported it. The property the whole cookie design rests on was
 * described in prose and verified by reading.
 *
 * These tests drive it against an in-memory storage and a fake H3 event, so the
 * behaviour under test is the real function, not a re-description of it.
 */

interface StoredCookie { value: string, options: Record<string, unknown> }

let store: Map<string, unknown>
let cookies: Map<string, StoredCookie>
let deleted: string[]

/** A fake H3 event, carrying whatever cookies the test has set. */
function fakeEvent(): Record<string, unknown> {
  return { __fake: true }
}

const config = {
  session: {
    cookieName: '__Host-purrenade_session',
    csrfCookieName: '__Host-purrenade_csrf',
    idleMinutes: 60 * 24 * 7,
    absoluteMinutes: 60 * 24 * 30,
  },
}

vi.mock('h3', () => ({
  getCookie: (_event: unknown, name: string) => cookies.get(name)?.value,
  setCookie: (_event: unknown, name: string, value: string, options: Record<string, unknown>) => {
    cookies.set(name, { value, options })
  },
  deleteCookie: (_event: unknown, name: string) => {
    cookies.delete(name)
    deleted.push(name)
  },
}))

vi.mock('~~/server/utils/problem', async importOriginal => importOriginal())
vi.mock('~~/server/utils/upstream', async importOriginal => importOriginal())

beforeEach(() => {
  store = new Map()
  cookies = new Map()
  deleted = []

  const storage = {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: unknown) => void store.set(key, value),
    removeItem: async (key: string) => void store.delete(key),
    getKeys: async () => [...store.keys()],
  }

  ;(globalThis as Record<string, unknown>).useStorage = () => storage
  ;(globalThis as Record<string, unknown>).useRuntimeConfig = () => config
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function subject() {
  return await import('~~/server/utils/session')
}

describe('startSession', () => {
  it('issues a new identifier every time', async () => {
    const { startSession } = await subject()
    const event = fakeEvent()

    const first = await startSession(event as never, {})
    const second = await startSession(event as never, {})

    expect(second.id).not.toBe(first.id)
  })

  it('destroys the record the previous identifier named', async () => {
    // The heart of it. An attacker who plants a known identifier in a victim's
    // browser must not be holding the victim's session afterwards — so the old
    // record has to be gone, not merely unreferenced.
    const { startSession, readSession } = await subject()
    const event = fakeEvent()

    const planted = await startSession(event as never, {})

    expect(store.has(planted.id)).toBe(true)

    await startSession(event as never, { apiToken: 'upstream-token', userId: 1 })

    expect(store.has(planted.id)).toBe(false)

    // And the planted identifier resolves to nothing if it is presented again.
    cookies.set(config.session.cookieName, { value: planted.id, options: {} })

    expect(await readSession(event as never)).toBeNull()
  })

  it('rotates the CSRF token with the identifier', async () => {
    // Carrying one across a privilege change would let a token minted for an
    // anonymous visitor act on an authenticated session.
    const { startSession } = await subject()
    const event = fakeEvent()

    const before = await startSession(event as never, {})
    const after = await startSession(event as never, { apiToken: 'upstream-token' })

    expect(after.record.csrfToken).not.toBe(before.record.csrfToken)
  })

  it('sets the session cookie HttpOnly, Secure, Lax and host-scoped', async () => {
    const { startSession } = await subject()

    await startSession(fakeEvent() as never, {})

    const cookie = cookies.get(config.session.cookieName)

    expect(cookie?.options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    })

    // `__Host-` forbids Domain. Setting one would silently void the prefix.
    expect(cookie?.options).not.toHaveProperty('domain')
  })

  it('leaves the CSRF cookie readable, and it alone', async () => {
    const { startSession } = await subject()

    await startSession(fakeEvent() as never, {})

    expect(cookies.get(config.session.csrfCookieName)?.options).toMatchObject({
      httpOnly: false,
      secure: true,
      path: '/',
    })
  })

  it('never puts the upstream token in a cookie', async () => {
    const { startSession } = await subject()

    await startSession(fakeEvent() as never, { apiToken: 'prrn_secret-upstream-token', userId: 7 })

    for (const cookie of cookies.values()) {
      expect(cookie.value).not.toContain('prrn_secret-upstream-token')
    }

    // It is in the server-side record, which is the whole point of the design.
    expect(JSON.stringify([...store.values()])).toContain('prrn_secret-upstream-token')
  })

  it('produces an identifier with 256 bits of entropy', async () => {
    const { startSession } = await subject()

    const ids = new Set<string>()

    for (let i = 0; i < 100; i++) {
      ids.add((await startSession(fakeEvent() as never, {})).id)
    }

    expect(ids.size).toBe(100)

    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/)
    }
  })
})

describe('destroySession', () => {
  it('removes the record and clears both cookies', async () => {
    const { startSession, destroySession } = await subject()
    const event = fakeEvent()

    const { id } = await startSession(event as never, { apiToken: 'upstream-token' })

    cookies.set(config.session.cookieName, { value: id, options: {} })

    await destroySession(event as never)

    expect(store.has(id)).toBe(false)
    expect(deleted).toContain(config.session.cookieName)
    expect(deleted).toContain(config.session.csrfCookieName)
  })
})

describe('readSession', () => {
  it('refuses an identifier that is not shaped like one we issued', async () => {
    // A filesystem-backed driver turns a key into a path, so a key containing
    // `..` or a slash is a traversal primitive.
    const { readSession } = await subject()
    const event = fakeEvent()

    for (const hostile of ['../../etc/passwd', 'a/b', 'short', '../' .repeat(20)]) {
      cookies.set(config.session.cookieName, { value: hostile, options: {} })

      expect(await readSession(event as never)).toBeNull()
    }
  })

  it('expires a session past its idle timeout, and deletes the record', async () => {
    const { startSession, readSession } = await subject()
    const event = fakeEvent()

    const { id } = await startSession(event as never, { apiToken: 'upstream-token' })

    cookies.set(config.session.cookieName, { value: id, options: {} })

    const record = store.get(id) as { lastSeenAt: number }
    store.set(id, { ...record, lastSeenAt: Date.now() - (config.session.idleMinutes * 60_000 + 1) })

    expect(await readSession(event as never)).toBeNull()

    // Deleted, not merely refused: a lingering expired record is one a clock
    // change could resurrect.
    expect(store.has(id)).toBe(false)
  })

  it('expires a session past its absolute timeout however recently it was used', async () => {
    const { startSession, readSession } = await subject()
    const event = fakeEvent()

    const { id } = await startSession(event as never, { apiToken: 'upstream-token' })

    cookies.set(config.session.cookieName, { value: id, options: {} })

    store.set(id, {
      ...(store.get(id) as object),
      createdAt: Date.now() - (config.session.absoluteMinutes * 60_000 + 1),
      lastSeenAt: Date.now(),
    })

    expect(await readSession(event as never)).toBeNull()
  })
})

describe('sweepExpiredSessions', () => {
  it('reclaims records past the absolute lifetime and keeps live ones', async () => {
    // `GET /api/auth/csrf` mints a record for any caller without a cookie, and
    // nothing else ever collects one whose identifier is not presented again.
    const { startSession, sweepExpiredSessions } = await subject()

    const live = await startSession(fakeEvent() as never, {})

    // A different browser: clear the jar, or the next startSession would
    // rotate away the one we just made rather than adding a second.
    cookies.clear()

    const stale = await startSession(fakeEvent() as never, {})

    store.set(stale.id, {
      ...(store.get(stale.id) as object),
      createdAt: Date.now() - (config.session.absoluteMinutes * 60_000 + 1),
    })

    const removed = await sweepExpiredSessions()

    expect(removed).toBe(1)
    expect(store.has(stale.id)).toBe(false)
    expect(store.has(live.id)).toBe(true)
  })

  it('discards a record it cannot make sense of', async () => {
    const { sweepExpiredSessions } = await subject()

    store.set('corrupt-record-key-that-is-long-enough-here', { nonsense: true })

    await sweepExpiredSessions()

    expect(store.size).toBe(0)
  })
})
