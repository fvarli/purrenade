# ADR-0007 — Localization strategy

- **Status:** Accepted
- **Scope:** Product-wide
- **Date:** 2026-09-12
- **Decision owner:** Product owner

## Context

Player-facing product and game copy ships in **Turkish, English and Spanish**.
All repository technical documentation is **English only**.

Claude Design v0.3 states the product constraint directly (board 19):

> *"Dil anında değişir — metinler görsellere gömülmez, kutular uzun çevirilere
> toleranslıdır."*

The language switcher appears on the **login screen**, before any session exists.
All approved copy is Turkish; only two sample strings exist in the other locales.

## Decision

1. **Turkish is the source locale.** English and Spanish are authored
   translations of it, not the reverse.
2. **No text is baked into images** — in the DOM or on the canvas. HUD labels,
   tutorial prompts, SLAYYY and Loli banners and run-end copy are localized text
   rendered over art.
3. **Language changes instantly** — no reload, no re-login, no restart.
4. **Layouts tolerate long translations**, verified at the 390 px baseline.
5. **Locale resolution order (PROPOSED):** authenticated profile → device
   preference → `Accept-Language` → Turkish. Changing it while signed in writes
   both the profile and the device mirror.
6. **Server-side copy is localized too.** Transactional emails use the player's
   **profile locale**, not the requesting device's. Every request carries the
   active locale.
7. **API errors carry a stable machine-readable code** plus an optional localized
   message. **The client never parses human-readable text to make a decision.**
8. **Brand terms are not localized:** `PURRENADE`, `SLAYYY`, and the character
   names Ayşenur, Loli, Büşo, Ogito, Sero.
9. **Formatting uses the platform internationalization API** for numbers, dates,
   relative times and plurals. Never hand-rolled.
10. **Turkish casing is handled locale-aware.** `i` → `İ`. Locale-blind
    `toUpperCase()` is prohibited on player-facing strings — the design uses
    uppercase headings heavily, so this is a live defect source.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| **English as the source locale** | All approved copy is Turkish, the primary audience is Turkish, and the voice is idiomatically Turkish. Translating to English first and back would lose the product's tone at the first hop. |
| **Text baked into art** | Explicitly prohibited by the approved design constraint, and it would make three locales three art sets. |
| **Reload on language change** | Contradicts "changes instantly" and would destroy a run in progress. |
| **Localized API error messages only** (no codes) | Forces the client to parse prose, which breaks the moment wording changes. |
| **Machine translation to fill en/es** | The Turkish copy is deliberately playful and idiomatic. Literal translation produces text that is technically correct and tonally wrong; translators need a tone brief. |

## Consequences

**Easier**
- Adding a fourth locale is a content task, not an engineering task.
- Copy changes do not require art changes.
- Emails and UI cannot disagree about the player's language.

**Harder**
- Every player-facing string must be a key from the first line of code.
  Retrofitting localization touches every component, which is why "add i18n
  later" is listed as an anti-pattern.
- The canvas needs a text-rendering path that respects locale and the type scale.
- Layout must be verified in the longest locale, not only in Turkish.

**Now constrained**
- No hard-coded player-facing string may be merged, ever.
- No art asset may contain text.
- Missing-key and unused-key checks are regression gates (G8).
- Turkish uppercase correctness is a tested behavior, not a review item.

## Open

- **LO-1:** English and Spanish copy must be authored.
- **LO-2:** A tone brief for translators.
- **#6:** Whether an approved tagline exists, and whether it is localized.
