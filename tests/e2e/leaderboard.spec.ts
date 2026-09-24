import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'

/**
 * The leaderboard, end to end (M10), against the running local stack.
 *
 * One real run is played through the ordinary flow — started, simulated and
 * classified by the server; no score is made up anywhere — and the board is
 * then read the way a player reaches it: from the run-complete screen's
 * "view leaderboard", and from the menu. What is asserted is that the screen
 * shows the **server's** own entry and rank, never one computed in the browser.
 *
 * Serial: one account holds one active run.
 */

interface Entry { rank: number, display_name: string, score: number, is_self: boolean }
interface Page15 { window: string, data: Entry[], own_entry: Entry | null, meta: { has_more: boolean } }

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await page.waitForLoadState('networkidle')
}

/** The board exactly as the BFF returns it — the same call the screen makes. */
async function board(request: APIRequestContext, window: 'weekly' | 'all_time'): Promise<Page15> {
  const response = await request.get(`/api/leaderboards?window=${window}`)

  expect(response.ok()).toBe(true)

  return await response.json()
}

async function bestScore(request: APIRequestContext): Promise<number> {
  const response = await request.get('/api/progression')

  expect(response.ok()).toBe(true)

  return (await response.json()).progression.best_score
}

/**
 * Chrome's GPU process reporting on its own driver — "GPU stall due to
 * ReadPixels" while the WebGL canvas runs. It is emitted by the browser, not
 * by any application code, and is recorded as an annotation rather than
 * silently dropped, so the report still shows it happened.
 */
const GPU_DRIVER_DIAGNOSTIC = /^\[\.WebGL-0x[0-9a-f]+\]GL Driver Message \(OpenGL, Performance,/

/** The console, observed — so any claim about it rests on evidence. */
function watchConsole(page: Page): string[] {
  const problems: string[] = []

  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return

    const text = message.text().split('\n')[0]!

    if (message.type() === 'warning' && GPU_DRIVER_DIAGNOSTIC.test(text)) {
      test.info().annotations.push({ type: 'browser GPU diagnostic', description: text })

      return
    }

    problems.push(`${message.type()}: ${text}`)
  })
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`))

  return problems
}

/** The digits of a formatted score, whatever the locale's grouping. */
function digits(text: string | null): number {
  return Number((text ?? '').replace(/\D/g, ''))
}

test.describe('the leaderboard', () => {
  test.describe.configure({ mode: 'serial' })

  test.skip(
    !process.env.PURRENADE_E2E_EMAIL || !process.env.PURRENADE_E2E_PASSWORD,
    'set PURRENADE_E2E_EMAIL and PURRENADE_E2E_PASSWORD',
  )

  test('shows the server\'s rank for a run just played, from the run-complete screen', async ({ page }) => {
    test.setTimeout(240_000)
    const observed = watchConsole(page)

    const finished = page.waitForResponse(response =>
      /\/api\/game-runs\/[^/]+\/finish$/.test(new URL(response.url()).pathname)
      && response.request().method() === 'POST', { timeout: 200_000 })

    await open(page, '/run')
    await expect(page.locator('.run__phase')).toHaveText(/Koşuyor|Running|En marcha/, { timeout: 30_000 })

    const result = (await (await finished).json()).result as { status: string, score: number }

    await expect(page.locator('.run__complete')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.run__outcome')).toBeVisible({ timeout: 30_000 })

    test.skip(result.status !== 'accepted', `the run was ${result.status}; only an accepted run is on the board`)

    await page.locator('.run__leaderboard').click()
    await page.waitForURL('**/leaderboard')
    await page.waitForLoadState('networkidle')

    await expect(page.locator('h1')).toHaveText(/Skor Tablosu|Leaderboard|Clasificación/)

    const tabs = page.getByRole('tab')
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')

    const weekly = await board(page.request, 'weekly')
    const own = page.locator('aside.leaderboard__own')

    expect(weekly.own_entry, 'an accepted run this week puts the player on the weekly board').not.toBeNull()
    expect(weekly.own_entry!.score).toBeGreaterThanOrEqual(result.score)
    await expect(own.locator('.leaderboard__rank')).toContainText(String(weekly.own_entry!.rank))
    expect(digits(await own.locator('.leaderboard__score').textContent())).toBe(weekly.own_entry!.score)
    await expect(own.locator('.leaderboard__you')).toBeVisible()

    // All time: the own entry is the player's best accepted score.
    await tabs.nth(1).click()
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
    await page.waitForLoadState('networkidle')

    const allTime = await board(page.request, 'all_time')
    const best = await bestScore(page.request)

    expect(allTime.own_entry?.score).toBe(best)
    await expect(own.locator('.leaderboard__rank')).toContainText(String(allTime.own_entry!.rank))
    expect(digits(await own.locator('.leaderboard__score').textContent())).toBe(best)

    expect(observed, 'console errors or warnings observed on the run and leaderboard pages').toEqual([])
  })

  test('is reached from the menu, and exposes nothing internal', async ({ page }) => {
    const observed = watchConsole(page)

    await open(page, '/')

    const answered = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/leaderboards' && response.request().method() === 'GET')

    await page.locator('.home__grid a[href="/leaderboard"]').click()
    await page.waitForURL('**/leaderboard')

    const response = await answered
    const body = await response.text()

    expect(response.status()).toBe(200)
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('tablist')).toBeVisible()
    await expect(page.locator('.leaderboard__podium, .leaderboard__empty').first()).toBeVisible()

    const json = JSON.parse(body) as Page15

    for (const entry of [...json.data, ...(json.own_entry ? [json.own_entry] : [])]) {
      expect(Object.keys(entry).sort()).toEqual(['display_name', 'is_self', 'rank', 'score'])
    }

    expect(body).not.toMatch(/"(user_id|run_id|player_id|email|achieved_at|duration_ms)"/)
    expect(body).not.toMatch(/@[a-z0-9-]+\.[a-z]/i)

    expect(observed, 'console errors or warnings observed on the menu and leaderboard pages').toEqual([])
  })
})
