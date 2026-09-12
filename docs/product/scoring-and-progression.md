# Scoring and Progression

Score, Paw Tokens, the Loli Bonus, SLAYYY, and how they interact.

**Status legend:** APPROVED / PROPOSED / OPEN.

---

## 1. Score composition — APPROVED

| Source | Description |
| --- | --- |
| **Distance / survival** | Accrues continuously while running |
| **Collectible** | Awarded for collecting Paw Tokens |
| **Bonus** | Awarded by defined events |
| **SLAYYY multiplier** | ×2 while SLAYYY is active |

**There is no combo system in v1** unless later explicitly approved. **Near misses award no
score** — see [core-run.md](core-run.md) §5A. As of M0.5 the *bonus* component has no defined
source; see §6.

### 1.1 Rates — PROPOSED

| Parameter | PROPOSED | Note |
| --- | --- | --- |
| `score.distancePerSecond` | `10` at base speed | Scales with actual scroll speed, so a faster run scores faster |
| `score.perPaw` | `5` | |
| `score.rounding` | floor, integer only | Displayed score is always an integer; no fractional accumulation is shown |

The v0.3 boards show scores in the 1,200–5,900 range for a session, which these
rates reproduce for runs of roughly 1.5–5 minutes.

### 1.2 Multiplier scope — PROPOSED

While SLAYYY is active, **×2 applies to distance, collectible and bonus score
alike.** The board label reads `SKOR ×2` without qualification, and a
partial multiplier is harder to explain than a total one.

### 1.3 Score integrity — APPROVED

The displayed score is a client-side projection. The **authoritative score is
decided by the backend** on run submission. The client never asserts a score the
server must accept. See the backend's `docs/security/anti-cheat.md`.

**PROPOSED:** the specification defines a plausibility ceiling —
`score.maxPlausiblePerSecond` — derived from the maximum attainable rate
(peak speed × ×2 multiplier × maximum collectible density). The server uses it as
one of several validation signals.

---

## 2. Paw Tokens — APPROVED

Paw Tokens are the **primary regular collectible** and the only collectible
mechanic in v1.

### 2.1 The three paw counters

There is no generic `paws` field. Three distinct concepts exist and must be named
distinctly everywhere — schema, API, state and UI.

| Field | Meaning | Lifetime |
| --- | --- | --- |
| `lifetimePaws` | Lifetime/statistical number of paws the player has collected | Permanent. Never consumed. |
| `loliCyclePaws` | Persistent progress toward the next Loli Bonus. Conceptually `0..199`, threshold `200`. | Persists **across runs**. Consumed in blocks of 200. |
| `runPaws` | Paws collected during the current run | Run-local. Reported at run end. |

### 2.2 Threshold behavior

When paw collection causes `loliCyclePaws` to reach or cross **200**:

1. **One Loli Bonus triggers per completed threshold.**
2. **200 is consumed** from the cycle progress.
3. **Overflow is preserved** toward the next cycle.

> Worked example: `loliCyclePaws = 198`, the player collects 5 paws →
> a Loli Bonus triggers and `loliCyclePaws` becomes **3**.

Paws collected through **Loli's magnet count normally** — toward `runPaws`,
`lifetimePaws` and `loliCyclePaws` alike. (v0.3 board 2a: *"ekstra pati
sayılır"*.)

### 2.3 Presentation — APPROVED

| Surface | Shows |
| --- | --- |
| Main menu / progression | `loliCyclePaws / 200` with a progress bar |
| In-run HUD | Current relevant paw progress |
| Game over | `+runPaws` |
| Profile / statistics | `lifetimePaws` |

**PROPOSED:** the in-run HUD shows the running `loliCyclePaws` value and switches
to an explicit `n/200` presentation once within `paw.hudThresholdProximity`
(PROPOSED `25`) of the threshold, matching the v0.3 boards which show a bare
`🐾 128` in one state and `🐾 200/200 ✓` in another.

### 2.4 Multiple thresholds in one run — APPROVED

**Earned Loli Bonuses are never lost within a run, and never bank beyond it.**

| Rule | Detail |
| --- | --- |
| Concurrency | **Only one Loli Bonus may be active at a time.** No two Loli companions run concurrently. |
| Crossing while active | The completed threshold is **preserved** and the additional bonus is **queued** — never stacked, never dropped |
| Dequeue | When the active bonus ends, the next queued bonus may start |
| **Run end** | **All active and queued Loli Bonus state ends with the run.** No queued bonus carries into a future run. |
| Consumed thresholds | A threshold already consumed during the run is **not** converted into a future-run entitlement |
| `loliCyclePaws` | Remains persistent, exactly as approved in §2.2. Only the *bonus* is run-scoped. |

**The Loli Bonus is a run-scoped gameplay reward, not a bankable meta-progression currency.**
That is the reason for the run-end rule: a player who banks bonuses could open a run already
holding 24 seconds of magnet, which is a different game from the one that was designed.

#### Model — APPROVED

Represented as an **explicit counter** in `RunState`:

```
queuedLoliBonuses: number   // run-scoped; 0..n; never persisted
```

Not a boolean pending flag — **more than one bonus may be queued within a single run**, and a
boolean silently discards the second. The counter increments on a threshold crossed while a
bonus is active, and decrements when a queued bonus starts.

| Where it lives | Where it does **not** live |
| --- | --- |
| `RunState` | Persistent progression |
| Run telemetry | The OpenAPI `Progression` schema |
| — | Any database column |

There is no `owedLoliBonuses` field anywhere in either repository.

#### Earned, queued, activated — three distinct concepts — APPROVED

**Crossing a threshold does not mean a Loli Bonus happened.** Because the queue is run-scoped
and discarded at run end, a threshold can be earned and consumed without the bonus ever
starting.

| Concept | Meaning | Where it lives |
| --- | --- | --- |
| **Threshold earned** | 200 paws crossed. `loliCyclePaws` consumed, overflow preserved. | Persistent paw ledger |
| **Queued** | Earned while a bonus was already active. Increments `queuedLoliBonuses`. | `RunState`, run-scoped |
| **Activated** | The bonus **actually started** — the ENTERING/ACTIVE transition. | Counted as `loliActivations` for the run |

**An activation counts only on actual start.** A threshold crossed but never started — because
the run ended first — is **not** an activation.

| Rule | Detail |
| --- | --- |
| Authoritative run fact | The accepted run exposes **`loliActivations`**, derived from validated telemetry / run events |
| **Never inferred from the paw ledger** | The ledger records thresholds *earned*, which is a different number |
| Lifetime total | `lifetimeLoliActivations`, accumulated server-side after run acceptance |
| Consumers | `lolis_favourite`, `loli_devotee`, and **Sero's character unlock** |

Without this separation, a player could earn thresholds late in a long run, have them expire
unstarted, and still be credited with bonuses they never saw — wrong on its own, and
exploitable once a public leaderboard is attached. See
[achievements-and-unlocks.md](achievements-and-unlocks.md) §1.5A.

---

## 3. SLAYYY — APPROVED

SLAYYY is the signature power and is **entirely separate from the Paw/Loli
system**.

| Property | Value |
| --- | --- |
| Charge | **Run-specific.** Never carries across runs. |
| Activation | **Player-activated.** Never auto-fires. |
| Duration | approximately **5 seconds** |
| Score | **×2** |
| Survival | **Invulnerability** for the duration |
| World | Beautifies/transforms the world — cones become flowers |
| Branding | Visually distinct from normal Purrenade branding; ✨ belongs to SLAYYY alone and is not used in the normal brand language |

### 3.1 Activation — APPROVED

**SLAYYY must never activate merely because the meter reaches full.** Reaching
full charge *arms* it; the player fires it.

| Platform | Activation |
| --- | --- |
| Mobile | The HUD element communicates charge progress while charging. When fully charged it exposes an **obvious, accessible activation affordance**; tapping it activates SLAYYY. |
| Desktop | **`E`** activates SLAYYY when ready. The on-screen control is also clickable. |

Accessibility requirements for the armed control (hit area, labelling, focus,
contrast) are in [accessibility.md](accessibility.md).

### 3.2 Charge model — PROPOSED

The exact charge model was explicitly deferred by the approved brief. This is a
reviewable proposal, not a decision.

| Parameter | PROPOSED | Rationale |
| --- | --- | --- |
| `slayyy.chargeMax` | `100` | Unitless meter |
| `slayyy.chargePerSecond` | `1.4` | Guarantees the power is reachable in a passive run |
| `slayyy.chargePerPaw` | `0.45` | Rewards engagement with the collectible loop |
| `slayyy.decay` | none | A decaying meter punishes cautious play and is hard to read at a glance |
| `slayyy.durationMs` | `5000` | APPROVED ≈ 5 s |
| First activation available at | ≈ 40 s of ordinary play | Late enough to matter, early enough to be seen in a first run |

Charge does **not** accrue while SLAYYY is active, and it does not carry across
runs. Re-activation within a single run is permitted once the meter refills.

### 3.3 During SLAYYY — APPROVED

- The player is invulnerable. Collisions deal no damage and cost no heart.
- **SLAYYY does not heal.** Hearts lost before activation stay lost.
- Obstacle generation is unchanged; only presentation transforms.
- Paw collection continues normally.

---

## 4. Loli Bonus — APPROVED

| Property | Value |
| --- | --- |
| Trigger | Paw progress reaching the 200 threshold |
| Duration | approximately **8 seconds** |
| Behavior | Loli follows/runs beside Ayşenur and **magnetically attracts nearby paws / eligible collectibles** |
| Survival | **Does NOT grant invulnerability.** The player may still take damage while Loli is active. |
| Relationship to SLAYYY | Does **not** replace SLAYYY. They are independent systems. |

Loli's animation states — idle, bonus entry ("puf"), follow/run, happy/reward,
exit ("puf") — are listed in [art-asset-requirements.md](art-asset-requirements.md).

### 4.1 Magnet — PROPOSED

| Parameter | PROPOSED | Note |
| --- | --- | --- |
| `loli.durationMs` | `8000` | APPROVED ≈ 8 s |
| `loli.magnetRadiusUnits` | `1.5` lanes | Reaches the adjacent lane but not across the whole road |
| `loli.magnetPullPerSecond` | `6.0` lane-units/s | Fast enough to feel magnetic, slow enough to be visible |
| `loli.eligibleCollectibles` | Paw Tokens only | The only collectible in v1 |

The magnet **never pulls the player**, never alters obstacles, and never changes
what is spawned.

---

## 5. SLAYYY and Loli overlap — APPROVED

SLAYYY and Loli **may overlap**. The overlap **must not create uncontrolled
multiplier stacking**.

### 5.1 Resolution rule — PROPOSED

**The Loli Bonus grants no score multiplier at all.** Its reward is collection
throughput, not multiplication. Therefore:

1. The **maximum score multiplier in v1 is ×2**, from SLAYYY alone.
2. **Multipliers never multiply with each other.** If a future multiplier source
   is introduced, the effective multiplier is `max(active multipliers)`, never
   their product.
3. During overlap the player receives: ×2 score (SLAYYY), invulnerability
   (SLAYYY), and paw attraction (Loli). Each effect ends with its own timer.
4. Timers run **independently and concurrently**. Neither extends, pauses, or
   truncates the other.

*Rationale:* Loli already multiplies score indirectly by increasing paws
collected. Letting it also multiply the rate would compound with SLAYYY and make
the highest scores a function of one lucky overlap rather than of skill — which
would in turn make leaderboard validation much harder.

The v0.3 art board titles one frame *"Oyun (SLAYYY & Loli)"*, confirming the
overlap is intended to be seen.

---

## 6. Bonus score — OPEN, and now without its leading candidate

The approved brief names "bonus score" as a component but does not define its sources.

**Near misses are no longer a candidate.** M0.5 approved near-miss as a
[statistics-only mechanic](core-run.md#5a-near-miss-ramak-kala--approved) that awards **no
score and no multiplier**. That removes the most obvious candidate source and leaves the
component with **no defined source at all**.

The remaining possibility visible in v0.3 is an achievement unlock awarding score, which is
itself unspecified.

**This stays OPEN.** No bonus source is implemented until it is specified, because each one
directly affects leaderboard fairness and server-side validation. If no source is ever
specified, the honest outcome is to **remove "bonus score" from the score composition** rather
than leave a component that never fires — that is itself a decision to take, not to default
into.

---

## 7. Persistence and authority — APPROVED

| Concern | Owner |
| --- | --- |
| Displaying score and progression | Frontend |
| Deciding score and progression | **Backend** |
| Paw ledger, thresholds, and unlock evaluation | **Backend**, race-safe and idempotent |
| SLAYYY charge | Frontend, run-local; never persisted |

Per-run paw telemetry is still recorded even when no threshold is crossed.

---

## 8. Open questions owned by this document

| Ref | Question |
| --- | --- |
| SP-1 | The SLAYYY charge model (§3.2) — PROPOSED, awaiting review |
| SP-2 | Bonus score sources (§6) — near-miss is now excluded, leaving none defined |
| SP-3 | Does the ×2 multiplier apply to collectible and bonus score, or distance only? (§1.2) |
| SP-4 | Confirmation of the "Loli grants no multiplier" overlap resolution (§5.1) |
| SP-5 | In-run paw HUD presentation near the threshold (§2.3) |
| SP-7 | Whether the HUD shows a queued-bonus indicator when `queuedLoliBonuses > 0` (§2.4) |
| SP-8 | Whether an activation that is cut short by run end still counts (PROPOSED: yes — it started) |
| SP-6 | Scoring rates (§1.1) |
