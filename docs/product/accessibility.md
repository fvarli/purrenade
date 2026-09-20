# Accessibility

**Status legend:** APPROVED / PROPOSED / OPEN.

---

## 1. What is approved — APPROVED

Claude Design v0.3 board 18 includes a **"Azaltılmış hareket" (reduced motion)**
setting, described as "calms the animations". It is a first-class product
setting, not a browser-only preference.

---

## 2. Reduced motion — APPROVED behavior, PROPOSED scope

### 2.1 Resolution — PROPOSED

The effective setting is: **the player's explicit choice if made, otherwise the
OS/browser `prefers-reduced-motion` preference.** A player who has already told
their device they want less motion should not have to say it again.

### 2.2 What it affects — PROPOSED

| Surface | Reduced-motion behavior |
| --- | --- |
| UI transitions | Cross-fade or instant instead of slide/scale |
| Achievement unlock celebration | No confetti, no badge spin; a static badge with a brief highlight |
| New-high-score screen | No confetti; the record dance still plays as it carries meaning |
| SLAYYY world transformation | Transition is a fade rather than a bloom/sparkle burst |
| Post-hit invulnerability blink | Slower, lower-contrast pulse instead of a 10 Hz blink |
| Parallax and decorative background motion | Reduced or stopped |
| **Core gameplay scroll** | **Unchanged.** The road must keep scrolling or there is no game. |

The line is: **motion that carries gameplay information is preserved; motion that
is decoration or celebration is reduced.**

### 2.3 Photosensitivity — PROPOSED

The post-hit blink at 10 Hz sits inside the range associated with
photosensitive seizures. Two rules follow regardless of the reduced-motion
setting:

1. No full-screen flashing above 3 Hz.
2. The blink is a **partial-alpha pulse on the character sprite**, not a
   full-screen luminance flash.

---

## 3. Accessibility outside the canvas — APPROVED

The approved brief requires accessibility outside the canvas wherever possible.
Menus, authentication, settings, profile, leaderboard and achievements are
ordinary interactive UI and are held to ordinary standards:

| Requirement | Detail |
| --- | --- |
| Semantics | Real semantic elements and accessible names, not styled `div`s |
| Keyboard | Every interactive control reachable and operable by keyboard, with a visible focus indicator |
| Focus management | Focus moves predictably on navigation and into/out of dialogs; dialogs trap focus and restore it on close |
| Screen reader | Meaningful labels; decorative imagery hidden from assistive technology |
| Live regions | Verification-code errors, resend countdowns and form errors are announced |
| Contrast | Text and essential UI meet WCAG 2.2 AA (4.5:1 body, 3:1 large text and essential graphics) |
| Touch targets | Minimum 44 × 44 CSS px, which the v0.3 boards already use for HUD controls |
| Zoom and text scaling | Layouts survive 200% text scaling without loss of function |

### 3.1 The SLAYYY control — APPROVED

The armed SLAYYY control is a **real, focusable, labelled control**, not a
decorative bar with a tap handler. Its accessible name communicates both state
and action ("SLAYYY ready — activate"), and its armed state is announced. A
player who cannot perceive the meter filling must still be able to know the power
is available.

---

## 4. The canvas — PROPOSED

A canvas-rendered action game cannot be made fully screen-reader operable, and
pretending otherwise helps nobody. What is achievable:

| Requirement | Approach |
| --- | --- |
| The canvas is labelled | An accessible name and role describing what it is |
| Gameplay state is available as text | Score, hearts, paw progress and SLAYYY state exist as DOM elements outside the canvas, not only as drawn pixels |
| Full keyboard play | Already required on desktop (§ core-run); no action requires a pointer |
| Pause is always reachable | By keyboard (`Esc`) and by a real button |
| No colour-only meaning | Hearts, SLAYYY state and paw progress are distinguishable by shape/number, not hue alone |

### 4.1 Colour independence — PROPOSED

The palette leans heavily on pink/coral/turquoise. Every gameplay-critical
distinction must survive colour-vision deficiency:

- hearts are countable shapes, not a colour bar;
- the SLAYYY meter shows a numeric or fill-proportion cue, not only a hue change;
- the Loli magnet bar is distinguishable from the SLAYYY bar by **position and
  label**, not only by being orange rather than pink.

---

## 5. Audio — PROPOSED

- **No gameplay information is conveyed by audio alone.** Every audio cue has a
  visual counterpart. A muted player must lose nothing but atmosphere.
- Music and sound effects are independently controllable (form **OPEN** — see
  [conflict #10](design-reference-conflicts.md)).
- Audio never autoplays before a user gesture, which mobile browsers enforce anyway.

---

## 5A. A measured contrast failure in the locked tokens — found at M7

`--text-secondary` (`--color-text-muted`, `#8a7b70`) does not reach the AC-1
target at body and caption sizes:

| Foreground on | Ratio | AA small text needs |
| --- | --- | --- |
| `--bg-page` (`#fff6e9`) | **3.81 : 1** | 4.5 : 1 |
| `--color-white` | **4.08 : 1** | 4.5 : 1 |
| `--color-surface` (`#f0e3d2`) | **3.23 : 1** | 4.5 : 1 |

At 13 px — `--type-caption`, where the token is most used — none of these is
large text, so 4.5 : 1 applies and all three fail. §6 already asks for a
"contrast check against the locked tokens"; this is that check, run for the
first time, and the token does not pass it.

**M7 fixed only what M7 introduced.** The two new HUD usages — the score label
and the SLAYYY control — were moved to `--color-ink` (13.4 : 1 and 11.7 : 1).

**Milestone B did the same.** The reconstructed heads-up display and its two
desktop side cards were measured against this table rather than eyeballed, and
two new labels failed it — the card titles at **3.07 : 1** on cream and the
next-goal note at **2.69 : 1** on `--color-pink-soft`, both at `--type-micro`.
Both moved to `--color-ink` (13.4 : 1 and 11.7 : 1) before the milestone closed.
`--color-pink-deep` is a fine colour for a rim, a border or a meter fill, and it
is not a colour for 11 px text on a pale ground.
The token itself is used in **nine** files across the authentication and account
surfaces, and re-deriving a locked colour for all of them is a palette decision
and a milestone of its own, not a side effect of a scoring milestone. **M12 owns
accessibility** and owns this.

Known remaining instances at M7: `.run__status` on the run route, plus
`LocaleSwitcher`, `AuthField`, `PasswordField`, `SessionRow`,
`account/security` and `admin/index`.

---

## 6. Testing — PROPOSED

| Test | Purpose |
| --- | --- |
| Automated audit on every non-canvas screen | Catches contrast, naming and semantics regressions |
| Keyboard-only traversal | Every flow completable without a pointer |
| Reduced-motion snapshot | The setting demonstrably changes behavior, including inside the canvas |
| Contrast check against the locked tokens | Run once per token change, not per component |
| 200% text-scale layout | At the 390 px baseline |

---

## 7. Open questions owned by this document

| Ref | Question |
| --- | --- |
| AC-1 | Target conformance level — PROPOSED WCAG 2.2 AA for non-canvas UI |
| AC-2 | Is there a colour-blind-friendly palette variant, or is colour independence achieved structurally? (PROPOSED: structurally) |
| AC-3 | Is there a low-motion gameplay variant beyond decoration reduction? |
| AC-4 | Are subtitles/captions needed for any audio? (None is known to carry meaning) |
| AC-5 | `--text-secondary` fails AA at caption and body sizes (§5A). Does the token get re-derived, or does every small-text usage move to `--color-ink`? |
