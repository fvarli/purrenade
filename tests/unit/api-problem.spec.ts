import { describe, expect, it } from 'vitest'
import { NETWORK_PROBLEM_CODE, fieldCodes, isApiProblem, toApiProblem } from '~/composables/useApiProblem'
import type { ApiProblem } from '~/composables/useApiProblem'

/**
 * Reading an error on the client.
 *
 * `api-client.md` §5: the client maps from stable codes, never from message
 * text. These tests pin the part that makes that possible — getting a problem
 * out of whatever the fetch layer threw, including when it threw nothing
 * resembling one.
 */

function problem(overrides: Partial<ApiProblem> = {}): ApiProblem {
  return {
    type: 'urn:purrenade:error:validation_failed',
    title: 'Validation failed',
    status: 422,
    detail: 'The given data was invalid.',
    code: 'validation_failed',
    ...overrides,
  }
}

describe('isApiProblem', () => {
  it('recognises a problem', () => {
    expect(isApiProblem(problem())).toBe(true)
  })

  it('rejects everything else', () => {
    for (const value of [null, undefined, 'error', 0, [], {}, { code: 'x' }, { status: 500 }]) {
      expect(isApiProblem(value)).toBe(false)
    }
  })
})

describe('toApiProblem', () => {
  it('unwraps the body ofetch attached to the error', () => {
    const extracted = toApiProblem({ data: problem({ code: 'invalid_credentials', status: 401 }) })

    expect(extracted.code).toBe('invalid_credentials')
    expect(extracted.status).toBe(401)
  })

  it('synthesises a problem when the request never arrived', () => {
    // A timeout, a dropped connection, a proxy's HTML page. Callers must never
    // have to handle "no problem at all", and the UI says something different
    // about a network failure than about a 422.
    for (const thrown of [
      new Error('Failed to fetch'),
      { data: '<html>502 Bad Gateway</html>' },
      { data: undefined },
      undefined,
      null,
    ]) {
      const extracted = toApiProblem(thrown)

      expect(extracted.code).toBe(NETWORK_PROBLEM_CODE)
      expect(extracted.status).toBe(0)
      expect(isApiProblem(extracted)).toBe(true)
    }
  })

  it('never surfaces the underlying error message', () => {
    // Node's network errors name the host and port they failed to reach, which
    // is internal topology.
    const extracted = toApiProblem(new Error('connect ECONNREFUSED 10.0.3.4:8410'))

    expect(extracted.detail).not.toContain('ECONNREFUSED')
    expect(extracted.detail).not.toContain('10.0.3.4')
  })
})

describe('fieldCodes', () => {
  it('takes the first failure per field', () => {
    // One message per field, and the first is the one to act on: telling
    // somebody their password is both too short and breached invites them to
    // fix the wrong half first.
    const codes = fieldCodes(problem({
      errors: {
        password: [
          { code: 'too_short', message: 'Too short.' },
          { code: 'password_compromised', message: 'Breached.' },
        ],
        email: [{ code: 'taken', message: 'Taken.' }],
      },
    }))

    expect(codes).toEqual({ password: 'too_short', email: 'taken' })
  })

  it('is empty when there are no field errors', () => {
    expect(fieldCodes(problem())).toEqual({})
  })
})
