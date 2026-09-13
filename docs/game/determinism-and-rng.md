# Determinism and RNG

Why the game is reproducible, and how that is achieved.

**Status legend:** APPROVED / PROPOSED / OPEN.

---

## 1. Why determinism is required — APPROVED

Not a preference. Three approved requirements depend on it:

1. **Jump is specified as deterministic and tunable.** The same input from the
   same state must always produce the same arc.
2. **The escape-path guarantee is proven by tests.** Property tests and long-run
   fuzzing over simulated minutes are only meaningful if a seed reproduces a run
   exactly. A flaky generator produces a flaky guarantee.
3. **Run validation.** Whatever model
   [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md)
   selects, every option except pure statistical bounding needs the server to be
   able to reproduce or verify what the client claims happened.

---

## 2. Rules — APPROVED

The game domain is a pure function of its inputs. Concretely, inside
`game/domain/`:

| Forbidden | Required instead |
| --- | --- |
| `Math.random()` | A seeded generator carried inside `RunState` |
| `Date.now()`, `performance.now()` | Time enters only as an explicit `deltaMs` |
| Variable-delta physics | **Fixed-step** simulation with an accumulator |
| Iterating an unordered collection where order affects outcome | Deterministic, stable ordering |
| Floating-point accumulation of authoritative counters | Integer accumulators for score and paws. **Scope, as of M5:** this rule governs *counters* — score, paws, hearts — none of which exist yet. The run clock (`elapsedMs`) and the three duration accumulators are floats, deliberately: they are driven by a constant `STEP_MS`, IEEE-754 addition is deterministic, and a 100 000-step run reproduces bit-for-bit. When score becomes a function of elapsed time at M7, the counter it feeds must still be an integer. |
| Reading anything ambient (DOM, network, storage, locale) | Pass it in |

---

## 3. Seeded RNG — PROPOSED

| Aspect | Approach |
| --- | --- |
| Algorithm | A small, fast, well-distributed PRNG with explicit state (e.g. a 128-bit xorshift family). **Not** the platform RNG. |
| State location | **Inside `RunState`**, threaded through `step()`. Not a module-level singleton. **As of M6 the `pattern` stream is consumed** — weighted pattern selection is its first and only consumer, and `step()` advances it whenever a pattern is emitted. `collectible` and `cosmetic` remain untouched, which is the point of separating them: a decorative change cannot shift the obstacle sequence, and a test asserts exactly that. |
| Seed source | A cryptographically strong value at run start — from the **server** if the run-token model is adopted, otherwise locally generated |
| Seed recording | The seed is part of the run summary, so any run can be replayed for debugging or validation |
| Streams | Separate, independently-seeded streams for **pattern selection**, **collectible placement** and **cosmetic variation**, derived from the run seed |

### 3.1 Why separate streams

If cosmetic variation draws from the same stream as pattern selection, then
changing a decorative detail shifts every subsequent gameplay draw — and every
recorded replay breaks. Separate streams make presentation changes safe.

---

## 4. Fixed-step simulation — PROPOSED

```
accumulator += frameDeltaMs
while (accumulator >= STEP_MS) {
  state = step(state, drainInput(), STEP_MS)
  accumulator -= STEP_MS
}
render(interpolate(previousState, state, accumulator / STEP_MS))
```

| Parameter | PROPOSED | Notes |
| --- | --- | --- |
| `sim.fixedStepHz` | 120 | Two steps per frame at 60 fps; smooth input resolution |
| `sim.maxCatchUpSteps` | 8 | Prevents a spiral of death after a long stall |

**Spiral protection:** if more than `maxCatchUpSteps` are owed — after a tab
stall, a GC pause, or a device sleep — the excess is **discarded, not
simulated**. Simulating thirty seconds of backlog instantly would kill the player
in a frame. This is also why losing visibility **pauses the run** rather than
letting it accumulate.

---

## 5. What determinism buys, concretely — APPROVED

| Capability | Enabled by |
| --- | --- |
| Reproduce a bug from a seed and an input log | Pure `step` + seeded RNG |
| Property-test the escape-path guarantee | Deterministic generation |
| Fuzz long runs at each difficulty tier with a reference solver | Deterministic generation |
| Compare two tuning sets over identical runs | Same seed, different tuning |
| Replay-based run validation, if adopted | Portable, engine-free domain |

---

## 6. What is deliberately NOT deterministic — APPROVED

- **Rendering.** Frame timing, interpolation and particle effects vary by device
  and must never feed back into the rules.
- **Cosmetic variation.** Drawn from its own stream precisely so it can change
  freely without disturbing gameplay draws.
- **The seed itself.** Each run gets a fresh one; runs are not meant to repeat
  for the player.

---

## 7. Testing — PROPOSED

| Test | Assertion |
| --- | --- |
| Replay equivalence | The same seed and input log produce a byte-identical final `RunState` |
| Step independence | ~~Splitting one step into two half-steps produces the same result within tolerance~~ — **withdrawn at M5.** The design cannot have this property and should not claim it: every duration threshold (`advanceJump`, `advanceLaneTransition`) settles on the first step at or past its target and discards the overshoot, so the step size is observable by construction. A fixed step is the guarantee; step independence is not. |
| No ambient access | A static check rejects `Math.random`, `Date.now` and `performance.now` inside `game/domain/` |
| Stream isolation | Changing the cosmetic stream leaves pattern and collectible draws unchanged |
| Catch-up bound | A simulated 30-second stall does not kill the player |

---

## 8. Open questions

| Ref | Question |
| --- | --- |
| RNG-1 | Is the run seed **server-issued**? Depends on [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md) and on the offline question (PWA-1) |
| RNG-2 | Is an input log recorded and submitted with the run? Directly affects payload size and the validation model |
| RNG-3 | Fixed-step rate confirmation (PROPOSED 120 Hz) |
