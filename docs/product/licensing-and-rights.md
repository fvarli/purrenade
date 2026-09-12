# Licensing and Rights

**Status: OPEN. No license has been granted.** The `LICENSE` file in both
repositories is a placeholder recording that fact.

---

## 1. The decision that must be made — OPEN

The repositories are expected to be **public**. Public source availability does
**not** automatically mean that code, artwork, branding, character likenesses, or
media are granted under an open-source or open-content license.

A licensing model must be chosen deliberately, and it must be **layered** —
one license rarely fits all of the following:

| Layer | Considerations |
| --- | --- |
| **Source code** | The only layer for which a conventional open-source license is straightforward. |
| **Purrenade name, wordmark, brand identity** | Trademark-like concerns. An open-source code license does **not** grant brand use, and usually should explicitly exclude it. |
| **Production artwork** | Sprites, backgrounds, UI art, achievement badges. Typically not granted openly. |
| **Character likenesses** | Based on **real people** and a real animal. Requires consent, not just a license. See §3. |
| **Private source / reference photographs** | Never committed, published, bundled, or served — under **any** license. See §4. |
| **Audio and music** | Often third-party licensed; terms may restrict redistribution and app-store use. |
| **Third-party assets and fonts** | Remain governed by their own licenses regardless of what Purrenade chooses. |

**Do not automatically select MIT or any other open-source license.** Until the
decision is recorded here and the `LICENSE` file is replaced, **all rights are
reserved**.

---

## 2. Interim rule — APPROVED

Until licensing is decided:

1. `LICENSE` states that licensing is undetermined and all rights are reserved.
2. No file claims a license it has not been granted.
3. No contribution is accepted on terms that would conflict with a
   yet-undecided model.
4. Third-party dependencies and fonts are tracked with their licenses from the
   moment they are introduced (M1), so a later decision is not blocked by an
   unknown inventory.

---

## 3. Character likenesses and consent — OPEN, and load-bearing

Purrenade's characters are named after **real people** — Ayşenur, Büşo, Ogito,
Sero — and a **real cat**, Loli. Claude Design v0.3 states that final character
illustration is produced **from photo reference**, and that friends' characters
unlock *"when the artwork is added"*.

Open questions, all of which must be answered before the relevant art ships:

| Question |
| --- |
| Is documented consent held from each person whose likeness is used? |
| Does that consent cover commercial use? |
| Does it cover app-store distribution under Android/iOS? |
| Does it cover use in marketing and store listings, not only in-game? |
| Is it revocable, and what happens to shipped builds if it is revoked? |
| For Loli's owner: the same questions apply to the animal's likeness and name. |
| Does consent survive the eventual licensing model — particularly if any layer is opened? |

**Rule:** a character does not ship until both its **artwork** and its **consent
record** exist. This is the second of the two unlock gates described in
[achievements-and-unlocks.md](achievements-and-unlocks.md) §2.3.

---

## 4. Private source material — APPROVED, non-negotiable

`design-reference/private-source/` is **local-only**. Private source photographs
must never be:

- committed to any repository,
- published anywhere,
- copied into public documentation,
- exposed in application bundles,
- served from a CDN or used as downloadable production assets.

They exist solely as local visual reference for the approved character artwork.
This rule holds **regardless of the eventual license**, and it is enforced by
`.gitignore` and a CI check.

---

## 5. Fonts — PROPOSED

Claude Design v0.3's reference page loads **Baloo 2** from Google Fonts and
inlines the woff2 faces. Production must **self-host** its fonts:

- **KVKK/GDPR:** loading fonts from a third-party CDN transmits visitors' IP
  addresses to that third party.
- **Performance:** a self-hosted, subset font on the product's own origin avoids
  an extra connection on the critical path.
- **Licensing:** the font's own license must be recorded in the dependency
  inventory, and open-font terms usually permit self-hosting explicitly.

---

## 6. Third-party inventory — from M1

From the first milestone that introduces dependencies, both repositories maintain
an inventory of third-party components and their licenses — libraries, fonts,
audio, and any art not produced for Purrenade. A licensing decision cannot be
made responsibly against an unknown inventory.

---

## 7. Open questions owned by this document

| Ref | Question |
| --- | --- |
| LR-1 | The layered licensing model itself (§1) |
| LR-2 | Consent records for every real-person and real-animal likeness (§3) |
| LR-3 | Whether the repositories are public from the first commit or later |
| LR-4 | Trademark posture for the Purrenade name and wordmark |
| LR-5 | Contribution terms, if outside contributions are ever accepted |
