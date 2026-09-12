# Screen Inventory

Every screen approved in **Claude Design v0.3**, with its states and behavior.
v0.3 is authoritative for structure, hierarchy and approved visual decisions;
this document is authoritative for behavior.

**Design baseline:** 21 mobile artboards at **390 × 844**, plus one desktop
behavior board. Board numbers below are the v0.3 numbers.

**Status legend:** APPROVED / PROPOSED / OPEN.

---

## 1. Navigation map — APPROVED

```
01 Splash
  └─ not authenticated ──► 03 Login ◄──► 02 Register ──► 04 Email verification
  │                          │  └─► 06 Forgot password ──► 07 Reset password
  │                          └─► 05 2FA challenge
  └─ authenticated ────────► 08 Main menu
                               ├─► 09 Character selection
                               ├─► Run ──► 10 / 10b / 11 ──► 12 Pause
                               │            └─► 13 Game over / 14 New high score
                               ├─► 15 Leaderboard
                               ├─► 16 Achievements
                               ├─► 17 Profile ──► 20 Account & security
                               └─► 18 Settings ──► 19 Language
                                                 └─► Replay tutorial
```

Route paths are PROPOSED and finalized in
[`../architecture/frontend-architecture.md`](../architecture/frontend-architecture.md).

---

## 2. Entry and authentication

| # | Screen | Key elements (APPROVED, from v0.3) | Behavior notes |
| --- | --- | --- | --- |
| **01** | **Splash / Açılış** | Wordmark, "starring Ayşenur", loading progress, rotating gameplay tip | Tips are localized copy, never baked into art. The v0.3 tip — *"koniler kaydırarak geçilir"* — is subject to [conflict #15](design-reference-conflicts.md). |
| **02** | **Register / Kayıt** | Username, email, password; notice that email verification follows ("check spam"); link to login; terms line | Client validation mirrors, never replaces, server validation. |
| **03** | **Login / Giriş** | Email, password, show-password toggle, forgot-password link, register link, **language switcher (Türkçe / English / Español)** | The language switcher on an unauthenticated screen means locale must work before a session exists. |
| **04** | **Email verification / E-posta Doğrulama** | **6-digit code** entry, target address shown, **resend with a countdown (0:42 in v0.3)** | Verification is a **code**, not a magic link — APPROVED. Resend cooldown and code TTL are enforced server-side. |
| **05** | **2FA challenge / 2FA Doğrulama** | 6-digit TOTP entry, **"use a backup code"**, note that 2FA is recommended for all and **mandatory for admin** | TOTP authenticator app. Enforcement is server-side. |
| **06** | **Forgot password / Şifremi Unuttum** | Email field, "send link" | Password reset is a **link**, unlike verification — APPROVED. |
| **07** | **Reset password / Şifre Yenileme** | New password with **strength meter**, confirm password | Strength copy in v0.3 is playful and locale-specific; it is copy, not policy. Policy is server-side. |

**OPEN:** password policy (minimum length, composition, breach-list checking) is
not specified by any reference. See the backend's `docs/security/authentication.md`.

---

## 3. Menu and character

| # | Screen | Key elements (APPROVED) | Behavior notes |
| --- | --- | --- | --- |
| **08** | **Main menu / Ana Menü** | Player chip (avatar, username, ⭐ best score), language chip, audio chip, wordmark, **`loliCyclePaws / 200` progress with "Loli Bonus approaching"**, **PLAY**, Characters, Leaderboard, Achievements, Settings | The paw progress bar is the between-runs retention surface. It shows `loliCyclePaws`, never `lifetimePaws`. |
| **09** | **Character selection / Karakter Seçimi** | Ayşenur as ⭐ "our star" with `özel güç: SLAYYY ✨`; three locked characters — **Büşo (2.500 puan)**, **Ogito (10 koşu)**, **Sero (Loli Bonusu ×3)**; note "unlocks when friend artwork is added"; **play with this character** | Unlock criteria semantics are ambiguous — see [achievements-and-unlocks.md](achievements-and-unlocks.md). Whether non-Ayşenur characters have their own special power is **OPEN**. |

---

## 4. Gameplay

| # | State | Key elements (APPROVED) | Behavior notes |
| --- | --- | --- | --- |
| **10** | **Run — normal** | Score + record badge, pause, **3 hearts**, paw counter, **SLAYYY meter**, mobile control hints (`◀ sola kaydır · ▲ zıpla · sağa kaydır ▶`) | See [core-run.md](core-run.md). |
| **11** | **Run — SLAYYY active** | `SKOR ×2`, transformed pink world, "SLAYYY ✨ her şey güzel!", **5 sn** countdown on the meter bar, caption "cones became flowers · you are invulnerable" | The three full hearts shown here are an illustrative inconsistency — [conflict #7](design-reference-conflicts.md). |
| **10b** | **Run — Loli Bonus active** | `🐾 200/200 ✓`, "LOLİ GELDİ!", Loli running beside Ayşenur, orange **`mıknatıs · 8 sn`** bar, caption "Loli attracts nearby paws" | The player is **not** invulnerable; an obstacle is visible in this very board. |
| **12** | **Pause / Duraklat** | "MOLA! 🫖", **"your score is safe: n"**, resume, restart, **Müzik** and **Efektler** controls, return to menu | v0.3 renders these as **sliders** here and as **toggles** in Settings — [conflict #10](design-reference-conflicts.md). A recommendation now exists (§7A); the decision is still required. |
| **13** | **Game over / Oyun Bitti** | "OYUN BİTTİ!", flavour line, score vs record, **`+runPaws`**, achievement progress chip (e.g. "Ramak Kala +1"), play again, return to menu | **No revive and no continue.** |
| **14** | **New high score / Yeni Rekor** | "YENİ REKOR! ⭐", new score, previous record, "Ayşenur is dancing", `+runPaws`, achievement chip, play again, **view leaderboard** | Uses the record-dance animation state. |

**Desktop board — APPROVED:** the playfield runs in a protected 460 px column
with the environment expanding decoratively; side cards show the keyboard legend
and the next goal. The desktop board omits hearts and the paw counter; that is an
**incomplete illustration, not intentional divergence** — desktop and mobile must
expose the same gameplay-critical state. See
[conflict #11](design-reference-conflicts.md) and
[`../architecture/responsive-and-viewport.md`](../architecture/responsive-and-viewport.md).

---

## 5. Progression

| # | Screen | Key elements (APPROVED) | Behavior notes |
| --- | --- | --- | --- |
| **15** | **Leaderboard / Skor Tablosu** | **Bu Hafta / Tüm Zamanlar** tabs, ranked rows with avatar, name, score, rank, **👑 on #1**, pinned **"SEN"** row for the current player | See [leaderboards.md](leaderboards.md). |
| **16** | **Achievements / Başarımlar** | `8/16` header; cards with icon, title, description, progress (`18/25`), unlocked state, locked state with hidden reward; note that a new unlock spins with confetti and a SLAYYY sound | Only **6 of 16** are named in v0.3. See [achievements-and-unlocks.md](achievements-and-unlocks.md). |

---

## 6. Support screens

| # | Screen | Key elements (APPROVED) | Behavior notes |
| --- | --- | --- | --- |
| **17** | **Profile / Profil** | Avatar with ⭐, username, "our star · running since {date}", stats — **REKOR**, **KOŞU** (runs), **BAŞARIM** (n/16), **🐾 PATİ** (`lifetimePaws`) — favourite character, language row, **Account & Security** row showing 2FA state, sign out | The paw stat here is `lifetimePaws`, distinct from the menu's `loliCyclePaws`. |
| **18** | **Settings / Ayarlar** | Language (tr/en/es), **Müzik**, **Ses Efektleri**, **Azaltılmış hareket** (reduced motion), Account & Security, build version line | Also the entry point for **replaying the tutorial** (approved requirement; no v0.3 row exists for it yet — **OPEN** placement). |
| **19** | **Language / Dil Seçimi** | Türkçe (default), English, Español, each with a native-language sample line; note that language changes instantly, text is never baked into images, and boxes tolerate long translations | This note is an approved, testable constraint. See [localization.md](localization.md). |
| **20** | **Account & Security / Hesap & Güvenlik** | 2FA state (on · authenticator app), email with verified mark, change password, **active sessions** (device, location, relative last-seen, "this device"), per-session sign-out, **sign out of all devices**, note that admin 2FA is mandatory and the admin panel is a separate plain interface | Session/device management is real backend scope: device labelling, approximate location, and revocation. |

---

## 7. Admin — APPROVED

v0.3 states only that the **admin panel is a separate, plain interface that does not adopt the
game's visual identity**, and that **2FA is mandatory for admins**.

**What an admin can actually do is not specified by any reference.** A **minimum v1 moderation
console** is now proposed — six capabilities, deliberately not a back office — in the backend
repository's `docs/api/endpoints/admin.md` and `docs/architecture/domain-boundaries.md`.

**The six-capability set is APPROVED.** Anything beyond it — CMS, arbitrary data editing,
granting scores or progression, user impersonation, bulk export — is explicitly out of scope
for v1.

---

## 7A. Audio controls — APPROVED (Option C)

v0.3 contradicted itself: board 12 (pause) shows **volume sliders**, board 18 (settings) shows
**on/off toggles**. Both are v0.3, so the conflict rules could not arbitrate. **Option C is
approved, deliberately resolving that contradiction.**

| Surface | Controls |
| --- | --- |
| **Settings (board 18)** | **Music volume slider** · **SFX volume slider** |
| **Pause (board 12)** | **Quick music mute/unmute** · **quick SFX mute/unmute** |

Each screen carries the affordance that fits its moment: one-tap silence when the player has
paused to silence the game, fine control where there is time to use it.

### Mute is independent of volume — APPROVED

**Mute state is stored separately from volume**, so unmuting restores the **previous non-zero
volume** rather than silence. Storing mute as `volume = 0` would destroy the level the player
chose, which is the defect this rule exists to prevent.

Four persisted fields: `music_volume` + `music_muted`, `effects_volume` + `effects_muted`.

### Recorded as a deliberate v0.3 deviation

Because v0.3 contradicts itself, every possible resolution deviates from at least one board.
Option C deviates from **both** — sliders move to Settings, toggles move to Pause — and is
approved knowingly rather than adopted quietly. This **resolves conflict #10**.

Reduced-motion and audio settings both live on the profile and follow the account; see
[accessibility.md](accessibility.md).

---

## 8. Cross-screen requirements — APPROVED

1. **Localization:** every string on every screen is localizable to tr/en/es;
   no text is baked into images; switching is instant; layouts tolerate long
   translations.
2. **Gameplay-critical parity:** score, hearts, paw/Loli progress, SLAYYY state
   and pause are available on every form factor.
3. **Authorization:** no screen's presence or absence is a security control.
   Route guards are convenience; the server authorizes every action.
4. **Reduced motion:** honoured on every screen, including the confetti and badge
   animation described on the achievements board.

---

## 9. Open questions owned by this document

| Ref | Question |
| --- | --- |
| SI-2 | Where "replay tutorial" lives on the Settings screen (§6) |

**Resolved by M0.6:** SI-1 (admin capability set **APPROVED**, §7) and SI-3 (audio **Option C
APPROVED**, §7A).
| SI-4 | Password policy (§2) |
| SI-5 | Do non-Ayşenur characters have their own special power? (§3) |
| SI-6 | Avatar source — uploaded, generated, or initials-based |
