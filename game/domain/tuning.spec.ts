import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { JUMP_ARC, STEP_MS, TUNING } from './tuning'

/**
 * The tuning module against its registry, and against itself.
 *
 * Two of M5's acceptance criteria live here. *"No gameplay literal exists
 * outside the tuning module"* is enforced by the source scan below; *"jump
 * matches the approved ~650 ms airborne target"* is enforced by deriving the
 * arc rather than restating it.
 *
 * The registry check makes rule 4 of `docs/game/tuning-parameters.md`
 * mechanical: *"adding a tunable means adding a row here, in the same change"*.
 * A rule that depends on remembering is a rule that decays.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))

function read(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8')
}

/** Every leaf key of the frozen tuning object, as dotted paths. */
function leafPaths(value: unknown, prefix = ''): string[] {
  // An array is a value, not a group. Walking into one would demand a registry
  // row per index, which documents nothing a reader wants.
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [prefix]

  return Object.entries(value).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  )
}

/**
 * Every `@status` tag paired with the leaf it sits above.
 *
 * Counting tags — which is what this used to do — proves a number, not a
 * mapping: two tags on one value and none on another passes, and a stray
 * `@status` in a file-level comment counts towards the total.
 */
function declaredStatuses(source: string): Map<string, string> {
  /*
   * Path-aware, because the groups nest.
   *
   * Keying by the bare leaf name collided the moment `difficulty.speed.base`
   * and `difficulty.density.base` both existed — one `base` overwrote the
   * other and half the statuses stopped being checked. The brace depth is
   * tracked so each tag is attributed to the value it actually sits above.
   */
  const found = new Map<string, string>()
  const stack: string[] = []

  let pending: string | null = null
  let depth = 0

  for (const line of source.split('\n')) {
    const tag = /@status (APPROVED|PROPOSED)/.exec(line)

    if (tag !== null) {
      pending = tag[1]!
      continue
    }

    const group = /^\s*([A-Za-z][A-Za-z0-9]*)\s*:\s*Object\.freeze\(\{/.exec(line)

    if (group !== null) {
      stack[depth] = group[1]!
      depth++
      pending = null
      continue
    }

    const leaf = /^\s*([A-Za-z][A-Za-z0-9]*)\s*:\s*(?!Object\.freeze\(\{)/.exec(line)

    if (leaf !== null && pending !== null) {
      found.set([...stack.slice(0, depth), leaf[1]!].join('.'), pending)
      pending = null
      continue
    }

    if (/^\s*\}\)[,;]?\s*$/.test(line) && depth > 0) {
      depth--
      pending = null
    }
  }

  return found
}

/**
 * Does the code's value match what the registry documents?
 *
 * A prefix match is not a match. This was `documented.startsWith(actual)`,
 * which passes whenever the documented number merely *begins* with the real
 * one: a registry saying `14` accepted a code value of `1`, and a registry
 * saying `0.55` accepted `0.5`. Every short number is a prefix of something.
 *
 * So numbers are compared as numbers, after stripping the unit or gloss the
 * registry is allowed to carry ("1 (CENTER)", "0.72 of the column"), and the
 * boundary after the number is checked so `1` cannot satisfy `14`. Arrays are
 * compared element by element; anything else is compared as exact text.
 */
function valueAgrees(actual: string, documented: string): boolean {
  const clean = (text: string): string => text.replace(/[`*]/g, '').trim()
  const text = clean(documented)

  // An array leaf stringifies as "0,30,60,120,180"; the registry writes it with
  // separators and may gloss it afterwards.
  if (actual.includes(',')) {
    const wanted = actual.split(',').map(Number)
    const found = (text.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)

    return wanted.every((value, index) => found[index] === value)
      && found.length >= wanted.length
  }

  const asNumber = Number(actual)

  if (!Number.isNaN(asNumber) && actual.trim() !== '') {
    // The number must lead, and must end where the code's value ends: a
    // trailing digit or decimal point means the registry documents a different
    // number that merely starts the same way.
    const leading = /^(-?\d+(?:\.\d+)?)(?![\d.])/.exec(text)

    return leading !== null && Number(leading[1]) === asNumber
  }

  return text === actual || text.startsWith(`${actual} `) || text.startsWith(`${actual}(`)
}

interface RegistryRow {
  readonly value: string
  readonly status: string
  /** The notes column says this row is ahead of the implementation. */
  readonly notImplemented: boolean
}

/** Every registry row, as leaf → { value, status, notImplemented }. */
function registryRows(markdown: string): Map<string, RegistryRow> {
  const rows = new Map<string, RegistryRow>()
  const pattern = /^\|\s*`([A-Za-z0-9.]+)`\s*\|\s*([^|]+?)\s*\|\s*\*{0,2}(APPROVED|PROPOSED|OPEN)\*{0,2}\s*\|([^\n]*)/gm

  for (const match of markdown.matchAll(pattern)) {
    // Keyed by the full dotted path. Keyed by the leaf, a newly added
    // `evil.count` was "documented" by the existing `lane.count` row.
    rows.set(match[1]!, {
      value: match[2]!,
      status: match[3]!,
      notImplemented: /\bNot implemented\b/i.test(match[4] ?? ''),
    })
  }

  return rows
}

describe('the registry and the module agree', () => {
  const registry = registryRows(read('../../docs/game/tuning-parameters.md'))
  const source = read('./tuning.ts')

  it('documents every tunable, as a row and not as prose', () => {
    /*
     * An anchored table row, not `registry.includes(leaf)`.
     *
     * The substring form matched anywhere in a 250-line document, including
     * table headers and English prose — "How close along the road **counts** as
     * passing" satisfied a leaf named `count`. Any tunable whose name happened
     * to appear somewhere in the file was documented as far as this test was
     * concerned, which is most short names.
     */
    const missing = leafPaths(TUNING).filter(path => !registry.has(path))

    expect(missing).toEqual([])
  })

  it('agrees with the registry about every value', () => {
    // Values were never compared. `airborneMs` could have become 6500 and only
    // the separate hard-coded assertion below would have noticed.
    const disagreements = leafPaths(TUNING).flatMap((path) => {
      const documented = registry.get(path)

      if (documented === undefined) return []

      const actual = String(path.split('.').reduce<unknown>(
        (node, key) => (node as Record<string, unknown>)[key], TUNING,
      ))

      return valueAgrees(actual, documented.value)
        ? []
        : [`${path}: code ${actual}, registry "${documented.value}"`]
    })

    expect(disagreements).toEqual([])
  })

  it('documents nothing the code does not have', () => {
    /*
     * The reverse direction, which was never checked.
     *
     * A registry row with no tunable behind it is worse than a missing row: it
     * reads as a decision the code honours, and nothing contradicts it. Three
     * were found this way — `run.resumeReadyMs`, `collision.playerBoxWidthRatio`
     * and `collision.playerBoxHeightRatio` — all documented with values, none
     * of them implemented anywhere.
     *
     * A row may be kept ahead of its implementation, but it has to say so in
     * its own notes, in the document, where a reader sees it. The exemption
     * lives in the registry rather than in a list here, so the test cannot drift
     * away from what the page claims.
     */
    const paths = new Set(leafPaths(TUNING))

    /*
     * Only rows carrying a *number* are checked.
     *
     * Most of the registry states structural rules rather than knobs —
     * `jump.doubleJumpAllowed | false`, `nearMiss.oneEventPerObstacle | true`,
     * `lane.pitch | road.width / 3`. Those are true because of how the code is
     * shaped, and there is deliberately no constant behind them; demanding one
     * would push a fake tunable into `TUNING` for every documented rule. A row
     * with a bare number is different: it reads as a value the code reads, and
     * if nothing reads it the row is a quiet lie.
     */
    const undelivered = [...registry.entries()]
      .filter(([path]) => !paths.has(path))
      .filter(([, row]) => !row.notImplemented)
      .filter(([, row]) => /^\s*\**\s*-?\d/.test(row.value))
      .map(([path, row]) => `${path}: registry says ${row.value}, code has no such tunable`)

    expect(undelivered).toEqual([])
  })

  /**
   * What APPROVED is worth, as a test.
   *
   * Found by mutating `score.perPaw` away from its approved value: exactly one
   * test failed, and it was the registry comparison. Every other assertion in
   * the suite is written against `TUNING`, deliberately and correctly — a test
   * that hard-codes a PROPOSED number has to be rewritten every time the number
   * is reviewed. But it means an **APPROVED** value was held by nothing except
   * the requirement that two files agree, and two files can be edited together.
   * "LOCKED" was a word in a document rather than a property of the repository.
   *
   * So approved values are pinned literally, here, and nowhere else. The table
   * is the third place: changing one now means changing the code, the registry
   * *and* a list that says in as many words that a product owner decided it.
   *
   * The first assertion is what keeps the table honest — a newly approved leaf
   * fails until it is listed, so the lock cannot be skipped by omission.
   */
  const APPROVED: Readonly<Record<string, number | boolean | readonly number[]>> = Object.freeze({
    'layout.baselineViewportWidthPx': 390,
    'layout.baselineViewportHeightPx': 844,
    'layout.desktopPlayColumnPx': 460,
    'lane.count': 3,
    'lane.startIndex': 1,
    'jump.airborneMs': 650,
    'obstacle.jumpable.clearableByJump': true,
    'hearts.start': 3,
    'hearts.max': 3,
    'hearts.costPerCollision': 1,
    'difficulty.tierStartsS': [0, 30, 60, 120, 180],
    'score.perPaw': 10,
    'score.slayyyMultiplier': 2,
    'paw.loliThreshold': 200,
    'loli.durationMs': 8000,
    'loli.concurrentInstances': 1,
    'slayyy.durationMs': 5000,
  })

  it('pins every approved value, so nothing approved can move quietly', () => {
    const declared = declaredStatuses(source)
    const approvedPaths = leafPaths(TUNING).filter(path => declared.get(path) === 'APPROVED')

    expect(
      approvedPaths.filter(path => !(path in APPROVED)),
      'newly approved values must be added to the locked table above',
    ).toEqual([])

    expect(
      Object.keys(APPROVED).filter(path => !approvedPaths.includes(path)),
      'the locked table names a value that is no longer APPROVED in tuning.ts',
    ).toEqual([])

    const wrong = Object.entries(APPROVED).flatMap(([path, expected]) => {
      const actual = path.split('.').reduce<unknown>(
        (node, key) => (node as Record<string, unknown>)[key], TUNING,
      )

      const same = Array.isArray(expected)
        ? JSON.stringify(actual) === JSON.stringify(expected)
        : actual === expected

      return same ? [] : [`${path}: code ${JSON.stringify(actual)}, approved ${JSON.stringify(expected)}`]
    })

    expect(wrong, 'an APPROVED value was changed without a recorded decision').toEqual([])
  })

  it('agrees with the registry about every status', () => {
    // `open-decisions.md` §0AC claims this test exists. It did not.
    const declared = declaredStatuses(source)

    const disagreements = leafPaths(TUNING).flatMap((path) => {
      const inCode = declared.get(path)
      const inRegistry = registry.get(path)?.status

      if (inCode === undefined) return [`${path}: no @status tag in tuning.ts`]
      if (inRegistry === undefined) return []

      return inCode === inRegistry ? [] : [`${path}: code ${inCode}, registry ${inRegistry}`]
    })

    expect(disagreements).toEqual([])
  })

  it('is frozen all the way down, at any depth', () => {
    // A mutable tuning object is a tuning object something will mutate, and a
    // run that changes its own constants is not reproducible. This walked two
    // levels; M6's `obstacle.classes.cone` would have been unfrozen and green.
    const unfrozen: string[] = []

    const walk = (node: unknown, path: string): void => {
      if (typeof node !== 'object' || node === null) return

      if (!Object.isFrozen(node)) unfrozen.push(path || 'TUNING')

      for (const [key, child] of Object.entries(node)) {
        walk(child, path ? `${path}.${key}` : key)
      }
    }

    walk(TUNING, '')
    walk(JUMP_ARC, 'JUMP_ARC')

    expect(unfrozen).toEqual([])
  })
})

describe('the jump arc is derived, not restated', () => {
  it('peaks at the apex height, at the midpoint of the approved duration', () => {
    const t = JUMP_ARC.apexMs / 1000
    const height = JUMP_ARC.initialVelocityPxPerS * t - 0.5 * JUMP_ARC.gravityPxPerS2 * t * t

    expect(JUMP_ARC.apexMs).toBe(TUNING.jump.airborneMs / 2)
    expect(height).toBeCloseTo(TUNING.jump.apexHeightPx, 9)
  })

  it('returns to the ground exactly at the approved airborne duration', () => {
    const t = TUNING.jump.airborneMs / 1000
    const height = JUMP_ARC.initialVelocityPxPerS * t - 0.5 * JUMP_ARC.gravityPxPerS2 * t * t

    expect(height).toBeCloseTo(0, 9)
  })

  it('tracks the airborne target if it is retuned', () => {
    // The point of deriving: gravity cannot be edited into disagreeing with the
    // duration, because nobody can edit gravity.
    const apexSeconds = TUNING.jump.airborneMs / 2000
    const expectedGravity = (2 * TUNING.jump.apexHeightPx) / (apexSeconds * apexSeconds)

    expect(JUMP_ARC.gravityPxPerS2).toBeCloseTo(expectedGravity, 9)
    expect(JUMP_ARC.initialVelocityPxPerS).toBeCloseTo(expectedGravity * apexSeconds, 9)
  })

  it('keeps the approved 650 ms as the stored value', () => {
    expect(TUNING.jump.airborneMs).toBe(650)
  })
})

describe('the fixed step', () => {
  it('is derived from the rate', () => {
    expect(STEP_MS).toBeCloseTo(1000 / TUNING.sim.fixedStepHz, 12)
  })

  it('is finer than one frame at 60 fps', () => {
    // Two steps per frame at 60 fps is the point of 120 Hz: input resolves at a
    // finer grain than the display, so a lane change does not depend on which
    // frame the key landed in.
    expect(STEP_MS).toBeLessThan(1000 / 60)
  })
})

describe('no gameplay literal outside the tuning module', () => {
  /**
 * Every rules file, discovered rather than listed.
 *
 * The list used to be hand-maintained, which meant each new rules module was
 * unscanned by default and nobody found out. `tuning.ts` and `patterns.ts` are
 * excluded because they *are* the data — their numbers are the content, not
 * constants hiding inside logic.
 */
const RULE_FILES = readdirSync(new URL('.', import.meta.url))
  .filter(name => name.endsWith('.ts'))
  .filter(name => !name.endsWith('.spec.ts'))
  // `rng.ts` is an algorithm, not a set of tunables: its constants are the
  // xorshift shift schedule and the splitmix words, and they are pinned far
  // more tightly than a registry row could — by a golden vector.
  .filter(name => !['tuning.ts', 'patterns.ts', 'index.ts', 'rng.ts'].includes(name))
  .map(name => `./${name}`)
  .sort()

  it.each(RULE_FILES)('%s reads its numbers from TUNING', (file) => {
    const source = read(file)
      // Comments explain the numbers; they do not encode them.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      // A type-level union names things; it does not hide a tunable in the
      // rules. `type Tier = 1 | 2 | 3 | 4 | 5` is the tier labels, not a
      // gameplay constant, and there is nowhere else for it to live.
      .replace(/^\s*export type [A-Za-z]+ =[^\n]*$/gm, '')

    /*
     * What remains may contain 0, 1, 2, 0.5 and 1000: array and index
     * arithmetic, the ±1 lane direction, the halving in the parabola, and
     * milliseconds to seconds. Anything else is a gameplay value that escaped
     * the registry.
     *
     * The pattern matches every numeric literal JavaScript has, not just the
     * plain decimal ones. The previous `(?<![\w.])\d+(\.\d+)?` was evaded by
     * four spellings a person writes without thinking: `.75` (the lookbehind
     * rejected it on its own decimal point), `1_000`, `1e3` and `0x1F4` (each
     * matched only its allowlisted first digit, the rest hidden behind a word
     * character). All four would have sat in the rules unreported.
     */
    const ALLOWED = [0, 1, 2, 0.5, 1000]

    const literals = (source.match(
      /(?<![\w$.])(?:0[xXbBoO][0-9a-fA-F_]+n?|(?:\d[\d_]*)?\.\d[\d_]*(?:[eE][+-]?\d+)?|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?n?)/g,
    ) ?? []).filter((literal) => {
      // Compared as a value, not as text: `1_000`, `1e3` and `0x3E8` are all
      // the millisecond conversion and all fine, while `0x1F4` is 500 and is
      // not. Matching the spelling would flag the first three and, worse, would
      // still have to be extended by hand for the fourth.
      const value = Number(literal.replace(/_/g, '').replace(/n$/, ''))

      return !ALLOWED.includes(value)
    })

    expect(literals).toEqual([])
  })

  it('keeps the derived arc in the tuning module, not in the rules', () => {
    expect(read('./jump.ts')).toContain('JUMP_ARC')
    expect(read('./jump.ts')).not.toMatch(/gravityPxPerS2\s*=/)
  })

  it('scans files that actually exist', () => {
    // A path typo would make the scan above pass by scanning nothing.
    for (const file of RULE_FILES) {
      expect(() => read(file)).not.toThrow()
    }

    expect(HERE).toContain('game/domain')
  })
})
