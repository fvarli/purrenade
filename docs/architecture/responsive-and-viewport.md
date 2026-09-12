# Responsive and Viewport Behavior

**Status legend:** APPROVED / PROPOSED / OPEN.

---

## 1. Approved baselines — APPROVED

| Constant | Value | Source |
| --- | --- | --- |
| Mobile design baseline | **390 × 844** | All 21 v0.3 mobile artboards |
| Desktop protected play column | **460 px** | v0.3 desktop behavior board |
| Minimum touch target | **44 × 44** | v0.3 HUD controls |

v0.3 states the responsive intent directly:

> *"Masaüstünde oyun 460px'lik korunan bir şeritte akar; sahil çevresi dekoratif
> olarak genişler. Tablette şerit ekrana oranla büyür, mobilde tam ekran olur."*

— on desktop the game flows in a protected 460 px column while the seaside
surroundings expand decoratively; on tablet the column grows proportionally to
the screen; on mobile it is full-screen.

---

## 2. Form factors — APPROVED

| Form factor | Playfield | Surroundings |
| --- | --- | --- |
| **Mobile** | Full-bleed | None — the playfield is the screen |
| **Tablet** | Column scales proportionally to screen size | Decorative margins appear |
| **Desktop** | Fixed **460 px** protected column | Seaside environment expands to fill; side cards carry the keyboard legend and the next goal |

The playfield's **gameplay geometry never changes** across form factors. Lane
count, relative lane pitch, jump arc and obstacle timing are identical. Only the
pixel mapping and the decorative surroundings differ.

This is exactly why the game domain works in lane/longitudinal units and knows
nothing about pixels — see
[game-engine-integration.md](game-engine-integration.md) §3.

---

## 3. HUD parity — APPROVED

**Desktop and mobile must expose the same gameplay-critical state:**

- score,
- hearts,
- relevant Paw/Loli progress,
- SLAYYY state,
- pause.

Presentation may differ responsively; **gameplay information must not be lost**.

> The v0.3 desktop board shows only the score badge and pause. That is an
> **incomplete illustration, not intentional divergence** — see
> [`../product/design-reference-conflicts.md`](../product/design-reference-conflicts.md) #11.

**PROPOSED desktop placement:** hearts and paw progress sit in the side region
adjacent to the play column rather than overlaying it, which keeps the 460 px
playfield clear while satisfying parity. The mobile layout keeps them overlaid,
as in the v0.3 gameplay boards.

---

## 4. Orientation — PROPOSED

The design is **portrait-first**: a tall play column with a horizon at the top is
inherently portrait, and all 21 artboards are 390 × 844.

| Situation | Behavior |
| --- | --- |
| Mobile portrait | Full-bleed, as designed |
| Mobile landscape | Render the same portrait-proportioned column centred, with the environment filling the sides — i.e. treat it like a small desktop rather than stretching the playfield |
| Forced rotation | **Not used.** Locking orientation on the web is hostile and unreliable. |

**OPEN:** whether landscape mobile deserves a bespoke layout or is acceptable as
the letterboxed treatment above.

---

## 5. Safe areas and browser chrome — APPROVED

Mobile browsers are a hostile layout environment and the HUD sits at the screen
edges:

| Requirement | Detail |
| --- | --- |
| Safe-area insets | Respected on all four edges; no control under a notch, a home indicator, or a rounded corner |
| Dynamic viewport | Layout uses dynamic viewport units so a collapsing/expanding URL bar does not resize the playfield mid-run |
| No layout shift during a run | A URL bar change must not move the lanes |
| Gesture conflicts | Gameplay gestures never trigger scroll, pull-to-refresh, double-tap zoom, text selection, or back-swipe navigation |

The bottom edge is the most dangerous: the v0.3 mobile boards place the SLAYYY
meter and control hints there, which is exactly where the home indicator and
browser gesture areas live.

---

## 6. Scaling strategy — PROPOSED

| Element | Strategy |
| --- | --- |
| Playfield | Scaled to fit the play column, preserving aspect ratio. Never stretched. |
| Canvas resolution | Rendered at device pixel ratio, capped (PROPOSED at 2×) so high-DPR phones do not pay for pixels nobody sees |
| HUD | DOM, laid out responsively with relative units — not scaled as an image |
| Text | Never scaled as part of the canvas; always real text |

---

## 7. Breakpoints — PROPOSED

Content-driven rather than device-driven:

| Breakpoint | Behavior |
| --- | --- |
| `< 600px` | Mobile: full-bleed playfield, overlaid HUD, stacked menus |
| `600–1023px` | Tablet: proportional column, decorative margins begin |
| `≥ 1024px` | Desktop: fixed 460 px column, side regions active, keyboard legend shown |

---

## 8. Testing — PROPOSED

| Test | Purpose |
| --- | --- |
| Layout at 390 × 844 in the longest locale | The design baseline under translation pressure |
| HUD parity check at each breakpoint | Every gameplay-critical value is present |
| Safe-area simulation | No control is obscured on notched devices |
| Gesture isolation | No gameplay gesture scrolls, zooms, or navigates |
| 200% text scaling | Non-canvas UI survives |
| DPR cap | Frame rate holds on a high-DPR mid-range device |
