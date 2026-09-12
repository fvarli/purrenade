# Purrenade Frontend — Working Agreement

Read this before making any change in this repository.

## What this repository is

The Nuxt/Vue/TypeScript/Phaser frontend for Purrenade, a browser-first,
mobile-first endless score-attack runner. It also **owns the Product/Game
Specification** (`docs/product/`), which is authoritative for the whole product.

`purrenade-api` (Laravel/PostgreSQL) is a **separate, independent repository**.
Never merge them, nest them, share Git state, or unify dependency management.
Commits in the two repositories are always separate.

## Source-of-truth priority

1. Written Product/Game Specification — authoritative for behavior and game rules.
2. Claude Design v0.3 (`design-reference/claude-design/v0.3`) — authoritative for approved UX/UI structure, brand integration, visual hierarchy.
3. Historical v0.2.1 decisions as represented inside v0.3 — secondary reference only.
4. ChatGPT Art Direction Board (`design-reference/chatgpt-art-direction`) — aspirational atmosphere/mood only. **Not** pixel-perfect production artwork, **not** an asset source, **not** a source of mechanics.
5. Private source references (`design-reference/private-source/`, local-only) — never exposed, published, or committed.

Conflict rules: the written specification wins for behavior; v0.3 wins for
approved visual decisions; approved production assets win over illustrative
mockups. **If a conflict cannot be resolved, stop and report it instead of
inventing a decision.** Record it in `docs/product/design-reference-conflicts.md`.

## Decision status discipline

Every documented decision carries one of:

- **APPROVED** — already decided product behavior. Treat as authoritative.
- **PROPOSED** — a recommended value or design that is *not* authoritative until reviewed.
- **OPEN** — unresolved; requires a product-owner decision.

Never silently convert PROPOSED or OPEN into APPROVED. Never assert behavior as
APPROVED without a source in the specification, in v0.3, or in a recorded review.

## Working sequence for any milestone

1. Read the current specification.
2. Inspect both repositories.
3. Inspect the relevant design references.
4. Research current recommended technical practices.
5. Document findings that materially affect implementation.
6. Identify conflicts with approved product decisions.
7. If no meaningful conflict exists, implement.
8. If a meaningful conflict exists, stop and report before changing behavior.
9. Add/update tests.
10. Run the relevant regression gates.
11. Update the technical documentation.
12. Review the final diff for scope creep and regressions.

## Versions

Version findings in `docs/architecture/versions-and-runtime.md` are **research,
not pins**. Re-verify current stable versions and mutual compatibility
immediately before installing anything. Prefer the newest stable **compatible**
stack, not the newest version number. Never hardcode old versions.

## Git identity and attribution

- Use the existing Git identity. Never change `user.name` / `user.email`.
- Never use "Claude", "Anthropic", "AI", "Assistant", "Bot" or similar as author or committer.
- **No AI attribution anywhere**: no `Co-authored-by` trailers, no generated-by
  banners, footers, signatures, comments, or metadata in source, docs,
  changelogs, pull-request text, or commit messages.
- Commit messages describe the change only. Conventional-commit style:
  `feat(game): add lane movement foundation`.
- Never commit or push unless the current milestone explicitly authorizes it.

## Hard prohibitions

- Do not commit private source photographs or anything under `design-reference/private-source/`.
- Do not invent game mechanics, tuning values, or copy and present them as approved.
- Do not scatter magic numbers; all tunables belong in `docs/game/tuning-parameters.md`.
- Do not leak Phaser state into unrelated Vue/Nuxt UI.
- Do not treat frontend checks as authorization.
- Do not build, bundle, or serve anything from `design-reference/` — it is reference material.
