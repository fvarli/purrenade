# Difficulty and Obstacles

**Status legend:** APPROVED / PROPOSED / OPEN.

---

## 1. Difficulty principles — APPROVED

1. Difficulty **increases over time**.
2. It **must not rely only on raw movement speed**.
3. It scales across four dimensions: **movement speed**, **spawn density**,
   **pattern complexity**, and **decision frequency**.
4. It uses a **soft cap** rather than unbounded growth into an impossible state.
5. Every generated pattern retains a **guaranteed valid escape path**.

Principle 5 is a hard invariant: it is enforced by the generator and verified by
tests, not left to designer discipline.

---

## 2. The four dimensions — PROPOSED

| Dimension | What it controls | Why it is separate |
| --- | --- | --- |
| **Movement speed** | How fast the world scrolls | Alone it just compresses reaction time until the game becomes a reflex test |
| **Spawn density** | How much of the road is occupied | Creates pressure without shortening reaction time |
| **Pattern complexity** | Which patterns are eligible | Multi-step patterns demand planning, not reflex |
| **Decision frequency** | How often the player must act | The real fatigue driver; a fast but empty road is easy |

### 2.1 Soft cap shape — PROPOSED

Each dimension approaches its own ceiling asymptotically rather than being
clamped. For a dimension with base `b`, ceiling `c` and time constant `k`:

```
value(t) = c - (c - b) * exp(-t / k)
```

This produces a fast early ramp that the player feels, and a late-run plateau
where survival depends on execution rather than on the game outrunning human
reaction time.

| Parameter | PROPOSED | Note |
| --- | --- | --- |
| `difficulty.speed.base` | 1.00× | Reference scroll speed |
| `difficulty.speed.ceiling` | 1.85× | Never faster than this |
| `difficulty.speed.timeConstantS` | 90 | Reaches ~63% of the gap at 90 s |
| `difficulty.density.base` | 0.25 | Fraction of road-length occupied |
| `difficulty.density.ceiling` | 0.55 | |
| `difficulty.decisionsPerMin.base` | 14 | |
| `difficulty.decisionsPerMin.ceiling` | 38 | |

> **What M6 actually consumes — implementation note.** Of the four dimensions, the generator
> reads two directly: **movement speed** through `difficulty.speed` (continuous, per step) and
> **pattern complexity** through the tier pools (discrete). **Spawn density** and **decision
> frequency** are realised only *indirectly*, by `generator.minGapUnits`, which is a per-tier
> constant — the road gets fuller and decisions arrive more often as the tier rises, but in five
> steps rather than along the curves above. `densityTarget()` and `decisionsPerMinute()` exist,
> are tested, and are **not read by the generator**. Wiring them in changes difficulty feel, so it
> is a product decision rather than an implementation detail, and it is deliberately not taken here.
> Principle 3 in §1 stays APPROVED and stays satisfied; this note records how completely, so the
> curves are not mistaken for something the game already runs on.

### 2.2 Driver: time or distance — PROPOSED

Difficulty is driven by **elapsed run time**, not distance.

*Rationale:* distance is itself a function of speed, so a distance-driven curve
compounds with the speed dimension and produces a runaway ramp. Time is also the
value the player perceives and the value a server can sanity-check against a
submitted score.

### 2.3 Tiers — thresholds APPROVED, pools PROPOSED

Continuous curves drive feel; discrete tiers gate which pattern pools are
eligible, so that pattern complexity is reviewable and testable.

| Tier | Starts at | Pattern pool | Character |
| --- | --- | --- | --- |
| **Tier 1** | 0 s | Introductory | Single obstacles, generous spacing |
| **Tier 2** | 30 s | Basic | Two-lane blocks; one decision at a time |
| **Tier 3** | 60 s | Intermediate | Sequences requiring a planned lane path |
| **Tier 4** | 120 s | Advanced | Mixed dodge/jump; tighter recovery windows |
| **Tier 5** | 180 s | Peak | Full pool at the soft-capped ceilings |

**Tier 5 is terminal:** it does not escalate further. A skilled player's run length is bounded
by concentration, not by the game becoming impossible.

> **Thresholds — corrected and APPROVED at M6.** The product decision is
> **0 / 30 / 60 / 120 / 180 seconds**. This document carried `0 / 25 / 60 / 110 / 180` from the
> repository's first commit and it was never edited, so a value that was only ever PROPOSED came to
> look settled purely by longevity. It had not been approved: DO-3 recorded these thresholds as
> unconfirmed from M0.5 onward, and the naming note below explicitly changed labels only. The
> corrected values are recorded here and in the tuning registry.
>
> The product owner approved them during the M6 adversarial remediation, so the **start times in
> the table above are APPROVED**. That is the thresholds alone. Which patterns each tier admits is
> still PROPOSED, and so are the soft-cap ceilings in §2.1 — DO-3 stays open, narrowed to those.
>
> **Naming — M0.5.** These were previously labelled `T0`…`T4` (zero-indexed), which invited an
> off-by-one against how the tiers are actually spoken about. They are now **one-indexed,
> Tier 1–Tier 5**. Thresholds are unchanged; only the labels moved.

---

## 3. Obstacle catalogue

### 3.1 Two semantic obstacle classes — APPROVED

v1 supports exactly **two behaviour classes**. Behaviour is a property of the class, not of the
artwork, so future visual variants reuse a class without new gameplay logic.

| Class | Meaning | Avoided by | v1 instance |
| --- | --- | --- | --- |
| **`LANE_BLOCKING`** | Occupies its lane at ground level; cannot be cleared while airborne | **Lane change** | **Traffic cone** |
| **`JUMPABLE`** | Low enough to be cleared while airborne | **Jump** | **Low seaside / beach barrier** |

This resolves the gap where the only approved obstacle was lane-only, leaving the approved jump
verb with nothing to jump over. See
[design-reference-conflicts.md](design-reference-conflicts.md) #15.

**No further speculative obstacle mechanics are added in v1.** There is no class that is both,
no moving obstacle, no destructible obstacle, and no obstacle that changes class at runtime.

### 3.2 Behaviour is decoupled from art — APPROVED

The gameplay rules know only the **class**. The cone and the beach barrier are the v1 art for
`LANE_BLOCKING` and `JUMPABLE`; a future seasonal variant that swaps a cone for a deckchair
changes an asset id and nothing else.

Concretely:

- the escape-path validator reasons over classes, never over sprite ids;
- the pattern library references obstacle ids whose class is declared once, in data;
- SLAYYY's world transformation swaps the **visual variant** and never the class — a
  `LANE_BLOCKING` cone that becomes a flower is still `LANE_BLOCKING`.

That last point matters: if SLAYYY changed an obstacle's class, generation and presentation
would diverge and the difficulty curve would stop being honest.

### 3.3 Obstacle taxonomy — PROPOSED

Whatever the final art, every obstacle is described by the same data, so the
generator and the escape-path validator never need to know about art:

```
Obstacle {
  id:            string
  class:         'LANE_BLOCKING' | 'JUMPABLE'   // APPROVED — the only gameplay semantics
  lanes:         LaneIndex[]     // which lanes it occupies
  lengthUnits:   number          // longitudinal footprint
  minTier:       Tier            // earliest tier it may appear in
  slayyyVariant: string          // visual variant during SLAYYY; class is unchanged
}
```

`class` is the only gameplay-relevant field. Everything else is geometry or presentation.

There is no separate `jumpable` boolean: a boolean invites a third state — "jumpable *and*
dodgeable" — that v1 does not have, and it names the affordance rather than the obstacle's
nature.

---

## 4. Pattern-driven generation — APPROVED

Obstacles are **pattern-driven and procedural**, drawn from
**difficulty-aware weighted pattern pools**, with a **guaranteed valid escape
path** in every generated pattern.

### 4.1 Pattern definition — PROPOSED

A pattern is a short, authored, data-only sequence of obstacle placements
relative to a local origin:

```
Pattern {
  id:          string
  minTier:     Tier
  weight:      number          // relative selection weight within its pool
  lengthUnits: number
  entries:     { offsetUnits: number, obstacleId: string, lane: LaneIndex }[]
  tags:        string[]        // e.g. "forces-jump", "double-decision"
}
```

Patterns are authored and reviewed as data. The generator never composes
obstacles freehand, because freehand composition cannot be proven safe.

### 4.2 Generation loop — PROPOSED

1. Determine the current tier from elapsed run time.
2. Select a pattern from the tier's weighted pool, excluding recently used
   patterns (`generator.repeatCooldown`, PROPOSED `3`).
3. Compute the **gap** before the pattern from the current density and decision
   frequency targets.
4. **Validate the escape path** (§5). If validation fails, the pattern is
   rejected and the next candidate is drawn.
5. Emit the pattern; sprinkle collectibles per
   [scoring-and-progression.md](scoring-and-progression.md).

Step 4 is a runtime safety net. The authoritative guarantee comes from §5.3.

---

## 5. The escape-path guarantee — APPROVED

**Every generated pattern has at least one survivable path** using only the
player's available actions at the current difficulty.

### 5.1 What "survivable" means — PROPOSED

A path is survivable if a simulated player, starting from **any** lane, can reach
a safe lane using:

- at most one lane change per `lane.transitionMs` window,
- jumps of exactly `jump.airborneMs` duration,
- no more than `escape.maxActionsPerPattern` (PROPOSED `2`) actions,

with a **reaction-time budget** of `escape.reactionBudgetMs` (PROPOSED `350`)
subtracted from the available window. The budget is what turns "technically
possible" into "humanly fair".

### 5.2 Cross-pattern safety — PROPOSED

A pattern that is safe in isolation can be lethal when it follows another. The
validator therefore runs over the **join** of the previous pattern's exit state
and the next pattern's entry state, not over patterns in isolation.

`generator.minGapUnits` (PROPOSED, scaled by tier) enforces a floor regardless.

### 5.3 How it is proven — APPROVED

The guarantee is verified by tests, not by inspection:

- **Per-pattern property test:** for every authored pattern, for every starting
  lane, a survivable path exists within the action and reaction budget.
- **Join test:** for every legal ordered pair of patterns within a tier, the
  joined sequence is survivable.
- **Long-run fuzz:** seeded generation over many simulated minutes at each tier,
  asserting that a reference solver never dies from an impossible pattern.

See [`../testing/testing-strategy.md`](../testing/testing-strategy.md) and
[`../game/determinism-and-rng.md`](../game/determinism-and-rng.md). These tests
run on **pure game logic with no Phaser dependency**, which is the main reason
the rules core is isolated from rendering.

---

## 6. SLAYYY and Loli interaction — APPROVED

- While **SLAYYY** is active the player is invulnerable, and the world
  transforms — cones become flowers. **Generation does not change**: the same
  patterns are produced, only presented differently, and an obstacle's **class never
  changes**. This keeps the difficulty curve honest and keeps SLAYYY from being a
  generation exploit.
- While **Loli Bonus** is active the player is **not** invulnerable and can still
  take damage. Generation is unchanged; only collectible attraction changes.

---

## 7. Open questions owned by this document

| Ref | Question |
| --- | --- |
| DO-3 | Confirmation of the soft-cap ceilings (§2.1). The tier **thresholds** were approved at M6; this is now the ceilings only |
| DO-4 | Whether difficulty may also be influenced by the player's current heart count |
| DO-5 | Whether patterns may span a SLAYYY activation boundary without adjustment |
| DO-6 | Whether additional art variants are needed per class beyond the cone and the beach barrier |

**Resolved by M0.5:** DO-1 (obstacle catalogue) and DO-2 (is the cone jumpable?) — see §3.1.
The pattern library is no longer blocked.
