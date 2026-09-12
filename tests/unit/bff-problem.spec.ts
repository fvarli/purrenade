import { describe, expect, it } from 'vitest'
import { BffProblemCode, bffProblem, isProblem, sanitizeProblem } from '~~/server/utils/problem'
import type { Problem } from '~~/server/utils/problem'

/**
 * The BFF's half of the error contract (API-1).
 *
 * The browser must see one error shape whether the failure came from Laravel,
 * from the BFF, or from the network. These tests pin the two rules that make
 * that true: a problem from the API keeps its stable `code`, and anything that
 * is *not* a problem is never relayed as though it were.
 */

function apiProblem(overrides: Partial<Problem> = {}): Problem {
  return {
    type: 'urn:purrenade:error:validation_failed',
    title: 'Validation failed',
    status: 422,
    detail: 'The given data was invalid.',
    code: 'validation_failed',
    correlation_id: '01K5R8Q2M3N4P5Q6R7S8T9V0W1',
    ...overrides,
  }
}

describe('isProblem', () => {
  it('recognises a well-formed problem', () => {
    expect(isProblem(apiProblem())).toBe(true)
  })

  it('rejects anything that is not one', () => {
    // The thing on the other end of a failed request is not always the API: it
    // may be a proxy's HTML page, a gateway timeout, or nothing at all.
    // Relaying such a body as a problem is how internal detail escapes.
    for (const value of [
      null,
      undefined,
      'Internal Server Error',
      '<html><body>502 Bad Gateway</body></html>',
      42,
      [],
      { message: 'Server Error' },
      { code: 'x' },
      { status: 500 },
      { code: 500, status: 500, title: 'x' },
    ]) {
      expect(isProblem(value)).toBe(false)
    }
  })
})

describe('sanitizeProblem', () => {
  it('keeps the members the browser needs', () => {
    const safe = sanitizeProblem(apiProblem({
      retry_after: 42,
      errors: { email: [{ code: 'taken', message: 'Already registered.' }] },
    }))

    // `code` survives, because it is the value the UI branches on. `errors` and
    // `retry_after` survive because a form and a countdown need them.
    expect(safe.code).toBe('validation_failed')
    expect(safe.errors?.email?.[0]?.code).toBe('taken')
    expect(safe.retry_after).toBe(42)
    expect(safe.correlation_id).toBe('01K5R8Q2M3N4P5Q6R7S8T9V0W1')
  })

  it('drops anything the API did not promise', () => {
    // An allow-list, not a deny-list: forgetting to exclude a new field would
    // disclose it, whereas forgetting to include one is merely visible.
    const safe = sanitizeProblem(apiProblem({
      trace: ['/var/www/app/Http/Controllers/Auth/LoginController.php:62'],
      sql: 'select * from users where email = ?',
      exception: 'PDOException',
    } as Partial<Problem>))

    expect(safe).not.toHaveProperty('trace')
    expect(safe).not.toHaveProperty('sql')
    expect(safe).not.toHaveProperty('exception')

    expect(Object.keys(safe).sort()).toEqual(
      ['code', 'correlation_id', 'detail', 'status', 'title', 'type'],
    )
  })

  it('omits a retry hint that is not a number', () => {
    const safe = sanitizeProblem(apiProblem({ retry_after: 'soon' } as Partial<Problem>))

    expect(safe).not.toHaveProperty('retry_after')
  })
})

describe('bffProblem', () => {
  it('mirrors the API URN scheme, so one client handles both', () => {
    const problem = bffProblem(BffProblemCode.UpstreamTimeout, 504, 'Took too long.')

    expect(problem.type).toBe('urn:purrenade:error:bff_upstream_timeout')
    expect(problem.code).toBe('bff_upstream_timeout')
    expect(problem.status).toBe(504)
  })

  it('namespaces its own codes, so the layer that refused is obvious', () => {
    for (const code of [
      BffProblemCode.CsrfTokenMismatch,
      BffProblemCode.OriginRejected,
      BffProblemCode.UpstreamTimeout,
      BffProblemCode.UpstreamUnavailable,
      BffProblemCode.SessionUnavailable,
    ]) {
      expect(code.startsWith('bff_')).toBe(true)
    }

    // The exception, deliberately: an unauthenticated BFF request and an
    // unauthenticated API request are the same condition to a client, and
    // giving them two codes would make every caller handle both.
    expect(BffProblemCode.Unauthenticated).toBe('unauthenticated')
  })
})
