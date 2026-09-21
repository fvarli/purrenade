import { randomUUID } from 'node:crypto'
import type { H3Event } from 'h3'
import { getRequestHeader } from 'h3'
import { FetchError } from 'ofetch'
import { BffProblemCode, bffProblem, isProblem, sanitizeProblem } from './problem'
import type { Problem } from './problem'

/**
 * The single door to the Laravel API.
 *
 * Every BFF route calls the API through this module and no other way, which is
 * what makes the following true by construction rather than by review:
 *
 *  - **It is not an open proxy.** The caller names an endpoint from a closed
 *    set below; it never supplies a path, a host, or a method. There is no
 *    `/api/proxy/[...path]` route in this application, because that route is
 *    an SSRF primitive: whoever can name the path can reach the API's
 *    administrative surface, cloud metadata endpoints, or any host the server
 *    can resolve.
 *
 *  - **Only intended headers cross.** Every header is constructed here, by
 *    name. A blanket forward would carry the browser's `Cookie`, `Origin`,
 *    `Authorization` and `X-Forwarded-*` upstream, where the API would treat
 *    some of them as trustworthy. Three browser-supplied values do cross —
 *    `Accept-Language`, `User-Agent` and a proposed correlation id — each for a
 *    stated reason and each length-capped and character-filtered, because all
 *    three reach a log line on the other side.
 *
 *  - **Nothing is unbounded.** Every call has a timeout. Without one, an API
 *    that accepts connections and never answers exhausts this process's
 *    sockets and takes the frontend down with it.
 *
 *  - **Upstream detail does not leak.** Responses are matched against the
 *    problem contract and reduced to an allow-list of members. A gateway's HTML
 *    error page or a stack trace never reaches a browser as though it were an
 *    API error.
 */

/** Endpoints this BFF may call. Adding one is a deliberate, reviewable act. */
export const Endpoint = {
  register: { method: 'POST', path: '/api/v1/auth/register' },
  login: { method: 'POST', path: '/api/v1/auth/login' },
  twoFactorChallenge: { method: 'POST', path: '/api/v1/auth/2fa/challenge' },
  logout: { method: 'POST', path: '/api/v1/auth/logout' },
  me: { method: 'GET', path: '/api/v1/auth/me' },
  emailVerify: { method: 'POST', path: '/api/v1/auth/email/verify' },
  emailResend: { method: 'POST', path: '/api/v1/auth/email/verify/resend' },
  passwordForgot: { method: 'POST', path: '/api/v1/auth/password/forgot' },
  passwordReset: { method: 'POST', path: '/api/v1/auth/password/reset' },
  passwordUpdate: { method: 'PUT', path: '/api/v1/auth/password' },
  twoFactorShow: { method: 'GET', path: '/api/v1/auth/2fa' },
  twoFactorEnable: { method: 'POST', path: '/api/v1/auth/2fa/enable' },
  twoFactorConfirm: { method: 'POST', path: '/api/v1/auth/2fa/confirm' },
  twoFactorRecoveryCodes: { method: 'POST', path: '/api/v1/auth/2fa/recovery-codes' },
  twoFactorDisable: { method: 'POST', path: '/api/v1/auth/2fa/disable' },
  sessionsIndex: { method: 'GET', path: '/api/v1/auth/sessions' },
  sessionsDestroyOthers: { method: 'DELETE', path: '/api/v1/auth/sessions' },

  // The item route. Its own entry, because the collection entry above was being
  // reused for it — and an endpoint table that does not describe what is
  // actually called has stopped being the closed vocabulary it exists to be.
  // The two happen to share a method, so changing the collection's would have
  // silently retargeted this one.
  //
  // The path here is the collection, with no placeholder in it: the id is
  // appended by `sessionRevokePath()`, which is the only thing permitted to
  // build it. Nothing in this table is a template — a template is something
  // somebody can fill.
  sessionRevoke: { method: 'DELETE', path: '/api/v1/auth/sessions' },
  profileUpdate: { method: 'PATCH', path: '/api/v1/profile' },
  progressionTutorial: { method: 'POST', path: '/api/v1/progression/tutorial' },
  adminOverview: { method: 'GET', path: '/api/v1/admin/overview' },
} as const satisfies Record<string, { method: string, path: string }>

export type EndpointName = keyof typeof Endpoint

/**
 * The one endpoint with a path segment.
 *
 * Built here, from a validated UUID, rather than by interpolating whatever the
 * browser sent. An unvalidated segment escapes the closed path set — `../..`
 * in a session id would address a different endpoint entirely.
 */
export function sessionRevokePath(publicId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(publicId)) {
    throw new UpstreamProblem(
      bffProblem(BffProblemCode.Unauthenticated, 404, 'That session does not exist.'),
    )
  }

  return `/api/v1/auth/sessions/${publicId}`
}

/**
 * A problem carried as an exception.
 *
 * Routes let this propagate; a Nitro error handler converts it to the response.
 * The alternative — returning a union of success and failure from every call —
 * gets unwrapped incorrectly exactly once and then a failure is treated as data.
 */
export class UpstreamProblem extends Error {
  constructor(public readonly problem: Problem) {
    super(problem.detail)
    this.name = 'UpstreamProblem'
  }
}

export interface UpstreamResponse<T> {
  status: number
  body: T
  correlationId: string
}

interface CallOptions {
  /** Overrides the endpoint's path. Only for `sessionRevokePath`, which builds one safely. */
  path?: string
  body?: unknown
  /** The upstream credential from the session. Omitted for public endpoints. */
  token?: string
}

/**
 * Call the API.
 *
 * @throws UpstreamProblem for any non-2xx response, a timeout, or an
 *         unreachable API. Success returns the parsed body.
 */
export async function callApi<T = unknown>(
  event: H3Event,
  endpoint: EndpointName,
  options: CallOptions = {},
): Promise<UpstreamResponse<T>> {
  const config = useRuntimeConfig()
  const { method, path } = Endpoint[endpoint]

  const correlationId = resolveCorrelationId(event)

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Correlation-Id': correlationId,
    // So the API localises its own messages and sends mail in the player's
    // language. Sanitised, because this header is echoed into logs upstream.
    'Accept-Language': safeAcceptLanguage(event),
    // Forwarded so the API can label the session's device.
    //
    // The BFF is the only layer that sees the browser, so without this the API
    // sees this process's own agent and every session in a player's device list
    // reads "Unknown device" — which defeats the one thing that list is for.
    //
    // The *raw* header is not stored anywhere: the API derives a coarse label
    // from it (`Chrome on Android`) and keeps only that. It remains
    // attacker-controlled input, so it is length-capped and filtered here as
    // well, and a native client sends its own agent naturally — the same code
    // path serves both, with derivation in one place.
    'User-Agent': safeUserAgent(event),
  }

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`
  }

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  try {
    const response = await $fetch.raw<T>(options.path ?? path, {
      baseURL: config.apiBase,
      method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      headers,
      body: options.body as Record<string, unknown> | undefined,
      timeout: config.apiTimeoutMs,
      // Errors are handled below rather than thrown as-is, so that a problem
      // body is preserved instead of being flattened into a generic message.
      ignoreResponseError: true,
      retry: 0,
    })

    const upstreamCorrelationId
      = response.headers.get('x-correlation-id') ?? correlationId

    if (response.status >= 200 && response.status < 300) {
      return {
        status: response.status,
        body: response._data as T,
        correlationId: upstreamCorrelationId,
      }
    }

    throw new UpstreamProblem(
      toProblem(response._data, response.status, upstreamCorrelationId),
    )
  }
  catch (error) {
    if (error instanceof UpstreamProblem) throw error

    throw new UpstreamProblem(transportProblem(error, correlationId))
  }
}

/**
 * Turn an error response body into a problem the browser may see.
 *
 * A well-formed problem from the API is passed through sanitised, so its stable
 * `code` — which the UI branches on — survives. Anything else is replaced: a
 * body that is not a problem did not come from the API's error handler, and
 * relaying it would forward whatever a proxy or a crashed process produced.
 */
function toProblem(body: unknown, status: number, correlationId: string): Problem {
  if (isProblem(body)) {
    return { ...sanitizeProblem(body), correlation_id: body.correlation_id ?? correlationId }
  }

  return bffProblem(
    BffProblemCode.UpstreamUnavailable,
    status >= 500 ? 502 : status,
    'The service returned an unexpected response.',
    { correlation_id: correlationId },
  )
}

/**
 * Classify a transport failure.
 *
 * A timeout and a refused connection are different operational facts and the UI
 * says different things about them ("still working on it" versus "we cannot
 * reach the service"), so they are not collapsed into one code.
 *
 * Neither carries the underlying message. Node's network errors name the host
 * and port they failed to reach, which is internal topology.
 */
function transportProblem(error: unknown, correlationId: string): Problem {
  const isTimeout = error instanceof Error
    && (error.name === 'AbortError' || error.name === 'TimeoutError'
      || (error instanceof FetchError && error.cause instanceof Error
        && error.cause.name === 'TimeoutError'))

  if (isTimeout) {
    return bffProblem(
      BffProblemCode.UpstreamTimeout,
      504,
      'The service took too long to respond. Try again.',
      { correlation_id: correlationId },
    )
  }

  return bffProblem(
    BffProblemCode.UpstreamUnavailable,
    502,
    'The service is temporarily unreachable. Try again shortly.',
    { correlation_id: correlationId },
  )
}

/**
 * One correlation id per request, propagated browser → BFF → API.
 *
 * A browser-supplied value is accepted only if it matches a strict shape. This
 * value ends up in response headers and log lines on both sides, so accepting
 * arbitrary bytes would permit header injection and log forging. The allowed
 * alphabet contains neither CR nor LF.
 */
function resolveCorrelationId(event: H3Event): string {
  const inbound = getRequestHeader(event, 'x-correlation-id')

  if (inbound && /^[A-Za-z0-9_-]{8,64}$/.test(inbound)) return inbound

  return randomUUID()
}

/**
 * Forward the browser's agent, bounded and filtered.
 *
 * Attacker-controlled, and it reaches a log line upstream, so the allowed
 * characters exclude CR and LF and the length is capped well below any header
 * limit. An agent that fails the filter becomes a fixed placeholder rather than
 * being dropped, so the API's own parser always has something to work with.
 */
function safeUserAgent(event: H3Event): string {
  const header = getRequestHeader(event, 'user-agent')

  if (header && header.length <= 256 && /^[\x20-\x7E]+$/.test(header)) return header

  return 'Purrenade-BFF'
}

/**
 * Pass the locale through, but only a value that is shaped like one.
 *
 * Same reasoning: this header is logged upstream, and forwarding it verbatim
 * would forward whatever the browser chose to put in it.
 */
function safeAcceptLanguage(event: H3Event): string {
  const header = getRequestHeader(event, 'accept-language')

  if (header && /^[A-Za-z0-9,;=.\-* \t]{1,120}$/.test(header)) return header

  return 'tr'
}
