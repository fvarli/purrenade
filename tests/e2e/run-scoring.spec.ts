import { expect, test } from '@playwright/test'

/**
 * The M7 heads-up display, driven by a real run.
 *
 * What a browser proves here is that the readout is *wired*: that the score on
 * screen comes from a simulation actually stepping, that collecting a token
 * moves the counter, that the display stops when the run does. It does not
 * prove the scoring rules — the multiplier, the 200-paw threshold, the charge
 * curve and the overflow arithmetic are all settled in the pure domain, exactly
 * once, without a GPU or a timing tolerance.
 *
 * **One case is deliberately absent: an activated SLAYYY.** The meter arms at
 * around 38-43 seconds on a representative healthy run (measured, and recorded
 * in the tuning registry), and a scripted player who does not dodge is dead in
 * roughly twenty. Reaching `ready` in a browser would mean playing the game
 * competently from a test, which is a worse instrument than the domain suite
 * that already holds the timing. The armed and active states are covered by the
 * component tests, which can hold any state, and the mechanics by the domain.
 */

type Page = import('@playwright/test').Page

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await page.waitForLoadState('networkidle')
}

async function running(page: Page): Promise<void> {
  await expect(page.locator('.run__phase')).toHaveText(
    /Koşuyor|Running|En marcha/,
    { timeout: 20_000 },
  )
}

/** The score, read from the text the player and a screen reader both get. */
async function score(page: Page): Promise<number> {
  return Number((await page.locator('.run__score-value').textContent())?.trim() ?? Number.NaN)
}

/** The paw count, from whichever of the two presentations is showing. */
async function paws(page: Page): Promise<number> {
  const text = (await page.locator('.run__paws').textContent()) ?? ''

  return Number(/(\d+)/.exec(text)?.[1] ?? Number.NaN)
}

test.describe('the heads-up display during a run', () => {
  test.skip(
    !process.env.PURRENADE_E2E_EMAIL || !process.env.PURRENADE_E2E_PASSWORD,
    'set PURRENADE_E2E_EMAIL and PURRENADE_E2E_PASSWORD',
  )

  test('starts empty and every fact is present', async ({ page }) => {
    await open(page, '/run')
    await running(page)

    // Read before the first frames can move it. A HUD that begins at some
    // arbitrary number is a HUD reading stale state from a previous run.
    expect(await score(page)).toBeLessThan(20)
    expect(await paws(page)).toBe(0)

    await expect(page.locator('.run__score-label')).toBeVisible()
    await expect(page.locator('.run__hearts-count')).toBeVisible()
    await expect(page.locator('.run__slayyy-button')).toBeVisible()
    // No companion at the start of a run: the first bonus is 200 paws away.
    await expect(page.locator('.run__loli')).toHaveCount(0)
  })

  test('the score climbs while the world scrolls', async ({ page }) => {
    await open(page, '/run')
    await running(page)

    const opening = await score(page)

    await expect
      .poll(async () => score(page), { timeout: 20_000, message: 'distance should earn points' })
      .toBeGreaterThan(opening + 50)
  })

  test('collecting tokens moves the paw counter', async ({ page }) => {
    await open(page, '/run')
    await running(page)

    // A player who never moves still runs into tokens: they are placed in
    // lanes the obstacles left clear, and the middle lane gets its share.
    await expect
      .poll(async () => paws(page), { timeout: 40_000, message: 'a standing player should collect something' })
      .toBeGreaterThan(0)
  })

  test('the SLAYYY control is present, disabled and labelled while it charges', async ({ page }) => {
    await open(page, '/run')
    await running(page)

    const button = page.locator('.run__slayyy-button')
    await expect(button).toBeDisabled()
    await expect(button).toHaveClass(/run__slayyy-button--charging/)

    // The state has to be in the accessible name, not only in the fill.
    const label = await button.getAttribute('aria-label')
    expect(label ?? '').not.toHaveLength(0)
    await expect(page.locator('.run__slayyy-text')).toHaveText(label ?? '')
  })

  test('pressing E while the meter is charging changes nothing', async ({ page }) => {
    await open(page, '/run')
    await running(page)

    const button = page.locator('.run__slayyy-button')
    const before = await button.getAttribute('class')

    await page.keyboard.press('KeyE')
    await page.keyboard.press('KeyE')
    await page.keyboard.press('KeyE')
    await page.waitForTimeout(500)

    // SLAYYY never auto-activates and never activates unarmed. A key that did
    // something here would be spending a meter that is not full.
    await expect(button).toBeDisabled()
    expect(await button.getAttribute('class')).toBe(before)
  })

  test('the score freezes when the run ends', async ({ page }) => {
    test.setTimeout(180_000)

    await open(page, '/run')
    await running(page)

    await expect(page.locator('.run__complete')).toBeVisible({ timeout: 150_000 })

    const final = await score(page)
    const finalPaws = await paws(page)
    await page.waitForTimeout(3_000)

    // Terminal means terminal: no distance is earned after the last heart.
    expect(await score(page)).toBe(final)
    expect(await paws(page)).toBe(finalPaws)
    await expect(page.locator('.run__slayyy-button')).toBeDisabled()
  })

  test('the whole display fits the narrowest supported screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await open(page, '/run')
    await running(page)

    for (const selector of ['.run__score-value', '.run__paws', '.run__hearts-count', '.run__slayyy-button']) {
      await expect(page.locator(selector)).toBeVisible()
    }

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    )
    expect(overflows, 'the HUD must not introduce a horizontal scrollbar').toBe(false)
  })
})
