import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'

/**
 * A normal run, from server start to server verdict, in a real browser (M9).
 *
 * Against the running local stack — Nuxt BFF and Laravel both — with the
 * `chrome-auth` account. What the unit tests prove with stubs, this proves
 * end to end: the run is started by the server before anything mounts, its
 * result is classified by the server, a finish survives a lost connection, and
 * a finish the BFF is holding survives a reload.
 *
 * Serial, on purpose: one account holds one active run, so two of these at
 * once would be two tabs racing for the same run — a real scenario, and one
 * the backend's concurrency suite covers, but not the one these assert.
 */

async function open(page: Page, path = '/run'): Promise<void> {
  await page.goto(path)
  await page.waitForLoadState('networkidle')
}

async function running(page: Page): Promise<void> {
  await expect(page.locator('.run__phase')).toHaveText(/Koşuyor|Running|En marcha/, { timeout: 30_000 })
}

/** The player's progression, as the server holds it. */
async function progression(request: APIRequestContext): Promise<{ run_count: number, lifetime_paws: number }> {
  const response = await request.get('/api/progression')

  expect(response.ok()).toBe(true)

  return (await response.json()).progression
}

/** A standing player loses three hearts in well under two minutes. */
async function waitForTheEnd(page: Page): Promise<void> {
  await expect(page.locator('.run__complete')).toBeVisible({ timeout: 150_000 })
}

test.describe('a normal run, decided by the server', () => {
  test.describe.configure({ mode: 'serial' })

  test.skip(
    !process.env.PURRENADE_E2E_EMAIL || !process.env.PURRENADE_E2E_PASSWORD,
    'set PURRENADE_E2E_EMAIL and PURRENADE_E2E_PASSWORD',
  )

  test('starts on the server, mounts its seed, and shows the server\'s verdict', async ({ page }) => {
    test.setTimeout(240_000)

    const before = await progression(page.request)

    const started = page.waitForResponse(response =>
      response.url().endsWith('/api/game-runs') && response.request().method() === 'POST')

    await open(page)

    const start = await started
    const body = await start.json()

    expect(start.status()).toBe(200)
    expect(body.run.seed).toBeGreaterThanOrEqual(0)
    expect(body.run.seed).toBeLessThanOrEqual(4294967295)
    expect(body.run.character_id).toBe('aysenur')

    await running(page)
    await waitForTheEnd(page)

    const outcome = page.locator('.run__outcome')

    await expect(outcome).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.run__outcome--accepted')).toBeVisible()

    const after = await progression(page.request)

    expect(after.run_count, 'an accepted run counts exactly once').toBe(before.run_count + 1)
  })

  test('keeps playing offline, and saves the run when the connection returns', async ({ page, context }) => {
    test.setTimeout(240_000)

    const before = await progression(page.request)

    await open(page)
    await running(page)

    // The run is already started server-side; losing the connection now must
    // not end it.
    await context.setOffline(true)

    await expect(page.locator('.run__phase')).toHaveText(/Koşuyor|Running|En marcha/)

    await waitForTheEnd(page)

    // The finish could not be sent: the page says so and keeps it.
    await expect(page.locator('.run__retry')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.run__outcome')).toHaveCount(0)

    await context.setOffline(false)

    await expect(page.locator('.run__outcome--accepted')).toBeVisible({ timeout: 60_000 })

    const after = await progression(page.request)

    expect(after.run_count).toBe(before.run_count + 1)
  })

  test('delivers a finish the BFF is holding after a reload, before anything new starts', async ({ page }) => {
    test.setTimeout(360_000)

    // Start from an empty finish bucket: the tests above finished runs inside
    // the current minute. Thirty finishes below then spend it exactly, and the
    // run's own finish is the thirty-first.
    await page.waitForTimeout(61_000)

    const before = await progression(page.request)

    /*
     * Hold the finish the first time it is sent, spend the account's finish
     * allowance, then let it through: Laravel answers 429, which consumes no
     * idempotency slot, so the BFF keeps the stored payload and its key. That
     * is the state a player is in when the API was briefly unreachable — and
     * the one a reload must recover from.
     */
    let held = false

    await page.route('**/api/game-runs/*/finish', async (route) => {
      if (!held) {
        held = true

        const csrf = (await page.context().cookies()).find(cookie => /csrf/i.test(cookie.name))?.value ?? ''

        for (let i = 0; i < 30; i++) {
          await page.request.post(`/api/game-runs/0199${String(i).padStart(4, '0')}-9999-7999-8999-999999999999/finish`, {
            headers: { 'X-CSRF-Token': csrf, 'Origin': new URL(page.url()).origin },
            data: { telemetry: { reported_duration_ms: 1, reported_score: 0, reported_run_paws: 0 } },
          })
        }
      }

      await route.continue()
    })

    await open(page)
    await running(page)
    await waitForTheEnd(page)

    await expect(page.locator('.run__retry')).toBeVisible({ timeout: 30_000 })

    await page.unroute('**/api/game-runs/*/finish')

    const pending = await page.request.get('/api/game-runs/pending')

    expect((await pending.json()).pending, 'the BFF holds the finish').not.toBeNull()

    await page.reload()

    // The held finish goes first — the page waits, and says so, while the
    // limiter still refuses it — and a new run starts only once it is
    // delivered, which the page then reports.
    await expect(page.locator('.run__status').filter({ hasText: /kaydedildi|has been saved|se ha guardado/i }))
      .toBeVisible({ timeout: 150_000 })

    await expect.poll(async () => (await progression(page.request)).run_count, { timeout: 120_000 })
      .toBe(before.run_count + 1)

    const cleared = await page.request.get('/api/game-runs/pending')

    expect((await cleared.json()).pending).toBeNull()
  })

  test('does not submit the tutorial', async ({ page }) => {
    test.setTimeout(120_000)

    const finishes: string[] = []
    const starts: string[] = []

    page.on('request', (request) => {
      if (request.url().endsWith('/finish')) finishes.push(request.url())
      if (request.url().endsWith('/api/game-runs') && request.method() === 'POST') starts.push(request.url())
    })

    await open(page, '/run?mode=tutorial')
    await expect(page.locator('.run__tutorial-card')).toBeVisible({ timeout: 30_000 })

    await page.locator('.run__tutorial-skip').click()
    await page.locator('.run__tutorial-confirm-skip').click()
    await expect(page.locator('.run__tutorial-complete')).toBeVisible({ timeout: 30_000 })

    expect(starts).toEqual([])
    expect(finishes).toEqual([])
  })
})
