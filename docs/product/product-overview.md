# Product Overview

**Status legend:** APPROVED / PROPOSED / OPEN — see [`../README.md`](../README.md).

## Identity — APPROVED

**Purrenade** = *Purr* + *Promenade*.

| Element | Role |
| --- | --- |
| **Purrenade** | The game, the world, and the IP. |
| **Ayşenur** | The primary star character. |
| **Loli** | Mascot and special gameplay companion. |
| **SLAYYY** | The signature power. |

The world is a **seaside promenade / festival**. The tone is soft, playful,
colorful, casual. Purrenade is *not* presented as "a cat game" — it is the brand
of a seaside arcade world, and the brand is independent of any single character.

## Product type — APPROVED

A **browser-first, mobile-first, responsive casual endless score-attack runner**.

- Three lanes, swipe/keyboard controls, survival scoring.
- Sessions are short and repeatable; the loop is "run → score → progress → run again".
- Authentication is **required**. This is not a guest-first product.

## Platforms — APPROVED

| Platform | v1 |
| --- | --- |
| Mobile web (primary) | Yes |
| Tablet web | Yes |
| Desktop web | Yes |
| Android / iOS native distribution | Not in v1, but **must remain possible**. No architectural decision may foreclose it. |

The "must remain possible" constraint has one concrete, load-bearing consequence:
the authentication transport cannot depend on same-site browser cookies alone.
See [ADR-0005](../decisions/ADR-0005-authentication-and-2fa-strategy.md).

## Audience and localization — APPROVED

Primary audience is Turkish-speaking; Turkish is the **source locale** for
player-facing copy. Player-facing product and game copy ships in:

- **Turkish (tr)** — source
- **English (en)**
- **Spanish (es)**

All repository technical documentation is **English only**.

Because the primary audience is Turkish, **KVKK applies** alongside GDPR. See the
backend's `docs/security/data-protection.md`.

## v1 scope — APPROVED

**v1 is the entire approved Claude Design v0.3 product surface** — all 21 screens,
authentication with 2FA, leaderboards, achievements, character unlocks,
session/device management, and the admin panel.

Scope is **not** reduced for convenience. It is also **not** implemented in a
single pass: delivery is broken into milestones with explicit dependencies,
acceptance criteria, tests and regression gates. See [milestones.md](milestones.md).

## v1 gameplay vocabulary — APPROVED

The v1 game teaches exactly four concepts. Nothing else is a gameplay verb.

| Concept | Verb |
| --- | --- |
| **Obstacle** | dodge (change lane) or jump |
| **Paw** | collect → fills progress toward **Loli Bonus** |
| **SLAYYY** | charge → activate |
| **Heart** | health |

This vocabulary is deliberately small so that a first-time player can be taught
the whole game in one tutorial. Concepts that appeared in design references but
were never approved as mechanics are recorded in
[deferred-design-exploration.md](deferred-design-exploration.md) and are **not**
implemented in v1.

## What is explicitly not in v1 — APPROVED

- **Çay (Tea)** as a speed boost. Not a functional pickup.
- **Trileçe** as an extra-life pickup. Not a functional pickup.
- Any healing mechanic. Maximum health is 3 and there is no way to regain a heart within a run.
- A combo system. (Brief: "no combo system in v1 unless later explicitly approved".)
- A swipe-down / slide mechanic.

## Success criteria — PROPOSED

These shape acceptance criteria but are not approved product targets.

| Criterion | Target |
| --- | --- |
| First meaningful interaction on mid-range mobile | under 3 s on a warm cache |
| Sustained frame rate during a run on mid-range mobile | 60 fps target, 30 fps floor |
| Tutorial completion rate for new players | high enough that the four verbs are understood before the first real run |
| Run-to-run retention loop | the paw progress bar is visible and advancing on the main menu after every run |

## Related documents

- [game-specification.md](game-specification.md) — the authoritative behavior specification
- [milestones.md](milestones.md) — how v1 is delivered
- [open-decisions.md](open-decisions.md) — what is still undecided
