import { describe, expect, it, vi } from 'vitest'

// The module's default export is a Nitro plugin, and importing it evaluates
// that call. `defineNitroPlugin` is a Nitro auto-import, absent from a plain
// Vitest run — stubbed here rather than moving the decision into a file of its
// own, because the guard and the decision it makes belong together.
vi.stubGlobal('defineNitroPlugin', (handler: unknown) => handler)

const { sessionStoreRefusal } = await import('~~/server/plugins/session-store-guard')

/**
 * Production must not inherit the local filesystem session store.
 *
 * The store holds `apiToken` — the raw Sanctum bearer token for every signed-in
 * device — as plaintext JSON, in files named after the session cookie. Fine in
 * development. Not something to arrive at by accident.
 *
 * And by accident was the only way it could have happened. `nitro.storage` is
 * resolved at build time, so `NUXT_SESSION_DRIVER` set in a production
 * environment does nothing at all: the built server carries a literal `fs`
 * mount, and the variable name does not appear anywhere in the bundle. An
 * operator following `.env.example` would set it, see no error, and be wrong —
 * while `.env.example` and two documents described it as a runtime switch.
 *
 * So the guard reads the resolved mount rather than the variable. Asking the
 * variable would reproduce the mistake it exists to catch.
 */

const fsMount = { isFilesystem: true, base: '.data/sessions' }
const redisMount = { isFilesystem: false }

describe('sessionStoreRefusal', () => {
  it('refuses a production boot on the filesystem store', () => {
    const refusal = sessionStoreRefusal(fsMount, { nodeEnv: 'production' })

    expect(refusal).toBeTypeOf('string')
  })

  it('says why, and says the variable is build-time', () => {
    // The operator reading this is about to try setting NUXT_SESSION_DRIVER
    // again. The message has to stop them.
    const refusal = sessionStoreRefusal(fsMount, { nodeEnv: 'production' }) ?? ''

    expect(refusal).toContain('BUILD time')
    expect(refusal).toContain('NUXT_SESSION_DRIVER')
    expect(refusal).toContain('PURRENADE_ALLOW_FS_SESSIONS')
    expect(refusal).toContain('.data/sessions')
  })

  it.each(['development', 'test', undefined])('allows %s', (nodeEnv) => {
    expect(sessionStoreRefusal(fsMount, { nodeEnv })).toBeNull()
  })

  it('allows production on any other driver', () => {
    expect(sessionStoreRefusal(redisMount, { nodeEnv: 'production' })).toBeNull()
  })

  it('allows production on the filesystem store when explicitly acknowledged', () => {
    // A single-instance deployment whose operator has decided the directory is
    // adequately protected. An explicit choice, made once, in the open.
    expect(sessionStoreRefusal(fsMount, {
      nodeEnv: 'production',
      allowFsSessions: '1',
    })).toBeNull()
  })

  it('does not treat any other value as acknowledgement', () => {
    for (const value of ['true', 'yes', '0', '', 'TRUE']) {
      expect(sessionStoreRefusal(fsMount, {
        nodeEnv: 'production',
        allowFsSessions: value,
      })).toBeTypeOf('string')
    }
  })
})
