# `game/domain` — pure game rules

**No Phaser. No DOM. No Vue. No network. No `Math.random()`. No `Date.now()`.**

This directory holds the game as a deterministic state machine:

```ts
step(state: RunState, input: InputEvent[], deltaMs: number): RunState
```

Time enters only as `deltaMs`; randomness only through a seeded generator carried
inside `RunState`. That purity is not stylistic — it is what makes the approved
escape-path guarantee provable by property tests and long-run fuzzing, and what
keeps the domain portable if run validation ever needs to replay it server-side.

See [`../../docs/architecture/game-engine-integration.md`](../../docs/architecture/game-engine-integration.md).

Implementation begins at **M5**. Empty at bootstrap by design.
