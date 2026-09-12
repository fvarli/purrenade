# Purrenade — Product / Game Specification (v1 draft)

**This document is authoritative for product behavior.** Where a visual reference
conflicts with it, this document wins for behavior. Where it is silent, the
matter is OPEN — it is not implied, and it is not invented.

**Status legend:** APPROVED / PROPOSED / OPEN — see [`../README.md`](../README.md).
PROPOSED and OPEN are never silently promoted to APPROVED.

---

## 1. How this specification is organized

This file is the entry point and holds the cross-cutting rules. Detailed behavior
lives in the companion documents below, all of which are part of the specification.

| Area | Document |
| --- | --- |
| Identity, platforms, v1 boundary | [product-overview.md](product-overview.md) |
| Lanes, input, jump, collision, hearts, run lifecycle | [core-run.md](core-run.md) |
| Difficulty model, obstacle catalogue, pattern generation | [difficulty-and-obstacles.md](difficulty-and-obstacles.md) |
| Score, paws, SLAYYY, Loli Bonus, overlap | [scoring-and-progression.md](scoring-and-progression.md) |
| Tutorial | [tutorial.md](tutorial.md) |
| Screens and navigation | [screen-inventory.md](screen-inventory.md) |
| Achievements and character unlocks | [achievements-and-unlocks.md](achievements-and-unlocks.md) |
| Leaderboards | [leaderboards.md](leaderboards.md) |
| Localization | [localization.md](localization.md) |
| Accessibility | [accessibility.md](accessibility.md) |
| Tunable values | [../game/tuning-parameters.md](../game/tuning-parameters.md) |

---

## 2. The game in one paragraph — APPROVED

Ayşenur runs along a seaside promenade that scrolls toward the player across
three lanes. The player dodges obstacles by changing lane or jumping, and
collects Paw Tokens. Paw progress persists across runs; every 200 paws summons
**Loli**, who runs alongside for a short time and magnetically attracts nearby
paws. A separate, run-local charge fills the **SLAYYY** meter; when the player
activates it, the world transforms, scoring doubles, and Ayşenur is briefly
invulnerable. The player starts each run with three hearts, loses one per
collision, and the run ends at zero. The score is the product.

---

## 3. Cross-cutting invariants — APPROVED

These hold everywhere. A change to any of them is a change to approved product
behavior and requires the formal change report in `CONTRIBUTING.md`.

1. **Maximum health is 3.** A run starts at 3 hearts. There is **no healing
   mechanic in v1**. Nothing restores a heart: not SLAYYY, not Loli, not any
   pickup, not a score threshold.
2. **A fair run is always survivable.** Every generated obstacle pattern has at
   least one valid escape path reachable with the player's available actions at
   the current difficulty. Difficulty never removes this guarantee.
3. **Difficulty is soft-capped.** It never grows without bound into an
   impossible state, and it never relies on raw movement speed alone.
4. **The player is never killed by the tutorial.** See [tutorial.md](tutorial.md).
5. **SLAYYY never activates itself.** Reaching full charge arms it; only the
   player fires it.
6. **The frontend is never trusted for authorization or for score truth.** Every
   protected action is authorized server-side, and submitted run results are
   validated server-side.
7. **Gameplay-critical state is never hidden by layout.** Score, hearts,
   Paw/Loli progress, SLAYYY state and pause are present on every form factor.
   Presentation may differ responsively; information may not be lost.
8. **No text is baked into images.** All player-facing copy is localizable and
   switches instantly between tr/en/es.
9. **No magic numbers.** Every tunable value is named in
   [../game/tuning-parameters.md](../game/tuning-parameters.md) and read from
   configuration, not scattered through code.

---

## 4. Run lifecycle — APPROVED

```
  Main Menu
     │  PLAY
     ▼
  Run start  ──►  Running  ──►  Run end (hearts = 0)  ──►  Game Over / New High Score
                   │   ▲                                          │
            PAUSE  │   │ RESUME                                   │ REPLAY
                   ▼   │                                          ▼
                 Paused ┘                                    Run start
```

- A run begins from the main menu (or from **BİR DAHA! / Play again** on the
  game-over screens).
- A run ends when hearts reach zero. There is no revive, no continue, and no
  second chance in v1 — the game-over screen offers only *play again* and
  *return to menu*.
- Pausing freezes simulation and preserves the score. The pause screen states
  explicitly that the score is safe.
- The score is shown against the player's personal record throughout the run.

**PROPOSED:** a short run-start readiness beat (see
[core-run.md](core-run.md#run-start)) before input is accepted, so the first
obstacle is never unfair.

---

## 5. Scoring summary — APPROVED

Score is composed of:

- **distance / survival score** — accrues continuously while running,
- **collectible score** — paws,
- **bonus score** — awarded by defined events,
- **SLAYYY multiplier** — ×2 while active.

There is **no combo system in v1**. Exact rates, the multiplier's scope, and the
SLAYYY/Loli overlap rule are specified in
[scoring-and-progression.md](scoring-and-progression.md).

---

## 6. Persistence summary — APPROVED

| Data | Lifetime |
| --- | --- |
| `lifetimePaws` | Permanent statistic; never consumed. |
| `loliCyclePaws` | Persists **across runs**; consumed in blocks of 200 when Loli Bonus triggers. |
| `runPaws` | Current run only; reported at run end. |
| SLAYYY charge | **Run-local.** Never carries across runs. |
| Hearts | Run-local. |
| Best score, run count, achievements, unlocks, tutorial completion | Permanent, on the player profile. |

Progression is owned by the backend. The client displays it and proposes changes;
the server decides. See [../architecture/api-client.md](../architecture/api-client.md)
and the backend's `docs/security/anti-cheat.md`.

---

## 7. Authentication summary — APPROVED

Authentication is **required**; Purrenade is not guest-first. The approved
product surface is:

- registration,
- email/password login,
- **email verification via a 6-digit code** with a resend cooldown,
- **forgot/reset password via an emailed link**,
- **2FA (TOTP authenticator app) with backup codes** — recommended for all
  players, **mandatory for the admin role**,
- role-aware access: `player` and `admin`,
- **server-side authorization**; no trust in frontend authorization,
- active session/device management, including logout-all.

The admin panel uses a **separate, plain interface** that does not adopt the
game's visual identity.

Screen-level behavior is in [screen-inventory.md](screen-inventory.md).
Transport, token and enforcement decisions are in
[ADR-0005](../decisions/ADR-0005-authentication-and-2fa-strategy.md) and the
backend's `docs/security/`.

---

## 8. What this specification deliberately does not decide

Everything listed in [open-decisions.md](open-decisions.md). The largest OPEN
items at the time of writing are the SLAYYY charge model, ten of the sixteen
achievements, the obstacle catalogue beyond the cone, the audio-control form,
the brand tagline, and whether a run is playable offline.

---

## 9. Change control

Approved product behavior is never changed silently. To propose a change, report:

1. current specification,
2. evidence / problem,
3. proposed alternative,
4. benefits,
5. risks and trade-offs,
6. scope and migration impact,
7. recommendation.
