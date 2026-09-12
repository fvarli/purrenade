# ADR-0002 — Nuxt + Phaser frontend architecture

- **Status:** Accepted
- **Scope:** Frontend
- **Date:** 2026-09-12
- **Decision owner:** Product owner

## Context

Purrenade is two products sharing a shell: a **canvas action game**, and a
**conventional authenticated web application** with 21 screens covering
registration, 2FA, profile, settings, leaderboards and achievements.

The approved technology direction names Nuxt, Vue, TypeScript and Phaser. The
approved product surface adds constraints that shape *how* they are combined:

- localization in tr/en/es with instant switching and **no text baked into images**;
- accessibility outside the canvas;
- deterministic, testable game logic;
- a proven escape-path guarantee in generated obstacle patterns;
- mobile-first performance;
- Android/iOS distribution must remain possible.

## Decision

**Nuxt + Vue + TypeScript for the application; Phaser 4 for the game; a strict
boundary between them.**

1. **Game rules are pure and engine-free.** `game/domain/` contains plain
   TypeScript with no Phaser, DOM, Vue, network, ambient time, or ambient
   randomness. It is a fixed-step state machine: `step(state, input, deltaMs)`.
2. **Phaser renders the domain.** The engine adapter owns scenes, sprites, input
   capture and rendering, and holds no gameplay state the domain does not have.
3. **Vue never sees Phaser.** The UI receives a small projected view model and
   coarse run events. No component imports a Phaser type.
4. **The HUD is DOM, not canvas** — required for accessible controls (notably the
   armed SLAYYY control) and for localized text.
5. **The run route is client-only**, and the Phaser bundle is lazily loaded there
   and nowhere else.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| **Game logic inside Phaser scenes** (the conventional approach) | Fastest to start, and rejected on the strongest ground available: the approved escape-path guarantee must be **proven by property tests and long-run fuzzing**. That is impractical against a renderer and straightforward against pure functions. Determinism and frame-rate independence follow from the same choice. |
| **Canvas-rendered HUD** | Would break accessible controls and localized text, and sits badly with the approved "no text baked into images" constraint. |
| **Phaser 3** | Phaser 3 ended at 3.90.0; the vendor states plainly that new projects should start on v4. No migration cost applies to a new project. |
| **A different engine, or hand-rolled canvas** | Contradicts the approved technology direction, and hand-rolling loses sprite, atlas, input and scene handling for no gain. |
| **SSR for the run route** | Impossible for a canvas game, and would drag the Phaser bundle into an SSR path. |

## Consequences

**Easier**
- Gameplay correctness is unit-testable in milliseconds, without a browser.
- Tuning changes are data changes against reproducible runs.
- Bundle isolation: auth and menu routes never pay for Phaser.
- If run validation later needs to replay a run server-side, the domain is
  already portable — see [ADR-0006](ADR-0006-run-validation-and-anti-cheat-boundary.md).

**Harder**
- The boundary must be maintained deliberately. The tempting shortcut — "just put
  this one rule in the scene" — is exactly what the architecture forbids, so it
  is enforced by a static check (regression gate G11), not by reviewer memory.
- A bridge layer exists that a naive Phaser project would not have.
- Rendering interpolation is required, since the simulation steps at a fixed rate
  independent of frame rate.

**Now constrained**
- No gameplay decision may be made by a Phaser scene.
- No gameplay literal may exist outside the tuning module.
- The domain may never acquire an ambient dependency on time or randomness.
