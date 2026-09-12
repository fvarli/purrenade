# Design Tokens

The locked visual vocabulary, extracted from **Claude Design v0.3**.

**Status: APPROVED** unless marked otherwise. v0.3 is authoritative for approved
visual decisions.

> **These values are the only palette.** The ChatGPT art-direction board publishes
> a different palette in which all six named tokens differ. Those values appear in
> [`../product/design-reference-conflicts.md`](../product/design-reference-conflicts.md) #1
> and **nowhere else** — never here, never in code.

---

## 1. Colour — APPROVED

### 1.1 Brand

| Token | Hex | v0.3 name | Role |
| --- | --- | --- | --- |
| `color.ink` | `#33272A` | mürekkep | Wordmark, body text, dark ground |
| `color.cream` | `#FFF6E9` | krem | Page ground |
| `color.coral` | `#FF6B4A` | mercan | `RR` in the wordmark, primary CTA ("OYNA") |
| `color.pink` | `#FF8FAB` | pembe | Paw, marks, SLAYYY world |
| `color.turquoise` | `#2EC4B6` | turkuaz | Wave, sea, secondary CTA |
| `color.yellow` | `#FFC93C` | sarı | Sun, highlight, record badge |

**Approved usage rule (v0.3 brand board):** ink → wordmark · coral → `RR` and
`OYNA` · pink → paw/marks · turquoise → wave · cream → ground.

### 1.2 Supporting

| Token | Hex | Role |
| --- | --- | --- |
| `color.textMuted` | `#8A7B70` | Secondary text |
| `color.surface` | `#F0E3D2` | Raised surface |
| `color.surfaceAlt` | `#E8D9C5` | Promenade / alternate surface |
| `color.surfaceSoft` | `#F3EADF` | Subtle fill |
| `color.border` | `#B9AFA6` | Hairlines and dividers |
| `color.pinkSoft` | `#FFE1E9` | Pink wash, SLAYYY ground |
| `color.pinkDeep` | `#D96A8C` | Pink emphasis |
| `color.turquoiseSoft` | `#7FD1C7` | Light wave |
| `color.mint` | `#D8EDDD` | Mint wash |
| `color.green` | `#6FBF8B` | Foliage, success |
| `color.greenDeep` | `#3E7D58` | Foliage shadow |
| `color.skySoft` | `#C9ECF2` | Sky |
| `color.coralDeep` | `#C3502F` | Coral shadow |
| `color.lilac` | `#C9A0E8` | Accent (sparing) |

### 1.3 Semantic aliases — PROPOSED

Components reference semantic tokens, never raw brand tokens, so a palette change
is a one-file change.

| Semantic | Maps to |
| --- | --- |
| `bg.page` | `color.cream` |
| `bg.surface` | `color.surface` |
| `text.primary` | `color.ink` |
| `text.secondary` | `color.textMuted` |
| `action.primary` | `color.coral` |
| `action.secondary` | `color.turquoise` |
| `state.slayyy` | `color.pink` + `color.lilac` |
| `state.loli` | `color.yellow` → orange range (Loli's magnet bar reads orange in v0.3) |
| `state.danger` | `color.coralDeep` |
| `state.success` | `color.green` |

### 1.4 Contrast — PROPOSED

Every semantic pairing is verified against **WCAG 2.2 AA** once, at the token
level, rather than per component. `color.textMuted` on `color.cream` and any
text on `color.yellow` are the pairings most likely to fail and must be checked
first. See [`../product/accessibility.md`](../product/accessibility.md).

---

## 2. Typography — APPROVED

| Token | Family | Role |
| --- | --- | --- |
| `font.display` | **Baloo 2** (weight 800) | Wordmark, screen titles, score |
| `font.body` | **Nunito** | UI text, body copy, buttons |

`JetBrains Mono` appears in the v0.3 canvas file; it is **design-tool chrome, not
product typography**, and is not adopted. (PROPOSED — confirm during M4 if any
product surface genuinely needs a monospace face.)

### 2.1 Font delivery — APPROVED

**Fonts are self-hosted.** The v0.3 reference page loads Baloo 2 from Google
Fonts; production must not, for both KVKK and performance reasons. See
[`../product/licensing-and-rights.md`](../product/licensing-and-rights.md) §5.

Subset to the character sets actually needed: Latin plus **Latin Extended** —
Turkish `ğ ı İ ş ç ö ü` and Spanish `á é í ñ ó ú ¡ ¿` are required.

### 2.2 Type scale — PROPOSED

Based on the 390 px design baseline.

| Token | Size / line | Usage |
| --- | --- | --- |
| `type.display` | 40 / 1.1 | Screen titles ("OYUN BİTTİ!") |
| `type.score` | 34 / 1.1 | Score readouts |
| `type.title` | 24 / 1.25 | Section headings |
| `type.bodyLg` | 17 / 1.45 | Buttons, primary copy |
| `type.body` | 15 / 1.5 | Default |
| `type.caption` | 13 / 1.4 | Secondary and helper text |
| `type.micro` | 11 / 1.3 | Labels, chips |

**Turkish casing:** never apply locale-blind `toUpperCase()` — `i` must become
`İ`. Uppercase headings are common in this design, so this is a real defect
source. See [`../product/localization.md`](../product/localization.md) §4.

---

## 3. Spacing, radius, elevation — PROPOSED

| Token | Value |
| --- | --- |
| Spacing scale | `4 · 8 · 12 · 16 · 24 · 32 · 48` |
| `radius.sm / md / lg / pill` | `8 · 14 · 22 · 999` |
| Elevation | Two levels only: resting card, raised dialog. Soft, low-contrast shadows in keeping with the casual tone. |

The v0.3 boards are heavily rounded; `radius.pill` is the default for primary
actions.

---

## 4. Layout constants — APPROVED

| Token | Value | Source |
| --- | --- | --- |
| `layout.baselineViewport` | **390 × 844** | 21 v0.3 mobile artboards |
| `layout.desktopPlayColumn` | **460 px** | v0.3 desktop board |
| `layout.minTouchTarget` | **44 × 44** | v0.3 HUD controls; accessibility minimum |

See [responsive-and-viewport.md](responsive-and-viewport.md).

---

## 5. Motion — PROPOSED

| Token | Value |
| --- | --- |
| `motion.fast` | 120 ms |
| `motion.base` | 200 ms |
| `motion.slow` | 320 ms |
| `motion.easeOut` | standard decelerate |
| `motion.playful` | slight overshoot, for celebratory moments only |

**Every motion token is gated by the reduced-motion setting.** See
[`../product/accessibility.md`](../product/accessibility.md) §2.

---

## 6. Iconography and motif — APPROVED

- Motif language is **paw + wave**, used sparingly: dividers, loading, progress.
- **✦ / ✨ belongs to SLAYYY alone** and is not part of the normal Purrenade brand
  language.
- The compact mark (paw + wave) requires no character face — the brand is
  independent of the characters. Sizes: 96 · 64 · 40 · 24 px.

---

## 7. Implementation rule — APPROVED

Tokens are declared **once**, in one module, and consumed by both CSS and the
game engine. A colour used by a Phaser scene and a colour used by a Vue component
are the same token, not two literals that happen to match today.

No component, scene, or stylesheet contains a raw hex value.
