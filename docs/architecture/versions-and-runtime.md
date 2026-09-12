# Versions and Runtime

**These are research findings, not permanent pins.**

Current stable versions and their **mutual compatibility** must be re-verified
immediately before M1 bootstrap. A package is not adopted merely because it is
the newest — the target is the **newest stable *compatible* stack**. Nothing was
installed or upgraded during M0.

---

## 1. Verification record

| Field | Value |
| --- | --- |
| Verified on | **2026-09-12** (M0 research), **re-verified 2026-09-12 immediately before M1 bootstrap** |
| Sources | npm registry, Packagist, nodejs.org, endoflife.date, vendor release notes, and **package peer/dependency graphs** |
| Next verification | Before the next major upgrade, recorded here with its date |

## 1A. Installed at M1 bootstrap — actual, not aspirational

These are the versions **actually resolved into `package-lock.json`**, verified after install.

| Package | Installed | Note |
| --- | --- | --- |
| Node | **24.21.0** LTS "Krypton" | via nvm; the machine's global default is deliberately left at 22 |
| npm | 11.19.0 | |
| Nuxt | **4.5.2** | |
| Vue | **3.5.42** | |
| Vite | **8.3.0** | transitive, via Nuxt |
| TypeScript | **6.0.3** | `~6.0.3` — patch-only, so it cannot drift to 7 |
| Phaser | **4.2.1** | installed; not yet imported anywhere |
| `@nuxtjs/i18n` | **10.6.0** | |
| Pinia | **4.0.3** + `@pinia/nuxt` 1.0.2 | |
| Vitest | **5.0.0** + `@nuxt/test-utils` 4.3.2 | |
| ESLint | **10.10.0** + `@nuxt/eslint` 1.17.0 | |
| vue-tsc | **3.3.11** | |
| Playwright | 1.63.0 | installed for M12; no e2e specs yet |

### Why TypeScript is pinned to `~6.0.3`

TypeScript 7.0.2 is the newest published version, and **nothing in the Nuxt ecosystem is built
against it**: Nuxt 4.5.2 dev-depends on TS `6.0.3`, `@nuxtjs/i18n` and `@pinia/nuxt` on
`^5.9.3`. The caret is deliberately narrowed to a tilde so a future `npm update` cannot silently
cross a major boundary the toolchain does not support.

### The one dependency that is not ours: `esbuild`

`esbuild@0.28.2` appears in `devDependencies` but **no Purrenade code imports it**. It resolves
a genuine upstream conflict:

| Package | Wants |
| --- | --- |
| `@intlify/bundle-utils` 11.2.5 (via `@nuxtjs/i18n`) | `esbuild ^0.25.4` — still, as of its latest release |
| Vite 8.3.0 (via Nuxt) | `peerOptional esbuild ^0.27.0 \|\| ^0.28.0` |

npm hoisted esbuild 0.25 to the root, which then failed Vite's optional peer and blocked
installation entirely.

**The fix is targeted, not blunt.** Declaring esbuild 0.28.2 at the root satisfies Vite's
optional peer there, and npm nests 0.25.12 under `@intlify/bundle-utils` where its own range is
honoured. Verified after install: root `0.28.2`, nested `0.25.12`.

`--force` and `--legacy-peer-deps` were **not** used. Both would have suppressed this conflict
along with every future one, which is precisely the failure mode a lockfile is supposed to
prevent. **Remove this dependency once `@intlify/bundle-utils` widens its esbuild range.**

---

## 2. Frontend findings — 2026-09-12

| Package | Latest at verification | Notes |
| --- | --- | --- |
| **Nuxt** | **4.5.2** (2026-08-05) | `engines.node`: `^22.19.0 \|\| ^24.11.0 \|\| >=26.0.0`. **No Nuxt 5 exists.** |
| **Vue** | **3.5.42** (2026-08-27) | 3.6 is in alpha (Vapor mode). **Do not adopt an alpha.** |
| **Phaser** | **4.2.1** (2026-07-09) | Phaser 4 has been stable since **4.1.0 (2026-04-30)**: rebuilt WebGL renderer, FX/Masks unified into a Filter system. **Phaser 3 ended at 3.90.0.** Vendor guidance is explicit that new projects should start on v4. → **target Phaser 4**. |
| **TypeScript** | 7.0.2 (native port) | ⚠️ **Nuxt 4.5.2 dev-depends on TypeScript 6.0.3.** Pin **TS 6.x** and re-verify TS 7 support at bootstrap rather than assuming it. |
| `@nuxtjs/i18n` | 10.6.0 (2026-07-30) | `node >=20.11.1`. Healthy release cadence. |
| `@pinia/nuxt` | 1.0.2 (2026-08-12) | Healthy. |
| `@vite-pwa/nuxt` | 1.1.1 (**2026-02-06**) | ⚠️ **Staleness risk.** Depends on `@nuxt/kit ^3.9.0` and has not released in seven months while Nuxt moved to 4.5. **Verify against the chosen Nuxt version at bootstrap**; the fallback is a Nitro + Workbox setup. |
| Vitest | 5.0.0 (2026-09-03) | Very fresh at verification; consider the previous major if the plugin ecosystem lags. |
| Playwright | 1.63.0 (2026-09-04) | Healthy. |
| **Node** | **24.21.0 "Krypton" — Active LTS** (2026-09-07) | Node 26.8.2 is Current and enters LTS around Oct 2026. |

### 2.1 Local environment at verification

| Tool | Local | Assessment |
| --- | --- | --- |
| Node | **v22.20.0** | Satisfies Nuxt 4.5's `^22.19.0`, but Node 22 reaches EOL in Apr 2027 |
| npm | 10.9.3 | Fine |

**Target: Node 24 LTS**, pinned via `.nvmrc`. Upgrade happens at M1, not in M0.

---

## 3. Backend findings — 2026-09-12

Recorded here for cross-repository awareness; the backend keeps its own copy in
`purrenade-api/docs/architecture/versions-and-runtime.md`.

| Package | Latest at verification | Notes |
| --- | --- | --- |
| **Laravel** | **13.31.0** (2026-09-08) | Released Mar 2026. Declares `php ^8.3`, but Symfony 8 dependencies effectively require **PHP 8.4**. No LTS since Laravel 6: bug fixes ≈ Q3 2027, security ≈ Q1 2028. |
| **PHP** | 8.5.10 current; **8.4.25 recommended** | PHP 8.4 EOL 2028-12-31. PHP 8.2 EOLs 2026-12-31. |
| **PostgreSQL** | **18.6** (EOL 2030-11-14) | Target 18. |
| Redis | 8.10.x | Note licensing (RSALv2/SSPL); Valkey is the open alternative. |
| laravel/sanctum · fortify | 4.3.3 · 1.39.0 | The mainstream 2026 pattern is Fortify for flows + Sanctum for session/token issuance. |
| pestphp/pest | 5.1.4 | **Requires `php ^8.4`** — reinforces the PHP 8.4 target. |

**Local PHP at verification was 8.2.30.** That is a local-environment gap, **not
an architectural constraint**: the runtime is upgraded to 8.4 before backend
bootstrap, and **not during M0**.

---

## 4. Target stack — PROPOSED

| Component | Target |
| --- | --- |
| Node | **24 LTS** |
| Nuxt | **4.5.x** |
| Vue | **3.5.x** |
| TypeScript | **6.x** |
| Phaser | **4.2.x** |
| PHP | **8.4** |
| Laravel | **13.x** |
| PostgreSQL | **18** |
| Redis | **8.x** (or Valkey — see the backend's caching ADR) |

All PROPOSED, all subject to the M1 re-verification.

---

## 5. Version policy — APPROVED

1. **Never hardcode old versions.** Research before bootstrapping.
2. **Never install a package merely because it is newest.** Compatibility with
   the rest of the stack decides.
3. **Avoid alphas and betas** for anything load-bearing (Vue 3.6 Vapor is the
   live example).
4. **Record what was actually installed, and when it was verified**, in this file.
5. **Re-verify at every bootstrap or major upgrade**, and update the record.
6. Prefer **Active LTS** runtimes over Current for production targets.

---

## 6. Risks carried into M1

| Risk | Mitigation |
| --- | --- |
| `@vite-pwa/nuxt` may not support the chosen Nuxt version | Verify first; fall back to a Nitro + Workbox setup rather than downgrading Nuxt |
| TypeScript 7 may not be supported by the Nuxt/Vue toolchain | Pin TS 6.x; re-verify before adopting 7 |
| Phaser 4's renderer rewrite is relatively young | New project, no migration cost; validate performance on a real mid-range device early |
| Vitest 5 released days before verification | Accept, or use the previous major if plugins lag |
| Laravel 13 has no LTS designation | Plan a steady annual upgrade cadence rather than expecting long-term stasis |
