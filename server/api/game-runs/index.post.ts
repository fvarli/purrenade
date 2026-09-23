import { defineBffHandler } from '~~/server/utils/handler'
import { readJsonBody, requireAuthenticated } from '~~/server/utils/guard'
import { BffProblemCode, bffProblem } from '~~/server/utils/problem'
import { UpstreamProblem, callApi } from '~~/server/utils/upstream'
import type { StartedRunEnvelope } from '~~/server/utils/contracts'
import { isUsableStartedRun, sessionPendingRunFinishStore } from '~~/server/utils/run-finish'

/**
 * POST /api/game-runs — start a normal run, or resume the active one.
 *
 * Laravel creates the run, its seed and its start time; this route relays the
 * one preference the browser has, the character, and returns what the server
 * decided. `resumed` is the status code made explicit (`200` rather than
 * `201`): a resumed run must never be presented as a fresh one.
 *
 * **Refused while a finish is pending for this session.** A new run starts only
 * after the previous one's result has been delivered or definitively refused,
 * so a player cannot leave an unsaved run behind by pressing Play.
 *
 * The seed is checked before it is returned: the domain throws on anything
 * that is not a uint32, and that failure belongs here, as an upstream fault,
 * rather than inside the engine.
 */
export default defineBffHandler(async (event) => {
  const { id, token } = await requireAuthenticated(event)

  if (await sessionPendingRunFinishStore.get(id) !== null) {
    throw new UpstreamProblem(bffProblem(
      BffProblemCode.RunFinishPending,
      409,
      'A previous run is still being saved. It has to finish first.',
    ))
  }

  const body = await readJsonBody(event)
  const characterId = body.character_id

  if (typeof characterId !== 'string') {
    throw new UpstreamProblem(bffProblem(BffProblemCode.InvalidRequest, 422, 'A character is required.'))
  }

  const response = await callApi<StartedRunEnvelope>(event, 'gameRunStart', {
    token,
    body: { character_id: characterId },
  })

  if (!isUsableStartedRun(response.body?.data)) {
    throw new UpstreamProblem(bffProblem(
      BffProblemCode.UpstreamUnavailable,
      502,
      'The service returned an unexpected response.',
      { correlation_id: response.correlationId },
    ))
  }

  return { run: response.body.data, resumed: response.status === 200 }
})
