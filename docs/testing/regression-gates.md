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
| G16 | **No persisted Loli queue** | `owedLoliBonuses` (any casing) appears as an identifier in source under `app/`, `game/`, `server/`, `i18n/`, `tests/` or `shared/` |
| G17 | **No bearer token in browser storage** | `localStorage`/`sessionStorage` is written with anything token-shaped |
| G17a | **Loli activation semantics** | A threshold earned but never started is counted as an activation, or unmuting fails to restore the previous volume |
| G23 | **RNG-stream ownership** | A module draws from a stream it does not own — `pattern` belongs to `obstacles.ts`, `collectible` to `collectibles.ts`, and `cosmetic` to nothing yet |
| G24 | **Runtime art boundary** | A file under `app/` or `game/` carries a path into `design-reference/`, or a texture the run loads is missing, is not a PNG, or has no alpha channel |

G9–G14, G16, G23 and G24 are cheap static checks that encode approved rules. They
exist because each of them is a rule that is easy to break accidentally and
expensive to unwind later.

**G16 was reworded at M7, when it was first implemented.** It had said
"anywhere in the repository", and that is not a check anyone can write: this
very table names the rejected field, and so do four other documents and a test
comment, all of them in order to reject it. A gate that fails on its own
specification is a gate nobody can turn on. So it now strips comments from
source files and fails on what survives — a field, a key, a property access —
while prose stays free to name the thing it forbids. Proven at M7 in both
directions: adding `owedLoliBonuses` to `RunState` fails it, adding it as an
i18n key fails it, and the existing prose mentions do not.

**G23 is new at M7,** the milestone that gave the `collectible` stream its first
consumer. Determinism rests on the three streams being independent, and the
property tests can only prove that of the code that exists; ownership-by-file is
what stops a new module from quietly drawing from someone else's stream. It
cannot be satisfied by a draw count either: Paw Token spawning always draws
exactly two values and then rotates to a clear lane, rather than redrawing until
it finds one, so the number of draws never depends on the obstacle layout.

---

### 2.1 What CI actually executes in a browser — and what it does not

**CI runs 38 of the 89 browser tests. The other 51 never run there.**

*Counting convention, so the numbers can be re-derived:* a "browser test" is a
Playwright test in a product project. The `setup` project's single sign-in test
is a fixture, not a product test, and is excluded — which is why
`--list --project=chrome-auth` reports 45 while the project's own total is 44.

| Project | Own tests | Runs in CI | Against |
| --- | --- | --- | --- |
| `chrome` (anonymous) | 41 | **38** | **a production build** — `npm run build`, then `.output/server/index.mjs` on 4399 |
| `chrome-auth` | 44 | no — needs a session | the local dev stack |
| `chrome-touch` | 4 | no — needs a session | the local dev stack |

Three of `chrome`'s 41 are tagged `@stack`; CI runs `--grep-invert @stack`, so
they are part of the 51 that CI does not execute. **51 = 3 + 44 + 4.**

**Which suite runs against what is not interchangeable, and it is the anonymous
one that gets the production build.** CI builds, serves `.output/server/index.mjs`
on port 4399, and points `chrome` at it — so the bundle, the Nitro server and the
server-rendered HTML under test are the real artefacts. `chrome-auth` and
`chrome-touch` run against `https://purrenade.test`, the local **dev** stack,
because two local facts stand in the way of pointing them at the preview: the
preview's origin is not in the BFF's trusted-origin allowlist
(`NUXT_TRUSTED_ORIGINS`, which exists precisely so the `.test` hostname stays a
development fact), and the built server cannot reach the local API over its
self-signed certificate. Neither is worth weakening for a test.

Every test behind the signed-in `/run` route needs a verified account, and
standing one up in CI would mean running the Laravel API inside the frontend's
workflow — coupling two deliberately independent repositories
([ADR-0001](../decisions/ADR-0001-separate-frontend-backend-repositories.md)).
So those two projects are run locally and reported per milestone rather than
enforced per commit.

The gap is not allowed to widen silently: the `Account for every browser case
this job cannot run` step lists the unrunnable specs by name and fails if that
set changes, so a new spec must either run anonymously or be recorded there with
its reason. A spec that quietly stopped executing used to look exactly like a
spec that passes.

**This is a real residual, not a solved problem.** It is recorded here because
the milestone reports would otherwise be the only place it is written down.

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

There is a real run to measure from M7 onwards. These thresholds are still
PROPOSED: M7 added no performance instrumentation, so none of P1-P4 has been
measured yet.

| # | Gate | Threshold |
| --- | --- | --- |
| P1 | Sustained frame rate on a mid-range mobile device | ≥ 30 fps floor, 60 fps target |
| P2 | Long tasks during a run | None exceeding one frame budget |
| P3 | Memory after ten consecutive runs | No monotonic growth — proves Phaser teardown works |
| P4 | Time to first interaction on a warm cache | Within the budget in [`../architecture/frontend-architecture.md`](../architecture/frontend-architecture.md) §7 |

P3 is listed explicitly because a leaked Phaser instance is the single most
likely performance defect in this architecture, and it is invisible in a
single-run test.

### 5.1 Measured at M7 — the simulation's own bounds

P1–P4 are all *rendered* measurements and none has been taken. What M7 did
measure is the half that needs no device: the pure simulation, driven headless.

**Twenty simulated minutes, 144 000 fixed steps, a player who cannot die:**

| Quantity | Peak | Note |
| --- | --- | --- |
| Paw Tokens held in `RunState` | **9** | 1 638 were created; 554 were collected and the rest left the world |
| Obstacles held in `RunState` | **10** | unchanged in shape from M6 |
| Queued Loli Bonuses | **0** | see below |
| Collected tokens surviving their own step | **0** | structural: collection removes them |

**Sixty thousand steps, timed:** 423 ms total, **7 µs per step**, about
**1 180× real time**, and a heap that came back 1.1 MB *smaller* than it started
— no monotonic growth across eight simulated minutes.

**The queue almost never forms, and that is worth knowing.** A threshold takes
roughly seven minutes of collecting to reach and a bonus lasts eight seconds, so
crossing a second threshold while one is running is about a one-in-five-hundred
event. The queue is approved, implemented and tested by construction; ordinary
play will essentially never exercise it. That is an argument for the tests
carrying it, not for the code dropping it.

Score rates were re-measured at the adversarial review, after `score.perPaw`
was approved at `10`. A representative healthy run scores **1 740 – 1 890** at
1.5 minutes, **4 020 – 4 300** at 3 minutes and **7 310 – 7 620** at 5 minutes,
so the v0.3 boards' 1 200 – 5 900 range now corresponds to roughly one to four
minutes of play rather than 1.5 to five. That is the approved paw value's
arithmetic, recorded rather than corrected;
[scoring-and-progression.md](../product/scoring-and-progression.md) §1.1 owns it
and names `score.distancePerSecond` — still PROPOSED — as the lever.

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
