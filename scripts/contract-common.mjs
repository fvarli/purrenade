/**
 * Shared by `contract-sync.mjs` and `contract-check.mjs`.
 *
 * The wire contract has exactly one source: the backend repository's
 * `docs/api/openapi.draft.yaml`. This repository never reads it live — it keeps
 * a byte-for-byte **snapshot** of it, records which backend commit the snapshot
 * came from, and generates TypeScript types from the snapshot. No shared Git
 * state, no runtime coupling (ADR-0001, `docs/architecture/api-client.md` §1A).
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const SNAPSHOT = 'contracts/openapi/purrenade-api.openapi.yaml'
export const SOURCE = 'contracts/openapi/SOURCE.json'
export const GENERATED = 'shared/contracts/api.generated.ts'

/** The path inside the backend repository the snapshot is taken from. */
export const UPSTREAM_PATH = 'docs/api/openapi.draft.yaml'

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Run the pinned generator — the local `openapi-typescript`, never a global or
 * a download — from `input` to `output`. Output is left exactly as the tool
 * writes it; it is not reformatted, so regeneration is byte-deterministic.
 */
export function generate(input, output) {
  const bin = path.join(ROOT, 'node_modules', '.bin', 'openapi-typescript')
  const result = spawnSync(bin, [input, '-o', output], { cwd: ROOT, encoding: 'utf8' })

  if (result.status !== 0) {
    throw new Error(`openapi-typescript failed:\n${result.stderr || result.stdout}`)
  }
}
