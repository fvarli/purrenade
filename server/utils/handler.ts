import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { defineEventHandler, setResponseHeader, setResponseStatus } from 'h3'
import { BffProblemCode, bffProblem } from './problem'
import type { Problem } from './problem'
import { UpstreamProblem } from './upstream'

/**
 * The wrapper every BFF route uses.
 *
 * It exists so that error handling is not a thing each route remembers. Three
 * guarantees, once:
 *
 *  1. **Every failure is RFC 9457**, with the right status and
 *     `application/problem+json`, so the browser sees one error shape from the
 *     whole surface.
 *
 *  2. **An unexpected throw does not leak.** Anything that is not an
 *     `UpstreamProblem` becomes a bare 500 whose detail comes from here. A raw
 *     Nitro error page carries a stack trace and file paths, and in development
 *     it carries the source of the file that threw.
 *
 *  3. **Failures are logged server-side.** The problem the browser gets is
 *     deliberately thin; the reason it happened has to be somewhere, and that
 *     somewhere is the process log, which in this deployment is the journal.
 *
 * `instance` is filled in here rather than by each route, so it always matches
 * the path that actually failed.
 */
export function defineBffHandler<T>(
  handler: (event: H3Event) => Promise<T>,
): EventHandler<EventHandlerRequest, Promise<T | Problem>> {
  return defineEventHandler(async (event) => {
    try {
      return await handler(event)
    }
    catch (error) {
      const problem = toProblem(error)

      if (!(error instanceof UpstreamProblem)) {
        // Unexpected: worth a real log line. Expected problems — a wrong
        // password, a rate limit — are control flow and would drown it.
        console.error('[bff] unhandled error', {
          path: event.path,
          method: event.method,
          error: error instanceof Error ? error.message : String(error),
        })
      }

      setResponseStatus(event, problem.status)
      setResponseHeader(event, 'content-type', 'application/problem+json')

      return { ...problem, instance: event.path } as Problem
    }
  })
}

function toProblem(error: unknown): Problem {
  if (error instanceof UpstreamProblem) return error.problem

  return bffProblem(
    BffProblemCode.UpstreamUnavailable,
    500,
    'Something went wrong on our side. Try again.',
  )
}
