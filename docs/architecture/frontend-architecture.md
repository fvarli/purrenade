# Frontend Architecture

Nuxt structure, rendering boundaries, and the layering that keeps game logic
testable.

**Status legend:** APPROVED / PROPOSED / OPEN.

---

## 1. Layering — PROPOSED

Four layers, with dependencies pointing in one direction only:

```
  UI (Vue components, pages, layouts)
        │  reads state, dispatches intents
        ▼
  Application state (stores)
        │  calls
        ▼
  Services  ──►  API client (typed, HTTP)
        │
        ▼
  Game domain (pure rules)  ◄── Engine adapter (Phaser) renders it
```

| Layer | Contains | Must not contain |
| --- | --- | --- |
| **UI** | Components, pages, layouts, i18n rendering | Business rules, HTTP calls, Phaser imports |
| **Application state** | Stores for session, profile, progression, settings, run summary | HTTP construction, Phaser types |
| **Services / API client** | Typed request/response, error mapping, correlation IDs | UI concerns, game rules |
| **Game domain** | Lanes, jump, collision, difficulty, patterns, scoring — **pure functions and plain data** | Phaser, DOM, Vue, network, `Math.random`, wall-clock time |
| **Engine adapter** | Phaser scenes, sprites, input capture, rendering | Game rules, business decisions |

The strict rule is stated once and enforced everywhere:
**game rules never import Phaser, and Vue never imports Phaser types.** See
[game-engine-integration.md](game-engine-integration.md).

---

## 2. Rendering strategy — PROPOSED

| Route group | Strategy | Why |
| --- | --- | --- |
| Marketing/splash | Prerendered or SSR | Fast first paint; no session needed |
| Auth (02–07) | SSR | Fast, indexable-by-nobody but cheap and robust; no game code loaded |
| Menu, profile, settings, leaderboard, achievements | SSR with client hydration | Data-driven, benefits from server rendering |
| **Run (10, 10b, 11, 12)** | **Client-only** | A canvas game cannot be server-rendered. The Phaser bundle must never be pulled into an SSR path. |
| Admin | Separate, plain, client-rendered | Does not adopt the game identity; see [screen-inventory](../product/screen-inventory.md) §7 |
| **BFF routes** | **Nitro server routes** | Session handling, CSRF, and upstream API calls. Never renders UI; never makes an authorization decision. |

**Hard requirement:** the Phaser bundle is **lazily loaded on the run route
only**. It must never appear in the initial bundle of an auth or menu route —
that is both a performance requirement and an SSR-safety requirement.

**APPROVED (M0.5) — ARCH-3 resolved: Nitro acts as a BFF.** The browser talks only to the Nuxt
origin; Nitro holds the server-side session and calls the Laravel API. Consequences:

- **No CORS** and no cross-origin credentialed requests for the browser.
- **The Nuxt server is stateful and security-relevant.** It holds sessions, enforces the CSRF
  boundary, and is inside the security boundary — see the repository `SECURITY.md`.
- Deployment is not constrained to a shared DNS parent between frontend and API.
- The Laravel API stays **token-capable**, so a future native client is a direct client of it.

See [ADR-0005](../decisions/ADR-0005-authentication-and-2fa-strategy.md).

---

## 3. Directory shape — PROPOSED

Finalized at M1 against the Nuxt version actually installed. The intent, not the
exact spelling, is what matters:

```
app/
  pages/            route components, thin
  layouts/
  components/       presentational; no rules, no HTTP
  composables/      UI-facing glue
  stores/           application state
  services/         API clients and mappers
  i18n/             locale messages (tr / en / es)
  assets/           self-hosted fonts, styles, tokens
game/
  domain/           ★ pure rules — no Phaser, no DOM, no Vue
    lanes.ts  jump.ts  collision.ts  difficulty.ts  patterns.ts  scoring.ts
    rng.ts    state.ts  tuning.ts
  engine/           ★ Phaser adapter — scenes, sprites, input, rendering
  bridge/           the single, typed boundary between the two
tests/
  unit/             game domain and pure logic
  component/        Vue components
  e2e/              user flows
```

`game/domain/` is deliberately a sibling of `app/`, not a folder inside it. The
separation is structural so that "just import Phaser here" is visibly wrong.

### 3.1 As built at M5

The shape above is the plan for the finished game. What exists after the game-core
milestone is the subset the rules needed, plus one file the plan did not name:

```
game/
  domain/     tuning.ts  rng.ts  types.ts  state.ts  lanes.ts  jump.ts
              input.ts   step.ts  index.ts
  bridge/     types.ts  snapshot.ts  loop.ts  index.ts
  engine/     index.ts  layout.ts  scene.ts  input/{keyboard,pointer}.ts
```

`collision.ts`, `difficulty.ts`, `patterns.ts` and `scoring.ts` belong to M6 and M7
and are deliberately absent — an empty file is a worse placeholder than none.

**`bridge/loop.ts` is the addition.** The fixed-step accumulator that turns variable
display frames into fixed simulation steps is not part of the rules and is not
Phaser-shaped, so it sits in the bridge with the rest of the boundary. Putting it in
the engine would have made the loop's invariants — bounded catch-up, no banked time
across a pause — testable only in a browser.

The separation is no longer only structural. **Six ESLint boundary blocks enforce it**,
and each was mutation-tested against both the alias and the relative spelling of the
import it forbids:

| Layer | May not reach |
| --- | --- |
| `game/domain` | Phaser, Vue, Pinia, Nuxt's virtual modules, the bridge, the engine, the DOM, the network, `Math.random`, `Date.now`, `performance.now`, `new Date()` |
| `game/bridge` | Phaser, Vue, Pinia, Nuxt, the engine, `Math.random`, `Date.now` |
| `game/engine` | Vue, Pinia, Nuxt, **and `game/domain`** — what a renderer needs is projected as `PLAYFIELD` and `GESTURE` in `game/bridge/engine-config.ts` |
| `app/**` | Phaser, `game/domain` |
| `server/**` | Phaser, `game/domain`, `game/engine` |

Dynamic `import()` is covered too. `no-restricted-imports` visits only static import and
export declarations, so a `no-restricted-syntax` rule sits alongside each block; without
it the whole boundary was one `await import()` away from being advisory. The globs name
every extension the bundler loads rather than `.ts` alone, because a `.js` file beside a
`.ts` one was unrestricted.

A CI gate additionally asserts Phaser lives in exactly one chunk, that nothing imports it
statically, and that **the only thing that imports it dynamically is the run route** — the
last of which is the property the gate's name always claimed and did not test.

---

## 4. TypeScript — PROPOSED

- **Strict mode on**, including `noUncheckedIndexedAccess`. A three-lane game
  indexes arrays constantly; unchecked indexing is exactly where the bugs live.
- No `any` in the game domain. Lane indices, tiers and obstacle ids are narrow
  types, not bare numbers and strings.
- API response types are **derived from the OpenAPI contract**, not hand-written,
  so a contract change surfaces as a type error rather than a runtime surprise.
- Pin the TypeScript major version deliberately: Nuxt's own toolchain currently
  tracks **TypeScript 6**, while TypeScript 7 (the native port) is newer. See
  [versions-and-runtime.md](versions-and-runtime.md).

---

## 5. Configuration and tuning — APPROVED

**No magic numbers.** Every gameplay tunable is declared once in
[`../game/tuning-parameters.md`](../game/tuning-parameters.md) and implemented in
a single typed tuning module that the game domain reads. Values are never
duplicated into scenes, components, or CSS.

Runtime configuration (API base URL, environment, feature toggles) comes from
Nuxt runtime config. **No secret is ever placed in client-visible config** — the
browser bundle is public by definition.

---

## 6. Error handling — PROPOSED

| Failure | Behavior |
| --- | --- |
| Network unavailable | The UI says so plainly and offers retry. A run in progress is never destroyed by a network error. |
| 401 / session expired | Clear local session state, route to login, preserve intent so the player returns where they were |
| 403 | Show a permission error; never silently degrade into a partial view that looks like data is missing |
| 422 validation | Map field errors onto the form from the server's stable error codes |
| 429 rate limited | Respect the server's retry signal; never retry in a tight loop |
| 5xx | Generic failure with a correlation ID the player can quote |

The client maps from **stable machine-readable error codes**, never from
human-readable message text.

---

## 7. Performance budget — PROPOSED

| Budget | Target |
| --- | --- |
| Initial route JavaScript (auth/menu) | small enough to interact in under 3 s on mid-range mobile over a warm cache |
| Phaser bundle | loaded only on the run route |
| Sustained run frame rate | 60 fps target, 30 fps floor on mid-range mobile |
| Long tasks during a run | none above one frame budget; asset decode happens before the run starts |

Measured on a real mid-range device, not only in a desktop profiler.

---

## 8. Security posture — APPROVED

- **The frontend is never an authorization boundary.** Route guards improve the
  experience; removing them must expose nothing. **This still holds with the BFF:** the BFF
  handles credentials, but **Laravel decides** every authorization question.
- **The BFF is inside the security boundary.** It holds session state and the upstream
  credential, so it is deployed, monitored and patched as a security-relevant component.
- No secret ships in the bundle.
- No private source material is referenced by any deployed artifact.
- Client-side obfuscation is **not** an anti-cheat control. See
  [ADR-0006](../decisions/ADR-0006-run-validation-and-anti-cheat-boundary.md).
