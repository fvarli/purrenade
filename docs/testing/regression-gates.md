# Regression Gates — Frontend

What must pass before any milestone closes, and before any change merges.

**Status legend:** APPROVED / PROPOSED / OPEN.

---

## 1. The gate — APPROVED

A change that does not pass every applicable gate is not done, regardless of how
complete the feature looks. **Do not take shortcuts merely to make a milestone
pass.**

---

## 2. Always-on gates — PROPOSED

Run on every pull request and every push to `main`.

| # | Gate | Fails when |
| --- | --- | --- |
| G1 | **Install** | Dependencies do not resolve from a clean checkout |
| G2 | **Lint** | Any lint error |
| G3 | **Typecheck** | Any type error, including generated API types diverging from the contract |
| G4 | **Domain unit tests** | Any gameplay rule regression |
| G5 | **Property / fuzz tests** | The escape-path guarantee, join safety, soft caps, or determinism regress |
| G6 | **Component tests** | UI behavior or accessibility semantics regress |
| G7 | **Build** | The production build fails or the run route leaks into a non-run bundle |
| G8 | **Localization completeness** | Any locale is missing a key present in the source locale |
| G9 | **No-magic-number check** | A gameplay literal exists outside the tuning module |
| G10 | **No-ambient check** | `Math.random`, `Date.now` or `performance.now` appears in `game/domain/` |
| G11 | **Boundary check** | Phaser is imported from `game/domain/` or from `app/` |
| G12 | **Token check** | A raw hex colour exists outside the token module |
| G13 | **Private-material check** | Anything under `design-reference/private-source/` is tracked |
| G14 | **Build-output check** | `node_modules/`, `.nuxt/`, `.output/` or `dist/` is tracked |
| G15 | **Secret scan** | A credential-shaped string is committed |
| G16 | **No persisted Loli queue** | `owedLoliBonuses` (any casing) appears anywhere in the repository |
| G17 | **No bearer token in browser storage** | `localStorage`/`sessionStorage` is written with anything token-shaped |
| G17a | **Loli activation semantics** | A threshold earned but never started is counted as an activation, or unmuting fails to restore the previous volume |

G9–G14 are cheap static checks that encode approved rules. They exist because
each of them is a rule that is easy to break accidentally and expensive to unwind
later.

---

## 3. Pre-merge gates — PROPOSED

| # | Gate | Fails when |
| --- | --- | --- |
| G18 | **End-to-end suite** | Any approved flow regresses |
| G19 | **Accessibility audit** | A non-canvas screen regresses on semantics, naming, or contrast |
| G20 | **Bundle budget** | The initial route bundle exceeds its budget, or Phaser appears outside the run route |
| G21 | **Documentation sync** | Behavior changed without the specification or ADRs being updated |
| G22 | **Decision-status check** | An OPEN item was implemented, or a PROPOSED value was presented as approved |

---

## 4. Milestone-exit gates — APPROVED

In addition to all of the above:

| # | Gate |
| --- | --- |
| M-A | Every acceptance criterion in [`../product/milestones.md`](../product/milestones.md) for that milestone is met |
| M-B | New tunables are registered in [`../game/tuning-parameters.md`](../game/tuning-parameters.md) with a status |
| M-C | New or changed decisions are reflected in [`../product/open-decisions.md`](../product/open-decisions.md) |
| M-D | Any conflict discovered is recorded in [`../product/design-reference-conflicts.md`](../product/design-reference-conflicts.md) |
| M-E | The final diff was reviewed for scope creep and regressions |
| M-F | No approved product behavior was changed silently |

---

## 5. Performance gates — PROPOSED

From M7, when there is a real run to measure:

| # | Gate | Threshold |
| --- | --- | --- |
| P1 | Sustained frame rate on a mid-range mobile device | ≥ 30 fps floor, 60 fps target |
| P2 | Long tasks during a run | None exceeding one frame budget |
| P3 | Memory after ten consecutive runs | No monotonic growth — proves Phaser teardown works |
| P4 | Time to first interaction on a warm cache | Within the budget in [`../architecture/frontend-architecture.md`](../architecture/frontend-architecture.md) §7 |

P3 is listed explicitly because a leaked Phaser instance is the single most
likely performance defect in this architecture, and it is invisible in a
single-run test.

---

## 6. Security gates — APPROVED

| # | Gate |
| --- | --- |
| S1 | No secret in the bundle or in client-visible runtime config |
| S2 | No private source material in any deployed artifact |
| S3 | No frontend check is relied on as an authorization control |
| S4 | No personal data in logs, telemetry, or error reports |
| S6 | No bearer token is written to `localStorage` or `sessionStorage` |
| S7 | Every state-changing BFF request carries a CSRF token, and one without it is rejected |
| S5 | Dependency audit shows no unresolved high-severity advisory (from M1) |

---

## 7. When a gate fails — APPROVED

Fix the cause. Do not:

- disable the gate,
- mark the test skipped,
- retry until it passes,
- lower the threshold to accommodate the change.

If a gate is genuinely wrong, change it deliberately, in its own change, with the
reason recorded.
