import { getRouterParam } from 'h3'
import { defineBffHandler } from '~~/server/utils/handler'
import { readJsonBody, requireAuthenticated } from '~~/server/utils/guard'
import { BffProblemCode, bffProblem } from '~~/server/utils/problem'
import { UpstreamProblem, callApi, gameRunFinishPath } from '~~/server/utils/upstream'
import type { RunResultEnvelope } from '~~/server/utils/contracts'
import {
  isUsableRunResult,
  parseTelemetry,
  sessionPendingRunFinishStore,
  submitRunFinish,
} from '~~/server/utils/run-finish'

/**
 * POST /api/game-runs/:runId/finish — deliver a run's proposed result.
 *
 * The browser sends only the three telemetry integers. The `Idempotency-Key`
 * is generated **here**, once, and stored with the payload in the session
 * before Laravel is called; every retry — a network drop, a reload, a BFF
 * restart — resends the stored payload under the stored key. See
 * `server/utils/run-finish.ts`.
 *
 * The response is Laravel's decision, relayed. Nothing here infers an outcome.
 */
export default defineBffHandler(async (event) => {
  const { id, token } = await requireAuthenticated(event)

  const requested = getRouterParam(event, 'runId') ?? ''
  // Validates the id — a malformed one is a 404 — before anything else runs.
  const path = gameRunFinishPath(requested)
  const runId = requested.toLowerCase()

  const body = await readJsonBody(event)

  const result = await submitRunFinish({
    store: sessionPendingRunFinishStore,
    sessionId: id,
    runId,
    telemetry: parseTelemetry(body.telemetry),
    send: async (pending) => {
      const response = await callApi<RunResultEnvelope>(event, 'gameRunFinish', {
        token,
        path,
        idempotencyKey: pending.idempotencyKey,
        body: { telemetry: pending.telemetry },
      })

      if (!isUsableRunResult(response.body?.data, pending.runId)) {
        throw new UpstreamProblem(bffProblem(
          BffProblemCode.UpstreamUnavailable,
          502,
          'The service returned an unexpected response.',
          { correlation_id: response.correlationId },
        ))
      }

      return response.body.data
    },
  })

  return { result }
})
