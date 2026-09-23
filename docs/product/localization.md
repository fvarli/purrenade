# Localization

**Status legend:** APPROVED / PROPOSED / OPEN.

---

## 1. Scope — APPROVED

| Content | Languages |
| --- | --- |
| Player-facing product and game copy | **Turkish (tr)**, **English (en)**, **Spanish (es)** |
| Repository technical documentation | **English only** |

Turkish is the **source locale**: all approved copy in Claude Design v0.3 is
Turkish, and the primary audience is Turkish-speaking. English and Spanish are
translations of the Turkish source, authored — not machine-filled.

---

## 2. Approved constraints — APPROVED

Claude Design v0.3 board 19 states the rule directly:

> *"Dil anında değişir — metinler görsellere gömülmez, kutular uzun çevirilere
> toleranslıdır."*

Which yields three testable requirements:

1. **Language changes instantly.** No reload, no re-login, no app restart.
2. **No text is baked into images.** Every player-facing string is a translatable
   key. This applies to the game canvas as much as to the DOM: HUD labels, tutorial
   prompts, SLAYYY and Loli banners, and run-end copy are all localized text
   rendered over art, never art containing text.
3. **Layouts tolerate long translations.** Turkish and Spanish are both
   substantially longer than English for short imperative strings.

### 2.1 The wordmark is not text — APPROVED

`PURRENADE` is a brand wordmark and is **not localized**. Neither are the character
names (Ayşenur, Loli, Büşo, Ogito, Sero) or `SLAYYY`.

---

## 3. Locale resolution — PROPOSED

| Step | Rule |
| --- | --- |
| 1 | An authenticated player's **profile locale** wins |
| 2 | Otherwise, a previously chosen locale stored on the device |
| 3 | Otherwise, the best match from the browser's `Accept-Language` |
| 4 | Otherwise, **Turkish** as the default |

Changing the language while signed in updates **both** the profile and the device
preference, so the choice survives both sign-out and a move to a new device.

The language switcher appears on the **login screen** (v0.3 board 03), so locale
resolution must work with no session present.

---

## 4. Formatting — PROPOSED

| Concern | Rule |
| --- | --- |
| Numbers | Locale-formatted via the platform's internationalization API. v0.3 shows `1.284` and `5.847` — Turkish dot-thousands. Never hand-formatted. |
| Dates | Locale-formatted. v0.3 profile shows a month-and-year form ("Mayıs 2026'dan beri koşuyor"). |
| Relative times | Locale-formatted ("2 saat önce" on the sessions screen). |
| Pluralization | Uses real plural rules per locale, never string concatenation. Turkish, English and Spanish differ here. |
| Turkish casing | Turkish has dotted/dotless `i`. Never apply locale-blind `toUpperCase()` to Turkish strings — `i` must become `İ`. This is a real defect source in a design that uses uppercase headings heavily. |

---

## 5. Copy that does not yet exist — OPEN

> **State of the files, recorded so this section is not misread (M9).** `i18n/locales/en.json`
> and `es.json` exist with **full key parity** with `tr.json`, enforced in CI, so every screen
> renders in all three. That parity is a build property, not an approval: the English and
> Spanish copy — and M9's new run-start, submission, outcome and reason copy in all three
> locales (`run.start.*`, `run.submit.*`, `run.outcome.*`, `run.reason.*`, and the
> `errors.run_not_active`, `errors.idempotency_key_reused`, `errors.bff_*` codes) — is
> **PROPOSED** until reviewed. The status below stands.

**Only Turkish copy exists.** v0.3 contains two sample strings in the other
locales — *"Play as Ayşenur by the sea!"* and *"¡Juega con Ayşenur junto al
mar!"* — and nothing more.

| Item | Status |
| --- | --- |
| Full English copy | OPEN — must be authored |
| Full Spanish copy | OPEN — must be authored |
| Tone guidance for translators | OPEN |

The Turkish copy is deliberately playful and idiomatic ("Olur öyle. Sıfırlama
bağlantısı gönderelim, gözyaşlarını sil."). Literal translation will lose the
product's voice, so translation needs a tone brief, not just a string dump.

---

## 6. Server-side localization — PROPOSED

Some player-facing text originates on the server: transactional emails
(verification code, password reset), and error messages surfaced from API
responses.

| Rule | Detail |
| --- | --- |
| The client sends its locale with every request | via a standard language header |
| Emails are sent in the player's **profile locale** | not the locale of the requesting device |
| API errors carry a **stable machine-readable code** plus an optional localized message | The client may localize from the code; it must never parse a human-readable message |

Contract details: the backend's `docs/api/api-conventions.md`.

---

## 7. Testing — PROPOSED

| Test | Purpose |
| --- | --- |
| Missing-key check | No locale is missing a key present in the source locale; CI fails on a gap |
| Unused-key check | Dead strings are removed rather than translated |
| Pseudo-localization | Long-string rendering is exercised without waiting for real translations |
| Instant-switch test | Switching locale updates DOM **and** canvas text without a reload |
| Turkish casing test | Uppercase transforms produce `İ`, not `I`, for Turkish |
| Layout test at 390 px | The longest locale does not clip or overflow on the design baseline |

---

## 8. Open questions owned by this document

| Ref | Question |
| --- | --- |
| LO-1 | English and Spanish copy (§5) |
| LO-2 | Tone brief for translators (§5) |
| LO-3 | Is the brand tagline localized? — depends on whether a tagline is approved at all ([conflict #6](design-reference-conflicts.md)) |
| LO-4 | Does the leaderboard display locale-specific number formatting for other players' scores, or the viewer's locale? (PROPOSED: the viewer's) |
