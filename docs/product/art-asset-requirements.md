# Art Asset Requirements

What production art must exist, derived from Claude Design v0.3. This document
specifies **requirements**, not artwork.

**Status legend:** APPROVED / PROPOSED / OPEN.

---

## 1. Character animation states — APPROVED

v0.3 board "character-and-loli-animation-language" defines the required states.

### 1.1 Ayşenur — 7 states

| State (tr) | State (en) | Used by |
| --- | --- | --- |
| Seçim / Selam | Selection / greet | Character selection |
| Bekleme | Idle | Menu, run-start readiness beat |
| Koşu | Run | Core run |
| Zıplama | Jump | Core run |
| Çarpışma / Ağlama | Collision / cry | Collision, game over |
| Rekor Dansı | Record dance | New high score |
| SLAYYY | SLAYYY | SLAYYY active |

### 1.2 Loli — 5 states

| State (tr) | State (en) | Used by |
| --- | --- | --- |
| Bekleme | Idle (mildly disinterested) | Menu presence |
| Bonus Girişi | Bonus entry ("puf") | Loli Bonus start |
| Takip / Koşu | Follow / run | Loli Bonus active |
| Mutlu / Ödül | Happy / reward | Loli Bonus reward beat |
| Çıkış | Exit ("puf") | Loli Bonus end |

v0.3 notes Loli's real-life reference: long white fur, orange head and tail, a
spot beside the nose. It also notes the intended implementation — **a single
sprite plus a follow curve** — which keeps the companion cheap to run.

---

## 2. Character art is placeholder — APPROVED

v0.3 marks the character drawings as *"temsili"* (representative): **the final
illustration is to be produced from photo reference.** The repository now has
character **production-art development masters** under
`design-reference/production-asset-development/characters/`; they are canonical
visual-development references/candidates, not final runtime production character
art. They do not replace the required rights-safe redraw/extraction, state
selection, animation timing, atlas production and approval.

**Non-negotiable:** private source photographs are reference material for the
illustrator only. They are never committed, published, bundled, served, or used
as downloadable production assets. See
[licensing-and-rights.md](licensing-and-rights.md).

---

## 3. World and gameplay art — APPROVED / OPEN

| Asset | Status |
| --- | --- |
| Promenade road surface with three lanes and lane markings | APPROVED composition; art OPEN |
| Sea horizon band, sky, sun | APPROVED composition; art OPEN |
| Decorative seaside dressing (umbrellas, benches, palms, boats, lamp posts) | APPROVED as decoration; needed especially for the desktop side areas |
| **Traffic cone** — `LANE_BLOCKING` | **APPROVED** |
| **Flower** — the cone's SLAYYY variant | **APPROVED**. A visual variant only; the class is unchanged. |
| **Low seaside / beach barrier** — `JUMPABLE` | **APPROVED (M0.5)**. The v1 art for the jump verb. |
| SLAYYY variant of the beach barrier | **OPEN** — needed, but undesigned |
| Paw Token collectible | APPROVED |
| Further obstacle art | **Not required for v1.** Two classes, two instances. See [difficulty-and-obstacles.md](difficulty-and-obstacles.md) §3.1. |
| SLAYYY world transformation set | APPROVED in intent; the full list of what transforms is OPEN |

The gameplay and world development masters illustrate additional obstacles,
collectibles and transformations. Those drawings do **not** expand this v1
catalogue or change its classes: cone remains `LANE_BLOCKING`; the low beach
barrier remains `JUMPABLE`; Paw Token remains the sole v1 collectible mechanic.

---

## 4. Brand assets — APPROVED

| Asset | Detail |
| --- | --- |
| Primary wordmark | `PURRENADE`, Baloo 2 based, bouncing setting, coral `RR`, wave + paw terminal, single ✦ |
| Dark-ground wordmark | Cream letters, yellow `RR`, light turquoise wave |
| Compact mark | Paw + wave. Used for favicon, PWA and app icon at 96 / 64 / 40 / 24 px |
| Motif language | Paw and wave, used sparingly as dividers and loading states; **✦/✨ belongs to SLAYYY alone** and is not part of the normal brand language |

The compact mark **requires no character face** — the brand is independent of the
characters.

> The ChatGPT art-direction board shows a different, mixed-case script wordmark.
> v0.3 wins. See [design-reference-conflicts.md](design-reference-conflicts.md) #2.

---

## 5. UI assets — APPROVED

Hearts (full and empty), paw counter icon, SLAYYY meter, Loli magnet bar, pause
glyph, crown for leaderboard rank 1, achievement badges (16), locked-state badge,
character portraits and locked portraits, avatar placeholder.

---

## 6. Technical requirements — PROPOSED

| Requirement | Value |
| --- | --- |
| **Class over artwork** | Every obstacle asset declares the behaviour class it belongs to (`LANE_BLOCKING` or `JUMPABLE`). Art variants reuse a class; art never defines behaviour. |
| Delivery format | Texture atlases for gameplay sprites; standalone assets only for UI that is not drawn to the canvas |
| Density | Authored at 3× the 390 px baseline so it holds up on high-density phones and on the 460 px desktop column |
| Animation | Frame-based sprite sheets, with consistent frame timing metadata |
| Naming | `{actor}-{state}-{frame}`; states use the English names in §1 |
| **Text in art** | **Prohibited.** All copy is localizable text rendered over art — see [localization.md](localization.md) |
| Fonts | **Self-hosted.** v0.3's reference page loads Baloo 2 from Google Fonts; production must not, for both KVKK and performance reasons |
| Budget | A per-screen and per-run asset budget is set in [`../architecture/asset-strategy.md`](../architecture/asset-strategy.md) |

Development masters may contain explanatory text, HUD examples and visual
measurements because they are specifications, not delivery assets. None of that
content may be cropped into runtime art; the HUD remains DOM-based under
[`../architecture/game-engine-integration.md`](../architecture/game-engine-integration.md).

---

## 7. Audio assets — OPEN

v0.3 references menu and run music, and effects for jump, paw, SLAYYY and crying.
No audio asset list, format, or licensing is specified anywhere. **OPEN.**

---

## 8. Open questions owned by this document

| Ref | Question |
| --- | --- |
| AA-1 | SLAYYY visual variant for the `JUMPABLE` beach barrier (§3) — the cone already has one |
| AA-2 | Full SLAYYY transformation set (§3) |
| AA-3 | Audio asset list, formats and licensing (§7) |
| AA-4 | Who produces the production character art, and on what schedule |
| AA-5 | Achievement badge art for all 16, including the ten undefined achievements |
| AA-6 | Avatar system — uploaded, generated, or initials-based |
