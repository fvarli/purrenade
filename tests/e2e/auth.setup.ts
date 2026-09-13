import { expect, test as setup } from '@playwright/test'

/**
 * Sign in once, and save the session for the authenticated specs.
 *
 * Not a convenience. Logging in per test tripped the real rate limiter — the
 * login limiter is five per minute per identifier, and eleven parallel workers
 * comfortably exceed that. The tests then failed for a reason that had nothing
 * to do with what they were testing, which is the worst kind of failing test.
 *
 * Reusing one session is also closer to how the product is used: a player signs
 * in once and plays.
 */

const STORAGE = 'tests/e2e/.auth/state.json'

const EMAIL = process.env.PURRENADE_E2E_EMAIL
const PASSWORD = process.env.PURRENADE_E2E_PASSWORD

setup('sign in', async ({ page }) => {
  setup.skip(!EMAIL || !PASSWORD, 'set PURRENADE_E2E_EMAIL and PURRENADE_E2E_PASSWORD')

  await page.goto('/auth/login')

  // Wait for hydration before typing. `goto` resolves on `load`, which under
  // the dev server is well before Vue has attached its listeners — filling then
  // sets the DOM value and never reaches the component's state, so the form
  // submits empty and the failure looks like bad credentials.
  await page.waitForLoadState('networkidle')

  await page.fill('#login-email', EMAIL!)
  await page.fill('#login-password', PASSWORD!)
  await page.click('form button[type=submit]')

  // Landing on the shell means the session cookie is set and the store has
  // bootstrapped — the state saved below is genuinely usable.
  await page.waitForURL('**/', { timeout: 20_000 })
  await expect(page.locator('.home__play')).toBeVisible()

  await page.context().storageState({ path: STORAGE })
})
