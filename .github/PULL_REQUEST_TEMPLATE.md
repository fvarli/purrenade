## Summary

<!-- What changed and why. Describe the change only. -->

## Milestone

<!-- e.g. M5 — Game core. Link the relevant section of docs/product/milestones.md -->

## Specification alignment

- [ ] Behavior matches the written Product/Game Specification
- [ ] Approved visual decisions match Claude Design v0.3
- [ ] No approved product behavior was changed silently
- [ ] No new game mechanic was invented
- [ ] Any new decision is tagged APPROVED / PROPOSED / OPEN and recorded in `docs/product/open-decisions.md`

## Conflicts

<!-- Any conflict found between the specification, v0.3, and the art direction board.
     If a conflict could not be resolved, it must be reported, not worked around. -->

## Quality checklist

- [ ] Tests added/updated
- [ ] Regression gates pass (`docs/testing/regression-gates.md`)
- [ ] No magic numbers — tunables live in `docs/game/tuning-parameters.md`
- [ ] SSR/client-only boundaries handled deliberately
- [ ] Phaser state does not leak into unrelated Vue/Nuxt UI
- [ ] Localization keys added for TR/EN/ES (no text baked into images)
- [ ] Accessibility considered outside the canvas
- [ ] Documentation updated
- [ ] Diff reviewed for scope creep

## Cross-repository impact

- [ ] No API contract change, **or** the contract change is reflected in `purrenade-api` docs and OpenAPI
