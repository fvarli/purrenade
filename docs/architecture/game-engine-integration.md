# Game Engine Integration

The boundary between pure game rules, the Phaser engine, and the Nuxt/Vue UI.
This is the most consequential structural decision in the frontend.

**Status legend:** APPROVED / PROPOSED / OPEN.

---

## 1. The rule — APPROVED

**Game rules are pure and engine-free. Phaser renders them. Vue never sees
either.**

```
  ┌──────────────────────────────────────────────┐
  │  game/domain    PURE                         │
  │  lanes · jump · collision · difficulty        │
  │  patterns · scoring · rng · state             │
  │                                               │
  │  no Phaser · no DOM · no Vue · no network     │
  │  no Math.random · no Date.now                 │
  └───────────────┬──────────────────────────────┘
                  │  plain data in, plain data out
  ┌───────────────▼──────────────────────────────┐
  │  game/bridge   the ONLY typed boundary        │
  │  input events ▲        render snapshot ▼      │
  └───────────────┬──────────────────────────────┘
                  │
  ┌───────────────▼──────────────────────────────┐
  │  game/engine   Phaser scenes, sprites, input  │
  │  no rules · no business decisions             │
  └───────────────┬──────────────────────────────┘
                  │  run summary events only
  ┌───────────────▼──────────────────────────────┐
  │  app/          Vue UI, stores, API client     │
  │  never imports Phaser types                   │
  └──────────────────────────────────────────────┘
```

### Why this is worth the discipline

1. **The escape-path guarantee is only provable if the rules are pure.** The
   approved invariant "every generated pattern has a valid escape path" is
   verified by property tests and long-run fuzzing over simulated minutes. That
   is impossible against a renderer and trivial against pure functions.
2. **Determinism is a product requirement, not a preference.** Jump is specified
   as deterministic and tunable; run validation depends on reproducibility.
3. **Frame-rate independence.** Rules stepped by an explicit delta cannot
   accidentally depend on how fast a device renders.
4. **Bundle isolation.** Phaser stays off every non-run route.

---

## 2. The domain contract — PROPOSED

The domain is a state machine, not an object graph:

```ts
step(state: RunState, input: InputEvent[], deltaMs: number): RunState
```

- `RunState` is plain, serializable data: lane, airborne progress, hearts,
  invulnerability timer, difficulty time, spawned entities, score, paw counters,
  SLAYYY charge/timer, Loli timer, **`queuedLoliBonuses`**, **near-miss events**, RNG cursor.
- `step` is **pure**: same inputs, same output. No ambient time, no ambient
  randomness, no I/O.
- Time enters only as `deltaMs`. Randomness enters only through a seeded
  generator carried inside the state — see
  [`../game/determinism-and-rng.md`](../game/determinism-and-rng.md).

### Fixed-step simulation — PROPOSED

The domain is stepped at a fixed rate (PROPOSED `120 Hz`) with an accumulator;
rendering interpolates between steps. Variable-delta physics is not
reproducible, and reproducibility is required both by the escape-path tests and
by any replay-based validation.

---

## 3. The bridge — PROPOSED

One module, one direction each way, fully typed:

| Direction | Payload |
| --- | --- |
| Engine → domain | Normalized `InputEvent`s: `MOVE_LEFT`, `MOVE_RIGHT`, `JUMP`, `ACTIVATE_SLAYYY`, `PAUSE`. Raw swipes and key codes are normalized **in the engine**, before crossing. |
| Domain → engine | An immutable **render snapshot**: entity positions in lane/longitudinal units, animation state names, HUD values. Never the mutable state object. |
| Domain/engine → app | Coarse **run events** only: `RUN_STARTED`, `HEART_LOST`, `SLAYYY_ACTIVATED`, `LOLI_STARTED`, `RUN_ENDED(summary)`. |

The engine converts lane/longitudinal units into pixels. **The domain never knows
about pixels**, which is what lets the same rules drive a 390 px phone and a
460 px desktop column without a second code path.

---

## 4. What each side may not do — APPROVED

### The domain may not
- import Phaser, touch the DOM, or reference Vue;
- call `Math.random()` or read the wall clock;
- perform I/O or know about the API;
- know about pixels, sprites, atlases, or animation frames.

### The engine may not
- decide whether a collision costs a heart;
- decide whether SLAYYY may activate;
- decide what spawns, or alter a pattern;
- hold gameplay state that the domain does not have.

If the engine holds gameplay state, the domain is no longer authoritative and
determinism is lost.

### The Vue/Nuxt UI may not
- import Phaser types anywhere;
- read or write `RunState` directly;
- perform any gameplay decision.

HUD values reach Vue as a small projected view model, not as engine internals.

---

## 5. HUD ownership — PROPOSED

The HUD is **DOM, not canvas**, for score, hearts, paw progress, SLAYYY control
and pause.

*Rationale:* the approved accessibility requirements demand real focusable,
labelled controls — in particular the armed SLAYYY control — and real text for
localization. Canvas-drawn text would break both, and would also violate the
"no text baked into images" constraint in spirit.

In-world flourishes that belong to the scene (the "SLAYYY ✨ her şey güzel!"
banner, the "LOLİ GELDİ!" banner) may be rendered in-canvas, with an accessible
announcement mirrored in the DOM.

---

## 6. Lifecycle — PROPOSED

| Phase | Behavior |
| --- | --- |
| Route enter | Dynamically import the engine; create the canvas; preload atlases |
| Run start | Construct `RunState` from profile data (`loliCyclePaws`) and a seed |
| Running | Fixed-step domain updates; engine interpolates and renders |
| Pause | The accumulator stops. No timers advance — not SLAYYY, not Loli, not difficulty, not invulnerability |
| Run end | Emit the summary; the app layer submits it |
| Route leave | Destroy the Phaser instance, release GPU resources and listeners, remove input handlers |

**Teardown is not optional.** A leaked Phaser instance is the classic cause of a
game that gets slower every time the player replays.

### Browser lifecycle — PROPOSED
Losing focus, backgrounding the tab, or a visibility change **pauses the run**
rather than letting it simulate unseen. On mobile this is also the only way to
stop a backgrounded run from being killed mid-simulation by the OS.

---

## 7. Testing consequences — APPROVED

| Test | Runs against |
| --- | --- |
| Lane, jump, collision, hearts, invulnerability | **Domain only.** Fast, deterministic, no browser. |
| **Near-miss detection** — deterministic, one event per obstacle | **Domain only.** It is a rule, not a rendering effect, and its output feeds server-verified achievements. |
| **Obstacle class semantics** — `LANE_BLOCKING` vs `JUMPABLE` | **Domain only.** The engine draws a cone; the domain knows only its class. |
| **Loli queueing** — run-scoped counter | Domain only |
| Difficulty curve and soft caps | Domain only |
| Escape-path property tests and pattern joins | Domain only |
| Seeded long-run fuzz with a reference solver | Domain only |
| Rendering, input normalization, teardown | Engine, in a browser context |
| HUD, menus, auth | Component and e2e |

The majority of gameplay correctness is provable without a browser. That is the
payoff for the boundary.

---

## 8. Open questions

| Ref | Question |
| --- | --- |
| GE-1 | Fixed-step rate (PROPOSED 120 Hz) |
| GE-2 | Whether the render snapshot is rebuilt per frame or diffed |
| GE-3 | Whether the domain also runs server-side for validation — see [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md). If it ever does, the domain must be portable, which is an additional reason to keep it free of browser APIs. |
