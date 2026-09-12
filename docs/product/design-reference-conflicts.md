# Design-Reference Conflict Register

Every conflict and ambiguity found across the design references, with its
resolution. **A conflict that cannot be resolved by the rules is reported here,
not invented around.**

**Last full review:** 2026-09-12, against `design-reference/` as it stood at that
date (Claude Design v0.3 and ChatGPT Art Direction Board v1).
**Last decision pass:** 2026-09-12 (M0.6) — #10, #13, #14 and #15 resolved; #16 partially
resolved, with a complete catalogue proposed and awaiting approval.

---

## Conflict rules

1. The **written Product/Game Specification** wins for behavior.
2. **Claude Design v0.3** wins for approved UX/UI and visual decisions.
3. **Approved production assets** win over illustrative mockups.
4. The **ChatGPT Art Direction Board** is aspirational, not literal.
5. **Private source photographs** are reference-only and remain local.
6. If a conflict cannot be resolved with these rules, **stop and report it**.

---

## A. Resolved — by the conflict rules, or by product decision

These are settled. They are recorded so the losing variant cannot re-enter the
product by accident.

### #1 — Palette divergence · RESOLVED

The ChatGPT board publishes a named palette in which **all six tokens differ**
from v0.3.

| Token | ChatGPT board | **v0.3 (authoritative)** |
| --- | --- | --- |
| Krem / cream | `#FFF8F0` | **`#FFF6E9`** |
| Mercan / coral | `#FF7B6B` | **`#FF6B4A`** |
| Pembe / pink | `#FFB6C1` | **`#FF8FAB`** |
| Turkuaz / turquoise | `#4ED1C5` | **`#2EC4B6`** |
| Mint yeşil / mint | `#D7F3E3` | **`#D8EDDD`** |
| Koyu / ink | `#2B2A33` | **`#33272A`** |

**Resolution:** v0.3 values are the locked design tokens. The ChatGPT hex values
appear in this register and **nowhere else** — never in
[`../architecture/design-tokens.md`](../architecture/design-tokens.md), never in code.

### #2 — Wordmark · RESOLVED

ChatGPT shows a mixed-case script "Purrenade" with a paw replacing part of the
`P`. v0.3 specifies uppercase `PURRENADE`, Baloo 2 based, coral `RR`, wave + paw
terminal, single ✦.

**Resolution:** v0.3.

### #3 — Camera and perspective · RESOLVED — **highest engineering impact**

ChatGPT boards 9 and 10 show a **behind-the-back, converging-perspective** runner.
v0.3's gameplay boards and the desktop board show **three parallel,
near-orthographic lanes with a fixed horizon** and the character facing the camera.

**Resolution:** v0.3.

**Why it matters:** the approved composition is achievable with straightforward
2D scrolling in Phaser. The art-board framing would require faux-3D lane
projection with per-depth sprite scaling — a different renderer architecture, a
different art pipeline, and a different collision model. This must be settled
before any engine work begins.

### #4 — Menu presentation · RESOLVED

ChatGPT shows wooden signpost menu items; v0.3 uses standard buttons.

**Resolution:** v0.3.

### #5 — Çay and Trileçe · RESOLVED as non-mechanics

v0.3 board 2a labels 🫖 Çay as *"kısa hız desteği"* (short speed boost) and
🍰 Trileçe as *"ekstra can"* (extra life).

**Resolution:** these are **not approved gameplay mechanics**. They are
personalized concepts and reference elements that appeared in the approved visual
design; their gameplay behavior was never approved. They are **not implemented in
v1 in any functional form**. See
[deferred-design-exploration.md](deferred-design-exploration.md).

*Note:* two of the six defined achievements depend on collecting them. That
consequence is tracked in
[achievements-and-unlocks.md](achievements-and-unlocks.md) §1.3.

### #7 — Hearts appear restored during SLAYYY · RESOLVED

v0.3 board 10 shows ❤️❤️🖤 (2 of 3); board 11, SLAYYY active, shows ❤️❤️❤️;
board 10b returns to ❤️❤️🖤.

**Resolution:** an **illustrative inconsistency in the mockup**, not gameplay
behavior. **SLAYYY does not heal.** Run starts at 3 hearts, maximum health is 3,
a normal collision removes one heart, and **no healing mechanic exists in v1**.

### #8 — SLAYYY activation control · RESOLVED

v0.3 board 10 renders `✨ ▬▬▬ SLAYYY` as a bottom bar, and the board's desktop
keyboard legend defines no key for it. Whether it was a meter, a button, or a
meter that becomes a button was ambiguous.

**Resolution:** **SLAYYY is manually activated and never auto-fires.** On mobile
the element shows charge progress while charging and, when full, exposes an
obvious accessible activation affordance. On desktop, **`E`** activates it when
ready, and the on-screen control is also clickable. Charge-rate tuning remains
PROPOSED.

### #9 — Paw counters · RESOLVED

Five different paw presentations appear across v0.3: in-run `🐾 128`, in-run
`🐾 200/200 ✓`, menu `🐾 128 / 200`, game over `+18 🐾`, profile `🐾 PATİ 1.284`.

**Resolution:** three distinct concepts, named distinctly everywhere:
`lifetimePaws`, `loliCyclePaws` (0..199, threshold 200), `runPaws`. Crossing the
threshold triggers one bonus per completed threshold, consumes 200, and preserves
overflow. Magnet-collected paws count normally. See
[scoring-and-progression.md](scoring-and-progression.md) §2.

### #11 — Desktop HUD omits hearts and paw counter · RESOLVED

The v0.3 desktop board shows only the score badge and pause.

**Resolution:** an **incomplete illustration, not intentional divergence**.
Desktop and mobile must both expose score, hearts, Paw/Loli progress, SLAYYY
state and pause. Presentation may differ responsively; gameplay-critical
information may not be lost.

### #12 — Tutorial has no v0.3 design · PARTIALLY RESOLVED

The approved brief mandates an interactive tutorial; no v0.3 screen covers it.

**Resolution:** tutorial **behavior is APPROVED** and specified in
[tutorial.md](tutorial.md). Its **visual presentation is OPEN** and requires a
design treatment **before M8**. No visual design was invented.

---

## B. Unresolved — require a product decision

These cannot be settled by the conflict rules. They are **OPEN**.

### #6 — Brand tagline · OPEN

*"Run Cute. Live Bright."* appears on the ChatGPT board, in the primary wordmark
lockup, on the splash mock, and in the app-icon examples. It appears **nowhere in
v0.3**.

Rule 4 makes the art board non-authoritative, but a tagline is brand copy rather
than art direction, so its absence from v0.3 is not proof it was rejected.

**Question:** is there an approved tagline? If so, is it localized?

### #10 — Audio controls contradict each other **inside** v0.3 · **RESOLVED (M0.6)**

| Screen | Control form |
| --- | --- |
| Board 12, Pause | **Volume sliders** for Müzik and Efektler |
| Board 18, Settings | **On/off toggles** for Müzik and Ses Efektleri |

Both are v0.3, so rule 2 cannot arbitrate. **Question:** volume levels or on/off?
The answer changes the settings schema and the audio implementation.

**Resolution: Option C, APPROVED.** Settings owns **music and SFX volume sliders**; Pause
exposes **quick music and SFX mute/unmute**. **Mute state is independent of volume**, so
unmuting restores the previous non-zero level.

Because v0.3 contradicts itself, every possible resolution deviates from at least one board.
Option C deviates from **both** — and was approved knowingly on that basis, as a deliberate
v0.3 deviation. Detail in [screen-inventory.md](screen-inventory.md) §7A.

### #13 — Character unlock criteria are semantically ambiguous · **RESOLVED (M0.6)**

`2.500 puan` (best run or lifetime?), `10 koşu` (any runs or qualifying runs?),
`Loli Bonusu ×3` (lifetime or single run?).

**Resolution, APPROVED:**

| Character | Criterion |
| --- | --- |
| Büşo | Best **accepted** single-run score ≥ 2,500 |
| Ogito | Complete **10 accepted runs** — **no** separate minimum-duration criterion; run acceptance is decided by the run-validation system |
| Sero | **3 lifetime *actual* Loli Bonus activations** — threshold crossings and queued-but-never-started bonuses do not count |

Evidence for each is in [achievements-and-unlocks.md](achievements-and-unlocks.md) §2.2. The
alternative-reading counters are retired.

### #14 — "Ramak Kala" implies an unspecified near-miss mechanic · **RESOLVED (M0.5)**

Appeared as an achievement ("survive 50 near misses") and as a game-over chip
("Ramak Kala +1 ▲"), while the approved Core Run brief contained no near-miss mechanic.

**Resolution:** near miss is now an **APPROVED v1 statistic mechanic**. A near miss occurs when
the player safely passes within a defined danger envelope of an obstacle without collision; at
most **one event per obstacle**; it awards **no score and no multiplier**; detection is
deterministic and testable; and leaderboard-relevant achievement progress from it must be
server-verifiable from accepted run telemetry. See [core-run.md](core-run.md) §5A.

The geometric threshold remains PROPOSED tuning. The v0.3 game-over chip is consistent with
this reading: it displays a **statistic**, not a score bonus.

### #15 — Obstacle traversal rules · **RESOLVED (M0.5)**

The v0.3 splash tip reads *"koniler kaydırarak geçilir"* — cones are passed **by swiping**.
That made the only approved obstacle lane-only, leaving the approved jump verb with nothing to
jump over.

**Resolution:** v1 supports **two semantic obstacle classes**, kept separate from visual assets:

| Class | v1 instance | Avoided by |
| --- | --- | --- |
| `LANE_BLOCKING` | Traffic cone | lane change |
| `JUMPABLE` | Low seaside / beach barrier | jump |

The v0.3 tip is **correct and preserved** — cones really are lane-only. The gap was that no
second class existed, not that the tip was wrong. See
[difficulty-and-obstacles.md](difficulty-and-obstacles.md) §3.1.

**The pattern library is no longer blocked.**

### #16 — The achievement catalogue was incomplete and partly invalid · **PARTIALLY RESOLVED (M0.5)**

v0.3 showed `8/16` unlocked but named only six, two of which depended on the non-mechanics
from #5.

**Resolved:**
- **Çay Molası** and **Trileçe Avcısı** are **removed as invalid** — they require mechanics
  that do not exist in v1.
- **Koni Koleksiyoncusu** ("hit 25 cones") is **superseded by product review**: it rewards
  intentional collision, which the achievement authoring constraints forbid. Replacement
  proposed as `cone_dodger`.

**Still open:** a **complete 16-item catalogue is now PROPOSED** and needs approval as a whole.
See [achievements-and-unlocks.md](achievements-and-unlocks.md) §1.5. This is no longer an
authoring gap; it is a review item.

### #17 — English and Spanish copy does not exist · OPEN

All v0.3 copy is Turkish. Two sample strings exist in the other locales. Turkish
is the source locale; en/es copy must be authored.

### #18 — Likeness and consent · OPEN

Characters are named after real people (Ayşenur, Büşo, Ogito, Sero) and a real
cat (Loli); v0.3 states final art derives from photo reference and that friends'
characters unlock "when the artwork is added".

**Questions:** is documented consent held for each likeness? Does it cover
commercial use, app-store distribution, and the eventual licensing model? See
[licensing-and-rights.md](licensing-and-rights.md).

---

## C. Decisions v0.3 makes that the written brief did not

Not conflicts — gaps the design filled. Promoted to APPROVED and recorded so
their provenance is traceable.

| Decision | Source |
| --- | --- |
| Email verification is a **6-digit code** with a resend countdown, not a magic link | Board 04 |
| Password reset is an **emailed link** | Board 06 |
| 2FA is **TOTP with backup codes**; recommended for all, **mandatory for admin** | Board 05, board 20 |
| The **admin panel is a separate plain interface** that does not adopt the game identity | Board 20 note |
| **Active session/device management** exists, including logout-all | Board 20 |
| A **reduced-motion** setting exists | Board 18 |
| Leaderboard has **weekly and all-time** windows, a crown on rank 1, and a pinned "you" row | Board 15 |
| Language switching is available **before** authentication | Board 03 |
| Text is **never baked into images**; switching is instant; layouts tolerate long translations | Board 19 note |
| Desktop runs the playfield in a **protected 460 px column** | Desktop board |

---

## D. Reference-material handling notes

- The v0.3 standalone HTML is a **design-canvas bundle** containing 21 mobile
  artboards at 390 × 844, one desktop artboard, three SVG components, an inlined
  Google Fonts payload and a React UMD build. It is **reference material only**:
  never built, never bundled, never served, and its font-loading pattern is not
  copied into production.
- `design-reference/private-source/` does not currently exist and is excluded by
  `.gitignore`. It must remain excluded.
