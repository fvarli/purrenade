import { readFileSync } from 'node:fs'
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
  if (typeof value !== 'object' || value === null) return [prefix]

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
  const found = new Map<string, string>()
  const pattern = /@status (APPROVED|PROPOSED)[^\n]*\n\s*(?:\*\/\s*\n\s*)?([A-Za-z][A-Za-z0-9]*)\s*:/g

  for (const match of source.matchAll(pattern)) {
    found.set(match[2]!, match[1]!)
  }

  return found
}

/** Every registry row, as leaf → { value, status }. */
function registryRows(markdown: string): Map<string, { value: string, status: string }> {
  const rows = new Map<string, { value: string, status: string }>()
  const pattern = /^\|\s*`([A-Za-z0-9.]+)`\s*\|\s*([^|]+?)\s*\|\s*\*{0,2}(APPROVED|PROPOSED|OPEN)\*{0,2}\s*\|/gm

  for (const match of markdown.matchAll(pattern)) {
    // Keyed by the full dotted path. Keyed by the leaf, a newly added
    // `evil.count` was "documented" by the existing `lane.count` row.
    rows.set(match[1]!, { value: match[2]!, status: match[3]! })
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

      // The registry writes some values with a unit or a gloss —
      // "1 (CENTER)", "0.72 of the column". The number must lead.
      return documented.value.replace(/[`*]/g, '').trim().startsWith(actual)
        ? []
        : [`${path}: code ${actual}, registry "${documented.value}"`]
    })

    expect(disagreements).toEqual([])
  })

  it('agrees with the registry about every status', () => {
    // `open-decisions.md` §0AC claims this test exists. It did not.
    const declared = declaredStatuses(source)

    const disagreements = leafPaths(TUNING).flatMap((path) => {
      const leaf = path.split('.').pop() ?? path
      const inCode = declared.get(leaf)
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
  const RULE_FILES = ['./step.ts', './lanes.ts', './jump.ts', './input.ts', './state.ts']

  it.each(RULE_FILES)('%s reads its numbers from TUNING', (file) => {
    const source = read(file)
      // Comments explain the numbers; they do not encode them.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')

    // What remains may contain 0, 1, 2 and 1000: array and index arithmetic,
    // the ±1 lane direction, the halving in the parabola, and milliseconds to
    // seconds. Anything else is a gameplay value that escaped the registry.
    const literals = (source.match(/(?<![\w.])\d+(\.\d+)?/g) ?? [])
      .filter(literal => !['0', '1', '2', '0.5', '1000'].includes(literal))

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
