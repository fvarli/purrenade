import { TUNING } from './tuning'
import type { LaneIndex, ObstacleKind } from './types'
import type { Tier } from './difficulty'

/**
 * The authored pattern catalogue.
 *
 * Patterns are **data**, reviewed like data. The generator never composes
 * obstacles freehand, because freehand composition cannot be proven safe — and
 * the escape-path guarantee is a hard invariant, not a hope about randomness.
 * Every pattern here is verified survivable from every starting lane, at every
 * tier it is eligible for, by `escape.ts` running the real rules.
 *
 * This file is a catalogue in the same sense `tuning.ts` is a registry: its
 * numbers are the content, not magic constants hiding in logic. `offsetUnits`
 * is measured from the pattern's own origin, so a pattern can be placed
 * anywhere on the road without rewriting its entries.
 *
 * Deliberately small. Quality over count: every entry costs a validation pass
 * per tier and per starting lane, and a pattern that is merely different is not
 * worth a weaker guarantee.
 */

export interface PatternEntry {
  readonly offsetUnits: number
  readonly kind: ObstacleKind
  readonly lane: LaneIndex
}

export interface Pattern {
  readonly id: string
  readonly minTier: Tier
  /** Relative selection weight within its pool. Integer, so selection is exact. */
  readonly weight: number
  readonly lengthUnits: number
  readonly entries: readonly PatternEntry[]
  /** Descriptive only. Never read by a rule. */
  readonly tags: readonly string[]
}

const LEFT: LaneIndex = 0
const CENTRE: LaneIndex = 1
const RIGHT: LaneIndex = 2

export const PATTERNS: readonly Pattern[] = Object.freeze([
  // --- Tier 1: one obstacle, one decision, generous room ---------------------
  Object.freeze({
    id: 'single-cone-left',
    minTier: 1,
    weight: 10,
    lengthUnits: 1,
    entries: Object.freeze([Object.freeze({ offsetUnits: 0, kind: 'lane_blocking' as const, lane: LEFT })]),
    tags: Object.freeze(['single']),
  }),
  Object.freeze({
    id: 'single-cone-centre',
    minTier: 1,
    weight: 10,
    lengthUnits: 1,
    entries: Object.freeze([Object.freeze({ offsetUnits: 0, kind: 'lane_blocking' as const, lane: CENTRE })]),
    tags: Object.freeze(['single']),
  }),
  Object.freeze({
    id: 'single-cone-right',
    minTier: 1,
    weight: 10,
    lengthUnits: 1,
    entries: Object.freeze([Object.freeze({ offsetUnits: 0, kind: 'lane_blocking' as const, lane: RIGHT })]),
    tags: Object.freeze(['single']),
  }),
  Object.freeze({
    id: 'single-barrier-centre',
    minTier: 1,
    weight: 8,
    lengthUnits: 1,
    entries: Object.freeze([Object.freeze({ offsetUnits: 0, kind: 'jumpable' as const, lane: CENTRE })]),
    tags: Object.freeze(['single', 'forces-jump-or-dodge']),
  }),

  // --- Tier 2: two lanes blocked, exactly one lane open ----------------------
  Object.freeze({
    id: 'pair-left-centre',
    minTier: 2,
    weight: 8,
    lengthUnits: 1,
    entries: Object.freeze([
      Object.freeze({ offsetUnits: 0, kind: 'lane_blocking' as const, lane: LEFT }),
      Object.freeze({ offsetUnits: 0, kind: 'lane_blocking' as const, lane: CENTRE }),
    ]),
    tags: Object.freeze(['two-lane', 'one-escape']),
  }),
  Object.freeze({
    id: 'pair-centre-right',
    minTier: 2,
    weight: 8,
    lengthUnits: 1,
    entries: Object.freeze([
      Object.freeze({ offsetUnits: 0, kind: 'lane_blocking' as const, lane: CENTRE }),
      Object.freeze({ offsetUnits: 0, kind: 'lane_blocking' as const, lane: RIGHT }),
    ]),
    tags: Object.freeze(['two-lane', 'one-escape']),
  }),

  // --- Tier 3: a sequence that needs a planned lane path ---------------------
  Object.freeze({
    id: 'stagger-left-then-right',
    minTier: 3,
    weight: 7,
    lengthUnits: 5,
    entries: Object.freeze([
      Object.freeze({ offsetUnits: 0, kind: 'lane_blocking' as const, lane: LEFT }),
      Object.freeze({ offsetUnits: 4, kind: 'lane_blocking' as const, lane: RIGHT }),
    ]),
    tags: Object.freeze(['sequence', 'double-decision']),
  }),
  Object.freeze({
    id: 'barrier-then-cone',
    minTier: 3,
    weight: 7,
    lengthUnits: 6,
    entries: Object.freeze([
      Object.freeze({ offsetUnits: 0, kind: 'jumpable' as const, lane: CENTRE }),
      Object.freeze({ offsetUnits: 5, kind: 'lane_blocking' as const, lane: CENTRE }),
    ]),
    tags: Object.freeze(['sequence', 'both-verbs']),
  }),

  // --- Tier 4: both verbs in one pattern, tighter --------------------------
  Object.freeze({
    id: 'barrier-wall-with-open-lane',
    minTier: 4,
    weight: 6,
    lengthUnits: 1,
    entries: Object.freeze([
      Object.freeze({ offsetUnits: 0, kind: 'jumpable' as const, lane: LEFT }),
      Object.freeze({ offsetUnits: 0, kind: 'jumpable' as const, lane: CENTRE }),
      Object.freeze({ offsetUnits: 0, kind: 'jumpable' as const, lane: RIGHT }),
    ]),
    tags: Object.freeze(['forces-jump', 'all-lanes']),
  }),
  Object.freeze({
    /*
     * Both verbs, genuinely.
     *
     * A blocker pushes the player out of the centre, and a barrier then covers
     * both lanes they can be in — so the pattern costs one lane change and one
     * jump, which is exactly the budget.
     *
     * The first draft was a two-lane pair followed by a barrier, and the solver
     * refused it from the far lane: escaping a pair already costs both actions,
     * leaving nothing to jump with. That is a real constraint of a two-action
     * budget, not a bug — a pair and a mandatory jump cannot share a pattern.
     */
    id: 'cone-then-barrier-wall',
    minTier: 4,
    weight: 6,
    lengthUnits: 6,
    entries: Object.freeze([
      Object.freeze({ offsetUnits: 0, kind: 'lane_blocking' as const, lane: CENTRE }),
      Object.freeze({ offsetUnits: 5, kind: 'jumpable' as const, lane: LEFT }),
      Object.freeze({ offsetUnits: 5, kind: 'jumpable' as const, lane: RIGHT }),
    ]),
    tags: Object.freeze(['sequence', 'both-verbs', 'double-decision']),
  }),

  // --- Tier 5: the full pool, at the ceilings -------------------------------
  Object.freeze({
    id: 'stagger-three-step',
    minTier: 5,
    weight: 5,
    lengthUnits: 9,
    entries: Object.freeze([
      Object.freeze({ offsetUnits: 0, kind: 'lane_blocking' as const, lane: CENTRE }),
      Object.freeze({ offsetUnits: 4, kind: 'lane_blocking' as const, lane: LEFT }),
      Object.freeze({ offsetUnits: 8, kind: 'jumpable' as const, lane: RIGHT }),
    ]),
    tags: Object.freeze(['sequence', 'both-verbs', 'peak']),
  }),
])

/** Every pattern a tier may draw. A tier inherits everything below it. */
export function poolForTier(tier: Tier): readonly Pattern[] {
  return PATTERNS.filter(pattern => pattern.minTier <= tier)
}

/**
 * Check the catalogue is well formed.
 *
 * Developer error, not player error, so it fails loudly and once rather than
 * degrading into an unfair game. A negative weight silently removes a pattern
 * from selection; a lane outside the road silently makes an obstacle
 * unreachable; a duplicate id makes the cooldown exclude the wrong entry. None
 * of those look like bugs from the outside — they look like the generator
 * being mysteriously boring, or mysteriously cruel.
 *
 * Called by a test rather than on every step: the catalogue is a constant, and
 * validating a constant at 120 Hz is a cost with no reader.
 */
export function validatePatterns(patterns: readonly Pattern[] = PATTERNS): readonly string[] {
  const problems: string[] = []
  const ids = new Set<string>()

  for (const pattern of patterns) {
    if (ids.has(pattern.id)) problems.push(`duplicate pattern id: ${pattern.id}`)

    ids.add(pattern.id)

    if (!Number.isInteger(pattern.weight) || pattern.weight <= 0) {
      problems.push(`${pattern.id}: weight must be a positive integer, got ${pattern.weight}`)
    }

    if (!Number.isFinite(pattern.lengthUnits) || pattern.lengthUnits <= 0) {
      problems.push(`${pattern.id}: lengthUnits must be positive and finite`)
    }

    if (pattern.minTier < 1 || pattern.minTier > TIER_COUNT) {
      problems.push(`${pattern.id}: minTier ${pattern.minTier} is outside the tiers`)
    }

    if (pattern.entries.length === 0) problems.push(`${pattern.id}: no entries`)

    for (const entry of pattern.entries) {
      if (!Number.isFinite(entry.offsetUnits) || entry.offsetUnits < 0) {
        problems.push(`${pattern.id}: offsetUnits must be finite and non-negative`)
      }

      // The obstacle's own footprint counts. An entry flush with the declared
      // length still occupies a unit beyond it, quietly eating the gap the next
      // pattern was promised — and the gap floor is what the escape-path
      // argument leans on.
      if (entry.offsetUnits + TUNING.obstacle.defaultLengthUnits > pattern.lengthUnits) {
        problems.push(`${pattern.id}: an entry at ${entry.offsetUnits} lies beyond lengthUnits ${pattern.lengthUnits}`)
      }

      if (!Number.isInteger(entry.lane) || entry.lane < 0 || entry.lane > LANE_MAX) {
        problems.push(`${pattern.id}: lane ${entry.lane} is not a lane`)
      }
    }

    /*
     * Every lane occupied at one offset is a wall.
     *
     * Counted across *both* classes, not just lane blockers. A mixed wall — two
     * cones and a barrier — is survivable only by being in the third lane and
     * airborne at the same time, which is strictly harsher than the plain wall
     * this check was written to catch, and the class filter let it straight
     * through. An all-jumpable row is legal and deliberate: a jump clears it.
     */
    const byOffset = new Map<number, Set<number>>()

    for (const entry of pattern.entries) {
      const lanes = byOffset.get(entry.offsetUnits) ?? new Set<number>()

      lanes.add(entry.lane)
      byOffset.set(entry.offsetUnits, lanes)
    }

    for (const [offset, lanes] of byOffset) {
      if (lanes.size < LANE_COUNT) continue

      const atOffset = pattern.entries.filter(entry => entry.offsetUnits === offset)
      const allJumpable = atOffset.every(entry => entry.kind === 'jumpable')

      if (!allJumpable) {
        problems.push(`${pattern.id}: every lane is blocked at offset ${offset}`)
      }
    }
  }

  return problems
}

/* Derived, not restated: a lane count change must reach the wall check. */
const TIER_COUNT = TUNING.difficulty.tierStartsS.length
const LANE_COUNT = TUNING.lane.count
const LANE_MAX = TUNING.lane.count - 1
