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
| Floating-point accumulation of authoritative counters | Integer accumulators for score and paws. **Honoured at M7:** score accumulates in **thousandths** (`ScoreState.distanceMilli` / `collectionMilli` / `bonusMilli`) and the SLAYYY meter in **millionths** (`chargeMicro`); paws, hearts and the activation counters are plain integers. Thousandths were not enough for the meter: 1.4 per second at an 8.33 ms step rounds about 2.8 % fast, which a ten-minute run turns into a visible discrepancy. The run clock (`elapsedMs`) and the duration accumulators remain floats, deliberately: they are driven by a constant `STEP_MS`, IEEE-754 addition is deterministic, and a 100 000-step run reproduces bit-for-bit. |
| Reading anything ambient (DOM, network, storage, locale) | Pass it in |

---

## 3. Seeded RNG — PROPOSED

| Aspect | Approach |
| --- | --- |
| Algorithm | A small, fast, well-distributed PRNG with explicit state (e.g. a 128-bit xorshift family). **Not** the platform RNG. |
| State location | **Inside `RunState`**, threaded through `step()`. Not a module-level singleton. **As of M7 two streams are consumed** — `pattern` by weighted pattern selection (M6) and `collectible` by Paw Token groups (M7). `cosmetic` remains untouched. Paw spawning draws a fixed **two** values per group, count then lane, and then *rotates* to a clear lane instead of redrawing: the number of draws must not depend on the obstacle layout, or the two streams would be coupled through the playfield rather than through the seed. Tests assert both directions — perturbing `collectible` leaves 4000 steps of obstacles bit-identical, and does change the tokens, so the first assertion is not vacuous. |
| Seed source | **APPROVED (RNG-1): server-issued.** `POST /game-runs` creates the run before gameplay begins and returns the seed, so the spawn sequence is known to the server. The frontend initializes the deterministic run domain from that value and **never treats a browser-generated seed as authoritative**. There is no offline-start fallback: a normal authoritative run requires connectivity to start (PWA-1). |
| Seed recording | The server stores the seed against the run record, so any run can be reproduced for debugging or future validation. The client never supplies it back. |
| Streams | Separate, independently-seeded streams for **pattern selection**, **collectible placement** and **cosmetic variation**, derived from the run seed |

### 3.0A What RNG-1 changes, and where — APPROVED

The domain already takes the seed as an input and never produces one, so adopting a
server-issued seed is a change at the boundary, not in the rules.

| Layer | Effect |
| --- | --- |
| `game/domain/` | **None.** `createRunState({ seed })` already validates and stores whatever it is handed. |
| `game/bridge/` | **None.** `createRunLoop({ seed })` receives a seed; it has never made one. |
| App layer | The seed stops being generated locally and starts coming from the run-start response. Today it is produced by `Math.random()` in `app/composables/useRunSurface.ts`, whose own comment says this changes "here and nowhere else" once RNG-1 settles. **It has now settled; the change itself is M9 implementation work.** |

The tutorial is unaffected: it consumes no randomness at all, submits nothing, and starts no
authoritative run.

### 3.0B No input log — APPROVED (RNG-2)

**No gameplay input log is recorded, submitted or retained in v1.** It belongs to the deferred
Layer 3 replay design in the backend's `docs/security/anti-cheat.md` §3.

The streams stay separate and the domain stays pure anyway — that is what keeps Layer 3 a
deployment decision rather than a rewrite, and the separation is enforced by a CI gate.

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
| ~~RNG-1~~ | **Resolved by [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md) (accepted 2026-09-22): the seed is server-issued.** See §3 and §3.0A. |
| ~~RNG-2~~ | **Resolved by ADR-0006: no input log in v1.** Layer 3 replay is deferred; the domain stays portable so it remains available. See §3.0B. |
| RNG-3 | Fixed-step rate confirmation (PROPOSED 120 Hz) |
