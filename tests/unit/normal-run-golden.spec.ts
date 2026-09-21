import { describe, expect, it } from 'vitest'
import { GOLDEN_CASES, caseKey, digestCase } from '~~/tests/support/normal-run-digest'
import golden from '~~/tests/support/normal-run-golden.json'

/**
 * A normal run is exactly the run it was before the tutorial existed.
 *
 * The fixture was generated on the tree immediately before M8 and is never
 * regenerated to make this pass. Each hash covers every observable field of
 * every step of a two-minute run — including all three RNG streams, so a
 * module that draws one extra value fails here even though no rule changed.
 *
 * This is the evidence behind "normal gameplay semantics were not changed". It
 * is deliberately not a statement in a report.
 *
 * **If this fails:** a normal run changed. Either that is a defect in the
 * tutorial mode's guards, or it is a deliberate gameplay change — and a
 * deliberate change rewrites the fixture in its own commit, with the reason
 * recorded, never as a side effect of something else.
 */
describe('the normal run is unchanged by the tutorial mode', () => {
  it.each(GOLDEN_CASES)('seed $seed, played $style', { timeout: 60_000 }, (testCase) => {
    expect(digestCase(testCase)).toBe((golden as Record<string, string>)[caseKey(testCase)])
  })

  it('covers every case in the fixture, and no more', () => {
    // A fixture key nobody runs would let a case rot unnoticed, and a case with
    // no key would pass against `undefined` if the assertion above were ever
    // loosened.
    expect(Object.keys(golden as Record<string, string>).sort())
      .toEqual(GOLDEN_CASES.map(caseKey).sort())
  })
})
