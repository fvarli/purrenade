import type { FetchError } from 'ofetch'

/**
 * Reading an RFC 9457 problem on the client.
 *
 * Every error from the BFF has the same shape, which is the whole point of
 * API-1. One module knows that shape, so no component parses an error and no
 * component branches on a message.
 */

export interface FieldError {
  code: string
  message: string
}

export interface ApiProblem {
  type: string
  title: string
  status: number
  detail: string
  code: string
  correlation_id?: string
  errors?: Record<string, FieldError[]>
  retry_after?: number
}

/** A network or client-side failure that never reached the BFF. */
export const NETWORK_PROBLEM_CODE = 'client_network_error'

export function isApiProblem(value: unknown): value is ApiProblem {
  if (typeof value !== 'object' || value === null) return false

  const candidate = value as Record<string, unknown>

  return typeof candidate.code === 'string' && typeof candidate.status === 'number'
}

/**
 * Pull the problem out of whatever `$fetch` threw.
 *
 * `ofetch` puts the parsed response body on `error.data`. When that is not a
 * problem — a proxy's HTML page, a dropped connection, a timeout — a synthetic
 * one is returned, so callers never have to handle "no problem at all". The
 * distinction matters to the UI: a network failure is worth a "try again",
 * whereas a 422 is worth pointing at a field.
 */
export function toApiProblem(error: unknown): ApiProblem {
  const data = (error as FetchError | undefined)?.data

  if (isApiProblem(data)) return data

  return {
    type: `urn:purrenade:error:${NETWORK_PROBLEM_CODE}`,
    title: 'Connection failed',
    status: 0,
    detail: 'The request did not reach the server.',
    code: NETWORK_PROBLEM_CODE,
  }
}

/**
 * Field errors as a flat map of field → first code.
 *
 * A form needs one message per field, and the first failure is the one to act
 * on: telling someone their password is both too short and breached invites
 * them to fix the wrong half first.
 */
export function fieldCodes(problem: ApiProblem): Record<string, string> {
  const codes: Record<string, string> = {}

  for (const [field, errors] of Object.entries(problem.errors ?? {})) {
    if (errors[0]) codes[field] = errors[0].code
  }

  return codes
}

/**
 * Translate a problem into a localised message.
 *
 * **Branches on `code`, never on `detail`.** The server's `detail` is English
 * prose for logs and for API consumers; a Turkish-speaking player must not be
 * shown it, and a client that parses it breaks the first time the wording
 * improves. localization.md, api-client.md §5.
 *
 * An unmapped code falls back to a generic message **and the correlation id**,
 * so an unexpected failure is still reportable rather than silently opaque.
 */
export function useProblemMessage() {
  const { t, te } = useI18n()

  function messageFor(problem: ApiProblem): string {
    const key = `errors.${problem.code}`

    if (te(key)) return t(key)

    if (problem.correlation_id) {
      return t('errors.unexpected_with_reference', { reference: problem.correlation_id })
    }

    return t('errors.unexpected')
  }

  /** The localised message for one field's first failure, or null. */
  function fieldMessageFor(problem: ApiProblem, field: string): string | null {
    const code = problem.errors?.[field]?.[0]?.code

    if (!code) return null

    const specific = `errors.fields.${field}.${code}`

    if (te(specific)) return t(specific)

    const generic = `errors.fields.default.${code}`

    return te(generic) ? t(generic) : t('errors.fields.default.invalid')
  }

  return { messageFor, fieldMessageFor }
}
