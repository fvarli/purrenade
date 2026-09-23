import { defineBffHandler } from '~~/server/utils/handler'
import { requireAuthenticated } from '~~/server/utils/guard'
import { sessionPendingRunFinishStore } from '~~/server/utils/run-finish'

/**
 * GET /api/game-runs/pending — is a finish still waiting to be delivered?
 *
 * How a reloaded page learns that the run it was saving has not been saved
 * yet, so it can resend it before anything else. BFF-only: the pending finish
 * is this layer's retry payload, not an API resource.
 *
 * Returns the run and the proposed numbers — what the player sees while it is
 * resent — and never the idempotency key, which the browser has no use for.
 */
export default defineBffHandler(async (event) => {
  const { id } = await requireAuthenticated(event)

  const pending = await sessionPendingRunFinishStore.get(id)

  return {
    pending: pending === null
      ? null
      : { runId: pending.runId, telemetry: pending.telemetry },
  }
})
