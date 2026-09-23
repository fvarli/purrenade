#!/usr/bin/env node
/**
 * Take a new contract snapshot from the backend repository, then regenerate.
 *
 *   npm run contract:sync -- <path-to-purrenade-api> <40-char-commit-sha>
 *
 * The file is read with `git show <sha>:docs/api/openapi.draft.yaml` — the
 * committed content at that exact revision, never the working tree — so the
 * snapshot is reproducible from the SHA it records.
 *
 * The SHA must be reachable from the backend's `origin/main`: a snapshot of a
 * commit nobody else can see names a contract nobody can reproduce. Before a
 * backend commit has been pushed, `--allow-unpublished` takes the snapshot
 * anyway and says so loudly; re-run without it once the commit is on
 * `origin/main` — the output is identical, and the check then passes.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { GENERATED, ROOT, SNAPSHOT, SOURCE, UPSTREAM_PATH, generate, sha256 } from './contract-common.mjs'

const args = process.argv.slice(2)
const allowUnpublished = args.includes('--allow-unpublished')
const [apiRepo, sha] = args.filter(arg => !arg.startsWith('--'))

if (!apiRepo || !/^[0-9a-f]{40}$/.test(sha ?? '')) {
  console.error('usage: contract-sync.mjs <path-to-purrenade-api> <40-char lowercase commit sha> [--allow-unpublished]')
  process.exit(2)
}

const git = (...gitArgs) => execFileSync('git', ['-C', apiRepo, ...gitArgs], { encoding: 'utf8' })

git('cat-file', '-e', `${sha}^{commit}`)

let published = true

try {
  git('merge-base', '--is-ancestor', sha, 'origin/main')
}
catch {
  published = false
}

if (!published && !allowUnpublished) {
  console.error(`refusing: ${sha} is not reachable from origin/main in ${apiRepo}`)
  process.exit(1)
}

if (!published) {
  console.warn(`WARNING: ${sha} is not on origin/main yet. Re-run without --allow-unpublished after it is pushed.`)
}

const snapshot = execFileSync('git', ['-C', apiRepo, 'show', `${sha}:${UPSTREAM_PATH}`])

writeFileSync(path.join(ROOT, SNAPSHOT), snapshot)
writeFileSync(path.join(ROOT, SOURCE), `${JSON.stringify({
  repository: 'purrenade-api',
  commit: sha,
  path: UPSTREAM_PATH,
  sha256: sha256(snapshot),
  generator: `openapi-typescript@${JSON.parse(readFileSync(path.join(ROOT, 'node_modules/openapi-typescript/package.json'), 'utf8')).version}`,
}, null, 2)}\n`)

generate(path.join(ROOT, SNAPSHOT), path.join(ROOT, GENERATED))

console.log(`contract synced from purrenade-api@${sha}`)
