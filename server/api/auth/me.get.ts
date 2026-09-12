import { defineBffHandler } from '~~/server/utils/handler'
import { requireTrustedOrigin } from '~~/server/utils/guard'
import { UpstreamProblem, callApi } from '~~/server/utils/upstream'
import { destroySession, readSession, touchSession } from '~~/server/utils/session'
import type { MeEnvelope } from '~~/server/utils/contracts'

/**
 * GET /api/auth/me
 *
 * How the app restores its state after a page refresh. The browser holds only
 * an opaque cookie, so on every fresh load this is the question it asks.
 *
 * Returns `guest` rather than 401 when there is no session. A refresh on a
 * public page is not an error, and a 401 here would make every first paint log
 * an authentication failure.
 *
 * `two_factor_required` is reported from local state: a session in that state
 * has no upstream credential, so there is nothing to ask the API about.
 */
export default defineBffHandler(async (event) => {
  requireTrustedOrigin(event)

  const session = await readSession(event)

  if (!session) {
    return { status: 'guest' as const, user: null }
  }

  if (session.record.pendingTwoFactor) {
    const pending = session.record.pendingTwoFactor

    // An expired challenge leaves the session stranded: no credential and no
    // way to finish. Drop it so the client is sent cleanly back to login.
    if (new Date(pending.expiresAt).getTime() <= Date.now()) {
      await destroySession(event)
      return { status: 'guest' as const, user: null }
    }

    return {
      status: 'two_factor_required' as const,
      user: null,
      challenge_expires_at: pending.expiresAt,
      recovery_codes_available: pending.recoveryCodesAvailable,
    }
  }

  if (!session.record.apiToken) {
    return { status: 'guest' as const, user: null }
  }

  try {
    const response = await callApi<MeEnvelope>(event, 'me', {
      token: session.record.apiToken,
    })

    await touchSession(session.id, session.record)

    return {
      status: 'authenticated' as const,
      user: response.body.data,
      email_verification: response.body.meta?.email_verification ?? null,
    }
  }
  catch (error) {
    // The token was revoked elsewhere — another device signed this session out,
    // or a password reset ended every session. The local session is now
    // meaningless, so it goes too rather than being retried on every page load.
    if (error instanceof UpstreamProblem && error.problem.status === 401) {
      await destroySession(event)
      return { status: 'guest' as const, user: null }
    }

    throw error
  }
})
