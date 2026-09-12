/**
 * RFC 9457 Problem Details, on the BFF side.
 *
 * The browser must see **one** error shape whether the failure came from
 * Laravel, from the BFF itself, or from the network in between. Anything else
 * and every caller in the app needs three code paths for the same question
 * ("what went wrong?").
 *
 * Laravel's problems pass through with their `code` intact — that is the value
 * the UI branches on, and rewriting it here would break the contract. Problems
 * the BFF originates use the codes below, which are namespaced `bff_` so it is
 * always obvious which layer refused.
 */

/** Errors the BFF itself produces. Upstream codes come from the API's own enum. */
export const BffProblemCode = {
  /** No session cookie, or one that no longer resolves. */
  Unauthenticated: 'unauthenticated',
  /** Missing or mismatched CSRF token on a state-changing request. */
  CsrfTokenMismatch: 'bff_csrf_token_mismatch',
  /** Origin or Referer did not match an allowed origin. */
  OriginRejected: 'bff_origin_rejected',
  /** The API did not answer within the timeout. */
  UpstreamTimeout: 'bff_upstream_timeout',
  /** The API could not be reached, or answered unintelligibly. */
  UpstreamUnavailable: 'bff_upstream_unavailable',
  /** The BFF's own session store failed. */
  SessionUnavailable: 'bff_session_unavailable',
  /**
   * No such BFF endpoint.
   *
   * Deliberately the API's own `not_found` rather than a `bff_` code: to a
   * caller this is the same event whichever layer noticed, and giving it two
   * codes would mean two branches for one condition.
   */
  NotFound: 'not_found',
} as const

export type ProblemCode = (typeof BffProblemCode)[keyof typeof BffProblemCode]

export interface FieldError {
  code: string
  message: string
}

export interface Problem {
  type: string
  title: string
  status: number
  detail: string
  code: string
  correlation_id?: string
  errors?: Record<string, FieldError[]>
  retry_after?: number
  [extension: string]: unknown
}

const TITLES: Record<ProblemCode, string> = {
  [BffProblemCode.Unauthenticated]: 'Authentication required',
  [BffProblemCode.CsrfTokenMismatch]: 'CSRF token mismatch',
  [BffProblemCode.OriginRejected]: 'Request origin not allowed',
  [BffProblemCode.UpstreamTimeout]: 'Upstream timed out',
  [BffProblemCode.UpstreamUnavailable]: 'Upstream unavailable',
  [BffProblemCode.SessionUnavailable]: 'Session store unavailable',
  [BffProblemCode.NotFound]: 'Not found',
}

/**
 * Build a problem the BFF originated.
 *
 * The `type` URN mirrors the API's scheme, so a client handling one handles
 * both. `code` is the discriminator either way.
 */
export function bffProblem(
  code: ProblemCode,
  status: number,
  detail: string,
  extras: Partial<Problem> = {},
): Problem {
  return {
    type: `urn:purrenade:error:${code}`,
    title: TITLES[code],
    status,
    detail,
    code,
    ...extras,
  }
}

/**
 * Is this value shaped like a Problem from the API?
 *
 * Checked rather than assumed, because the thing on the other end of a failed
 * request is not always the API: it may be a proxy's HTML error page, a gateway
 * timeout, or nothing at all. Passing such a body through as though it were a
 * problem is how internal detail escapes into a browser.
 */
export function isProblem(value: unknown): value is Problem {
  if (typeof value !== 'object' || value === null) return false

  const candidate = value as Record<string, unknown>

  return typeof candidate.code === 'string'
    && typeof candidate.status === 'number'
    && typeof candidate.title === 'string'
}

/**
 * Keep only the members the browser is allowed to see.
 *
 * An allow-list, not a deny-list. A deny-list has to be updated every time the
 * API adds a field, and the failure mode of forgetting is disclosure. With an
 * allow-list, forgetting means a field is missing — visible, harmless, fixable.
 *
 * `retry_after` and `errors` are carried because the UI needs them: a countdown
 * and per-field form messages respectively.
 */
export function sanitizeProblem(problem: Problem): Problem {
  const safe: Problem = {
    type: problem.type,
    title: problem.title,
    status: problem.status,
    detail: problem.detail,
    code: problem.code,
  }

  if (typeof problem.correlation_id === 'string') {
    safe.correlation_id = problem.correlation_id
  }

  if (typeof problem.retry_after === 'number') {
    safe.retry_after = problem.retry_after
  }

  if (problem.errors && typeof problem.errors === 'object') {
    safe.errors = problem.errors
  }

  return safe
}
