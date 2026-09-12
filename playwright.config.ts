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
  reporter: [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'https://purrenade.test',
    // The local certificate is issued by the mkcert CA, which is trusted by the
    // system store but not by Playwright's bundled Chromium.
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'chrome',
      use: {
        // The system Chrome, not Playwright's bundled build. These tests are an
        // acceptance pass against the machine's real stack, so the real browser
        // is the right engine — and it avoids pinning a second ~170MB Chromium
        // download to the toolchain for a suite that is not a CI gate.
        channel: 'chrome',
      },
    },
  ],
})
