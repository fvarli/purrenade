# Deferred Design Exploration

Concepts that appear in approved visual design but are **not approved gameplay
mechanics**, and are therefore **not implemented in v1**.

This document exists so that appearing in a design board is never mistaken for
being specified behavior.

---

## 1. Çay (Tea) and Trileçe

### 1.1 Status — APPROVED decision

**Çay and Trileçe are NOT approved gameplay mechanics.**

They are **personalized concepts and reference elements** that appeared in the
approved visual design. Their gameplay behavior was never approved.

For v1:

- **Paw Tokens** are the primary regular collectible.
- **Loli Bonus** is the collection/companion reward system.
- **SLAYYY** is the signature power system.
- **Do not implement Tea as a speed boost.**
- **Do not implement Trileçe as an extra-life pickup.**
- **Do not let their appearance in Claude Design override the written gameplay
  specification.**

Tea and Trileçe may remain as **visual/personalization concepts** in design
references, but they must not appear as **functional v1 gameplay pickups** unless
explicitly specified later.

### 1.2 What the design board actually said

Claude Design v0.3 board 2a lists them alongside the Paw Token:

| Element | Label in v0.3 |
| --- | --- |
| 🐾 Pati Jetonu | normal collectible · 200 paws = Loli Bonus |
| 🫖 Çay | *dönemsel ödül · kısa hız desteği* — periodic reward · short speed support |
| 🍰 Trileçe | *dönemsel ödül · ekstra can* — periodic reward · extra life |

### 1.3 Why they are deferred

**Vocabulary economy.** v1 already carries two strong bespoke systems — Paw → Loli
(collection/companion) and SLAYYY (survival + score power). Adding two more
pickups crowds the first release's gameplay economy. The v1 vocabulary stays at
four concepts precisely so a first-time player can be taught the whole game in one
tutorial:

```
Obstacle → dodge / jump
Paw      → collect → Loli
SLAYYY   → charge → activate
Heart    → health
```

**Trileçe → extra life blurs the heart rule.** Is 3 the maximum or can it become
4? What happens when it is collected at full health? How does its spawn RNG affect
leaderboard fairness? None of that is answered, and the answer changes a core
invariant.

**Çay → speed boost is worse.** In an endless runner a "speed increase" looks like
a reward while actually interacting with obstacle timing, spawn distance, jump
windows and difficulty tiers. The difficulty system already raises speed
deliberately and under a soft cap; a pickup that raises it again from outside that
system undermines the curve and the escape-path guarantee at once.

### 1.4 Consequence: two achievements cannot ship as written

Two of the six achievements defined in v0.3 depend on these non-mechanics:

- **Çay Molası** — collect 3 teas in one run
- **Trileçe Avcısı** — collect 10 trileçe

This is tracked as an OPEN decision in
[achievements-and-unlocks.md](achievements-and-unlocks.md) §1.3, to be resolved
together with the ten undefined achievements.

### 1.5 If revisited after v1

Before any implementation, their mechanics must be designed against:

- **scoring** — how a boost or an extra life interacts with score rate and the ×2 multiplier,
- **difficulty** — how a speed change composes with the soft-capped curve,
- **leaderboard fairness** — whether spawn RNG can decide a ranking,
- **spawn balance** — frequency, placement, and interaction with pattern generation,
- **the fixed heart model** — whether maximum health may exceed 3 at all.

They may also turn out to be better used as **achievement themes, cosmetics, or
seasonal/event items** than as pickups. That is a live option, not a fallback.

---

## 2. Other concepts explicitly not in v1

| Concept | Why it is here |
| --- | --- |
| **Combo system** | The approved brief states: no combo system in v1 unless later explicitly approved. |
| **Swipe-down / slide** | The approved brief states there is no swipe-down/slide mechanic in v1. The tutorial must not imply one exists. |
| **Healing of any kind** | Maximum health is 3 and nothing restores a heart during a run. |
| **Per-character special powers** | Ayşenur's card lists `özel güç: SLAYYY`, which hints at per-character powers. Nothing specifies them. PROPOSED: all characters share SLAYYY in v1. |
| **Revive / continue after death** | The game-over screen offers only play-again and menu. |

---

## 3. Rule

**Appearing in a design reference is not approval.** A mechanic exists when the
written Product/Game Specification says it exists. Anything else is atmosphere,
personalization, or a proposal — and belongs in this document until it is
specified.
