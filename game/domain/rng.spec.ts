import { describe, expect, it } from 'vitest'
import { createRngState, createStream, nextFloat, nextIntInclusive, nextUint32 } from './rng'
import { createRunState } from './state'

/**
 * The generator, tested for the properties the product actually depends on.
 *
 * Not statistical quality for its own sake — this picks lanes and decorations,
 * not lottery numbers. What matters is that a seed reproduces a run exactly,
 * that the three streams are independent, and that the state is carried rather
 * than hidden in the module.
 */

describe('createStream', () => {
  it('is a pure function of the seed', () => {
    expect(createStream(12345)).toEqual(createStream(12345))
  })

  it('gives unrelated streams to adjacent seeds', () => {
    // splitmix32's job. Without it, seeds 1 and 2 would produce sequences that
    // visibly track each other.
    const a = createStream(1)
    const b = createStream(2)

    expect(a).not.toEqual(b)
    expect(nextUint32(a).value).not.toBe(nextUint32(b).value)
  })

  it('never produces the all-zero state xorshift cannot escape', () => {
    // Vanishingly unlikely is not impossible, and the failure mode is a stream
    // that emits zero forever.
    for (const seed of [0, 1, -1, 0xFFFFFFFF, 2 ** 31]) {
      const s = createStream(seed)

      expect(s.a | s.b | s.c | s.d).not.toBe(0)
    }
  })
})

describe('nextUint32', () => {
  it('returns the next state rather than mutating the one given', () => {
    const state = createStream(99)
    const snapshot = { ...state }

    const draw = nextUint32(state)

    expect(state).toEqual(snapshot)
    expect(draw.state).not.toEqual(state)
  })

  it('replays identically from the same state', () => {
    const start = createStream(2026)

    const run = (): number[] => {
      let state = start
      const values: number[] = []

      for (let i = 0; i < 500; i++) {
        const draw = nextUint32(state)
        values.push(draw.value)
        state = draw.state
      }

      return values
    }

    expect(run()).toEqual(run())
  })

  it('stays within 32 unsigned bits', () => {
    let state = createStream(7)

    for (let i = 0; i < 2000; i++) {
      const draw = nextUint32(state)

      expect(Number.isInteger(draw.value)).toBe(true)
      expect(draw.value).toBeGreaterThanOrEqual(0)
      expect(draw.value).toBeLessThanOrEqual(0xFFFFFFFF)

      state = draw.state
    }
  })

  it('does not fall into a short cycle', () => {
    let state = createStream(4)
    const seen = new Set<number>()

    for (let i = 0; i < 5000; i++) {
      const draw = nextUint32(state)
      seen.add(draw.value)
      state = draw.state
    }

    // A degenerate generator would collapse to a handful of values.
    expect(seen.size).toBeGreaterThan(4900)
  })
})

describe('nextFloat', () => {
  it('stays in [0, 1)', () => {
    let state = createStream(11)

    for (let i = 0; i < 5000; i++) {
      const draw = nextFloat(state)

      expect(draw.value).toBeGreaterThanOrEqual(0)
      expect(draw.value).toBeLessThan(1)

      state = draw.state
    }
  })

  it('spreads across the range', () => {
    let state = createStream(13)
    const buckets = new Array<number>(10).fill(0)

    for (let i = 0; i < 10_000; i++) {
      const draw = nextFloat(state)
      buckets[Math.floor(draw.value * 10)]!++
      state = draw.state
    }

    // Not a distribution proof — just enough to catch a generator stuck in one
    // corner of the range, which is the failure that would actually happen.
    for (const count of buckets) {
      expect(count).toBeGreaterThan(700)
    }
  })
})

describe('nextIntInclusive', () => {
  it('includes both ends', () => {
    let state = createStream(5)
    const seen = new Set<number>()

    for (let i = 0; i < 500; i++) {
      const draw = nextIntInclusive(state, 0, 2)
      seen.add(draw.value)
      state = draw.state
    }

    expect([...seen].sort()).toEqual([0, 1, 2])
  })

  it('handles a single-value range', () => {
    expect(nextIntInclusive(createStream(1), 4, 4).value).toBe(4)
  })

  it('refuses an inverted range rather than returning nonsense', () => {
    expect(() => nextIntInclusive(createStream(1), 5, 2)).toThrow(RangeError)
  })
})

describe('createRngState', () => {
  it('derives three streams that are independent of each other', () => {
    // The reason they are separate: if a decorative draw shared a stream with
    // pattern selection, changing a decoration would shift every subsequent
    // gameplay draw and break every recorded replay.
    const { pattern, collectible, cosmetic } = createRngState(2026)

    expect(pattern).not.toEqual(collectible)
    expect(collectible).not.toEqual(cosmetic)
    expect(pattern).not.toEqual(cosmetic)
  })

  it('is reproducible from the run seed', () => {
    expect(createRngState(777)).toEqual(createRngState(777))
  })

  it('leaves the other streams untouched when one advances', () => {
    const state = createRngState(31)
    const advanced = { ...state, cosmetic: nextUint32(state.cosmetic).state }

    expect(advanced.pattern).toEqual(state.pattern)
    expect(advanced.collectible).toEqual(state.collectible)
  })
})

describe('the generator is pinned, not merely self-consistent', () => {
  /*
   * A golden vector, because every other determinism test in this suite runs
   * the same code twice in the same process and compares the results.
   *
   * That catches ambient nondeterminism — a stray `Math.random()` or clock read
   * — which ESLint already forbids. It cannot catch the thing that actually
   * breaks a recorded replay: swapping the algorithm, changing a splitmix
   * constant, or altering the three stream offsets. Every one of those keeps
   * `run() === run()` perfectly true while silently invalidating every run ever
   * recorded, which is precisely what server-side revalidation under ADR-0006
   * would depend on.
   *
   * If this fails, the generator changed. That is not necessarily wrong — but
   * it is never accidental, and every stored seed now means something else.
   */
  it('produces the recorded sequence for a known seed', () => {
    let stream = createRngState(2026).pattern

    const drawn: number[] = []

    for (let i = 0; i < 8; i++) {
      const draw = nextUint32(stream)

      drawn.push(draw.value)
      stream = draw.state
    }

    expect(drawn).toEqual([
      4179496168, 103557520, 3046311259, 1668154586,
      1780366611, 219806057, 546151500, 869663827,
    ])
  })

  it('keeps the collectible stream on its own recorded sequence', () => {
    // Pinned separately: a change to the stream offsets would otherwise be
    // invisible as long as all three moved together.
    let stream = createRngState(2026).collectible

    const drawn: number[] = []

    for (let i = 0; i < 4; i++) {
      const draw = nextUint32(stream)

      drawn.push(draw.value)
      stream = draw.state
    }

    expect(drawn).toEqual([959012032, 1603355678, 1677191665, 3078830729])
  })

  it('refuses a seed that cannot round-trip', () => {
    // `>>> 0` mapped NaN, Infinity, 0.5 and 2**32 all onto zero, so five
    // different "seeds" produced one identical run and nobody found out.
    for (const seed of [Number.NaN, Number.POSITIVE_INFINITY, 0.5, -1, 2 ** 32]) {
      expect(() => createRunState({ seed }), `seed ${seed}`).toThrow(RangeError)
    }

    expect(() => createRunState({ seed: 0 })).not.toThrow()
    expect(() => createRunState({ seed: 0xFFFFFFFF })).not.toThrow()
  })

  it('refuses bounds it cannot honour', () => {
    const stream = createRngState(1).pattern

    // `max < min` is the one comparison NaN slips through, so it was the only
    // guard and it could not see the worst input.
    expect(() => nextIntInclusive(stream, Number.NaN, Number.NaN)).toThrow(RangeError)
    expect(() => nextIntInclusive(stream, 0.5, 2.5)).toThrow(RangeError)
    expect(() => nextIntInclusive(stream, 0, Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })
})
