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

    public: {
      // Deliberately empty of any backend origin. See above.
    },
  },

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
