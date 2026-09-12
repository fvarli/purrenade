# Engineering Standards — Frontend

Implementation quality is a **first-class requirement**, not a follow-up task.
This document is the checklist every milestone is held to.

---

## 1. The standard — APPROVED

Use current best practices for the selected framework/runtime versions and the
problem domain. For **every** technical decision, evaluate:

correctness · maintainability · readability · testability · separation of
concerns · security · performance · observability · accessibility ·
localization · scalability where justified · developer experience ·
deployment/operations impact · backward compatibility · failure handling ·
data integrity · concurrency and race conditions · idempotency where relevant ·
API consistency · mobile/browser constraints · future Android/iOS compatibility.

Two balancing rules:

- **Do not take shortcuts merely to make a milestone pass.** A milestone that
  passes by creating known debt in approved v1 functionality has not passed.
- **Do not over-engineer speculative features.** Leave clean extension points
  only where the approved product direction clearly requires them.

When several approaches are technically valid, prefer the one that is **simpler
to operate, easier to test, and easier to understand**, unless there is a strong
product, security, or performance reason to choose otherwise.

---

## 2. Frontend-specific expectations — APPROVED

| Expectation | What it means here |
| --- | --- |
| **Idiomatic Nuxt architecture** | Follow the framework's conventions rather than inventing a parallel structure |
| **Idiomatic Vue composition patterns** | Composables for reuse; components stay presentational |
| **Strong TypeScript** | Strict mode, narrow types for lane indices/tiers/ids, no `any` in the game domain, API types generated from the contract |
| **Clear separation** | UI · application state · API clients · Phaser/game logic are four distinct layers with one-way dependencies |
| **Pure game rules** | Game logic is isolated from rendering and unit-tested without a browser |
| **No Phaser leakage** | Phaser state and types never appear in unrelated Vue/Nuxt UI |
| **Deliberate SSR/client boundaries** | The run route is client-only; the Phaser bundle never enters an SSR path |
| **Robust mobile input** | Gestures never scroll, zoom, refresh, or navigate; input is buffered, not dropped |
| **Approved viewport rules** | 390 × 844 baseline, 460 px desktop column, safe areas, dynamic viewport units |
| **Localization from the start** | No hard-coded player-facing string, ever — not "added later" |
| **Accessibility outside the canvas** | Real semantics, keyboard operability, visible focus, announced state |
| **Deterministic, testable game logic** | Fixed-step simulation, seeded RNG, no ambient time or randomness |
| **No unnecessary global mutable state** | Especially not run state |
| **No magic numbers** | Documented tuning configuration, single source |

---

## 3. Definition of done — APPROVED

A change is done when **all** of the following hold:

- [ ] Behavior matches the written specification; no approved behavior changed silently
- [ ] No OPEN decision was implemented; no PROPOSED value was presented as approved
- [ ] Tests added or updated at the right layer (see [`../testing/testing-strategy.md`](../testing/testing-strategy.md))
- [ ] Regression gates pass (see [`../testing/regression-gates.md`](../testing/regression-gates.md))
- [ ] New tunables are registered in [`../game/tuning-parameters.md`](../game/tuning-parameters.md)
- [ ] New player-facing strings exist in **tr / en / es**
- [ ] Non-canvas UI is keyboard-operable with visible focus
- [ ] Reduced motion is honoured by any new motion
- [ ] No secret, no personal data, and no private source material is present
- [ ] Documentation updated, including any affected ADR
- [ ] The final diff was reviewed for scope creep and regressions

---

## 4. Code review focus — PROPOSED

In rough order of how often each catches a real problem in this codebase:

1. **Boundary violations** — a Phaser import in the domain, a domain mutation in
   a component, a rule decided in a scene.
2. **Hidden gameplay literals** — a number in a scene that should be a tunable.
3. **Determinism leaks** — `Math.random()`, `Date.now()`, or variable-delta
   physics inside the domain.
4. **Authorization assumptions** — treating a client check as a control.
5. **Missing localization** — a string that will need a migration later.
6. **Lifecycle leaks** — a Phaser instance, listener, or texture not released.
7. **Unbounded work** — a retry without backoff, a request without a timeout, an
   allocation inside the frame loop.
8. **Accessibility regressions** — a control that became a `div`.

---

## 5. Anti-patterns — APPROVED

| Anti-pattern | Why it is rejected here |
| --- | --- |
| Game state in a reactive store | Destroys determinism, reactive overhead at 120 Hz, lets UI mutate rules |
| Reading pixel positions to decide gameplay | Rendering must never decide outcomes |
| `any` in the game domain | The domain is the one place types actually prevent bugs |
| Trusting the client for score or progression | The leaderboard makes this exploitable by design |
| "We'll add i18n later" | Retrofitting localization touches every component |
| "We'll add tests after the milestone" | The escape-path guarantee is only real if it is tested |
| Copying a value from the design board into a component | Tokens and tunables exist so there is one source |
| Client-side obfuscation as anti-cheat | Not a control; see [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md) |
