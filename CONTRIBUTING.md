# Contributing — Purrenade Frontend

## Ground rules

1. **Two independent repositories.** Never merge this repository with
   `purrenade-api`, never nest one inside the other, never share Git state,
   and never couple their dependency management. Frontend and backend commits
   stay separate.
2. **The written specification wins for behavior.** Approved product behavior is
   not changed silently. If research or implementation suggests changing an
   approved decision, stop and report: current specification → evidence/problem →
   proposed alternative → benefits → risks/trade-offs → scope/migration impact →
   recommendation.
3. **Do not invent game mechanics.** If something is not in the specification or
   in Claude Design v0.3, it is OPEN, not implied.
4. **Decision status is explicit.** Every documented decision is tagged
   `APPROVED`, `PROPOSED`, or `OPEN`. PROPOSED and OPEN are never silently
   promoted to APPROVED.

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
10. Run the relevant regression gates (`docs/testing/regression-gates.md`).
11. Update the technical documentation.
12. Review the final diff for scope creep and regressions.

## Git identity and commit attribution

- Use the repository/user's existing Git identity. Do not change global or local
  `user.name` / `user.email`.
- Do not create tool-specific or automation identities, and do not use
  "Claude", "Anthropic", "AI", "Assistant", "Bot" or similar as author or committer.
- Do not add generated-by banners, signatures, footers, trailers, comments, or
  metadata identifying an assistant in source files, documentation, changelogs,
  pull-request text, or commits.
- Before the first commit, verify: `git config user.name`, `git config user.email`,
  `git status`, `git remote -v`, `git branch --show-current`. If identity is
  missing, stop and report rather than inventing one.

## Commit messages

Conventional-commit style, describing the change only:

```
feat(game): add lane movement foundation
feat(auth): add email verification flow
fix(game): prevent repeated collision damage
docs(api): document game run contract
test(auth): cover mandatory admin 2FA
```

## Code expectations

See [`docs/architecture/engineering-standards.md`](docs/architecture/engineering-standards.md).
The short version:

- Idiomatic Nuxt architecture and Vue composition patterns; strong TypeScript.
- Clear separation between UI, application state, API clients, and Phaser/game logic.
- Pure game rules isolated from rendering/engine code and unit-tested.
- Phaser state never leaks into unrelated Vue/Nuxt UI.
- SSR/client-only boundaries handled deliberately.
- Localization from the start; accessibility outside the canvas wherever possible.
- No unnecessary global mutable state.
- **No magic numbers** — every tunable lives in
  [`docs/game/tuning-parameters.md`](docs/game/tuning-parameters.md) and its
  implementation counterpart.

## Never commit

- Private source photographs or anything under `design-reference/private-source/`.
- Secrets, `.env` files, credentials, tokens.
- Dependency or build output (`node_modules/`, `.nuxt/`, `.output/`, `dist/`).
