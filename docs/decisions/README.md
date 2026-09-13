# Architecture Decision Records

## Index

| ADR | Title | Status | Scope |
| --- | --- | --- | --- |
| [0001](ADR-0001-separate-frontend-backend-repositories.md) | Separate frontend and backend repositories | **Accepted** | Product-wide |
| [0002](ADR-0002-nuxt-phaser-frontend-architecture.md) | Nuxt + Phaser frontend architecture | **Accepted** | Frontend |
| [0003](ADR-0003-laravel-rest-api-backend.md) | Laravel REST API backend | **Accepted** | Product-wide |
| [0004](ADR-0004-postgresql-primary-database.md) | PostgreSQL as the primary database | **Accepted** | Product-wide |
| [0005](ADR-0005-authentication-and-2fa-strategy.md) | Authentication and 2FA strategy | **🔴 Proposed — decision required** | Product-wide |
| [0006](ADR-0006-run-validation-and-anti-cheat-boundary.md) | Run validation and anti-cheat boundary | **🔴 Proposed — decision required** | Product-wide |
| [0007](ADR-0007-localization-strategy.md) | Localization strategy | **Accepted** | Product-wide |
| [0008](ADR-0008-source-of-truth-and-design-reference-hierarchy.md) | Source-of-truth and design-reference hierarchy | **Accepted** | Product-wide |
| [0009](ADR-0009-server-rendered-session-awareness.md) | Server-rendered session awareness | **Accepted** | Frontend |

**ADR-0005 and ADR-0006 block work.** Neither can be deferred past its milestone:
0005 blocks M2/M3 and constrains the approved "Android/iOS must remain possible"
requirement; 0006 blocks M9/M10 and is the largest architectural risk in v1.

---

## Numbering and cross-repository sync — PROPOSED

The two repositories share **one ADR numbering space**, because the decisions
themselves are shared even though the repositories are independent.

| Rule | Detail |
| --- | --- |
| Scope header | Every ADR declares `Scope: Product-wide`, `Scope: Frontend`, or `Scope: Backend` |
| Product-wide ADRs | Stored in **both** repositories with the **same number and the same decision**, so each repository is independently readable |
| Repository-specific ADRs | Stored only where they apply; the number is still reserved globally |
| Divergence | A product-wide ADR whose two copies disagree is a **defect**, not a variant. The gate that catches it is the contract-change process. |
| Superseding | An ADR is never edited into a different decision. Write a new one and mark the old one `Superseded by ADR-XXXX`. |

Backend copies live in `purrenade-api/docs/decisions/`.

---

## Format

```markdown
# ADR-XXXX — Title

- **Status:** Proposed | Accepted | Superseded by ADR-YYYY | Deprecated
- **Scope:** Product-wide | Frontend | Backend
- **Date:** YYYY-MM-DD
- **Decision owner:** role

## Context
What forces led here. Facts, not preferences.

## Decision
What is decided, stated so it can be checked.

## Alternatives considered
What else was weighed, and why it lost.

## Consequences
What becomes easier, what becomes harder, what is now constrained.
```

## When to write one

Write an ADR when a decision is **hard to reverse**, **crosses a repository
boundary**, **affects security or data integrity**, or **would otherwise be
rediscovered by archaeology six months later**.

Do not write one for a routine choice with an obvious default.
