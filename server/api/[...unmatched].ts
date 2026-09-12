import { BffProblemCode, bffProblem } from '~~/server/utils/problem'
import { defineBffHandler } from '~~/server/utils/handler'
import { UpstreamProblem } from '~~/server/utils/upstream'

/**
 * Anything under `/api/` that is not one of this BFF's routes.
 *
 * Without it, Nitro answers an unknown `/api/...` path with its own error shape
 * — `{error, url, statusCode, statusMessage, message, data, stack}`, carrying a
 * stack trace in development — which is the one place the "every failure the
 * browser sees is RFC 9457" guarantee in `handler.ts` did not reach, because
 * nothing was routed there for the wrapper to wrap. The same gap the Laravel
 * side had, for the same reason: the envelope was applied per handler rather
 * than to the surface.
 *
 * A catch-all under `/api/` only. Page routes are the Vue application's, and a
 * browser navigating to a wrong URL should get a page, not a JSON problem.
 */
export default defineBffHandler(() => {
  throw new UpstreamProblem(
    bffProblem(
      BffProblemCode.NotFound,
      404,
      'That endpoint does not exist.',
    ),
  )
})
