# `game/bridge` — the single typed boundary

The only place `game/domain` and `game/engine` meet.

| Direction | Payload |
| --- | --- |
| Engine → domain | Normalized `InputEvent`s. Raw swipes and key codes are normalized **in the engine**, before crossing. |
| Domain → engine | An immutable render snapshot in lane/longitudinal units — never the mutable state object, never pixels. |
| Domain/engine → app | Coarse run events only. |

Implementation begins at **M5**. Empty at bootstrap by design.
