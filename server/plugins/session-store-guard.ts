import { chmod, mkdir, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/**
 * Production must not boot on the local filesystem session store.
 *
 * The `sessions` mount holds `apiToken` — the raw Laravel Sanctum bearer token
 * for every signed-in device — as plaintext JSON, in a file whose **name is the
 * session cookie value**. Anyone who can list that directory has the cookie;
 * anyone who can read it has the credential. That is a fine trade in
 * development, where the alternative is running another service to write a demo
 * account's token to. It is not a trade to make by accident in production.
 *
 * And by accident is exactly how it would happen. `nitro.storage` is resolved at
 * **build** time, so `NUXT_SESSION_DRIVER` set in a production environment has
 * no effect whatsoever: the built server carries a literal `fs` mount and the
 * variable name does not appear in the bundle. An operator following
 * `.env.example` would set it, see no error, and be wrong. The store would keep
 * writing credentials to the deployment directory.
 *
 * So this checks the **resolved mount**, not the environment. Asking the
 * variable would reproduce the same mistake it exists to catch — the variable
 * is what lied.
 *
 * Refusing to start is deliberate. A warning in a deployment log is a warning
 * nobody reads, and the failure mode being guarded against is silent by nature:
 * everything works, and the tokens are simply readable. `PURRENADE_ALLOW_FS_SESSIONS=1`
 * is the escape hatch for a single-instance deployment whose operator has
 * decided the directory is adequately protected — an explicit choice, made once,
 * in the open.
 *
 * Locally the guard does the other half of the job: it creates the store
 * directory as `0700` and hands `session.ts` the mode to write records with, so
 * a shared development machine does not leave live sessions readable by every
 * other account on it.
 */

/** Owner-only, for a directory that holds credentials. */
const STORE_DIR_MODE = 0o700

/** Owner-only, for the records themselves. */
const STORE_FILE_MODE = 0o600

export interface SessionMount {
  isFilesystem: boolean
  base?: string
}

export interface GuardEnvironment {
  nodeEnv?: string
  allowFsSessions?: string
}

/**
 * Why this configuration must not start, or null if it may.
 *
 * A pure decision, separated from the plugin so it can be asserted directly.
 * The alternative is a guard whose only proof is that the server happened to
 * start — which is exactly the evidence the original defect also produced.
 */
export function sessionStoreRefusal(
  mount: SessionMount,
  env: GuardEnvironment,
): string | null {
  if (!mount.isFilesystem) return null
  if (env.nodeEnv !== 'production') return null
  if (env.allowFsSessions === '1') return null

  return [
    'Refusing to start: the BFF session store resolves to the local filesystem driver',
    `(base: ${mount.base ?? 'unknown'}).`,
    '',
    'That store holds the upstream Sanctum bearer token for every signed-in device,',
    'as plaintext JSON, in files named after the session cookie.',
    '',
    'NUXT_SESSION_DRIVER is read at BUILD time, not at runtime — setting it here does',
    'nothing. Rebuild with it set, and with the driver package installed (OPS-1).',
    '',
    'If a filesystem store is genuinely intended for this deployment, set',
    'PURRENADE_ALLOW_FS_SESSIONS=1 and make sure the directory is owner-only.',
  ].join('\n')
}

export default defineNitroPlugin(async () => {
  const mount = resolveSessionsMount()

  const refusal = sessionStoreRefusal(mount, {
    nodeEnv: process.env.NODE_ENV,
    allowFsSessions: process.env.PURRENADE_ALLOW_FS_SESSIONS,
  })

  if (refusal !== null) {
    // Exit, rather than throw.
    //
    // Nitro does not abort startup when a plugin rejects: it reports an
    // unhandled rejection and carries on listening. Throwing here produced a
    // frightening log line beside a server that was serving traffic perfectly
    // happily on the store this guard exists to refuse — which is precisely the
    // "a warning nobody reads" failure the guard was written to avoid, with
    // extra steps.
    //
    // Refusing to start has to mean not starting.
    console.error(refusal)
    process.exit(1)
  }

  if (!mount.isFilesystem || !mount.base) return

  // Owner-only, whether or not this is production: a development machine can
  // have other accounts on it too, and unstorage writes records at whatever the
  // process umask allows — 0644 on a typical setup.
  const path = resolve(mount.base)

  await mkdir(path, { recursive: true, mode: STORE_DIR_MODE })
  await chmod(path, STORE_DIR_MODE)

  // The directory mode is the control that matters; a record nobody can
  // traverse to is a record nobody can read. Tightening the files as well is
  // for the case where the directory mode is later relaxed, or the store is
  // copied somewhere with different permissions — a backup, an rsync, a
  // container image.
  //
  // Two halves, because one pass at boot only covers the records that already
  // exist. unstorage offers no mode option, so the umask is what decides how the
  // *next* record is created — 0644 on a typical machine. Narrowing it here
  // covers every write for the life of the process, and it is scoped to the
  // filesystem store: a deployment on a shared store never reaches this line.
  //
  // This takes effect in a built server, where the plugin and the writes share
  // one process. Under `nuxt dev` the writes happen in a separate process that
  // does not inherit it, so records there keep the developer's own umask — which
  // is why the directory mode above is the control and this is the belt to its
  // braces. A record inside a 0700 directory is unreachable to another user
  // whatever its own mode says.
  process.umask(0o077)

  const entries = await readdir(path, { withFileTypes: true }).catch(() => [])

  await Promise.all(
    entries
      .filter(entry => entry.isFile())
      .map(entry => chmod(join(path, entry.name), STORE_FILE_MODE).catch(() => undefined)),
  )
})

/**
 * What the `sessions` mount actually resolved to.
 *
 * Asked of the **root** storage, not of `useStorage('sessions')`. A namespaced
 * storage's own `getMount()` answers for the root mount — it reports the
 * in-memory default no matter what is mounted underneath — so asking it would
 * have made this guard quietly always pass, which is the same class of silent
 * wrong answer it exists to prevent.
 *
 * unstorage reports the driver's own `name`, so a future driver swap is
 * reflected here without this file being told about it.
 */
function resolveSessionsMount(): { isFilesystem: boolean, base?: string } {
  const root = useStorage() as unknown as {
    getMount?: (key?: string) => { driver?: { name?: string, options?: { base?: string } } } | undefined
  }

  const driver = root.getMount?.('sessions')?.driver

  const name = driver?.name ?? ''

  return {
    isFilesystem: name === 'fs' || name === 'fs-lite',
    base: driver?.options?.base,
  }
}
