import { defineConfig } from '@playwright/test'

/**
 * End-to-end configuration.
 *
 * Runs against the **live local stack** — the systemd services behind Nginx —
 * rather than starting its own server. That is deliberate: these tests are the
 * responsive and accessibility acceptance pass, and the thing worth asserting
 * about is the real SSR output with the real fonts and the real CSS, not a
 * separately-built approximation of it.
 *
 * Consequently they are **not** part of the default `npm test` run and not a CI
 * gate: CI has no Nginx, no certificates and no .test hostname. They are run
 * explicitly, with `npm run test:e2e`, against a running stack.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,

  /*
   * Capped, because the thing under test is one dev server.
   *
   * Playwright defaults to half the cores, which here means several specs
   * driving a live Phaser run at the same time, against a single Nuxt process
   * that is also server-rendering every navigation. Under that load the run
   * route can sit in "Getting ready" for twenty seconds and a signed-in home
   * page can take longer than any reasonable assertion budget — failures that
   * describe the machine, not the product. Measured serially, every one of
   * those cases is correct every time.
   *
   * Four keeps the suite honest without making it slow: a full run costs about
   * a minute more than it did at six, and stops reporting saturation as defect.
   */
  workers: process.env.CI ? 2 : 4,

  /*
   * A minute, not Playwright's default thirty seconds.
   *
   * These are acceptance tests against a live stack, and several of them drive a
   * real Phaser run: waiting out a readiness beat, losing three hearts at the
   * real scroll speed, comparing canvas frames across a jump arc. Thirty seconds
   * was never a generous budget for that, and three separate specs were sitting
   * within a second or two of it — so any extra load tipped them over and the
   * suite reported "expected 0, received 1" or a bare screenshot timeout, which
   * describes the machine rather than the product.
   *
   * Individual tests still raise this where they genuinely need longer; what
   * this removes is a whole class of failures that were only ever about time.
   */
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'https://purrenade.test',
    // The local certificate is issued by the mkcert CA, which is trusted by the
    // system store but not by Playwright's bundled Chromium.
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      // Signs in once and saves the session. Without it every authenticated
      // test would log in for itself and trip the real login rate limiter,
      // which is five per minute per identifier.
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { channel: 'chrome' },
    },
    {
      // The anonymous pass: sign-in, registration, the guards. These must run
      // with no session, so they deliberately do not adopt the saved state.
      name: 'chrome',
      testIgnore: [/auth\.setup\.ts/, /run-surface\.spec\.ts/, /run-lifecycle\.spec\.ts/, /run-obstacles\.spec\.ts/, /run-scoring\.spec\.ts/, /run-tutorial\.spec\.ts/, /run-submission\.spec\.ts/, /run-touch\.spec\.ts/, /ssr-auth-session\.spec\.ts/, /leaderboard\.spec\.ts/],
      use: {
        // The system Chrome, not Playwright's bundled build. These tests are an
        // acceptance pass against the machine's real stack, so the real browser
        // is the right engine — and it avoids pinning a second ~170MB Chromium
        // download to the toolchain for a suite that is not a CI gate.
        channel: 'chrome',
      },
    },
    {
      // The authenticated pass: the run surface, which lives behind the
      // verified-account guard.
      name: 'chrome-auth',
      testMatch: /(run-(surface|lifecycle|obstacles|scoring|tutorial|submission)|ssr-auth-session|leaderboard)\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        channel: 'chrome',
        storageState: 'tests/e2e/.auth/state.json',
      },
    },
    {
      /*
       * The one project with a touchscreen.
       *
       * Every other project drives a mouse, and the gesture unit tests drive a
       * hand-written emitter — so until this existed, every claim the codebase
       * made about touch was verified by something that cannot produce a touch.
       * That is how a dead band covering a third of the playfield survived two
       * milestones: the canvas fills the viewport, the HUD rows are painted
       * over it, and a touch that lands on a row is not a touch on the canvas.
       *
       * Deliberately narrow. It runs one spec, not the suite: a second full
       * pass would double the runtime to re-prove things that have nothing to
       * do with the input device.
       */
      name: 'chrome-touch',
      testMatch: /run-touch\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        channel: 'chrome',
        storageState: 'tests/e2e/.auth/state.json',
        hasTouch: true,
        isMobile: false,
        viewport: { width: 360, height: 640 },
      },
    },
  ],
})
