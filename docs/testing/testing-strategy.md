# Testing Strategy — Frontend

**Status legend:** APPROVED / PROPOSED / OPEN.

---

## 1. Principle — APPROVED

**Most gameplay correctness is provable without a browser.** That is the whole
payoff of keeping game rules pure and engine-free
([game-engine-integration](../architecture/game-engine-integration.md)).

Tests are placed at the lowest layer that can actually prove the thing.

---

## 2. Layers — PROPOSED

| Layer | Runs against | Speed | Proves |
| --- | --- | --- | --- |
| **Domain unit** | `game/domain/` — pure, no browser | Milliseconds | Lanes, jump, collision, hearts, invulnerability, difficulty, scoring, paw thresholds, SLAYYY and Loli timers |
| **Domain property / fuzz** | `game/domain/` | Seconds | **The escape-path guarantee**, pattern joins, determinism, soft caps |
| **Engine** | Phaser adapter, in a browser context | Seconds | Input normalization, rendering wiring, lifecycle teardown |
| **Component** | Vue components | Seconds | HUD projection, forms, states, accessibility semantics |
| **End-to-end** | The running app | Minutes | Auth flows, tutorial, a full run, settings, localization switching |
| **Visual** | Key screens | Minutes | Token regressions and layout breakage at the 390 baseline |

---

## 3. What must be tested — APPROVED

These follow directly from approved invariants. Each is a named, non-negotiable test.

| Invariant | Test |
| --- | --- |
| **Every generated pattern has a valid escape path** | Property test: every authored pattern, from every starting lane, within the action and reaction budget |
| **Pattern joins are survivable** | Property test over every legal ordered pair within a tier |
| **Long runs stay fair** | Seeded fuzz at each tier with a reference solver; the solver never dies from an impossible pattern |
| **Maximum health is 3 and nothing heals** | Invariant test: no sequence of events raises hearts |
| **SLAYYY never auto-activates** | Test: a full meter alone never activates; only the input does |
| **SLAYYY does not heal** | Test: hearts are unchanged across activation |
| **Paw overflow is preserved** | Test: 198 + 5 → bonus triggers, cycle = 3 |
| **One bonus per completed threshold** | Test: a large single gain crossing 200 twice triggers twice and queues |
| **Loli grants no invulnerability** | Test: a collision during Loli costs a heart |
| **Maximum multiplier is ×2 during overlap** | Test: SLAYYY + Loli does not exceed ×2 |
| **Jump is deterministic and ≈650 ms** | Test: arc timing and reproducibility |
| **`JUMPABLE` is cleared while airborne; `LANE_BLOCKING` is not** | Test: both classes, grounded and airborne, in the same lane |
| **An obstacle's class never changes, including during SLAYYY** | Test: activate SLAYYY over both classes and assert collision outcomes are unchanged |
| **A near miss fires at most once per obstacle** | Test: pass the same obstacle at the envelope edge; exactly one event |
| **A near miss awards no score** | Test: score before and after an envelope pass is identical |
| **Near-miss detection is deterministic** | Test: the same seed and input log produce the same near-miss event set |
| **Loli queueing is run-scoped** | Test: cross the threshold while Loli is active → `queuedLoliBonuses` increments, the next starts on exit, and **the run ends with the queue discarded** |
| **Two Loli companions never run concurrently** | Test: queue two and assert only one is ever active |
| **A threshold earned is not an activation** | Test: cross a threshold, end the run before the queued bonus starts → `loliActivations` does **not** include it |
| **An activation counts on actual start** | Test: the ENTERING/ACTIVE transition increments `loliActivations` exactly once per bonus |
| **Mute is independent of volume** | Test: set volume, mute, unmute → the previous non-zero volume is restored, not silence |
| **The player cannot die in the tutorial** | Test: deliberately collide at every step; hearts never drop |
| **Determinism** | Replay equivalence from a seed and input log |
| **Desktop/mobile HUD parity** | Test: every gameplay-critical value is present at each breakpoint |
| **No ambient time or randomness in the domain** | Static check over `game/domain/` |
| **No hard-coded player-facing strings** | Static check; every string is a translation key |
| **No raw hex colours outside the token module** | Static check |

---

## 4. Property-based testing — PROPOSED

The escape-path guarantee is the clearest case for property testing anywhere in
this product: the claim is universally quantified ("**every** pattern, from
**every** lane, at **every** tier"), which is precisely what example-based tests
cannot express.

| Property | Statement |
| --- | --- |
| Escape | ∀ pattern, ∀ starting lane → a survivable path exists within budget |
| Join | ∀ (pattern A, pattern B) legal in tier T → the joined sequence is survivable |
| Soft cap | ∀ t → every difficulty dimension ≤ its ceiling |
| Overflow | ∀ (cycle, gain) → `newCycle = (cycle + gain) mod 200` and `bonuses = ⌊(cycle + gain) / 200⌋` |
| Escape (both verbs) | ∀ pattern mixing classes → a survivable path exists using lane changes and jumps within budget |
| Near miss | ∀ obstacle → at most one near-miss event, and score is unchanged by it |
| Determinism | ∀ (seed, inputs) → `step*` is a pure function |

---

## 5. The reference solver — PROPOSED

A deliberately simple, greedy player used only in tests: it looks ahead a fixed
window and takes the first survivable action within the reaction budget.

It is **not** an AI and is not meant to play well. Its only job is to answer
"could a human have survived this?" mechanically, so that fairness is a property
the test suite checks rather than a thing a designer hopes is true.

---

## 6. End-to-end coverage — PROPOSED

| Flow | Covers |
| --- | --- |
| Register → verify email (6-digit) → first run | The approved first-time path |
| Login → 2FA challenge → menu | TOTP and backup-code paths |
| Forgot password → reset link → login | The link-based reset flow |
| Tutorial, start to finish | Gating, no-death, persistence |
| A full run to game over | Hearts, collision, score, submission |
| Trigger SLAYYY and Loli, including overlap | Timers, multiplier, invulnerability |
| Language switch tr → en → es | Instant switching, no reload, no clipping |
| Desktop keyboard play including `E` and `Esc` | Full keyboard operability |
| Leaderboard and achievements | Read paths and the pinned "you" row |
| Offline/network failure during a run | A run is never destroyed by a network error |

---

## 7. Accessibility and localization testing — APPROVED

Both are requirements, so both are tested rather than reviewed by eye:

- automated accessibility audit on every non-canvas screen;
- keyboard-only traversal of every flow;
- reduced motion demonstrably changes behavior, including inside the canvas;
- contrast checked at the **token** level, once per token change;
- missing-key and unused-key checks across tr/en/es, failing CI on a gap;
- pseudo-localization for long-string layout;
- Turkish uppercase produces `İ`, not `I`.

---

## 8. What is not tested automatically — PROPOSED

Named honestly rather than pretended:

| Not automated | Handled by |
| --- | --- |
| Whether the game *feels* good | Playtesting; tuning values are PROPOSED until reviewed for exactly this reason |
| Art fidelity to the design boards | Human design review against v0.3 |
| Audio mix | Human review |
| Real-device performance | Measured on a physical mid-range device at M12 and M14 |

---

## 9. Conventions — PROPOSED

- Tests are named after the behavior, not the function.
- No test depends on wall-clock time; the domain takes an explicit delta.
- No test depends on network access; the API is stubbed at the client boundary.
- Fixtures for patterns and runs are data, shared between tests and the game.
- A flaky test is fixed or deleted, never retried into green.
