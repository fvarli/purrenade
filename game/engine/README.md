# `game/engine` — Phaser adapter

Owns scenes, sprites, input capture and rendering. **Holds no gameplay state the
domain does not have, and makes no gameplay decision.**

If the engine decides whether a collision costs a heart, the domain is no longer
authoritative and determinism is lost.

## What is here, as of M5

| File | |
| --- | --- |
| `index.ts` | `mountRun()` — the only module that imports Phaser **as a value**, and it imports it lazily.
  `scene.ts` takes the namespace as a parameter and imports only its *types*, which
  are erased at build time — that is what lets the scene's lifecycle be tested in
  Node without a browser. Returns a handle that can pause, resume and destroy. |
| `scene.ts` | The Phaser scene: sea, promenade, three lanes, the player. Reads the render snapshot; decides nothing. |
| `layout.ts` | Lane units and baseline pixels to real pixels. Pure, and tested in Node. |
| `input/keyboard.ts` | Key codes to intent, with the modifier and focus rules that stop gameplay stealing the browser's keys. Pure. |
| `input/pointer.ts` | Swipe recognition against the approved thresholds. Pure. |

The art is deliberately primitive — coloured shapes, not sprites. No approved
production artwork exists yet, and drawing rectangles keeps the boundary honest
rather than blocking it on a texture atlas.

**The lazy import is load-bearing.** Phaser is 1.3 MB; a static import anywhere
would pull it into the entry chunk for every visitor who never plays, and drag a
`window`-dependent library into an SSR path. CI asserts that Phaser lives in
exactly one chunk, that nothing imports that chunk statically, that only the run
route imports it dynamically, and that
something imports it dynamically.
