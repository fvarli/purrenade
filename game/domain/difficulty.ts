import { TUNING } from './tuning'

/**
 * The difficulty curve, driven by elapsed run time.
 *
 * Time, not distance: distance is itself a function of speed, so a
 * distance-driven curve compounds with the speed dimension and produces a
 * runaway ramp. Time is also what the player perceives and what a server can
 * sanity-check a submitted score against.
 *
 * Two shapes live here and they do different jobs. The **continuous curves**
 * drive feel — how fast the road moves, how full it is, how often a decision
 * arrives — and each approaches its own ceiling asymptotically rather than
 * being clamped, so there is a fast early ramp the player notices and a late
 * plateau where survival is execution rather than the game outrunning human
 * reaction time. The **discrete tier** gates which pattern pools are eligible,
 * so pattern complexity stays reviewable and testable.
 */

/** One-indexed, matching how the tiers are spoken about. Tier 5 is terminal. */
export type Tier = 1 | 2 | 3 | 4 | 5

/**
 * The soft-cap curve: `value(t) = ceiling - (ceiling - base) × exp(-t / k)`.
 *
 * Asymptotic rather than clamped, so no dimension ever crosses its ceiling and
 * none of them has a discontinuity a player could feel as a lurch.
 */
export function softCap(base: number, ceiling: number, timeConstantS: number, elapsedMs: number): number {
  const seconds = elapsedMs / MS_PER_SECOND

  return ceiling - (ceiling - base) * Math.exp(-seconds / timeConstantS)
}

const MS_PER_SECOND = 1000

/** The scroll speed multiplier at this point in the run. */
export function speedMultiplier(elapsedMs: number): number {
  const { base, ceiling, timeConstantS } = TUNING.difficulty.speed

  return softCap(base, ceiling, timeConstantS, elapsedMs)
}

/** Road units per second, at this point in the run. */
export function scrollUnitsPerS(elapsedMs: number): number {
  return TUNING.world.baseScrollUnitsPerS * speedMultiplier(elapsedMs)
}

/**
 * The fraction of road length the generator is aiming to occupy.
 *
 * **Not consumed by the generator.** Spacing comes from `minGapUnits`, a
 * per-tier constant, so density scales in five steps rather than along this
 * curve. The function is kept because the curve is a documented product
 * dimension and the value is meaningful; connecting it would change difficulty
 * feel, which is a product decision and not one to slip in as a refactor.
 * `docs/product/difficulty-and-obstacles.md` §2.2 records the same thing.
 */
export function densityTarget(elapsedMs: number): number {
  const { base, ceiling } = TUNING.difficulty.density

  return softCap(base, ceiling, TUNING.difficulty.speed.timeConstantS, elapsedMs)
}

/** How many decisions per minute the generator is aiming to demand. Not
 * consumed by the generator either — see `densityTarget` above. */
export function decisionsPerMinute(elapsedMs: number): number {
  const { base, ceiling } = TUNING.difficulty.decisionsPerMin

  return softCap(base, ceiling, TUNING.difficulty.speed.timeConstantS, elapsedMs)
}

/**
 * The tier at this point in the run.
 *
 * Boundaries are inclusive of their start: a run at exactly the Tier 2 start is
 * in Tier 2. One policy, applied the same way at every boundary, so crossing is
 * deterministic and testable at the exact millisecond.
 */
export function tierAt(elapsedMs: number): Tier {
  const starts = TUNING.difficulty.tierStartsS

  let tier = 1

  for (let index = 1; index < starts.length; index++) {
    if (elapsedMs >= starts[index]! * MS_PER_SECOND) tier = index + 1
  }

  return tier as Tier
}

/** The gap floor before the next pattern, in road units, for a tier. */
export function minGapUnits(tier: Tier): number {
  return TUNING.generator.minGapUnits[tier - 1] ?? TUNING.generator.minGapUnits[0]!
}
