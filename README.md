# Purrenade — Frontend

Browser-first, mobile-first responsive casual **endless score-attack runner**.
Nuxt · Vue · TypeScript · Phaser.

> **Status: authentication shipped; game core in progress.** The framework, toolchain and
> quality gates are in place, and the authentication surface — sign-in, registration, email
> verification, two-factor, account security and the admin gate — is implemented behind the
> Nitro BFF. Gameplay begins at **M5**, which is the milestone under way.

## Local setup

Requires **Node 24 LTS**. The repository pins it in `.nvmrc`.

```bash
nvm use          # reads .nvmrc → Node 24
npm ci           # install from the lockfile
npm run dev      # http://localhost:3000
```

| Command | What it does |
| --- | --- |
| `npm run lint` | ESLint, including the architecture boundary rules |
| `npm run typecheck` | `vue-tsc` via `nuxt typecheck` |
| `npm run test` | Vitest |
| `npm run build` | Production build |

**No Docker.** This project does not use containers in local development.

### Architecture boundaries the linter enforces

These are not style rules — each one protects a decision the product depends on:

- `game/domain/**` cannot import Phaser, Vue or Nuxt, cannot touch the DOM, and cannot call
  `Math.random()` or `Date.now()`. Determinism is a product requirement, not a preference.
- `app/**` cannot import Phaser. The engine is lazily loaded on the run route only.

## What Purrenade is

| Concept | Meaning |
| --- | --- |
| **Purrenade** | The game, world, and IP. *Purr + Promenade.* |
| **Ayşenur** | The primary star character. |
| **Loli** | Mascot and special gameplay companion. |
| **SLAYYY** | The signature power. |

A seaside promenade / festival world with a soft, playful, colorful casual-game
tone. Player-facing copy ships in **Turkish, English and Spanish**. Future
Android/iOS distribution must remain possible.

## Repository layout

This is one of **two independent repositories**. They are developed as one
product but never merged, nested, or given shared Git state.

| Repository | Purpose |
| --- | --- |
| `purrenade` (this one) | Nuxt/Vue/TypeScript/Phaser frontend. Owns the Product/Game Specification. |
| `purrenade-api` | Laravel REST API, PostgreSQL. Owns backend architecture, API and security documentation. |

```
design-reference/   approved and supporting visual references (see its README)
docs/
  product/          ★ Product/Game Specification — authoritative for behavior
  architecture/     frontend architecture, engine boundary, tokens, runtime
  game/             tuning parameters and determinism
  testing/          testing strategy and regression gates
  decisions/        architecture decision records (ADRs)
```

## Start here

1. [`docs/README.md`](docs/README.md) — documentation index and the
   APPROVED / PROPOSED / OPEN status legend.
2. [`docs/product/game-specification.md`](docs/product/game-specification.md) —
   the authoritative behavior specification.
3. [`docs/product/open-decisions.md`](docs/product/open-decisions.md) —
   everything still undecided.
4. [`docs/decisions/`](docs/decisions/) — why the architecture looks the way it does.

## Source-of-truth priority

1. **Written Product/Game Specification** — authoritative for behavior and game rules.
2. **Claude Design v0.3** — authoritative for approved UX/UI structure, brand integration and visual hierarchy.
3. **Historical v0.2.1 decisions represented in v0.3** — secondary reference only.
4. **ChatGPT Art Direction Board** — aspirational atmosphere/mood reference only. Not a production asset source, not a source of mechanics.
5. **Private source references** — local-only. Never exposed, published, or committed.

If a conflict cannot be resolved with these rules, it is **reported, not invented
around**. See [`docs/product/design-reference-conflicts.md`](docs/product/design-reference-conflicts.md).

## Development status

See [`docs/product/milestones.md`](docs/product/milestones.md), whose overview table carries the
delivery status of every milestone and records why the delivery labels and the roadmap numbers do
not line up one-for-one.

Delivered: **M0** (documentation), **M1** (bootstrap), **M2** and **M3** (authentication and
access — both shipped in the commit labelled M2), and most of **M4** (the frontend shell, less the
profile and settings screens that M12 owns).

In progress: **M5 — game core**.

## License

**Not yet determined.** See [`LICENSE`](LICENSE) and
[`docs/product/licensing-and-rights.md`](docs/product/licensing-and-rights.md).
