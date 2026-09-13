# `game/bridge` — the single typed boundary

The only place `game/domain` and `game/engine` meet.

| Direction | Payload |
| --- | --- |
| Engine → domain | Normalized `InputEvent`s. Raw swipes and key codes are normalized **in the engine**, before crossing. |
| Domain → engine | An immutable render snapshot in lane/longitudinal units — never the mutable state object, never pixels. |
| Domain/engine → app | Coarse run events only. |

## What is here, as of M5

| File | |
| --- | --- |
| `types.ts` | The three payloads, and nothing else. |
| `snapshot.ts` | `RunState` to a frozen render snapshot, and interpolation between two of them. |
| `loop.ts` | The fixed-step loop: variable frames in, whole simulation steps out. |

The loop lives here rather than in the engine because none of it is
Phaser-shaped, and because its two protections against a stalled tab — clearing
the accumulator on pause, and bounding catch-up — are worth testing in Node
rather than by backgrounding a browser tab and hoping.

Run events are deliberately coarse: `run_started`, `run_interactive`,
`phase_changed`. A UI that re-rendered on every lane change would be a UI
fighting a 120 Hz loop, and one that read gameplay state would eventually try to
write it. `HEART_LOST`, `SLAYYY_ACTIVATED`, `LOLI_STARTED` and `RUN_ENDED`
arrive with the milestones that own them.
