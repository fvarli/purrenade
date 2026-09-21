import { defineBffHandler } from '~~/server/utils/handler'
import { requireAuthenticated } from '~~/server/utils/guard'
import { callApi } from '~~/server/utils/upstream'
import type { TutorialStateEnvelope } from '~~/server/utils/contracts'

/**
 * POST /api/progression/tutorial — the first-run tutorial is done.
 *
 * No body is read, and none is forwarded. The upstream endpoint takes none: the
 * player it records is the owner of the session this BFF holds, so there is
 * nothing a caller could put in a request that would aim it somewhere else.
 * Not reading the body is the point — a handler that forwarded one would be a
 * handler somebody could try to smuggle a `user_id` through, even though the
 * API would ignore it.
 *
 * Skipping and finishing are the same call. The product counts a skipped
 * tutorial as completed, and the difference is not something the server is
 * told.
 *
 * Idempotent upstream, so no retry guard is needed here: a second call returns
 * the same state without moving the stored timestamp.
 */
export default defineBffHandler(async (event) => {
  const { token } = await requireAuthenticated(event)

  const response = await callApi<TutorialStateEnvelope>(event, 'progressionTutorial', { token })

  return { tutorialCompleted: response.body.data.tutorial_completed }
})
