# Asset Strategy

## Gameplay presentation — reconstructed in Milestone B3

The run route draws a seaside promenade in one-point projection from **twenty
prepared RGBA PNGs** under `public/game/`. The manifest is
`game/engine/assets.ts`; the world that uses it is `game/engine/promenade.ts`
and `game/engine/actors.ts`. Nothing in `app/`, `game/` or the Nuxt build reads
`design-reference/`, and `game/engine/scene.spec.ts` asserts that, that every
manifest path exists, and that every file is a real PNG with an alpha channel.

### How the runtime files are made — APPROVED

`tools/prepare-run-assets.py` is an **authoring tool, not a build step**. It is
run by hand, its output is committed, and it implements §4.5 below: development
masters are not delivery inputs, they are *extracted* into rights-cleared,
text-free runtime files.

Each entry in the tool records the master, the panel and the pixel box it comes
from, so a later art pass can re-cut from an updated master rather than guess.
Two keying modes exist because the masters need both: a colour key for coloured
art on the cream panel, and a morphologically closed silhouette for art that is
itself nearly white — Loli's coat and the low barrier's stripes are within a few
points of the panel, and a colour key opens holes straight through them.

| Family | Files | Source |
| --- | --- | --- |
| Ayşenur | `aysenur-run`, `aysenur-lean-left`, `aysenur-lean-right`, `aysenur-hit` | Character reference sheet turnaround (front, 3/4, mirrored 3/4) and the action master's own hit pose |
| Loli | `loli-companion` | Character master, 3/4 turnaround — the one cell carrying the tail, the head markings and the nose marking together |
| Obstacles | `traffic-cone`, `traffic-cone-slayyy`, `low-barrier`, `low-barrier-slayyy` | Gameplay master panels 1 and 2 |
| World | `world-horizon`, `prop-railing`, `prop-lamp`, `prop-bench`, `prop-palm`, `prop-flowerpot` | World kit panels 1 and 3; the coast is mirrored onto itself so it tiles with no seam |
| Drawn | `paw-token`, `paw-token-slayyy`, `fx-petal`, `fx-sparkle`, `fx-shadow` | Drawn to the master's design rather than cut: the Paw Token is a pink paw inside a *white* glow on a cream panel, which no key can separate |

No file carries a label, a caption or a callout. No file is a reference board.
Total payload is roughly 2.4 MB, of which the coastline backdrop is 576 KiB —
the only file over 300 KiB, and the one that is upscaled rather than downscaled
on a high-DPR phone, so it is deliberately not reduced further.

**This hits a §2.1 review trigger, and the trigger is answered rather than
ignored.** The size thresholds are nowhere near: no single binary approaches
10 MB and the repository is far under 100 MB. The one that does fire is *"the
first runtime sprite set is about to be committed"*. **Decision: commit these
twenty files normally, in git, with no LFS and no external store.** They are
individually small, they are content that changes rarely, and the question the
trigger exists for — how a multi-megabyte packed atlas re-exported dozens of
times should be stored — is a question about the atlas, which is still OPEN
below. Revisit at that point, as ASSET-1 says, and not before.

### The camera and the character, and why these cells

`design-reference-conflicts.md` #3 resolves the camera to v0.3: the player faces
the camera. So the runtime uses the turnaround's front and three-quarter views
rather than the action master's run-cycle strip, which is drawn in side view and
would put the protagonist in a different camera from the world she runs through.

The master contains no front-facing run cycle, and cutting turnaround cells and
calling them frames would be inventing an animation it does not contain. What
the states are driven by instead: the master's own hit pose for a lost heart,
its own three-quarter views for a lane change, and controlled motion — a run
bob, a lean, a jump stretch, a ground shadow that shrinks with height — for
everything else. Quality and identity over a fabricated frame count.

### Remaining production-art preparation requirements — OPEN

- A front-facing Ayşenur **run cycle** and **jump sequence**, so the bob and the
  stretch can be replaced by real frames.
- Loli follow/enter/exit frames in the same camera.
- Approved SLAYYY variants for anything beyond the cone and the barrier, which
  the master already draws.
- A packed atlas: twenty individual files is twenty texture binds, and §3 wants
  one.

No design master is a fallback network asset. If a prepared asset fails to load,
`actors.ts` builds its primitive presentation instead — a hazard the player
cannot see is a hazard they cannot fairly avoid.

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
| Runtime-ready / packaged production assets | Twenty prepared, label-free RGBA PNGs under `public/game/` (~2.4 MB), cut from the masters by `tools/prepare-run-assets.py`; a packed atlas and a real run cycle remain future production art |

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
