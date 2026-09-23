#!/usr/bin/env node
/**
 * CI's contract gate. Fails when:
 *
 *  1. the snapshot is not the file `SOURCE.json` says it is (sha256), so a
 *     hand edit to the snapshot cannot pass as the backend's contract;
 *  2. the generator in `node_modules` is not the one `SOURCE.json` records;
 *  3. regenerating from the snapshot does not reproduce the committed
 *     `api.generated.ts` byte for byte, so a hand edit to the generated types —
 *     a local fork of the contract — cannot pass either.
 *
 * Reads nothing outside this repository: the build stays reproducible without
 * the backend being reachable.
 *
 * `CONTRACT_ROOT` points the check at another directory with the same layout;
 * the tests use it to prove the gate fails.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { GENERATED, ROOT, SNAPSHOT, SOURCE, generate, sha256 } from './contract-common.mjs'

const root = process.env.CONTRACT_ROOT ? path.resolve(process.env.CONTRACT_ROOT) : ROOT
const failures = []

const source = JSON.parse(readFileSync(path.join(root, SOURCE), 'utf8'))
const snapshot = readFileSync(path.join(root, SNAPSHOT))

if (!/^[0-9a-f]{40}$/.test(source.commit ?? '')) {
  failures.push('SOURCE.json does not record a 40-character backend commit')
}

if (sha256(snapshot) !== source.sha256) {
  failures.push(`${SNAPSHOT} does not match the sha256 recorded in SOURCE.json`)
}

const installed = JSON.parse(readFileSync(path.join(ROOT, 'node_modules/openapi-typescript/package.json'), 'utf8')).version

if (source.generator !== `openapi-typescript@${installed}`) {
  failures.push(`SOURCE.json records ${source.generator}, but openapi-typescript@${installed} is installed`)
}

const scratch = mkdtempSync(path.join(tmpdir(), 'contract-check-'))

try {
  const regenerated = path.join(scratch, 'api.generated.ts')
  generate(path.join(root, SNAPSHOT), regenerated)

  if (!readFileSync(regenerated).equals(readFileSync(path.join(root, GENERATED)))) {
    failures.push(`${GENERATED} differs from what the snapshot generates — regenerate it, never edit it`)
  }
}
finally {
  rmSync(scratch, { recursive: true, force: true })
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`contract check: ${failure}`)
  process.exit(1)
}

console.log(`contract matches purrenade-api@${source.commit}`)
