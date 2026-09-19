# Asset Strategy

How binary assets are stored, delivered, and kept from degrading the repository.

**Status legend:** APPROVED / PROPOSED / OPEN.

---

## 1. Current state — APPROVED

| Fact | Detail |
| --- | --- |
| Design reference set | ~39 MB as reviewed on 2026-09-19, including ~19 MB of nine untracked production-art development masters and ~1.8 MB of planning material |
| Git LFS | **Not used, and not introduced in M0** |
| Storage | The current design-reference set is committed normally |
| Production-art development masters | Nine PNG visual specifications/candidates under `design-reference/production-asset-development/`; they are reference-only and not runtime assets |
| Runtime-ready / packaged production assets | **None exist yet** — no approved extracted sprites, texture atlases or delivered production-art package exists |

**Decision: no Git LFS in M0.** ~18 MB is acceptable for an initial repository,
and introducing LFS adds a tooling dependency for every future clone before there
is a demonstrated need.

---

## 2. Growth must be monitored — APPROVED

The current figure is a snapshot, not a steady state. Growth comes from three
directions, and the third is by far the largest:

1. **New design versions.** Each design revision adds a full board set. v0.3
   alone is ~16 MB; a v0.4 and v0.5 would compound.
2. **Runtime production sprite atlases.** Ayşenur has 7 animation states and Loli has 5,
   authored at 3× the 390 px baseline, plus world art and 16 achievement badges.
3. **Audio.** Menu and run music plus effects. Music is typically the single
   largest class of asset in a casual game.

Git stores every revision of every binary forever. A 4 MB atlas re-exported
twenty times is 80 MB of permanent history, and no later cleanup is cheap.

### 2.1 Review trigger — PROPOSED

Re-evaluate the asset strategy when **any** of these is true:

| Trigger | Threshold |
| --- | --- |
| Repository size | exceeds **100 MB** |
| Clone time | becomes a noticeable friction for a fresh contributor |
| Production sprite atlases | are about to be committed for the first time |
| Audio assets | are about to be committed for the first time |
| A single binary | exceeds **10 MB** |

The third and fourth triggers matter most: the right moment to choose a strategy
is **before** the first large binary enters history, not after.

### 2.2 Options at that point — PROPOSED

| Option | Trade-off |
| --- | --- |
| **Git LFS** | Keeps assets versioned alongside code; adds a tooling requirement for every clone and a hosting quota |
| **External asset store + CDN, referenced by manifest** | Keeps the repository small and matches how assets are actually delivered in production; adds a second system to keep in sync |
| **Keep only current-version design boards in git** | Simple; loses design history, which is exactly what the conflict register depends on |
| **Status quo** | Fine until it is not; the triggers above define "not" |

**Currently OPEN (ASSET-1).** No option is chosen.

---

## 3. Production delivery — PROPOSED

Distinct from storage: how assets reach the player.

| Concern | Approach |
| --- | --- |
| Gameplay sprites | Packed **texture atlases**, not individual files. Fewer requests, fewer GPU texture binds. |
| Authoring density | 3× the 390 px baseline; downscaled at build time for lower-DPR targets |
| Formats | Modern compressed formats with fallbacks; PNG only where transparency and fidelity demand it |
| Fonts | **Self-hosted**, subset to Latin + Latin Extended (Turkish and Spanish diacritics required) |
| Cache busting | Content-hashed filenames; long-lived immutable caching |
| Service worker | Atlases are cache-first and revisioned — see [pwa-and-mobile.md](pwa-and-mobile.md) §4 |
| Preloading | A run never begins mid-decode. Atlases are decoded before the run becomes interactive. |

### 3.1 Budget — PROPOSED

| Budget | Target |
| --- | --- |
| Total gameplay atlas payload | small enough to precache within a reasonable storage budget on mobile |
| Per-run additional download after first load | **zero** — a repeat run fetches nothing |
| Audio | Streamed or lazily loaded; never blocking the first run |

Concrete numbers are set at M12 against real assets rather than guessed now.

---

## 4. Hard rules — APPROVED

1. **Private source photographs are never committed, published, bundled, or
   served** — under any storage or delivery strategy. See
   [`../product/licensing-and-rights.md`](../product/licensing-and-rights.md) §4.
2. **Nothing in `design-reference/` is ever built, bundled, or served.** It is
   reference material. The v0.3 standalone HTML in particular contains an inlined
   Google Fonts payload and a React UMD build, and must never reach production.
3. **No text is baked into any art asset.** All copy is localizable text rendered
   over art.
4. **Every third-party asset's license is recorded** in the dependency inventory
   from the moment it is introduced.
5. **Development masters are not delivery inputs.** They must be redrawn or
   extracted into rights-cleared, text-free runtime files and packed separately;
   `design-reference/` itself remains excluded from builds and delivery.
