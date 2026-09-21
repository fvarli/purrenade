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

## 7A. Implementation status — M5

The layering in §1 and the contracts in §2 and §3 are implemented. What exists:

| Layer | Status |
| --- | --- |
| `game/domain` | Lanes, jump, input buffering, pause, the seeded generator, the tuning module. `step()` is pure and tested in Node. |
| `game/bridge` | Render snapshot, interpolation, and the fixed-step loop. |
| `game/engine` | The Phaser scene, the layout mapping, keyboard and swipe normalization. |
| `app/pages/run.vue` | Client-only, mounts and tears down the engine, pauses when unwatched. |

Three things are worth recording because they were decided by building it:

**The fixed-step loop lives in the bridge, not the engine.** None of it is
Phaser-shaped, and its two stall protections — clearing the accumulator on
pause, bounding catch-up — are worth testing in Node rather than by
backgrounding a browser tab.

**Pause and resume are applied synchronously, not queued as inputs.** Queuing
them produced a deadlock: a queued transition is applied by the next `frame()`,
and `frame()` is driven by the renderer's loop, which Phaser stops on window
blur. A run paused by that blur could not be resumed, because the resume was
waiting for the loop that pausing had stopped. Control operations must not
depend on the thing they control.

**Resume is never automatic.** Losing visibility pauses a run; regaining it does
not resume one. A tab returning to the foreground while the player is looking
elsewhere would otherwise restart a live run nobody is watching.

Implemented since: obstacles, collision, hearts and difficulty (**M6**); paws,
SLAYYY, the Loli Bonus, scoring and the HUD (**M7**). Two of the three RNG
streams are now consumed — `pattern` by obstacle spawning and `collectible` by
Paw Tokens — and `cosmetic` remains reserved, drawn from by nothing.

---

## 7B. Two things M5 deliberately does not do

**Reduced motion — implemented at M6, as this section said it would have to be.**
At M5 nothing in `game/` read `prefers-reduced-motion`, and that was honest: the scene
drew static shapes and the only movement was the player responding to input, which is not
decoration. M6 added the thing the setting is actually about — the post-hit blink. The
scene now reads the query directly (`game/engine/scene.ts`) — and, since Milestone C,
keeps watching it (§7D) — and under `reduce` the 10 Hz
blink becomes a slower, lower-contrast pulse rather than either a flash or a static dim:
the invulnerable state still has to be *visible*, so switching the feedback off would trade
an accessibility problem for a legibility one. This satisfies `accessibility.md`'s
requirement that the setting *"demonstrably changes behaviour, including inside the
canvas"*. The scroll itself is not reduced: it is the game, not an effect.

**The airborne duration is quantised to the step rate, and only exact at 120 Hz.**
Measured from the domain, not the renderer:

| Step rate | Airborne | Error against the approved 650 ms |
| --- | --- | --- |
| 60 Hz | 666.67 ms | +16.67 |
| 90 Hz | 655.56 ms | +5.56 |
| **120 Hz** | **650.00 ms** | **0.00** |
| 144 Hz | 652.78 ms | +2.78 |
| 240 Hz | 654.17 ms | +4.17 |

This is inherent to a fixed step: a jump lands on the first whole step at or past its
target. It is exact today only because `650 / (1000 / 120)` is exactly 78. **That couples
an APPROVED product value to GE-1, which is still OPEN** — changing the step rate moves
the approved number by up to 17 ms. Recorded rather than fixed, because the fix is a
product decision about which of the two values is load-bearing.

---

## 7C. The presentation layer, after the B3 reconstruction — APPROVED

The engine's rendering half is three modules rather than one scene, and the
split follows the boundary that already exists on screen:

| Module | Draws | May read |
| --- | --- | --- |
| `promenade.ts` | Sky, painted coast, road, lane markings, balustrade, dressing, the desktop column's light | The layout, a scroll offset, and three presentation flags — how far into the SLAYYY world, whether the run is live, and the reduced-motion preference. **Not the snapshot's obstacles.** |
| `actors.ts` | Ayşenur, Loli, the hazards, the Paw Tokens, the SLAYYY effect | The render snapshot |
| `scene.ts` | Nothing | Everything, and it hands each of the other two exactly what it needs |

`promenade.ts` cannot draw a hazard even by accident: it is never given one.

### The scroll offset does not come from the bridge

The promenade's paving, lane dashes, balusters and palms are laid out in world
units and projected, so they need to know how far the world has moved — and the
snapshot carries no speed. **It was not given one.** An obstacle present in two
consecutive frames reports its own distance in both, and the difference *is* the
distance travelled, so `scene.ts` measures the rate from data the renderer
already receives and integrates its own offset.

That is a deliberate choice against the easier one. Adding `scrollUnits` to
`RenderSnapshot` would have widened a contract §3 describes as "three payloads,
three directions, and nothing else" for the benefit of scenery, and every later
field would have had that precedent to point at. The measurement is presentation
arithmetic in the presentation layer, it freezes when the run is not `running`,
and nothing downstream of it can reach the rules.

---

## 7D. The run lifecycle, after Milestone C — APPROVED

Milestone C closed the session around the run — pause, run complete, replay —
without changing a byte under `game/domain/` or `game/bridge/`. Three facts about
the boundary follow from it.

### Replay is a teardown and a fresh mount, never a reset

`RunPhase.ended` is terminal by construction: `step()` returns the sealed state
before it looks at anything else, so no input can reopen a finished run. There is
therefore no state to rewind, and `useRunSurface.restart()` does not try — it runs
the same `stop()` the route leave runs, then the same `start()` the route entry
runs.

That is the point rather than a shortcut. The generation counter, the listener
list and `MountedRun.destroy()` are the mechanisms this composable exists for, and
the ones already hardened twice; a replay path with reset logic of its own would
be a second lifecycle to keep correct, and the first symptom of it drifting would
be two live WebGL contexts.

One consequence is worth stating because it is not obvious. `createRunLoop` emits
`run_started` but **no opening `phase_changed`** — `lastPhase` is seeded from the
fresh state, so the first phase event a new run produces is `ready → running`, at
the *end* of the readiness beat. The phase therefore has to be reset by `stop()`
alongside the score and the hearts. Without that, the run-complete overlay stays
mounted over a live new run for the whole beat.

### The reduced-motion preference is watched, not sampled

The scene resolves the media query once in `create()`, installs exactly one
`change` listener, and pushes its removal into the same `teardown` list as the
resize and input handlers — the list `drain()` empties on `shutdown` **and** on
`destroy`. Every consumer already reads `reducedMotion` off the view object once
per frame, so a change lands on the next frame with no reload and no rebuild.

A query object that reports `matches` without `addEventListener` is handled: the
preference still applies, only the watching is skipped.

### Overlays are DOM, and the scrim is load-bearing

No text is drawn inside the canvas, and the pause and run-complete screens do not
change that. They are Vue components, siblings of `.run__readouts` rather than
children of it, because the readout rail is clamped to the play column and takes
no pointer events — an overlay inside it would leave the seaside either side of
the column live to touches.

Covering the canvas is how gameplay input stops: Phaser's `pointerdown` only fires
when the target is the canvas, so a tap on the scrim reaches nothing. Keyboard is
stopped independently, by `shouldHandleKey` declining every binding but Escape
while an activatable element has focus — and the dialog's focus trap guarantees
one always does. Two mechanisms, neither relying on the other.

### The tutorial seam — built at M8 — APPROVED

Milestone C left this section describing a seam the tutorial *would* need. M8 built it, and
what it added is narrower than the prediction: **one nullable field**, `RunState.tutorial`,
which is `null` for every normal run.

| A tutorial must | and does, through |
| --- | --- |
| enter a controlled run | `mountRun({ mode: 'tutorial' })` — the single entry point, taking its options at the call site as predicted |
| suppress lethal behaviour | `step()` honours the mode: the collision resolves by the real rules and the heart is simply not spent |
| author its own road | `advanceSpawning` and `advancePawSpawning` both return early, and a scripted director places props where they would have |
| observe what the player did | recorded facts on `TutorialState`, read after collisions settle |
| tell the app | four coarse `RunEvent` variants — a lesson, a correction, and the end |
| leave cleanly | `stop()` — the same teardown a replay and a route leave use |
| not corrupt a normal run | nothing is persisted, and a `RunState` is built once per mount and thrown away |

**Exactly three call sites branch on the mode**, and they are the three the mode exists for:
the two spawners, and the damage block in `step()`. Nothing else in the domain knows the
tutorial exists. `collision.ts` is **unmodified** — it still computes `heartsLost` by the real
rules, and `step()` decides whether to spend it.

**The engine was not touched at all.** A tutorial prop is an ordinary obstacle or Paw Token in
the lane the script chose, so `RenderSnapshot` did not widen and the scene has no tutorial
branch. That is what "derive the treatment from the production visual system" means at this
boundary.

#### Why the player is not made invulnerable

It would have been a smaller change and a worse one. `isProtected` would then be true, so
`resolveCollisions` marks every damaging obstacle `cleared` rather than `hit` — and `cleared`
is also the outcome of a clean pass. The cone lesson could no longer distinguish a player who
walked into it from one who went around it, which is the entire lesson.

#### Why the lessons watch facts rather than outcomes

An obstacle's `outcome` is the damage rules' conclusion. What a lesson teaches is what the
player *did*, so `TutorialState` records two things per prop — was the player in its lane while
overlapping it, and were they airborne — and judges on those. This also avoids a real trap:
`resolveCollisions` caps damage at one heart per step and marks any *further* damaging obstacle
`cleared`, so `cleared` does not reliably mean "avoided".

#### Why the world keeps scrolling

An unsatisfied lesson re-presents its prop further down the road rather than freezing the
scroll. Freezing breaks the jump lesson outright — a barrier that never travels is a barrier a
jump cannot clear — and it would need a conditional in the scroll path, which is the one path
the normal-run golden is most sensitive to. Re-presenting needs no change there at all.

#### The proof that normal play is unchanged

`tests/unit/normal-run-golden.spec.ts` hashes 32 seed-and-style combinations over every
observable field of every step of a two-minute run, **including all three RNG streams**,
against a fixture generated before the mode existed. A module that consumed one extra random
value fails it even though no rule changed. That is the evidence behind "normal gameplay
semantics were not changed"; it is deliberately not a sentence in a report.

---

## 8. Open questions

| Ref | Question |
| --- | --- |
| GE-1 | Fixed-step rate (PROPOSED 120 Hz). **Implemented at 120 Hz as a named tuning parameter at M5; shipping it does not approve it**, and the question stays open until the rate is reviewed against a real device. |
| GE-2 | Whether the render snapshot is rebuilt per frame or diffed. **Rebuilt, as of M5** — an engineering choice, not a product one: the snapshot is eight primitive fields, and diffing it would cost more than building it. Revisit only if profiling on a real device says otherwise. |
| GE-3 | Whether the domain also runs server-side for validation — see [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md). If it ever does, the domain must be portable, which is an additional reason to keep it free of browser APIs. |
