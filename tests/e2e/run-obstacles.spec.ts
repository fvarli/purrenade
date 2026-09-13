import { expect, test } from '@playwright/test'

/**
 * The M6 systems, in a real browser.
 *
 * What a browser proves here is integration: that obstacles actually reach the
 * screen, that a heart actually goes when one is ignored, that the world
 * actually stops when the run is paused. It does **not** prove the gameplay
 * mathematics — collision geometry, the escape-path guarantee and the near-miss
 * rules are settled in the pure domain, deterministically, with no GPU and no
 * timing tolerance. A screenshot diff is the wrong instrument for a rule.
 */

async function open(page: import('@playwright/test').Page, path: string): Promise<void> {
  await page.goto(path)
  await page.waitForLoadState('networkidle')
}

/** The visible heart count, read from the accessible text rather than the glyphs. */
async function hearts(page: import('@playwright/test').Page): Promise<number> {
  const text = await page.locator('.run__hearts-count').textContent()

  return Number(/(\d+)\s*\/\s*\d+/.exec(text ?? '')?.[1] ?? Number.NaN)
}

test.describe('obstacles, damage and the end of a run', () => {
  test.describe.configure({ mode: 'serial' })

  test.skip(
    !process.env.PURRENADE_E2E_EMAIL || !process.env.PURRENADE_E2E_PASSWORD,
    'set PURRENADE_E2E_EMAIL and PURRENADE_E2E_PASSWORD',
  )

  test('starts with three hearts and nothing able to hurt the player yet', async ({ page }) => {
    await open(page, '/run')
    await expect(page.locator('.run__phase')).toHaveText(/Koşuyor|Running|En marcha/, { timeout: 20_000 })

    expect(await hearts(page)).toBe(3)

    // The approved protected interval. Nothing may reach the player inside it.
    await page.waitForTimeout(2_000)

    expect(await hearts(page), 'no hazard may be reachable in the opening').toBe(3)
  })

  test('costs a heart when the player ignores the road', async ({ page }) => {
    await open(page, '/run')
    await expect(page.locator('.run__phase')).toHaveText(/Koşuyor|Running|En marcha/, { timeout: 20_000 })

    await expect
      .poll(async () => hearts(page), { timeout: 30_000, message: 'a standing player should be hit' })
      .toBeLessThan(3)
  })

  test('ends the run after three hits, and stops the world', async ({ page }) => {
    /*
     * Three deaths at the real scroll speed take the better part of a minute,
     * and longer when eleven workers are sharing one dev server. The poll asked
     * for 90s against a 30s test timeout, so it was cut off two hearts in and
     * failed as `expected 0, received 1` — a message that describes the game
     * being slow, not the game being wrong. Observed once in three consecutive
     * full-suite runs, and it is a timing lie rather than a flake.
     */
    test.setTimeout(150_000)

    await open(page, '/run')
    await expect(page.locator('.run__phase')).toHaveText(/Koşuyor|Running|En marcha/, { timeout: 20_000 })

    await expect
      .poll(async () => hearts(page), { timeout: 90_000 })
      .toBe(0)

    await expect(page.locator('.run__phase')).toHaveText(/Bitti|Over|Fin/)
    await expect(page.locator('.run__status--ended')).toBeVisible()

    // Terminal: the canvas must stop changing.
    const canvas = page.locator('canvas')
    const settled = await canvas.screenshot()

    await page.waitForTimeout(400)

    expect(Buffer.compare(settled, await canvas.screenshot()), 'an ended run must not keep scrolling').toBe(0)
  })

  test('freezes the world while paused and does not burst on resume', async ({ page }) => {
    await open(page, '/run')
    await expect(page.locator('.run__phase')).toHaveText(/Koşuyor|Running|En marcha/, { timeout: 20_000 })

    await page.keyboard.press('Escape')
    await expect(page.locator('.run__phase')).toHaveText(/Duraklatıldı|Paused|En pausa/)

    const canvas = page.locator('canvas')

    /*
     * Let the canvas settle before sampling it.
     *
     * The phase flips synchronously — that is the M5 fix for the resume
     * deadlock — but the dimming that goes with it is applied by Phaser's next
     * frame, and the scale manager polls its parent bounds on an interval of
     * its own. Measured: the canvas changes for about 900 ms after the pause
     * and is then byte-identical across four samples over the following second.
     * So the world does stop; sampling it too eagerly catches it stopping.
     */
    await expect.poll(async () => {
      const a = await canvas.screenshot()
      await page.waitForTimeout(300)
      const b = await canvas.screenshot()

      return Buffer.compare(a, b) === 0
    }, { timeout: 8_000, intervals: [300], message: 'the paused canvas should stop changing' }).toBe(true)

    const paused = await canvas.screenshot()
    const heartsWhilePaused = await hearts(page)

    // Long enough that an unpaused world would have moved a great deal.
    await page.waitForTimeout(1_500)

    expect(Buffer.compare(paused, await canvas.screenshot()), 'a paused world must not scroll').toBe(0)
    expect(await hearts(page), 'a paused run cannot take damage').toBe(heartsWhilePaused)

    await page.keyboard.press('Escape')
    await expect(page.locator('.run__phase')).toHaveText(/Koşuyor|Running|En marcha/)

    // Resuming must not pay back the paused time as a burst of hazards.
    await page.waitForTimeout(300)

    expect(await hearts(page), 'resuming must not deliver banked damage').toBe(heartsWhilePaused)
  })

  test('draws obstacles that approach the player', async ({ page }) => {
    await open(page, '/run')
    await expect(page.locator('.run__phase')).toHaveText(/Koşuyor|Running|En marcha/, { timeout: 20_000 })

    // Past the protected interval, the road has something on it and it moves.
    await page.waitForTimeout(3_000)

    const canvas = page.locator('canvas')
    const first = await canvas.screenshot()

    await page.waitForTimeout(250)

    expect(Buffer.compare(first, await canvas.screenshot()), 'the world should be moving').not.toBe(0)
  })

  test('keeps the heart row readable at every viewport', async ({ page }) => {
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 360, height: 640 },
      { width: 390, height: 844 },
      { width: 1280, height: 900 },
    ]) {
      await page.setViewportSize(viewport)
      await open(page, '/run')
      await page.waitForFunction(() => document.querySelector('canvas') !== null, null, { timeout: 20_000 })

      const row = page.locator('.run__hearts')

      await expect(row).toBeVisible()

      const box = await row.boundingBox()

      expect(box, `${viewport.width}x${viewport.height}`).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1)

      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth)

      expect(overflow, 'the run must not scroll horizontally').toBeLessThanOrEqual(0)
    }
  })
})
