/**
 * The seeded generator the run carries with it.
 *
 * `Math.random()` is banned in this directory and ESLint enforces it. The
 * reason is not stylistic: three approved requirements rest on a run being
 * reproducible from a seed — the deterministic jump arc, the escape-path
 * guarantee that M6 proves by property tests and long-run fuzzing, and whatever
 * validation model ADR-0006 eventually selects. A flaky generator produces a
 * flaky guarantee.
 *
 * ### Explicit state, not a module singleton
 *
 * Every function here is pure: it takes a state and returns a value *and* the
 * next state. The state lives inside `RunState`, so two runs simulated in the
 * same process cannot interfere, and a run can be rewound, forked or replayed
 * by keeping an old state object.
 *
 * ### Three streams, not one
 *
 * `pattern`, `collectible` and `cosmetic` advance independently. If a
 * decorative detail drew from the same stream as pattern selection, changing
 * that detail would shift every subsequent gameplay draw and break every
 * recorded replay. Separating them makes presentation changes free.
 *
 * Nothing consumes the streams yet — spawning arrives with M6. They exist now
 * because the seed has to be part of `RunState` from the first version for any
 * of the above to be provable, and retrofitting a seed into a state machine
 * that already has recorded runs is the expensive way to do it.
 *
 * ### Algorithm
 *
 * xorshift128 over four 32-bit words, seeded through splitmix32. Chosen for
 * being small, fast, well-distributed and — the property that matters here —
 * exactly reproducible with integer operations that behave identically on every
 * JavaScript engine. It is not cryptographic and is not used for anything that
 * needs to be.
 */

/** One independent stream. Four 32-bit words, held as unsigned integers. */
export interface RngStream {
  readonly a: number
  readonly b: number
  readonly c: number
  readonly d: number
}

/** The generator state a run carries. One stream per concern. */
export interface RngState {
  readonly pattern: RngStream
  readonly collectible: RngStream
  readonly cosmetic: RngStream
}

/** A draw: the value, and the state that must replace the one you drew from. */
export interface RngDraw<T> {
  readonly value: T
  readonly state: RngStream
}

/**
 * splitmix32 — turns one seed into a well-distributed sequence.
 *
 * Used only to expand a seed into stream words. Adjacent seeds produce
 * unrelated streams, which matters because the three streams are derived from
 * the same run seed by mixing it with a distinct constant.
 */
function splitmix32(seed: number): () => number {
  let state = seed >>> 0

  return (): number => {
    state = (state + 0x9E3779B9) >>> 0

    let z = state
    z = Math.imul(z ^ (z >>> 16), 0x21F0AAAD) >>> 0
    z = Math.imul(z ^ (z >>> 15), 0x735A2D97) >>> 0

    return (z ^ (z >>> 15)) >>> 0
  }
}

/**
 * Build one stream from a seed.
 *
 * The all-zero state is the one xorshift cannot escape — it would emit zero
 * forever — so it is replaced. splitmix32 makes it vanishingly unlikely, and
 * "vanishingly unlikely" is not the same as impossible.
 */
export function createStream(seed: number): RngStream {
  const next = splitmix32(seed)

  const a = next()
  const b = next()
  const c = next()
  const d = next()

  if ((a | b | c | d) === 0) {
    return { a: 0x9E3779B9, b: 0x243F6A88, c: 0xB7E15162, d: 0x85EBCA6B }
  }

  return { a, b, c, d }
}

/**
 * Derive the three streams from one run seed.
 *
 * The offsets are arbitrary but fixed: what matters is that the same run seed
 * always produces the same three streams, and that they are unrelated to each
 * other.
 */
export function createRngState(seed: number): RngState {
  return {
    pattern: createStream((seed ^ 0x1F123BB5) >>> 0),
    collectible: createStream((seed ^ 0x27D4EB2F) >>> 0),
    cosmetic: createStream((seed ^ 0x165667B1) >>> 0),
  }
}

/** Advance a stream, returning a 32-bit unsigned value and the next state. */
export function nextUint32(stream: RngStream): RngDraw<number> {
  let t = stream.d
  const s = stream.a

  t ^= (t << 11) >>> 0
  t >>>= 0
  t ^= t >>> 8
  t ^= s ^ (s >>> 19)
  t >>>= 0

  return {
    value: t,
    state: { a: t, b: stream.a, c: stream.b, d: stream.c },
  }
}

/** A float in `[0, 1)`. */
export function nextFloat(stream: RngStream): RngDraw<number> {
  const { value, state } = nextUint32(stream)

  // 2^32. Dividing by it keeps the result strictly below 1.
  return { value: value / 4294967296, state }
}

/**
 * An integer in `[min, max]`, inclusive at both ends.
 *
 * Rejection-free and therefore very slightly biased for ranges that do not
 * divide 2^32. The bias is at the 2^-32 level and this generator picks lanes
 * and decorations, not lottery numbers.
 */
export function nextIntInclusive(stream: RngStream, min: number, max: number): RngDraw<number> {
  /*
   * Both bounds, not just their order.
   *
   * `max < min` is the one comparison `NaN` slips through, so the only guard
   * here was the guard that could not see the worst input: `nextIntInclusive(s,
   * NaN, NaN)` returned `NaN`, and non-integer bounds returned a non-integer
   * from a function whose contract is "an integer in [min, max]". At M6 that is
   * a `NaN` lane index or a fractional spawn offset landing straight in state.
   */
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) {
    throw new RangeError(
      `nextIntInclusive: bounds must be safe integers (got min ${String(min)}, max ${String(max)})`,
    )
  }

  if (max < min) {
    throw new RangeError(`nextIntInclusive: max (${max}) is below min (${min})`)
  }

  const { value, state } = nextFloat(stream)

  return { value: min + Math.floor(value * (max - min + 1)), state }
}
