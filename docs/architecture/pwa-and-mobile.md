# PWA and Mobile

**Status legend:** APPROVED / PROPOSED / OPEN.

---

## 1. Why this matters more than usual — APPROVED

The approved product direction requires that **future Android/iOS distribution
remain possible**. That is a constraint on decisions made now, not a feature to
add later. Two decisions in particular must not foreclose it:

1. **Authentication transport** — **decided (M0.5)**. The browser uses a Nuxt BFF with
   server-managed session cookies; the Laravel API stays **token-capable** so a native client
   authenticates directly against it with a bearer-token flow, **bypassing the BFF**. Not
   implemented in v1. See [ADR-0005](../decisions/ADR-0005-authentication-and-2fa-strategy.md).
2. **Offline run capability** — whether a run can be played and submitted later
   has direct anti-cheat consequences. See §3.

---

## 2. PWA scope — PROPOSED

| Capability | v1 | Rationale |
| --- | --- | --- |
| Web app manifest, icons, theme colour | **Yes** | Cheap, and the compact paw + wave mark already exists at 96/64/40/24 px |
| Installable / add to home screen | **Yes** | Removes browser chrome, which the HUD layout benefits from |
| Precached app shell and assets | **Yes** | Fast repeat loads; sprite atlases are the bulk of the payload |

> ### M1 decision: no PWA dependency was taken
>
> `@vite-pwa/nuxt` 1.1.1 — still the latest release — depends on `@nuxt/kit ^3.9.0` and
> dev-depends on `nuxt ^3.10.1`. **It is built against Nuxt 3**, while this project runs Nuxt
> 4.5.2. Its last release was February 2026.
>
> Taking that dependency during a bootstrap milestone would mean fighting a framework
> mismatch for a capability whose milestone is **M12**. The direction below stands; only the
> implementation is deferred.
>
> **Re-evaluate at M12:** either `@vite-pwa/nuxt` has released a Nuxt 4 build by then, or the
> fallback is a Nitro + Workbox setup, which this repository is already structured for.

| Offline **shell** (a useful screen when offline) | **Yes** | Better than a browser error page |
| Offline **play** | **OPEN — see §3** | Has anti-cheat and leaderboard consequences |
| Background sync of results | Follows §3 | Only meaningful if offline play exists |
| Push notifications | **No** | Nothing in the approved product surface uses them |

---

## 3. The offline question — OPEN (PWA-1)

**Is a run playable offline?**

This single question shapes both the PWA strategy and the run-validation design,
which is why it is called out rather than assumed.

| If **yes** | Consequence |
| --- | --- |
| Runs are simulated with no server involvement | A server-issued run token cannot gate the run |
| Results are queued and submitted later | Submission must be idempotent and carry trustworthy timing |
| Weekly leaderboard attribution becomes ambiguous | A run played before rollover and submitted after it must land in exactly one week |
| The attack surface widens considerably | An offline client is an unobserved client |

| If **no** | Consequence |
| --- | --- |
| A run requires connectivity to start | The server can issue a run token and observe the run's lifecycle |
| Validation is materially easier | Timing and pacing can be checked against server-recorded boundaries |
| The player loses the ability to play on a plane or in a dead spot | A real product cost for a mobile-first game |

**PROPOSED:** v1 requires connectivity to **start** a run, but a run already in
progress survives a transient network loss and its result is queued for
submission with an idempotency key. This keeps the server able to bound the run
while not punishing a player whose connection drops mid-run.

Not decided. It must be resolved together with
[ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md).

---

## 4. Caching strategy — PROPOSED

| Asset class | Strategy |
| --- | --- |
| App shell, JS, CSS | Precache, revisioned; update on new release |
| Fonts (self-hosted) | Cache-first, long-lived |
| Sprite atlases and audio | Cache-first, revisioned. These dominate the payload and must not be refetched per run. |
| API responses | **Network-first, never served stale for anything security- or ranking-relevant** |
| Authenticated data | Not cached by the service worker |

**Update behavior — PROPOSED:** a new version never activates mid-run. The
service worker waits until no run is active, then prompts or applies on next
navigation. Swapping code under a running simulation is a correctness hazard and
an anti-cheat hazard at once.

---

## 5. Mobile browser constraints — APPROVED

| Constraint | Handling |
| --- | --- |
| **Audio cannot autoplay** before a user gesture | The audio context is unlocked on the first deliberate interaction; a muted first run is never broken |
| **Backgrounding** suspends timers unreliably | Losing visibility **pauses the run** rather than simulating unseen |
| Safe areas and browser chrome | See [responsive-and-viewport.md](responsive-and-viewport.md) §5 |
| Pull-to-refresh, back-swipe, double-tap zoom | Suppressed on the playfield surface |
| **Memory pressure** | Phaser is destroyed on route leave; atlases are released. A replayed run must not accumulate GPU memory. |
| Battery and thermals | Frame rate is capped at 60; DPR is capped; nothing renders while paused |

---

## 6. Path to native — PROPOSED

If Android/iOS distribution happens, the most likely route is a **web-view shell**
around the same application. That shapes what must be true now:

| Requirement | Why |
| --- | --- |
| **Token-capable authentication** | **Already guaranteed by ADR-0005.** The API accepts a bearer credential; the browser simply does not use that path. |
| The native client **bypasses the BFF** | The BFF is a browser convenience, not part of the API contract |
| Tokens live in **platform secure storage** | Never in web storage, in any client |
| No dependence on same-origin browser storage semantics | Shell storage differs |
| Asset loading that works from a packaged origin | Absolute-origin assumptions break |
| No dependence on browser-only APIs for anything essential | Availability differs inside a shell |
| Store compliance surface known in advance | Account deletion (required by both major stores), privacy disclosures, age rating |

**Account deletion is worth noting now:** both major app stores require in-app
account deletion for apps that support account creation. It is also a KVKK/GDPR
requirement. It is tracked as SEC-3.

---

## 7. Open questions

| Ref | Question |
| --- | --- |
| **PWA-1** | **Is a run playable offline?** (§3) |
| PWA-2 | Does the service worker cache sprite atlases aggressively enough to make a repeat run start instantly, within the storage budget? |
| PWA-3 | Is installability promoted in-product, or left to the browser? |
| PWA-4 | Is a native shell actually planned, and on what horizon? |
