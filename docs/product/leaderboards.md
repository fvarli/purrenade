# Leaderboards

**Status legend:** APPROVED / PROPOSED / OPEN.

---

## 1. Approved shape — APPROVED

Claude Design v0.3 board 15 establishes:

- two windows: **Bu Hafta (this week)** and **Tüm Zamanlar (all time)**;
- ranked rows showing avatar, display name, score and rank;
- a **👑 crown on rank 1**;
- the current player's own row **pinned** and labelled **"SEN" (you)**, shown
  even when they are outside the visible page.

---

## 2. What a leaderboard costs — APPROVED

A public ranking converts every gameplay value into an incentive to cheat. Three
consequences follow, and they are not optional:

1. **Scores are decided by the server**, never accepted from the client. See
   the backend's `docs/security/anti-cheat.md` and
   [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md).
2. **Display names are user-supplied content** and need a moderation path.
3. **Ranking is a read-heavy query on a growing table** and needs a deliberate
   index and projection strategy, not an `ORDER BY` over everything.

---

## 3. Windows

### 3.1 All-time — APPROVED

Ranks players by their **best single-run score**, not by cumulative score.
(v0.3 shows the same value — 5.847 — as both the player's record on the profile
and their leaderboard score.)

### 3.2 Weekly — APPROVED

Ranks players by their best single-run score **within the current week**.

#### Boundary — APPROVED

**Monday 00:00 Europe/Istanbul**, with a run attributed to the week containing its
**server-recorded run start**.

| Aspect | Recommendation | Why |
| --- | --- | --- |
| Timezone | **Europe/Istanbul** | The launch audience is Türkiye. More importantly, **Türkiye has been UTC+3 year-round since 2016** — no DST means **no ambiguous or duplicated hour at rollover**, which is a real operational advantage over a DST-observing zone. A weekly reset that happens twice, or not at all, on two days a year is a genuine defect class this choice avoids entirely. |
| Start of week | **Monday** | Conventional in Türkiye and most of Europe |
| Storage and computation | **UTC**, converted for display | Never store a local timestamp |
| Attribution | **Server-recorded run start** | A run cannot be held open across the boundary to choose its week |
| Late submission | Attributed by run **start**, not submission | A run that begins Sunday 23:58 and submits Monday 00:03 belongs to the week it was played in |
| Previous week | **Archived and viewable** | Discarding it destroys the only record of a player's best week |

**Cost, stated plainly:** Spanish- and English-speaking players see the reset at a local time
that means nothing to them — roughly Sunday evening in Western Europe and mid-afternoon in the
Americas. That is the correct trade for a Türkiye-first launch, but it is a trade.

**UTC was considered** and rejected as the weaker option: it is equally DST-free but places the
reset at 03:00 for the primary audience — during the tail of Sunday-evening play sessions
rather than cleanly after them.

**APPROVED (M0.6).**

---

## 4. Ranking rules

### 4.1 Tie-breaking — APPROVED

Equal scores are broken by, in order:

| # | Rule | Why |
| --- | --- | --- |
| 1 | Higher **score** | The primary ranking |
| 2 | **Earlier** `achieved_at` | The player who got there first ranks higher — rewards the achievement, not the resubmission |
| 3 | **Shorter** `duration_ms` | The same score in less time is the better run |
| 4 | Stable identifier | Guarantees a **total order** |

Rule 4 is a correctness requirement, not a nicety: without a total order, two pages of the same
leaderboard can contain the same row, or silently skip one.

### 4.2 Pagination — APPROVED

**Cursor-based**, not offset-based. Offsets over a live ranking skip and repeat rows as scores
change underneath the reader.

| Parameter | Recommendation |
| --- | --- |
| Default page size | **25** |
| Maximum page size | **100** |
| Cursor | Opaque; clients never construct or parse one |
| Own row | Always returned alongside the page, with its **true rank**, in the same response |

---

## 5. Privacy and moderation

### 5.1 Display names — v1 baseline APPROVED

A display name is user-supplied content shown to every other player, which makes it both a
moderation surface and an impersonation surface.

**APPROVED for v1:**

| Rule | Value |
| --- | --- |
| Length | **3–20 characters** |
| Character set | **Unicode letters and digits, plus `_`, `.`, `-`** |
| Must contain | **At least one letter** — a name of pure punctuation is not a name |
| Must not | Begin or end with punctuation |
| Uniqueness | **Case-insensitive** |
| Changes | **Rate-limited** |
| Moderation | An administrator can **force-rename**; the player is notified and must choose a new name |

#### Future hardening — PROPOSED, explicitly not a v1 blocker

| Deferred | Why it can wait |
| --- | --- |
| **Automated profanity screening** in tr/en/es | Needs a maintained wordlist per locale, and every such list produces false positives on legitimate names. **Admin force-rename is the v1 answer.** |
| **Homoglyph / confusable detection** | Latin/Cyrillic/Greek lookalike impersonation is real but low-volume at launch scale, and a naive normalizer wrongly rejects legitimate non-Latin names. |

Neither blocks M1 or v1. Both are worth doing once there is a real user base and real abuse
data to tune against — tuning either against an imagined threat model would produce a filter
nobody can justify.

### 5.2 Banned players — APPROVED

Entries are **hidden from public boards** and retained internally for audit. A ban is a
moderation action, not a deletion: the record must survive so the decision can be reviewed.

### 5.3 Deleted players — architecture PROPOSED, policy OPEN

- Deletion **removes or anonymizes personal identity data** as required.
- A deleted player **must no longer appear publicly under their former identity**.
- **Active leaderboard projections must account for deletion and anonymization** — a
  projection that is not rebuilt keeps serving a deleted identity, which is the exact failure
  a cached ranking makes easy.
- Historical result retention is governed by the eventual privacy/retention policy.

**The exact retention and anonymization policy remains OPEN** pending an explicit
product/legal decision (SEC-3). No grace period, retention window, or legal basis is invented
here. See the backend's `docs/security/data-protection.md`.

### 5.4 Opt-out — APPROVED in principle

| Rule | Recommendation |
| --- | --- |
| A player may opt out of **public** ranking | Their row is excluded from public pages |
| An opted-out player still sees **their own rank**, privately | Opting out of visibility is not opting out of the game |
| Opting out does not delete their runs | It changes visibility, not history |
| The setting is reversible | |

---

## 6. Performance and projection — PROPOSED

| Concern | Approach |
| --- | --- |
| Source of truth | An authoritative PostgreSQL table of accepted run results |
| Read path | A **projection** (materialized view or maintained ranking table) refreshed on write or on a short schedule, never a live full-table sort |
| Caching | Short-TTL cache of the top page; the player's own row is always computed fresh so it never appears stale to them |
| Redis | Acceptable as a **cache or projection** over the authoritative table. **Never** as the source of truth for rankings. |

Details belong to the backend: `docs/architecture/data-model.md` and
`docs/architecture/caching-and-redis.md`.

---

## 7. Client behavior — APPROVED

- The leaderboard is read-only. The client never writes ranking data.
- Ranks come from the server. The client never computes a rank locally, because a
  locally-computed rank is a lie the moment another player scores.
- The new-high-score screen offers **"view leaderboard"**, which is the primary
  entry point after a good run.

---

## 8. Open questions owned by this document

| Ref | Question |
| --- | --- |
| LB-5 | **Retention and anonymization policy** for deleted players (§5.3) — remains genuinely **OPEN**, product/legal decision required |
| LB-6 | Is there a friends-only or regional board? Nothing suggests one; recorded so it is not assumed |
| LB-7 | Profanity and confusable screening — source, locale coverage, tuning (§5.1). **Future hardening, not a v1 blocker.** |
| LB-8 | Opt-out surface: where the setting lives and what an opted-out player sees (§5.4) |

**Resolved by M0.6:** LB-1 (boundary), LB-2 (tie-break and pagination), LB-3 (display-name v1
baseline), LB-4 (opt-out supported) are **APPROVED**.
