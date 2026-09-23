import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { deleteCookie, getCookie, setCookie } from 'h3'
import { BffProblemCode, bffProblem } from './problem'
import { UpstreamProblem } from './upstream'

/**
 * The BFF session: server-side state, opaque cookie.
 *
 * This is the heart of ADR-0005. The browser holds **one** value — a random
 * identifier in an `HttpOnly` cookie — and everything else lives here, on the
 * server, in Nitro's storage. The upstream API token in particular never leaves
 * this process.
 *
 * ### Why not h3's `useSession`
 *
 * h3's built-in session is a *sealed cookie*: the payload is encrypted and sent
 * to the browser. That would put the API token in the browser, encrypted, which
 * ADR-0005 §1 forbids in as many words ("the API credential never reaches the
 * browser") and §3 rules out again ("the session is a server-side record, the
 * cookie only a reference"). A sealed cookie also cannot be revoked: the holder
 * keeps a valid credential until it expires, whatever the server decides.
 *
 * So the session is a storage record and the cookie is a pointer. Deleting the
 * record ends the session immediately, for real.
 *
 * ### Two timeouts, and why both
 *
 * **Idle** — expires a session that has not been used. This is the one that
 * matters for a shared or stolen device, and it is enforced here because the BFF
 * is the layer that observes browser activity.
 *
 * **Absolute** — expires a session however active it has been, so a long-lived
 * session cannot outlive its credential. Mirrored upstream by
 * `sanctum.expiration`, which is the backstop if this layer is ever bypassed.
 */

export interface PendingTwoFactor {
  /** Opaque challenge token from the API. Never sent to the browser. */
  challengeToken: string
  /** ISO 8601, from the API. */
  expiresAt: string
  /** Whether the account has unused recovery codes, so the UI can offer them. */
  recoveryCodesAvailable: boolean
}

export interface SessionRecord {
  /**
   * The upstream Sanctum token.
   *
   * Absent while a session is in the pre-authentication state: a visitor needs a
   * session to hold a CSRF token before they have any credential at all.
   */
  apiToken?: string
  /** Set once authenticated. Used only for logging and cache keys, never trusted for authorization. */
  userId?: number
  /** Synchroniser CSRF token for this session. */
  csrfToken: string
  /** Epoch milliseconds. */
  createdAt: number
  /** Epoch milliseconds. */
  lastSeenAt: number
  /** Present between a correct password and a completed two-factor challenge. */
  pendingTwoFactor?: PendingTwoFactor
}

const SESSION_STORAGE_BASE = 'sessions'

/** Milliseconds. Configurable; the defaults are the documented policy. */
function timeouts() {
  const config = useRuntimeConfig()

  return {
    idle: config.session.idleMinutes * 60_000,
    absolute: config.session.absoluteMinutes * 60_000,
  }
}

function storage() {
  return useStorage(SESSION_STORAGE_BASE)
}

/**
 * Run a storage operation, turning a driver failure into a stated problem.
 *
 * Without this a full disk or an unreachable store surfaces as an unhandled
 * throw and the caller gets a bare 500 — the same answer as a bug in a route,
 * for a condition an operator can actually act on. `bff_session_unavailable`
 * existed as a code from the start and nothing ever threw it; this is where it
 * belongs.
 *
 * Only for the writes. A failed *read* is already indistinguishable from "no
 * session" as far as the caller is concerned, and `readSession` returning null
 * sends them to the login screen, which is the right place to be when the
 * session cannot be established.
 */
async function withStore<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  }
  catch (error) {
    console.error('[sessions] store unavailable', error)

    throw new UpstreamProblem(
      bffProblem(
        BffProblemCode.SessionUnavailable,
        503,
        'The session store is unavailable. Try again shortly.',
      ),
    )
  }
}

/**
 * 256 bits of entropy, URL-safe.
 *
 * The session id is a bearer credential in its own right — whoever holds it is
 * the session. `randomBytes` is the CSPRNG; `Math.random` is not, and a session
 * id a few observed values can predict is an account takeover.
 */
function newIdentifier(): string {
  return randomBytes(32).toString('base64url')
}

function cookieName(): string {
  return useRuntimeConfig().session.cookieName
}

/**
 * Cookie attributes, in one place.
 *
 * `httpOnly` is the reason this design exists: script cannot read the cookie, so
 * an XSS defect cannot exfiltrate a portable credential.
 *
 * `sameSite: 'lax'` rather than `strict`. Strict would break the return-from-
 * email flows the product depends on — clicking a password-reset link is a
 * cross-site navigation, and under Strict the session cookie would not be sent,
 * so the player would arrive logged out on a page that needs their session.
 * `Lax` still blocks cross-site POSTs, and the CSRF token is the actual control
 * regardless (ADR-0005 §2).
 *
 * The default cookie name carries the `__Host-` prefix, which browsers enforce:
 * it requires `Secure`, requires `Path=/`, and forbids `Domain`, so no
 * subdomain — including one an attacker manages to control — can overwrite this
 * cookie. That is ADR-0005's "host-prefixed" requirement, made a browser
 * guarantee rather than a convention. It does mean the cookie will not be set
 * over plain HTTP: use the `.test` hostname locally, as the local-development
 * docs say.
 */
function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  }
}

export function newCsrfToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Read and validate the session behind this request.
 *
 * Returns null for every failure — no cookie, unknown id, expired either way —
 * because the caller's only sensible reaction is the same in all four cases, and
 * distinguishing them would tell a prober which of their guesses had once been a
 * real session.
 *
 * Expiry deletes the record rather than leaving it: an expired session that
 * lingers is a row waiting to be resurrected by a clock change.
 */
export async function readSession(
  event: H3Event,
): Promise<{ id: string, record: SessionRecord } | null> {
  const id = getCookie(event, cookieName())

  if (!id || !isPlausibleIdentifier(id)) return null

  const record = await storage().getItem<SessionRecord>(id)

  if (!record) return null

  const { idle, absolute } = timeouts()
  const now = Date.now()

  if (now - record.lastSeenAt > idle || now - record.createdAt > absolute) {
    await storage().removeItem(id)
    return null
  }

  return { id, record }
}

/**
 * Reject anything that is not shaped like an identifier we issued.
 *
 * Cheap, and it keeps malformed cookie values out of the storage key namespace —
 * a filesystem-backed driver turns a key into a path, and a key containing `..`
 * or a slash is a path-traversal primitive.
 */
function isPlausibleIdentifier(value: string): boolean {
  return /^[A-Za-z0-9_-]{32,128}$/.test(value)
}

/**
 * Refresh the idle clock.
 *
 * Throttled to once a minute: writing the session record on every request turns
 * a page of parallel API calls into a burst of storage writes for a value that
 * only needs minute-level resolution.
 */
export async function touchSession(id: string, record: SessionRecord): Promise<void> {
  const now = Date.now()

  if (now - record.lastSeenAt < 60_000) return

  await storage().setItem(id, { ...record, lastSeenAt: now })
}

/**
 * Delete every session record that is past its absolute lifetime.
 *
 * Sessions are otherwise only ever collected lazily, when the exact identifier
 * that names one is presented again — so a record nobody comes back for is a
 * record that lives forever. `GET /api/auth/csrf` mints one for any visitor who
 * arrives without a cookie, which means an unauthenticated caller in a loop can
 * grow the store without bound: inodes on a filesystem driver, and an
 * ever-larger pile of files holding credentials that nothing reclaims.
 *
 * The absolute timeout is the right cut-off rather than the idle one. A record
 * past its absolute lifetime cannot be revived by any request, so deleting it
 * changes nothing a caller could observe; the idle clock, by contrast, is
 * refreshed by use, and sweeping on it would race a request in flight.
 *
 * Best-effort throughout. A driver that cannot enumerate keys is not an error
 * here — the sweep is hygiene, and the expiry checks in `readSession` remain the
 * control.
 */
export async function sweepExpiredSessions(): Promise<number> {
  const { absolute } = timeouts()
  const now = Date.now()

  let removed = 0

  const keys = await storage().getKeys().catch((): string[] => [])

  for (const key of keys) {
    const record = await storage().getItem<SessionRecord>(key).catch(() => null)

    // A record that will not parse is not a session either.
    if (!record || typeof record.createdAt !== 'number' || now - record.createdAt > absolute) {
      await storage().removeItem(key).catch(() => undefined)
      removed++
    }
  }

  return removed
}

/**
 * Start a session, or replace an existing one with a new identifier.
 *
 * **Always a new identifier.** This is the session-fixation defence: an
 * attacker who plants a known session id in a victim's browser must not end up
 * holding the victim's authenticated session. ADR-0005 §3 requires rotation on
 * every privilege change — login, a passed two-factor challenge, a password
 * change — and the way to guarantee it is for this to be the only way to write
 * a session at all.
 */
export async function startSession(
  event: H3Event,
  data: Omit<SessionRecord, 'createdAt' | 'lastSeenAt' | 'csrfToken'> & { csrfToken?: string },
): Promise<{ id: string, record: SessionRecord }> {
  await destroySession(event)

  const now = Date.now()
  const id = newIdentifier()

  const record: SessionRecord = {
    ...data,
    // A fresh CSRF token by default: carrying one across a privilege change
    // would let a token minted for an anonymous visitor act on an
    // authenticated session.
    csrfToken: data.csrfToken ?? newCsrfToken(),
    createdAt: now,
    lastSeenAt: now,
  }

  await withStore(() => storage().setItem(id, record))

  const { absolute } = timeouts()

  setCookie(event, cookieName(), id, cookieOptions(Math.floor(absolute / 1000)))

  // The CSRF token is readable by design — the client has to send it back in a
  // header, and a header is the only thing a cross-site form cannot set. It is
  // not a credential: without the HttpOnly session cookie it grants nothing.
  setCookie(event, useRuntimeConfig().session.csrfCookieName, record.csrfToken, {
    httpOnly: false,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(absolute / 1000),
  })

  return { id, record }
}

/**
 * End the session and clear both cookies.
 *
 * Deletes the record first. If the process died between the two steps, a
 * dangling cookie that resolves to nothing is harmless, whereas a live record
 * with no cookie would be a session nobody can reach and nobody can revoke.
 */
export async function destroySession(event: H3Event): Promise<void> {
  const id = getCookie(event, cookieName())

  if (id && isPlausibleIdentifier(id)) {
    await storage().removeItem(id)
    // A pending run finish belongs to this session and this account. It ends
    // with them — sign-out, rotation on a privilege change, or expiry — so it
    // can never be submitted as somebody else.
    await storage().removeItem(pendingRunFinishKey(id))
  }

  deleteCookie(event, cookieName(), { path: '/', secure: true, sameSite: 'lax' })
  deleteCookie(event, useRuntimeConfig().session.csrfCookieName, { path: '/', secure: true, sameSite: 'lax' })
}

/**
 * Constant-time CSRF comparison.
 *
 * `===` on a secret leaks its prefix through timing. The length check first is
 * required because `timingSafeEqual` throws on mismatched lengths — and length
 * is not a secret worth protecting here.
 */
export function csrfTokenMatches(submitted: string, expected: string): boolean {
  const a = Buffer.from(submitted)
  const b = Buffer.from(expected)

  if (a.length !== b.length) return false

  return timingSafeEqual(a, b)
}

/**
 * The storage key of a session's pending run finish.
 *
 * A **sibling** of the session record rather than a field inside it, on
 * purpose. `touchSession` writes back the whole record it read at the start of
 * its request, so a field living in the record could be erased by any
 * concurrent request that happened to refresh the idle clock — silently losing
 * the one thing the pending finish exists to keep. A key of its own has exactly
 * one writer. The `:` makes it a separate namespace, and its shape can never be
 * mistaken for a session identifier (`isPlausibleIdentifier`).
 */
export function pendingRunFinishKey(sessionId: string): string {
  return `run-pending:${sessionId}`
}

/** Read a session's pending run finish, or null. */
export async function readPendingRunFinish<T>(sessionId: string): Promise<T | null> {
  return await storage().getItem<T>(pendingRunFinishKey(sessionId))
}

/** Store a session's pending run finish, surfacing a store failure as a problem. */
export async function writePendingRunFinish<T extends object>(sessionId: string, pending: T): Promise<void> {
  await withStore(() => storage().setItem(pendingRunFinishKey(sessionId), pending))
}

export async function clearPendingRunFinish(sessionId: string): Promise<void> {
  await withStore(() => storage().removeItem(pendingRunFinishKey(sessionId)))
}
