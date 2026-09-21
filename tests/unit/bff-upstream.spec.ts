import { describe, expect, it } from 'vitest'
import { Endpoint, UpstreamProblem, sessionRevokePath } from '~~/server/utils/upstream'

/**
 * The BFF is not an open proxy.
 *
 * This is the security property that matters most about the upstream module: a
 * route named by the caller would be an SSRF primitive, reaching the API's
 * administrative surface, cloud metadata, or any host the server can resolve.
 */

describe('the endpoint allow-list', () => {
  it('is a closed set of API paths', () => {
    const paths = Object.values(Endpoint).map(entry => entry.path)

    expect(paths.length).toBeGreaterThan(0)

    // Every entry addresses this API's versioned prefix and nothing else. No
    // scheme, no host, no `..`.
    for (const path of paths) {
      expect(path.startsWith('/api/v1/')).toBe(true)
      expect(path).not.toContain('..')
      expect(path).not.toMatch(/^[a-z]+:/)
    }
  })

  it('uses only the methods it declares', () => {
    for (const { method } of Object.values(Endpoint)) {
      expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).toContain(method)
    }
  })

  it('admits the tutorial-completion endpoint, and admits it deliberately', () => {
    // Adding an endpoint here is the reviewable act that lets the BFF reach a
    // new part of the API at all, so the entry is asserted rather than assumed.
    expect(Endpoint.progressionTutorial).toEqual({
      method: 'POST',
      path: '/api/v1/progression/tutorial',
    })
  })

  it('declares no endpoint with a caller-supplied segment', () => {
    // The one path with a variable segment is built by `sessionRevokePath`,
    // which validates it. Nothing in the table interpolates.
    for (const { path } of Object.values(Endpoint)) {
      expect(path).not.toContain('{')
      expect(path).not.toContain('$')
    }
  })
})

describe('sessionRevokePath', () => {
  it('accepts a UUID', () => {
    expect(sessionRevokePath('3f2504e0-4f89-11d3-9a0c-0305e82c3301'))
      .toBe('/api/v1/auth/sessions/3f2504e0-4f89-11d3-9a0c-0305e82c3301')
  })

  it('refuses anything that is not one', () => {
    // Each of these would escape the closed path set if interpolated: `../..`
    // addresses a different endpoint entirely, and an absolute URL would
    // redirect the request to another host.
    for (const hostile of [
      '../../admin/overview',
      '..%2f..%2fadmin',
      '1',
      '',
      'http://169.254.169.254/latest/meta-data/',
      '3f2504e0-4f89-11d3-9a0c-0305e82c3301/../../admin',
      'not-a-uuid',
      '3f2504e0_4f89_11d3_9a0c_0305e82c3301',
    ]) {
      expect(() => sessionRevokePath(hostile)).toThrow(UpstreamProblem)
    }
  })

  it('reports a refusal as not-found, disclosing nothing', () => {
    // A malformed id and somebody else's id must be indistinguishable, or the
    // endpoint becomes an existence oracle over session identifiers.
    try {
      sessionRevokePath('../admin')
      expect.unreachable('should have thrown')
    }
    catch (error) {
      expect(error).toBeInstanceOf(UpstreamProblem)
      expect((error as UpstreamProblem).problem.status).toBe(404)
    }
  })
})
