# `game/domain` — pure game rules

**No Phaser. No DOM. No Vue. No network. No `Math.random()`. No `Date.now()`.**

As of M6 this is also where obstacles live, where collision is decided, where hearts are lost and
where the escape-path solver runs. All of it is pure: the solver is the same `step()` the game
uses, so a pattern it certifies is a pattern the rules agree with.

This directory holds the game as a deterministic state machine:

```ts
step(state: RunState, input: InputEvent[], deltaMs: number): RunState
```

Time enters only as `deltaMs`; randomness only through a seeded generator carried
inside `RunState`. That purity is not stylistic — it is what makes the approved
escape-path guarantee provable by property tests and long-run fuzzing, and what
keeps the domain portable if run validation ever needs to replay it server-side.

See [`../../docs/architecture/game-engine-integration.md`](../../docs/architecture/game-engine-integration.md).

## What is here, as of M5

| File | |
| --- | --- |
| `tuning.ts` | Every tunable value, each carrying its APPROVED/PROPOSED status. The derived jump arc. |
| `rng.ts` | The seeded generator: three independent streams, explicit state, no module singleton. |
| `types.ts` | `RunState`, `InputEvent`, `LaneIndex`, `RunPhase`. Plain serializable data. |
| `state.ts` | Constructing a run. |
| `lanes.ts` | One lane per input, edge clamping, occupancy switching at the midpoint. |
| `jump.ts` | The 650 ms arc: no double jump, no variable height, no invulnerability. |
| `input.ts` | Applying an input, or buffering one that cannot act yet. |
| `step.ts` | The reducer. Phase, then inputs, then time. |

**Not here yet:** paws, SLAYYY, the Loli Bonus and scoring (M7). Obstacles,
collision, hearts and difficulty arrived at M6 and are listed above. The
`pattern` RNG stream now drives spawning; `collectible` and `cosmetic` are still
untouched, and a test proves a decorative draw cannot shift the obstacle
sequence.

Tests live beside the code as `*.spec.ts` and run in Node with no DOM — Vitest's
`unit` project already globs `game/**/*.spec.ts`. A browser dependency creeping
in fails there rather than at M6, when the property tests need to run thousands
of times.
