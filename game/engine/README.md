# `game/engine` — Phaser adapter

Owns scenes, sprites, input capture and rendering. **Holds no gameplay state the
domain does not have, and makes no gameplay decision.**

If the engine decides whether a collision costs a heart, the domain is no longer
authoritative and determinism is lost.

Implementation begins at **M5**. Empty at bootstrap by design.
