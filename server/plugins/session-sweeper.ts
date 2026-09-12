import { sweepExpiredSessions } from '~~/server/utils/session'

/**
 * Reclaim expired session records on a slow timer.
 *
 * Sessions are otherwise collected only when the identifier naming one is
 * presented again, so a session nobody returns to is never collected at all.
 * `GET /api/auth/csrf` creates one for every visitor who arrives without a
 * cookie — including a caller in a loop — and each record holds an upstream
 * credential once it is authenticated. A store that only grows is a disclosure
 * surface that only grows with it.
 *
 * Hourly, because these records live for weeks and nothing depends on the sweep
 * being timely: `readSession` already refuses an expired record, so this
 * reclaims space rather than enforcing anything. One pass at startup catches
 * whatever accumulated while the process was down.
 *
 * `unref()` so the timer never holds the process open — a server that will not
 * shut down because a cleanup timer is pending is a worse problem than the one
 * being solved.
 */

const SWEEP_INTERVAL_MS = 60 * 60 * 1000

export default defineNitroPlugin((nitro) => {
  const sweep = (): void => {
    void sweepExpiredSessions().catch((error: unknown) => {
      // Hygiene, not a control. A failure is worth saying out loud and worth
      // not crashing over.
      console.warn('[sessions] sweep failed:', error)
    })
  }

  sweep()

  const timer = setInterval(sweep, SWEEP_INTERVAL_MS)

  timer.unref?.()

  nitro.hooks.hook('close', () => {
    clearInterval(timer)
  })
})
