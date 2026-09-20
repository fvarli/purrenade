# `game/engine` — Phaser adapter

Owns scenes, sprites, input capture and rendering. **Holds no gameplay state the
domain does not have, and makes no gameplay decision.**

If the engine decides whether a collision costs a heart, the domain is no longer
authoritative and determinism is lost.

## What is here

| File | |
| --- | --- |
| `index.ts` | `mountRun()` — the only module that imports Phaser **as a value**, and it imports it lazily. `scene.ts` takes the namespace as a parameter and imports only its *types*, which are erased at build time — that is what lets the scene's lifecycle be tested in Node without a browser. Returns a handle that can pause, resume and destroy. |
| `scene.ts` | Lifetime, texture loading, input capture and the per-frame wiring. Draws nothing itself. |
| `promenade.ts` | The place: sky, painted coast, road, lane markings, balustrade and dressing, all in one-point projection. Scenery only. |
| `actors.ts` | Everything standing on it: Ayşenur, Loli, the hazards, the Paw Tokens and the SLAYYY effect. Pooled, snapshot-driven. |
| `layout.ts` | Lane units and baseline pixels to real pixels, and the projection the road is drawn in. Pure, and tested in Node. |
| `assets.ts` | The runtime art manifest, and the "did the texture really load" check. |
| `palette.ts` | The scene's copy of the approved colour tokens, gated against `tokens.css`. |
| `input/keyboard.ts` | Key codes to intent, with the modifier and focus rules that stop gameplay stealing the browser's keys. Pure. |
| `input/pointer.ts` | Swipe recognition against the approved thresholds. Pure. |

### The presentation is art, with a primitive fallback under it

`assets.ts` names twenty prepared RGBA PNGs under `public/game/`. They are cut
and cleaned from the production-art development masters by
`tools/prepare-run-assets.py`, which is an authoring tool run by hand — nothing
in the build, in `app/` or in `game/` reads the reference directory, and
`scene.spec.ts` asserts that.

Whether those textures loaded is decided once, in `create()`, and the world and
the cast each build only the objects their chosen presentation needs. The
fallback is not a second design: it keeps the two obstacle classes
distinguishable by silhouette and colour so a failed download is a plain-looking
run rather than an unplayable one.

### The road is drawn in projection

Lane markings, paving, balusters and dressing are placed at fixed **world**
distances and projected, so their spacing compresses towards the vanishing
point. That compression is the forward-motion cue; evenly spaced marks under
converging edges read as a flat texture, which is what the earlier
near-orthographic playfield looked like.

Authoritative lane positions and collisions are untouched by any of it. The
domain reasons in lane indices and road units, `distanceScale` is clamped to the
playable range so a far obstacle never shrinks below a third of its near size,
and an illustration drawn at twice its size would still be hit at exactly the
same moment.

**The lazy import is load-bearing.** Phaser is 1.3 MB; a static import anywhere
would pull it into the entry chunk for every visitor who never plays, and drag a
`window`-dependent library into an SSR path. CI asserts that Phaser lives in
exactly one chunk, that nothing imports that chunk statically, that only the run
route imports it dynamically, and that
something imports it dynamically.
