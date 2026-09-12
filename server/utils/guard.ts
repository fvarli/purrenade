import type { H3Event } from 'h3'
import { getRequestHeader, getRequestURL, readBody } from 'h3'
import { BffProblemCode, bffProblem } from './problem'
import { UpstreamProblem } from './upstream'
import { csrfTokenMatches, readSession, touchSession } from './session'
import type { SessionRecord } from './session'

/**
 * The checks every state-changing BFF route runs before it does anything.
 *
 * Three layers, in this order, and the order matters: a request is rejected as
 * cheaply as possible, and the session is not even loaded for a request that
 * fails the origin check.
 *
 *   1. origin — is this request from our own page?
 *   2. CSRF   — does it carry the token only our own page could read?
 *   3. session — is there one, and does it have a credential?
 *
 * Why CSRF at all when the browser talks to one origin over `SameSite=Lax`
 * cookies: because `Lax` is a mitigation, not a control (ADR-0005 §2). It does
 * not cover every request shape, it varies by browser and version, and it is
 * the sort of protection that quietly stops applying. The token does not vary.
 */

/** Methods that may not change state, and therefore need no token. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export const CSRF_HEADER = 'x-csrf-token'

/**
 * Reject a request that did not come from one of our own origins.
 *
 * Defence in depth rather than the primary control — `Origin` is set by the
 * browser and cannot be forged by page script, but it is absent on some
 * legitimate requests, which is why a missing header is tolerated for safe
 * methods and refused for unsafe ones.
 *
 * The allow-list is configuration, so the `.test` hostname stays a local
 * development fact and production names its own origin.
 */
export function requireTrustedOrigin(event: H3Event): void {
  const method = event.method.toUpperCase()

  if (SAFE_METHODS.has(method)) return

  const allowed = trustedOrigins()

  const origin = originOf(getRequestHeader(event, 'origin'))
    // Firefox omits Origin on some same-origin requests; Referer is the
    // fallback, read only for its origin component.
    ?? originOf(getRequestHeader(event, 'referer'))

  if (!origin || !allowed.has(origin)) {
    throw new UpstreamProblem(
      bffProblem(
        BffProblemCode.OriginRejected,
        403,
        'This request did not come from an allowed origin.',
      ),
    )
  }
}

/**
 * Refuse a request the browser itself labelled as cross-site.
 *
 * For the safe methods, where the origin check deliberately does not apply and
 * the CSRF token is not required — but where the handler still creates
 * something. `Sec-Fetch-Site` is set by the browser and is not settable by page
 * script, so `cross-site` is a reliable statement that this did not come from
 * our own page.
 *
 * Absent is allowed, not refused. Non-browser callers send no fetch metadata at
 * all, and this is not an authentication boundary — it is a bound on who can
 * make the server allocate. Treating a missing header as hostile would break
 * `curl` and every older browser for no security gain, because anything willing
 * to omit the header is equally willing to forge it.
 */
export function requireSameSiteRequest(event: H3Event): void {
  const site = getRequestHeader(event, 'sec-fetch-site')

  if (site === 'cross-site') {
    throw new UpstreamProblem(
      bffProblem(
        BffProblemCode.OriginRejected,
        403,
        'This request did not come from an allowed origin.',
      ),
    )
  }
}

/**
 * The allow-list, as a set of canonical origins.
 *
 * Normalised here rather than trusted as configured, because it arrives in two
 * different shapes. `nuxt.config.ts` builds an array by splitting the
 * environment variable, but `trustedOrigins` is runtime config, and Nitro
 * re-applies the environment at boot: its `applyEnv` treats an array as a
 * scalar, so whenever `NUXT_TRUSTED_ORIGINS` is set the array is replaced by the
 * raw, unsplit **string**.
 *
 * That was not a cosmetic difference. `allowed.includes(origin)` on a string is
 * `String.prototype.includes` — substring containment, not membership — so the
 * check silently stopped being an allow-list and started accepting any origin
 * that happened to be a substring of the configured value. Against
 * `https://purrenade.test` it admitted `https://purrenade.tes` and
 * `https://purrenade`; against a comma-joined production list it would admit far
 * more, including fragments spanning the separator. Nothing ever threw, so
 * nothing ever said so.
 *
 * A `Set` of parsed `URL.origin` values fixes both halves: the shape is
 * normalised once, and the comparison is exact equality on a canonical form —
 * scheme, host and port together, with no room for a prefix to pass.
 */
function trustedOrigins(): Set<string> {
  const configured = useRuntimeConfig().trustedOrigins

  const entries = Array.isArray(configured)
    ? configured
    : String(configured ?? '').split(',')

  return new Set(
    entries
      .map(entry => originOf(entry.trim()))
      .filter((entry): entry is string => entry !== undefined),
  )
}

/**
 * The canonical origin of a URL, or undefined if it is not one.
 *
 * `URL.origin` is what makes the comparison exact: it collapses a value to
 * scheme, host and port and drops everything else, so `https://a.test@evil.test`
 * resolves to `https://evil.test` — the origin the browser would actually use —
 * rather than matching on the part before the `@`.
 */
function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined

  try {
    const origin = new URL(url).origin

    // `new URL('foo:bar').origin` is the string "null" for a non-special
    // scheme. That is not an origin anything should match.
    return origin === 'null' ? undefined : origin
  }
  catch {
    return undefined
  }
}

/**
 * Verify the synchroniser CSRF token.
 *
 * Synchroniser, not double-submit. Double-submit compares a header against a
 * cookie and trusts that only our own page could have set the cookie — which
 * fails if any subdomain can write cookies for the parent domain. Here the
 * expected value lives in the server-side session, so the comparison is against
 * state the client cannot influence at all. Having a real session store is what
 * makes the stronger pattern free.
 *
 * The token travels in a **header**, which is the load-bearing detail: a
 * cross-site form or image can make the browser send cookies, but it cannot set
 * a custom header.
 */
export function requireCsrf(event: H3Event, record: SessionRecord): void {
  if (SAFE_METHODS.has(event.method.toUpperCase())) return

  const submitted = getRequestHeader(event, CSRF_HEADER)

  if (!submitted || !csrfTokenMatches(submitted, record.csrfToken)) {
    throw new UpstreamProblem(
      bffProblem(
        BffProblemCode.CsrfTokenMismatch,
        419,
        'Your session token is missing or stale. Reload the page and try again.',
      ),
    )
  }
}

/**
 * A session must exist, but it need not be authenticated.
 *
 * Used by login, register and the password-reset routes: they are
 * state-changing, so they need a CSRF token, so they need the session that
 * holds it — but they obviously have no credential yet.
 */
export async function requireSessionContext(
  event: H3Event,
): Promise<{ id: string, record: SessionRecord }> {
  requireTrustedOrigin(event)

  const session = await readSession(event)

  if (!session) {
    throw new UpstreamProblem(
      bffProblem(
        BffProblemCode.CsrfTokenMismatch,
        419,
        'Your session has expired. Reload the page and try again.',
      ),
    )
  }

  requireCsrf(event, session.record)

  return session
}

/**
 * A session with an upstream credential.
 *
 * Note what this does **not** do: it makes no authorization decision. It
 * establishes that a credential exists and hands it over. Whether that
 * credential may do the thing being asked is decided by Laravel, on every
 * request. The BFF carries credentials; it does not grant permissions
 * (ADR-0005 §"Now constrained").
 */
export async function requireAuthenticated(
  event: H3Event,
): Promise<{ id: string, record: SessionRecord, token: string }> {
  requireTrustedOrigin(event)

  const session = await readSession(event)

  if (!session?.record.apiToken) {
    throw new UpstreamProblem(
      bffProblem(
        BffProblemCode.Unauthenticated,
        401,
        'You are not signed in.',
      ),
    )
  }

  requireCsrf(event, session.record)

  await touchSession(session.id, session.record)

  return { ...session, token: session.record.apiToken }
}

/**
 * Read a JSON body as a plain object.
 *
 * Bodies are **not** forwarded upstream wholesale. Each route picks the fields
 * it means to send, so a caller cannot smuggle an extra field — `role`,
 * `email_verified_at` — into an upstream payload by adding it to the JSON. The
 * API guards its own columns too; this is the second lock on the same door.
 */
export async function readJsonBody(event: H3Event): Promise<Record<string, unknown>> {
  const body = await readBody(event).catch(() => null)

  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}
}

/** A string field, or undefined. Never an object, array, or number. */
export function stringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key]

  return typeof value === 'string' ? value : undefined
}

/** The current request's path, for a problem's `instance` member. */
export function instanceOf(event: H3Event): string {
  return getRequestURL(event).pathname
}
