# Achievements and Character Unlocks

**Status legend:** APPROVED / PROPOSED / OPEN.

---

## 1. Achievements

### 1.1 Approved shape — APPROVED

Claude Design v0.3 board 16 establishes:

- a fixed catalogue of **16 achievements**, with a `n/16` header;
- each achievement has an **icon, title, description** and one of three states:
  **in progress** (with a counter such as `18/25`), **unlocked**, or **locked**;
- a locked achievement may hide its reward ("gizli ödül");
- a new unlock is celebrated — the badge spins with confetti and a SLAYYY sound
  plays. This celebration must honour the reduced-motion setting.

### 1.2 What happened to the v0.3 six — APPROVED

Claude Design v0.3 named six achievements. **Three survive unchanged, two are invalid, and one
is superseded.**

| v0.3 achievement | Condition as written | Outcome |
| --- | --- | --- |
| **Koni Koleksiyoncusu** | Hit 25 cones | **SUPERSEDED by product review** — see §1.3 |
| **Ramak Kala** | Survive 50 near misses | **Retained** — the mechanic is now APPROVED, see [core-run.md](core-run.md) §5A |
| **SLAYYY Ustası** | Use SLAYYY 10 times | **Retained** |
| **Loli'nin Gözdesi** | Trigger the Loli Bonus 5 times (hidden reward) | **Retained**, with "trigger" now meaning an **actual activation** — see §1.5A |
| **Çay Molası** | Collect 3 teas in one run | **REMOVED — invalid for v1** |
| **Trileçe Avcısı** | Collect 10 trileçe | **REMOVED — invalid for v1** |

### 1.3 Removals and supersession — APPROVED

#### Çay Molası and Trileçe Avcısı — removed as invalid

Both require collecting **Çay** and **Trileçe**, which are **not functional gameplay mechanics
in v1**. They are personalization concepts that appeared in approved visual design and whose
gameplay behaviour was never approved — see
[deferred-design-exploration.md](deferred-design-exploration.md).

An achievement that can never progress is not an achievement. Both definitions are **removed
from the catalogue**, not shipped as permanently-zero entries.

#### Koni Koleksiyoncusu — superseded by product review

"Hit 25 cones" **rewards intentional collision**. It asks the player to do the one thing the
game is otherwise built to punish, and it directly contradicts the authoring constraint that an
achievement must not encourage deliberate failure.

It is therefore **superseded by product review** — a deliberate, reviewed decision, recorded
here rather than silently retained or silently dropped. Its proposed replacement is
`cone_dodger` (§1.5), which measures the same subject matter — the player's relationship with
cones — from the skill side.

### 1.4 Achievement progression authority — APPROVED

**Client-reported summary counters alone are insufficient for authoritative achievement
progression.**

1. The client may **emit** gameplay events / telemetry.
2. The server **validates** the accepted run.
3. Achievement progression is **derived server-side** from accepted, validated telemetry and
   authoritative persistent data.

A trusted client aggregate capped by plausibility checks is **not** an acceptable final
verification model. Plausibility bounds cap a number; they do not establish it. With a public
leaderboard attached, "capped but unverified" is a number a determined client can still choose.

#### Two independent questions, two columns — APPROVED

A single classification column conflated two different things. They are separated:

```
  Client events → validated telemetry → authoritative run facts → persistent aggregates
                  └── Verification Source ──┘        └─── Progress Persistence ───┘
```

| Column | Values | Answers |
| --- | --- | --- |
| **Verification Source** | `DERIVED_PERSISTENT` · `DERIVED_TELEMETRY` | Where the **evidence** comes from |
| **Progress Persistence** | `PERSISTED_AGGREGATE` · `RUN_FACT` | How progress is **stored** after derivation |

| Value | Meaning |
| --- | --- |
| `DERIVED_PERSISTENT` | Evidence comes entirely from authoritative stored progression and run records |
| `DERIVED_TELEMETRY` | Evidence is computed server-side from accepted run telemetry |
| `PERSISTED_AGGREGATE` | Progress accumulates across runs in an authoritative server-side counter |
| `RUN_FACT` | Satisfied by a **single accepted run's** authoritative fact; no cross-run accumulation needed |

**Governing rule — APPROVED:**

> **Do not reclassify an achievement as `DERIVED_PERSISTENT` merely because its cumulative
> total is stored persistently after derivation.**

"Stored in the database" is not the same as "not derived from telemetry". A lifetime counter
built by incrementing a telemetry-derived run fact has a **telemetry** verification source and
a **persisted** progress model. Both facts matter, and they are recorded separately.

**Consequence:** [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md)
must retain enough validated event data — or derive enough authoritative run facts at
acceptance — to reproduce achievement progression without trusting client summary counters.
The retention *design* remains PROPOSED; the authority rule is APPROVED.

### 1.5 The proposed 16-achievement catalogue — PROPOSED

**Not approved.** Presented for product review **as a whole**, because the catalogue has to
balance as a set: difficulty spread, group coverage, and the number of entries that force
telemetry retention.

Every entry has a **stable machine key independent of localized display text**. All conditions
count **accepted runs only** — flagged and rejected runs never contribute.

| # | Key | Group | Condition | Verification Source | Progress Persistence | Origin |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `cone_dodger` | obstacles | **Successfully avoid 500 traffic cones across accepted runs.** Each safely passed cone increments progress by one. | `DERIVED_TELEMETRY` | `PERSISTED_AGGREGATE` | **PROPOSED** — replaces the superseded "hit 25 cones" |
| 2 | `close_call` | near miss | 50 near misses lifetime | `DERIVED_TELEMETRY` | `PERSISTED_AGGREGATE` | v0.3 |
| 3 | `slayyy_master` | SLAYYY | 10 SLAYYY activations lifetime | `DERIVED_TELEMETRY` | `PERSISTED_AGGREGATE` | v0.3 |
| 4 | `lolis_favourite` | Loli | 5 **actual** Loli Bonus activations lifetime · hidden reward | `DERIVED_TELEMETRY` | `PERSISTED_AGGREGATE` | v0.3 |
| 5 | `first_run` | progression | Complete 1 accepted run | `DERIVED_PERSISTENT` | `PERSISTED_AGGREGATE` | PROPOSED |
| 6 | `sixty_seconds` | run performance | Survive ≥ 60 s in one accepted run | `DERIVED_PERSISTENT` | `RUN_FACT` | PROPOSED |
| 7 | `three_minutes` | run performance | Survive ≥ 180 s in one accepted run | `DERIVED_PERSISTENT` | `RUN_FACT` | PROPOSED |
| 8 | `paw_starter` | paws | 100 paws lifetime | `DERIVED_PERSISTENT` | `PERSISTED_AGGREGATE` | PROPOSED |
| 9 | `paw_hoarder` | paws | 1,000 paws lifetime | `DERIVED_PERSISTENT` | `PERSISTED_AGGREGATE` | PROPOSED |
| 10 | `paw_sprint` | paws | 50 paws in one accepted run | `DERIVED_PERSISTENT` | `RUN_FACT` | PROPOSED |
| 11 | `loli_devotee` | Loli | 20 **actual** Loli Bonus activations lifetime | `DERIVED_TELEMETRY` | `PERSISTED_AGGREGATE` | PROPOSED |
| 12 | `slayyy_double` | SLAYYY | 2 SLAYYY activations in one accepted run | `DERIVED_TELEMETRY` | `RUN_FACT` | PROPOSED |
| 13 | `nerves_of_steel` | near miss | 10 near misses in one accepted run | `DERIVED_TELEMETRY` | `RUN_FACT` | PROPOSED |
| 14 | `regular` | progression | 25 accepted runs | `DERIVED_PERSISTENT` | `PERSISTED_AGGREGATE` | PROPOSED |
| 15 | `devoted` | progression | 100 accepted runs | `DERIVED_PERSISTENT` | `PERSISTED_AGGREGATE` | PROPOSED |
| 16 | `score_5000` | high score | Best accepted single-run score ≥ 5,000 | `DERIVED_PERSISTENT` | `RUN_FACT` | PROPOSED |

**By verification source: 9 `DERIVED_PERSISTENT`, 7 `DERIVED_TELEMETRY`.**
**By progress persistence: 10 `PERSISTED_AGGREGATE`, 6 `RUN_FACT`.**

The seven `DERIVED_TELEMETRY` entries — rows 1, 2, 3, 4, 11, 12, 13 — are exactly what force
ADR-0006 to retain validated event data or derive authoritative run facts at acceptance. They
draw on four run-level facts: **obstacle passes**, **near misses**, **SLAYYY activations**, and
**actual Loli activations**.

#### Authoring constraints each entry satisfies

| Constraint | How |
| --- | --- |
| Derives from approved gameplay | Only the four v1 verbs — obstacle, paw, SLAYYY, heart — plus near miss, now approved |
| Objectively measurable | Every condition is a count or a threshold, never a judgement |
| Server-verifiable | Every entry is `DERIVED_PERSISTENT` or `DERIVED_TELEMETRY`; none is client-asserted |
| Avoids rejected/deferred mechanics | No Çay, no Trileçe, no combo, no slide, no healing |
| Avoids failure exploits | **No entry rewards collision, death, or deliberate failure** |
| Stable machine key | Keys are English, lowercase, snake_case, independent of display text in tr/en/es |

#### Notes carried into implementation

- **`cone_dodger` counts safe passes, not a streak.** Each safely passed cone increments
  progress by one. **A cone collision neither increments nor resets progress** — it simply does
  not count that cone. The achievement rewards skill without punishing failure twice, and it is
  explicitly **not** a "500 cones without a single collision" run.
- **`lolis_favourite` and `loli_devotee` count *actual* Loli Bonus activations** — see §1.5A.
  They are `DERIVED_TELEMETRY` because activation cannot be inferred from the paw ledger.
- **`slayyy_master` and `slayyy_double` are `DERIVED_TELEMETRY`** because activation is a player
  action, not a derivable consequence of the ledger.
- **Difficulty is spread** so a first session unlocks at least one (`first_run`, and usually
  `paw_starter`), while `devoted` and `score_5000` remain long-term.

#### Rejected drafts — recorded so they are not re-proposed

| Draft | Why rejected |
| --- | --- |
| "Trigger the Loli Bonus twice in one run" | Needs 400 paws in a single run, against observed per-run values of +18 and +42. Effectively unreachable. |
| "3 Loli Bonuses in a single run" | 600 paws in a run. Same problem, worse. |
| Retaining "hit 25 cones" | Rewards intentional collision (§1.3) |

### 1.5A Loli activation is a distinct fact — APPROVED

**Crossing a 200-paw threshold does not mean a Loli Bonus happened.**

Because queued bonuses are **run-scoped and discarded when the run ends**, a threshold can be
earned and consumed without the bonus ever starting. Three concepts, named distinctly
everywhere — schema, API, telemetry and UI:

| Concept | Meaning |
| --- | --- |
| **Threshold earned** | 200 paws crossed. `loliCyclePaws` is consumed and overflow preserved. |
| **Queued** | Earned while a bonus was already active. Increments `queuedLoliBonuses` **for that run**. |
| **Activated** | The bonus **actually started** — the ENTERING/ACTIVE transition in the run state machine. |

**An activation counts only when the bonus actually starts.** A threshold crossed but never
started — because the run ended first — is **not** an activation.

| Rule | Detail |
| --- | --- |
| Authoritative run fact | The accepted run exposes **`loliActivations`**, derived from validated telemetry / run events |
| **Never derived from the paw ledger** | The ledger records thresholds earned, which is a different number |
| Lifetime totals | May be persisted server-side after run acceptance — `DERIVED_TELEMETRY` source, `PERSISTED_AGGREGATE` persistence |
| Consumers | `lolis_favourite`, `loli_devotee`, and **Sero's character unlock** (§2.2) |

Left unseparated, a player could earn thresholds in a long run, have them expire unstarted, and
still be credited with bonuses they never saw — which is both wrong and, on a public
leaderboard, exploitable.

### 1.6 Evaluation model — PROPOSED

| Aspect | PROPOSED |
| --- | --- |
| Where evaluated | **Server-side, on run submission.** The client may show optimistic progress, but the server decides. |
| When | Once per accepted run, inside the same transaction as the run result |
| Idempotency | An unlock is idempotent per `(player, achievement)`. Re-submitting a run never double-unlocks or double-counts. |
| Progress counters | Monotonic, race-safe, backed by database constraints rather than application checks |
| In-run celebration | The client may celebrate immediately on a locally-detected unlock, then reconcile with the server response |
| **Source of truth** | Per §1.4, progression is **derived** from accepted, validated telemetry and authoritative persistent data — never adopted from a client summary counter |

---

## 2. Character unlocks

### 2.1 Approved shape — APPROVED

| Character | Status | Unlock label in v0.3 |
| --- | --- | --- |
| **Ayşenur** | Available. ⭐ "our star". `özel güç: SLAYYY ✨` | — |
| **Büşo** | Locked | `2.500 puan` |
| **Ogito** | Locked | `10 koşu` |
| **Sero** | Locked | `Loli Bonusu ×3` |

v0.3 also notes: *"arkadaş görselleri eklenince açılacak"* — these characters
become available when the friend artwork exists.

### 2.2 Unlock semantics — APPROVED

The v0.3 labels were ambiguous; each admitted readings differing by orders of magnitude. These
are now decided. **All three are deterministic and server-derived.**

| Character | v0.3 label | **Approved criterion** | Verification Source | Rationale |
| --- | --- | --- | --- | --- |
| **Büşo** | `2.500 puan` | **Best accepted single-run score ≥ 2,500** | `DERIVED_PERSISTENT` | v0.3 shows per-run scores of 1,284–5,847, so 2,500 is a real single-run target. As a lifetime aggregate it falls in two runs and means nothing. |
| **Ogito** | `10 koşu` | **Complete 10 accepted runs.** No separate minimum-duration criterion. | `DERIVED_PERSISTENT` | Whether a run is accepted is decided by the **run-validation system**. Anti-farming belongs there, not in a second hidden rule that would compete with it and need separate tuning. |
| **Sero** | `Loli Bonusu ×3` | **3 lifetime *actual* Loli Bonus activations.** Threshold crossings and queued-but-never-started bonuses do **not** count. | `DERIVED_TELEMETRY` | 3 in a *single run* requires 600 paws against observed per-run values of +18 and +42 — effectively impossible, so single-run cannot be the intent. Activation is a telemetry-derived fact (§1.5A), never a ledger inference. |

**Ogito's simplification retires AU-7.** There is no minimum-duration threshold to tune and no
`accepted_runs_above_min_duration` counter — a plain accepted `run_count` suffices.

#### Persisted counters

| Counter | Feeds | Verification Source | Progress Persistence |
| --- | --- | --- | --- |
| `bestScore` | Büşo | `DERIVED_PERSISTENT` | `PERSISTED_AGGREGATE` |
| `runCount` (accepted) | Ogito | `DERIVED_PERSISTENT` | `PERSISTED_AGGREGATE` |
| `lifetimeLoliActivations` | Sero, `lolis_favourite`, `loli_devotee` | **`DERIVED_TELEMETRY`** | `PERSISTED_AGGREGATE` |

`lifetimeLoliActivations` counts **actual activations only**, accumulated from the accepted
run's `loliActivations` fact. It is **not** the count of thresholds earned.

The alternative-reading counters are retired: `lifetimeScore`, `maxLoliBonusInSingleRun` and
`accepted_runs_above_min_duration` are no longer recorded.

### 2.3 Two gates, not one — APPROVED

A character becomes playable only when **both** hold:

1. the player has met the unlock criterion, **and**
2. the character's **approved artwork exists** (v0.3: *"unlocks when friend
   artwork is added"*).

The second gate is a content gate, not a player-progress gate, and the UI must be
able to express "you have earned this, it is not ready yet" without implying the
player failed.

### 2.4 Do other characters have their own power? — OPEN

Ayşenur's card states `özel güç: SLAYYY ✨`. Listing a special power *per
character* implies other characters may have different powers. Nothing confirms
this.

**PROPOSED:** in v1, **all characters share SLAYYY**. Per-character powers would
multiply the balance, tuning, art and anti-cheat surface for a feature no
reference actually specifies.

### 2.5 Likeness and consent — APPROVED constraint

Büşo, Ogito and Sero are named after **real people**, as are Ayşenur and Loli.
Documented consent is required before their likenesses ship. Private source
photographs are never committed, published, bundled, or served. See
[licensing-and-rights.md](licensing-and-rights.md).

---

## 3. Open questions owned by this document

| Ref | Question |
| --- | --- |
| AU-1 | **Approval of the proposed 16-achievement catalogue as a whole** (§1.5) — **blocks M11** |
| AU-5 | Do non-Ayşenur characters have their own special power? (§2.4) |
| AU-6 | Achievement reward content — what "gizli ödül" actually grants |
| AU-8 | Display text in tr/en/es for all 16 machine keys, once the catalogue is approved |

**Resolved by M0.5:**
AU-2 — Çay Molası and Trileçe Avcısı are **removed as invalid** (§1.3).
AU-3 — near-miss detection is **APPROVED** in [core-run.md](core-run.md) §5A; only its
geometric threshold remains PROPOSED tuning.
The former "ten undefined achievements" gap is closed by the §1.5 proposal, which now needs
approval rather than authoring.

**Resolved by M0.6:**
AU-4 — unlock semantics are **APPROVED** (§2.2).
AU-7 — **retired.** Ogito has no minimum-duration criterion; run acceptance is decided by the
run-validation system.
