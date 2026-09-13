# Changelog

All notable changes to this repository are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project does not yet have released versions.

## [Unreleased]

### Added — M5: game core

The pure game-rules core, the Phaser boundary, and the run route. No obstacles, no scoring,
no HUD — those are M6 and M7.

- **`game/domain`** — a deterministic, engine-free rules core. `step(state, inputs, deltaMs)` is a
  pure function over plain data: three lanes with edge no-ops, a jump whose arc is derived from the
  approved 650 ms airborne target, a depth-1 input buffer, a readiness beat, and pause. No Phaser,
  no DOM, no Vue, no `Math.random`, no wall-clock time — all enforced by ESLint, not convention.
- **A seeded PRNG** with three independent streams (pattern, collectible, cosmetic) whose cursors
  live in the run state, so a run replays identically from its seed.
- **`game/bridge`** — the only place the rules and the renderer meet: normalized input events in, a
  frozen render snapshot in lane units out, and coarse run events to the app. It also owns the
  fixed-step loop, with bounded catch-up and no time banked across a pause.
- **`game/engine`** — a Phaser adapter behind a lazy `import('phaser')`, with keyboard and pointer
  input normalized before they cross the bridge.
- **`/run`** — client-only, guarded by the verified-account route middleware, mounting the engine
  on entry and destroying it on leave. The guard is convenience, not authorization: nothing on this
  route reaches privileged data, and the server remains the only access control. Escape pauses and resumes; losing visibility or focus pauses and never silently resumes.
- **The tuning module** — every gameplay number in one frozen object, each carrying its own approval
  status, cross-checked against `docs/game/tuning-parameters.md` by a test. Shipping a PROPOSED value does not
  approve it; see `docs/product/open-decisions.md` §0AC.

### Fixed — M5

- **Pause could deadlock the run.** Pause and resume were queued as inputs, so a resume needed a
  frame from the loop that pausing had stopped — and Phaser stops that loop when the window blurs. A
  run paused by losing focus could not be resumed. Control transitions now apply synchronously.
- **`/run` was seven pixels taller than the viewport.** `<canvas>` is inline by default, so the line
  box reserved descender space and made the page scrollable — meaning a gameplay key could scroll it.
- **The CI gate for "Phaser must not enter a non-run bundle"** could not fail. It grepped a build
  that had never imported Phaser. It now asserts one lazily-loaded carrier chunk with no static
  importer, and was verified against four deliberately broken builds.

### Changed — M5: documentation drift

The executed milestone labels had drifted from the roadmap's numbering — the commit labelled M2
delivered roadmap M2 and M3 and most of M4. `docs/product/milestones.md` now carries a delivery
history and per-milestone status. Canonical roadmap numbers are unchanged and no frozen milestone
was re-labelled.

### Added — M2 (delivery label): authentication and access foundation

Delivered roadmap **M2 and M3** together, plus most of roadmap **M4**. See
`docs/product/milestones.md` for the delivery history and why the labels and the roadmap numbers
do not line up one-for-one.

- **The Nitro BFF** — server-side session in unstorage behind an opaque `__Host-` cookie, a
  synchroniser CSRF token, a closed upstream endpoint table, and a construct-only header
  allow-list. The browser never holds a bearer token.
- **Auth screens** — sign in, register, verify email, two-factor challenge, forgot and reset
  password, account security, and an admin surface that exists to prove access control works.
- **The frontend shell** — design tokens, typography, tr/en/es with instant switching, the typed
  BFF client with RFC 9457 error mapping and correlation ids.

### Added — M1C (delivery label): runtime completion

- Systemd user services for both repositories, port-conflict detection in `bin/dev`.

### Added — M1 (delivery label): repository bootstrap

- Nuxt 4 skeleton, TypeScript, ESLint with the architectural boundary rules, Vitest, Playwright,
  CI, `.env.example`. No product code.

### Changed — M0.6: decision normalization

**Newly APPROVED**
- **Audio Option C** — Settings owns music and SFX **volume sliders**; Pause exposes **quick
  mute/unmute**. **Mute is stored independently of volume**, so unmuting restores the previous
  non-zero level. Four persisted fields. Resolves conflict #10, deliberately deviating from
  both v0.3 boards.
- **Character unlock semantics** — Büşo: best accepted single-run ≥ 2,500 · Ogito: 10 accepted
  runs with **no** minimum-duration criterion (run acceptance is the validation system's job) ·
  Sero: 3 lifetime **actual** Loli Bonus activations.
- **Leaderboard core rules** — Monday 00:00 Europe/Istanbul, attributed by server-recorded run
  start; `score DESC` → earlier `achieved_at` → shorter `duration_ms` → stable id; cursor
  pagination, default 25 / max 100; banned users hidden publicly and retained for audit;
  public opt-out supported.
- **Display-name v1 baseline** — length, character set, uniqueness, rate-limited changes and
  admin force-rename. Profanity screening and homoglyph detection demoted to **future
  hardening, explicitly not v1 blockers**.
- **Minimum admin capability set** — the six-capability moderation console, with CMS, arbitrary
  data editing, granting progression, impersonation and bulk export approved as out of scope.
- **Loli activation is a distinct fact** — threshold earned ≠ queued ≠ **activated**. An
  activation counts only on the ENTERING/ACTIVE transition. `loliActivations` is derived from
  validated telemetry and **never inferred from the paw ledger**.
- **Two-column verification model** — **Verification Source** separated from **Progress
  Persistence**, under the rule that storing a cumulative total never reclassifies where its
  evidence came from.

**Fixed**
- Achievement counts corrected from the erroneous "12/4" to **9 `DERIVED_PERSISTENT` /
  7 `DERIVED_TELEMETRY`** by verification source (10 `PERSISTED_AGGREGATE` / 6 `RUN_FACT` by
  persistence), across all nine documents that carried the stale claim.
- `lolis_favourite` and `loli_devotee` reclassified to `DERIVED_TELEMETRY` — the previous claim
  that they follow from the paw ledger was wrong once queued bonuses became run-scoped.
- `cone_dodger` reworded so it cannot be read as a collision-free streak: **successfully avoid
  500 traffic cones across accepted runs; each safely passed cone increments progress by one;
  a collision neither increments nor resets progress.**

**Notes**
- Difficulty tier labels, retired counters and retired reference ids are recorded in the
  register rather than silently dropped. AU-7 retired.
- Telemetry retention gains explicit latitude: **raw events need not be retained forever**;
  validating at acceptance and keeping compact derived run facts is permitted.
- Still no framework, dependency, or application code. Bootstrap remains M1.

### Changed — M0.5: decision closure

**Newly APPROVED**
- **Authentication transport** — Nuxt BFF with server-managed session cookies over a
  token-capable Laravel API; no persistent bearer token in browser storage; a native bearer
  flow preserved as a future capability and not implemented in v1. ADR-0005 rewritten to
  Accepted. Resolves ARCH-1 and ARCH-3 (Nitro *is* the BFF).
- **Password reset never disables, resets, or bypasses 2FA** — a tested security invariant.
- **Obstacle model** — two semantic classes, `LANE_BLOCKING` (traffic cone) and `JUMPABLE`
  (low seaside barrier), decoupled from visual assets. Unblocks the pattern library.
- **Near miss ("Ramak Kala")** — a real v1 statistic mechanic: one event per obstacle, no
  score, deterministic detection, server-verifiable progress.
- **Loli Bonus queueing is run-scoped** — queued bonuses never carry into a future run; no
  persisted `owedLoliBonuses` field anywhere.
- **Achievement progression authority** — client-reported summary counters alone are
  insufficient; every achievement is `DERIVED_PERSISTENT` or `DERIVED_TELEMETRY`.
- **Çay Molası** and **Trileçe Avcısı** removed as invalid; **Koni Koleksiyoncusu**
  ("hit 25 cones") superseded by product review for rewarding intentional collision.
- Difficulty tiers relabelled **Tier 1–Tier 5** (one-indexed); thresholds unchanged.

**Newly PROPOSED, awaiting review**
- A complete **16-achievement catalogue** with verification classification.
- **Audio Option C** — Settings owns volume sliders, Pause exposes quick mute/unmute.
- **Character unlock semantics** for Büşo, Ogito and Sero.
- **Leaderboard rules** — Monday 00:00 Europe/Istanbul, tie-break, pagination, display-name
  rules, banned/deleted/opt-out visibility.
- **Minimum admin capability set** — six moderation capabilities.
- **Account deletion architecture**; the retention/anonymization policy stays OPEN.

**Notes**
- Retained gameplay telemetry is now recorded as behavioural personal data with a retention
  obligation (SEC-5).
- Still no framework, dependency, or application code. Bootstrap remains M1.

### Added — M0: documentation foundation
- Repository hygiene files (`.gitignore`, `.gitattributes`, `.editorconfig`, `.nvmrc`, CI stub, PR template).
- Documentation structure: `docs/product/`, `docs/architecture/`, `docs/game/`, `docs/testing/`, `docs/decisions/`.
- Product/Game Specification v1 draft, including core run, difficulty/obstacles, scoring/progression, tutorial, screen inventory, achievements/unlocks, leaderboards, localization and accessibility.
- Design-reference conflict register and deferred design exploration record.
- Architecture documentation: frontend architecture, game-engine integration boundary, state management, API client, design tokens, responsive/viewport rules, PWA/mobile, engineering standards, asset strategy, runtime/version research.
- Tuning-parameter registry and determinism/RNG documentation.
- Testing strategy and regression gates.
- ADR-0001 … ADR-0008.
- `LICENSE` placeholder recording that licensing remains undetermined.

### Notes
- No framework, dependency, or application code exists yet. Bootstrap is M1.
