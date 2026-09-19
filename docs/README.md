# Purrenade Frontend — Documentation Index

This repository owns the **Product/Game Specification**, which is authoritative
for product behavior across both repositories. Backend technical documentation
lives independently in `purrenade-api/docs/`.

All documentation in both repositories is **English only**. Player-facing product
and game copy ships in **Turkish, English and Spanish**.

---

## Decision status legend

Every decision in this documentation carries exactly one status.

| Status | Meaning | Rules |
| --- | --- | --- |
| **APPROVED** | Already decided product behavior. | Authoritative. Implement as written. Changing it requires the formal change report in `CONTRIBUTING.md`. |
| **PROPOSED** | A recommended value or design, written so it can be reviewed rather than left blank. | **Not authoritative.** May be implemented behind a tuning parameter, but must not be presented as decided. Must be reviewed before the milestone that depends on it closes. |
| **OPEN** | Unresolved. Requires a product-owner decision. | Must not be implemented. Must not be guessed. Tracked in [`product/open-decisions.md`](product/open-decisions.md). |

**PROPOSED and OPEN are never silently promoted to APPROVED.**

---

## Source-of-truth priority

1. **Written Product/Game Specification** — behavior and game rules.
2. **Claude Design v0.3** — approved UX/UI structure, brand integration, visual hierarchy.
3. **Explicitly approved runtime production assets** — win over illustrative
   mockups only for their visual subject. The development masters are candidates,
   not runtime assets.
4. **Historical v0.2.1 decisions as represented in v0.3** — secondary reference only.
5. **ChatGPT Art Direction Board** — aspirational atmosphere and mood only.
6. **Private source references** — local-only, never published.

Conflict rules and every conflict found so far:
[`product/design-reference-conflicts.md`](product/design-reference-conflicts.md).
For the reference directory, its development masters, and the never-ship rule,
see [`../design-reference/README.md`](../design-reference/README.md).

---

## Product (`docs/product/`)

| Document | Contents |
| --- | --- |
| [product-overview.md](product/product-overview.md) | Identity, audience, platforms, v1 boundary |
| [game-specification.md](product/game-specification.md) | **★ Entry point** — authoritative behavior specification |
| [core-run.md](product/core-run.md) | Lanes, input, jump, collision, hearts, run lifecycle |
| [difficulty-and-obstacles.md](product/difficulty-and-obstacles.md) | Difficulty model, obstacle catalogue, pattern generation |
| [scoring-and-progression.md](product/scoring-and-progression.md) | Score, paws, SLAYYY, Loli Bonus, overlap rule |
| [tutorial.md](product/tutorial.md) | Interactive tutorial behavior |
| [screen-inventory.md](product/screen-inventory.md) | All 21 approved v0.3 screens |
| [achievements-and-unlocks.md](product/achievements-and-unlocks.md) | Achievements and character unlocks |
| [leaderboards.md](product/leaderboards.md) | Weekly and all-time ranking |
| [localization.md](product/localization.md) | TR/EN/ES strategy and constraints |
| [accessibility.md](product/accessibility.md) | Reduced motion, contrast, non-canvas accessibility |
| [art-asset-requirements.md](product/art-asset-requirements.md) | Required sprites, states, atlases |
| [design-reference-conflicts.md](product/design-reference-conflicts.md) | **★** Conflict register and resolutions |
| [deferred-design-exploration.md](product/deferred-design-exploration.md) | Concepts explicitly **not** v1 mechanics |
| [licensing-and-rights.md](product/licensing-and-rights.md) | Layered rights model; likeness consent |
| [milestones.md](product/milestones.md) | M0–M14 delivery plan |
| [open-decisions.md](product/open-decisions.md) | **★** Live OPEN / PROPOSED register |

## Architecture (`docs/architecture/`)

| Document | Contents |
| --- | --- |
| [frontend-architecture.md](architecture/frontend-architecture.md) | Nuxt structure, SSR/client boundaries |
| [game-engine-integration.md](architecture/game-engine-integration.md) | **★** Pure game rules vs Phaser rendering |
| [state-management.md](architecture/state-management.md) | Store ownership and boundaries |
| [bff-and-session.md](architecture/bff-and-session.md) | **★** The BFF, sessions, CSRF, and the browser security boundary (M2) |
| [api-client.md](architecture/api-client.md) | Typed client, errors, auth transport, correlation IDs |
| [design-tokens.md](architecture/design-tokens.md) | **★** Locked palette and typography |
| [responsive-and-viewport.md](architecture/responsive-and-viewport.md) | Mobile baseline, desktop protected column |
| [pwa-and-mobile.md](architecture/pwa-and-mobile.md) | PWA scope, offline question, native future |
| [engineering-standards.md](architecture/engineering-standards.md) | **★** Per-milestone quality checklist |
| [asset-strategy.md](architecture/asset-strategy.md) | Binary asset growth, LFS/CDN revisit trigger |
| [local-development.md](architecture/local-development.md) | **★** Local hostnames, HTTPS, ports, how to run both sides |
| [versions-and-runtime.md](architecture/versions-and-runtime.md) | Version research findings (not pins) |

## Game (`docs/game/`)

| Document | Contents |
| --- | --- |
| [tuning-parameters.md](game/tuning-parameters.md) | **★** Single source for every tunable value |
| [determinism-and-rng.md](game/determinism-and-rng.md) | Seeding, reproducibility, testability |

## Testing (`docs/testing/`)

| Document | Contents |
| --- | --- |
| [testing-strategy.md](testing/testing-strategy.md) | Test layers and what belongs in each |
| [regression-gates.md](testing/regression-gates.md) | What must pass before a milestone closes |

## Production (`docs/production/`)

How the frontend actually runs in production, and the procedure for changing
it. The controlled frontend and backend production deployment paths have been
**proven end-to-end** (OPS-3 complete). Frontend deployment remains
operator-controlled through `workflow_dispatch`; the manual procedure remains
the fallback. The API half of this documentation lives in
[`purrenade-api/docs/production/`](https://github.com/fvarli/purrenade-api/tree/main/docs/production).

| Document | Contents |
| --- | --- |
| [README.md](production/README.md) | **★ Entry point** — architecture, request path, runtime versions, release layout, BFF session model in production, deviations |
| [deployment.md](production/deployment.md) | **★** Build, hash, transfer, atomic release activation, rollback, CI/CD invariants |
| [operations.md](production/operations.md) | **★** systemd, nginx, TLS, session store, health and smoke, logs, restart checklist |
| [ci-cd.md](production/ci-cd.md) | **★** The controlled deployment pipeline: triggers, artifact integrity, release mechanics and security model |

---

## Decisions (`docs/decisions/`)

[ADR index](decisions/README.md) — ADR-0001 … ADR-0009.
