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
| Timezone | **Europe/Istanbul** (the IANA zone, with its full rule history — never a fixed `+03:00` offset) | The launch audience is Türkiye. More importantly, **Türkiye has been UTC+3 year-round since 2016** — no DST means **no ambiguous or duplicated hour at rollover**, which is a real operational advantage over a DST-observing zone. A weekly reset that happens twice, or not at all, on two days a year is a genuine defect class this choice avoids entirely. The implementation still applies the zone's rules rather than assuming the current offset, so a rule change or an older timestamp is handled correctly. |
| Start of week | **Monday** | Conventional in Türkiye and most of Europe |
| Storage and computation | **UTC**, converted for display | Never store a local timestamp |
| Attribution | **Server-recorded run start** | A run cannot be held open across the boundary to choose its week |
| Late submission | Attributed by run **start**, not submission | A run that begins Sunday 23:58 and submits Monday 00:03 belongs to the week it was played in |
| Previous week | **Archived** — kept permanently. **Viewing** it is OPEN (LB-9) | Discarding it destroys the only record of a player's best week. Keeping the data does not decide how, or whether, past weeks are shown — see §3.3 |

**Cost, stated plainly:** Spanish- and English-speaking players see the reset at a local time
that means nothing to them — roughly Sunday evening in Western Europe and mid-afternoon in the
Americas. That is the correct trade for a Türkiye-first launch, but it is a trade.

**UTC was considered** and rejected as the weaker option: it is equally DST-free but places the
reset at 03:00 for the primary audience — during the tail of Sunday-evening play sessions
rather than cleanly after them.

**APPROVED (M0.6).**

### 3.3 Previous weeks — retention APPROVED, viewing OPEN (LB-9)

Every past week's ranking is **kept permanently** — no pruning and no destructive change
(owner decision D3, 2026-09-24). That settles **retention only**.

How a player views a past week — a selector, a "last week" tab, a results card — has **no
approved UX and no API contract**. It is **OPEN as LB-9**. M10 ships the two windows of board 15
and **no third tab**; keeping the data must not be read as having delivered previous-week
viewing.

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

**`achieved_at` — owner decision D2 (2026-09-24), APPROVED.** `achieved_at` is the run's
**server-recorded finish** — the moment the server accepted the result. It is never a
client-supplied time. Weekly **attribution** still uses the server-recorded run **start**
(§3.2), so a late submission counts for the week it was played in, but its tie priority is set
by when it was actually accepted: holding a run open cannot buy an earlier `achieved_at`.

**Stable identifier = the entry's representative run id** (engineering specification, M10).
Each board entry is represented by one run — the player's best accepted run in that window.
The stable identifier is **that run's id**. One comparator,

> `score DESC, achieved_at ASC, duration_ms ASC, run id ASC`,

therefore both chooses each player's representative run and orders the board, so the two can
never disagree. A run belongs to one player and one week, so the order is total. Neither the run
id nor the player's account id is ever exposed to clients.

### 4.2 Pagination — APPROVED

**Cursor-based**, not offset-based. Offsets over a live ranking skip and repeat rows as scores
change underneath the reader.

| Parameter | Recommendation |
| --- | --- |
| Default page size | **25** |
| Maximum page size | **100** |
| Cursor | Opaque; clients never construct or parse one |
| Own row | Always returned alongside the page, with its **true rank**, in the same response |

A cursor also remembers **which week** it belongs to: a cursor taken before a Monday rollover
keeps paging the week it was issued for.

### 4.3 Consistency across pages — APPROVED contract (M10)

A leaderboard is live: other players finish runs while one player pages through it. The
contract is deliberately precise rather than optimistic:

1. **Each response is internally consistent.** The page, its ranks, whether more rows follow,
   and the player's own row are read from **one snapshot**.
2. **A multi-page traversal is not a frozen snapshot.** Each request reads the board as it is
   at that moment. Consequently:
   - an entry that is new, or improves, and lands **above** the part already paged is **not
     shown** in the rest of that traversal — it appears when the player refreshes from the top;
   - ranks are recomputed on every request, so rank numbers across pages always increase but
     **may skip** by the number of entries that moved above;
   - an entry **never appears twice** in one traversal, and an entry that stays below the paged
     position is shown exactly once.
3. The no-duplicate guarantee rests on one invariant (**M**): in M10 an entry's position can
   only move **up**, never down, because an entry only ever changes when its player sets a
   better run. Any later feature that can move an entry **down** — run invalidation by an
   administrator (M13), or deletion/anonymization (SEC-3) — breaks M and must either accept
   possible duplicates in open traversals or invalidate outstanding cursors.

The screen therefore offers an explicit **refresh / back to top** action and never pretends
ranks across pages are contiguous. Snapshot-versioned pagination is not part of v1.

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

**Enforcement is deferred to M13.** No ban state exists before the M13 moderation console, so
M10 hides nobody and claims no ban filtering. The backend keeps a single visibility rule that
every public page **and** every rank count goes through, so that M13 — and the opt-out surface,
LB-8 — add their exclusion in one place.

### 5.3 Deleted players — architecture PROPOSED, policy OPEN

- Deletion **removes or anonymizes personal identity data** as required.
- A deleted player **must no longer appear publicly under their former identity**.
- **Active leaderboard projections must account for deletion and anonymization** — a
  projection that is not rebuilt keeps serving a deleted identity, which is the exact failure
  a cached ranking makes easy.
- Historical result retention is governed by the eventual privacy/retention policy.

**The exact retention and anonymization policy remains OPEN (LB-5)** pending an explicit
product/legal decision (SEC-3). No grace period, retention window, or legal basis is invented
here. See the backend's `docs/security/data-protection.md`.

**Owner decision D1 (2026-09-24), APPROVED: M10 does not wait for LB-5.** The leaderboard
projections store **no copy of public identity** — the display name is read live from the
player's account — and are derived data, rebuildable from the authoritative run history.
**LB-5 now gates SEC-3 / account deletion (M14)**, which must settle deletion, anonymization and
retention consistently across the run history **and** the leaderboard projections. D1 sets no
deletion behaviour.

### 5.4 Opt-out — APPROVED in principle

| Rule | Recommendation |
| --- | --- |
| A player may opt out of **public** ranking | Their row is excluded from public pages |
| An opted-out player still sees **their own rank**, privately | Opting out of visibility is not opting out of the game |
| Opting out does not delete their runs | It changes visibility, not history |
| The setting is reversible | |

---

## 6. Performance and projection — engineering decisions (M10)

| Concern | Approach |
| --- | --- |
| Source of truth | The authoritative PostgreSQL run history; only **accepted** runs rank |
| Read path | **Maintained PostgreSQL ranking tables** (one all-time, one weekly), updated **inside** the transaction that accepts a run — never a live full-table sort |
| Caching | **None in M10.** Every response, including the player's own row, is read fresh |
| Redis | Not used by M10. If ever adopted, only as a **cache or projection** over the authoritative table — **never** as the source of truth for rankings |

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
| LB-5 | **Retention and anonymization policy** for deleted players (§5.3) — remains genuinely **OPEN**, product/legal decision required. **Gates SEC-3 / account deletion at M14**, not M10 (D1) |
| LB-6 | Is there a friends-only or regional board? Nothing suggests one; recorded so it is not assumed |
| LB-7 | Profanity and confusable screening — source, locale coverage, tuning (§5.1). **Future hardening, not a v1 blocker.** |
| LB-8 | Opt-out surface: where the setting lives and what an opted-out player sees (§5.4) |
| LB-9 | **Previous-week viewing** — the interaction and API contract for looking at a past week (§3.3). The data is retained; the view is not designed |

**Resolved by M0.6:** LB-1 (boundary), LB-2 (tie-break and pagination), LB-3 (display-name v1
baseline), LB-4 (opt-out supported) are **APPROVED**.
