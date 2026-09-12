import { describe, expect, it } from 'vitest'

// A harness check, not a product test.
//
// It exists so the bootstrap milestone ends with a *verified* test toolchain
// rather than an unproven one, and so M5 adds game-rule tests to a runner that
// is already known to work. It deliberately asserts nothing about gameplay:
// inventing product assertions before the rules exist would be noise, and the
// approved invariants are tested where they are implemented.
describe('test toolchain', () => {
  it('runs TypeScript under Vitest', () => {
    const answer: number = 1 + 1
    expect(answer).toBe(2)
  })

  it('targets a Node environment, so pure domain tests need no browser', () => {
    expect(typeof process).toBe('object')
    expect(typeof globalThis.window).toBe('undefined')
  })
})
