// Purrenade — Nuxt configuration.
//
// Architectural constraints this file encodes (see docs/architecture/):
//   - ADR-0005: Nitro acts as the BFF and is inside the security boundary.
//     `server/` handles sessions and CSRF; the browser never holds a bearer token.
//   - frontend-architecture.md §2: the run route is client-only and the Phaser
//     bundle must never enter an SSR path.
//   - localization.md: tr is the source locale; text is never baked into images.
//
// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',

  devtools: { enabled: true },

  // Local development binds to a dedicated loopback port. Never 0.0.0.0, and
  // never Laravel's 8000 — which is already occupied on some dev machines.
  // Public local URL is https://purrenade.test, terminated by native Nginx.
  devServer: {
    host: process.env.NUXT_DEV_HOST || '127.0.0.1',
    port: Number(process.env.NUXT_DEV_PORT || 4310),
  },

  vite: {
    server: {
      // Vite blocks requests whose Host header it does not recognise — DNS
      // rebinding protection. The local domain is allowlisted explicitly
      // rather than disabling the check.
      allowedHosts: (process.env.NUXT_ALLOWED_HOSTS || 'purrenade.test').split(','),

      // HMR travels through the Nginx TLS proxy, so the client must be told to
      // dial wss on 443 rather than plain ws on the internal port. Overridable
      // for anyone who prefers browsing the internal port directly — that mode
      // needs NUXT_HMR_PROTOCOL=ws, NUXT_HMR_HOST=127.0.0.1, NUXT_HMR_PORT=4310.
      //
      // `server.ws`, not `server.hmr`: Vite 8 deprecated every connection field
      // on `hmr` in favour of the identically-shaped `ws`, and warned about it
      // on every dev-server boot — noise in a journal that is now the primary
      // place these logs are read.
      ws: {
        protocol: process.env.NUXT_HMR_PROTOCOL || 'wss',
        host: process.env.NUXT_HMR_HOST || 'purrenade.test',
        clientPort: Number(process.env.NUXT_HMR_PORT || 443),
      },
    },
  },

  runtimeConfig: {
    // PRIVATE — server-side only. Nitro reads this; the browser never does.
    //
    // ADR-0005: the browser talks to https://purrenade.test and nothing else.
    // Nitro, acting as the BFF, is what talks to the Laravel API. Moving this
    // into runtimeConfig.public would expose the API origin to the browser and
    // quietly invert that decision, so it stays private.
    apiBase: process.env.NUXT_API_BASE || 'https://api.purrenade.test',

    // Every upstream call is bounded. Without a timeout, an API that accepts
    // connections and never answers exhausts this process's sockets and takes
    // the frontend down with it.
    apiTimeoutMs: Number(process.env.NUXT_API_TIMEOUT_MS || 10_000),

    // Origins whose state-changing requests the BFF will consider. Defence in
    // depth behind the CSRF token, not a substitute for it — and configuration
    // rather than a constant, because `.test` is a local development fact.
    trustedOrigins: (process.env.NUXT_TRUSTED_ORIGINS || 'https://purrenade.test').split(','),

    session: {
      // `__Host-` is a prefix browsers enforce: it requires Secure, requires
      // Path=/, and forbids Domain, so no subdomain can overwrite this cookie.
      // That is ADR-0005 §3's "host-prefixed" requirement made a browser
      // guarantee rather than a convention. It also means the cookie is not set
      // over plain HTTP — use the .test hostname locally.
      cookieName: process.env.NUXT_SESSION_COOKIE || '__Host-purrenade_session',

      // Readable by design: the client must send it back in a header, which is
      // the one thing a cross-site form cannot do. Not a credential on its own.
      csrfCookieName: process.env.NUXT_CSRF_COOKIE || '__Host-purrenade_csrf',

      // Idle timeout: expires a session nobody is using. The control that
      // matters for a shared or stolen device, and enforced here because the
      // BFF is the layer that observes browser activity.
      idleMinutes: Number(process.env.NUXT_SESSION_IDLE_MINUTES || 60 * 24 * 7),

      // Absolute timeout: expires a session however active it has been, so one
      // cannot outlive its credential. Mirrored upstream by sanctum.expiration,
      // which is the backstop if this layer is ever bypassed.
      absoluteMinutes: Number(process.env.NUXT_SESSION_ABSOLUTE_MINUTES || 60 * 24 * 30),
    },

    public: {
      // Deliberately empty of any backend origin. See above.
    },
  },

  // The run route is client-only.
  //
  // A canvas cannot be server-rendered, and Phaser reads `window` at import
  // time — so an SSR pass over this route would fail at build, not at runtime.
  // Marking it here rather than relying on a `<ClientOnly>` wrapper also keeps
  // the page's own chunk out of the server bundle.
  //
  // frontend-architecture.md §2.
  routeRules: {
    '/run': { ssr: false },
  },

  nitro: {
    // ---------------------------------------------------------------------
    // The BFF session store
    // ---------------------------------------------------------------------
    //
    // ADR-0005 §3 requires the session to be a *server-side record*, with the
    // cookie only a reference, so that revocation is immediate and real. That
    // rules out h3's sealed-cookie `useSession`, which encrypts the payload into
    // the cookie — putting the API token in the browser and making the session
    // unrevocable until it expires.
    //
    // So the session lives in Nitro storage, behind unstorage. The driver is a
    // deployment choice, and this is the seam that keeps it one:
    //
    //   - **Development**: the filesystem. No extra service to run, no Docker,
    //     and it survives a dev-server restart, which a memory driver would not.
    //
    //   - **Production**: a shared store, so more than one instance can resolve
    //     the same session. That belongs to OPS-1 along with the rest of the
    //     hosting topology.
    //
    // **This is read at BUILD time, not at runtime.** `nitro.storage` is not
    // part of `runtimeConfig`, so the driver chosen here is compiled into the
    // server bundle: the built output contains a literal
    // `mount('sessions', fs({...}))` and the variable name appears nowhere in
    // it. Setting `NUXT_SESSION_DRIVER` in a production environment therefore
    // does **nothing** — the process keeps writing plaintext bearer tokens to
    // the local disk while the operator believes they have moved the store.
    // Changing it requires a rebuild with the variable present, plus the
    // driver's own dependency.
    //
    // An earlier version of this comment, and of the docs, called it "a
    // configuration change here rather than a code change anywhere". It is the
    // other way round, and the failure was silent and in the unsafe direction —
    // so `server/plugins/session-store-guard.ts` refuses to boot a production
    // process whose resolved sessions mount is filesystem-backed.
    //
    // The path is git-ignored, and the guard tightens its permissions: it holds
    // live session records, which are credentials.
    storage: {
      sessions: {
        driver: process.env.NUXT_SESSION_DRIVER || 'fs',
        base: process.env.NUXT_SESSION_FS_BASE || '.data/sessions',
      },
    },
  },

  // Self-hosted fonts and the token layer, in that order: the @font-face rules
  // must exist before anything references the families. Fonts come from
  // @fontsource (OFL-1.1, vendored via the lockfile) rather than a CDN —
  // loading them from a third party transmits every visitor's IP address to it.
  // design-tokens.md §2.1.
  //
  // Only the weights and subsets actually used: Baloo 2 at 800 for display,
  // Nunito at 400/700 for body, each in latin and latin-ext. latin-ext is not
  // optional — it carries Turkish `ğ ı İ ş ç ö ü` and Spanish `á é í ñ ó ú`.
  css: [
    '@fontsource/baloo-2/latin-800.css',
    '@fontsource/baloo-2/latin-ext-800.css',
    '@fontsource/nunito/latin-400.css',
    '@fontsource/nunito/latin-ext-400.css',
    '@fontsource/nunito/latin-700.css',
    '@fontsource/nunito/latin-ext-700.css',
    '~/assets/css/tokens.css',
    '~/assets/css/base.css',
  ],

  modules: [
    '@nuxt/eslint',
    '@nuxtjs/i18n',
    '@pinia/nuxt',
  ],

  typescript: {
    // Fail the build on type errors rather than only reporting them.
    strict: true,
    typeCheck: false, // run explicitly via `npm run typecheck`; keeps dev startup fast
  },

  i18n: {
    // Turkish is the source locale — all approved copy in Claude Design v0.3 is
    // Turkish and the primary audience is Turkish-speaking. See ADR-0007.
    defaultLocale: 'tr',
    strategy: 'no_prefix',
    locales: [
      { code: 'tr', language: 'tr-TR', name: 'Türkçe', file: 'tr.json' },
      { code: 'en', language: 'en-US', name: 'English', file: 'en.json' },
      { code: 'es', language: 'es-ES', name: 'Español', file: 'es.json' },
    ],
    langDir: 'locales',
    // Locale resolution order is profile → device → Accept-Language → tr.
    // Only the browser half is configurable here; the profile half arrives with
    // the session in M2/M4.
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'purrenade_locale',

      // Secure, like every other cookie this site sets. It carries no secret —
      // it is a language preference — but a cookie without it can be written by
      // anyone who can answer for plain http://purrenade.test, and a writable
      // cookie is a lever: the jar has a per-domain limit, so an attacker who
      // can set cookies can evict others, including the `__Host-` session
      // cookie. Being harmless in itself is not the same as being safe to leave
      // writable.
      cookieSecure: true,
      cookieCrossOrigin: false,

      redirectOn: 'root',
      fallbackLocale: 'tr',
    },
  },

  // PWA is deliberately NOT configured here. `@vite-pwa/nuxt` 1.1.1 is built
  // against Nuxt 3 (`@nuxt/kit ^3.9.0`), so the dependency is not taken during
  // bootstrap. Direction is documented in docs/architecture/pwa-and-mobile.md;
  // implementation belongs to M12.

  future: {
    compatibilityVersion: 4,
  },
})
