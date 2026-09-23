import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * The contract gate (`npm run contract:check`) — proven to fail, not only to
 * pass.
 *
 * A gate that has only ever been seen green is a gate nobody knows works. Each
 * case copies the committed snapshot, provenance and generated types into a
 * scratch directory, breaks one thing, and runs the real script against it.
 */

const ROOT = process.cwd()
const FILES = [
  'contracts/openapi/purrenade-api.openapi.yaml',
  'contracts/openapi/SOURCE.json',
  'shared/contracts/api.generated.ts',
]

let scratch: string

function check(): { status: number | null, output: string } {
  const run = spawnSync(process.execPath, [join(ROOT, 'scripts/contract-check.mjs')], {
    env: { ...process.env, CONTRACT_ROOT: scratch },
    encoding: 'utf8',
  })

  return { status: run.status, output: run.stdout + run.stderr }
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'contract-spec-'))

  for (const file of FILES) {
    mkdirSync(join(scratch, file, '..'), { recursive: true })
    cpSync(join(ROOT, file), join(scratch, file))
  }
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

describe('contract:check', () => {
  it('passes on the committed contract', () => {
    expect(check().status).toBe(0)
  })

  it('fails when the generated types were edited by hand', () => {
    const generated = join(scratch, 'shared/contracts/api.generated.ts')
    writeFileSync(generated, readFileSync(generated, 'utf8').replace('run_id: string;', 'run_id: number;'))

    const result = check()

    expect(result.status).toBe(1)
    expect(result.output).toContain('differs from what the snapshot generates')
  })

  it('fails when the snapshot no longer matches its recorded provenance', () => {
    const snapshot = join(scratch, 'contracts/openapi/purrenade-api.openapi.yaml')
    writeFileSync(snapshot, `${readFileSync(snapshot, 'utf8')}\n# edited\n`)

    const result = check()

    expect(result.status).toBe(1)
    expect(result.output).toContain('does not match the sha256')
  })

  it('fails when the recorded generator is not the installed one', () => {
    const source = join(scratch, 'contracts/openapi/SOURCE.json')
    const record = JSON.parse(readFileSync(source, 'utf8'))
    writeFileSync(source, JSON.stringify({ ...record, generator: 'openapi-typescript@0.0.1' }))

    expect(check().status).toBe(1)
  })

  it('records a full backend commit', () => {
    const record = JSON.parse(readFileSync(join(ROOT, 'contracts/openapi/SOURCE.json'), 'utf8'))

    expect(record.repository).toBe('purrenade-api')
    expect(record.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(record.path).toBe('docs/api/openapi.draft.yaml')
  })
})

describe('the generated contract (ANTI-6 boundary)', () => {
  it('carries no field for a fact M9 cannot establish', () => {
    const generated = readFileSync(join(ROOT, 'shared/contracts/api.generated.ts'), 'utf8')

    for (const name of [
      'derived_facts',
      'reported_loli_activations',
      'reported_near_miss_count',
      'lifetime_loli_activations',
      'lifetime_near_misses',
      'run_token',
    ]) {
      // A property declaration, not a word: the contract's prose names these
      // fields precisely in order to say they do not exist.
      expect(generated, name).not.toMatch(new RegExp(`^\\s+"?${name}"?\\??:`, 'm'))
    }
  })
})
