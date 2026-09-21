import { expect, test } from '@playwright/test'

/**
 * The playfield, touched.
 *
 * Every other browser project drives a mouse, and the gesture rules are unit
 * tested against a hand-written emitter — so nothing in this repository had
 * ever produced a real touch. That is how the defect below survived two
 * milestones.
 *
 * `.run__surface` is `position: absolute; inset: 0`, so the canvas is the whole
 * viewport and the HUD rows are painted over it. Phaser starts a gesture only
 * when the touch's target is the canvas, so a swipe beginning on any row did
 * nothing at all — roughly the top quarter and the entire bottom third of a
 * 360x640 screen, including the strip a thumb rests on. Keyboard play was
 * unaffected, which is why it was invisible.
 *
 * Asserted on the engine's own decision rather than on pixels: `scene.ts` calls
 * `preventDefault()` only once `shouldHandleKey`/the gesture path has claimed
 * the input, and the road scrolls continuously so frame diffing proves nothing.
 */

type Page = import('@playwright/test').Page

async function openRun(page: Page): Promise<void> {
  await page.goto('/run')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('.run__phase')).toHaveText(
    /Koşuyor|Running|En marcha/,
    { timeout: 20_000 },
  )
}

/** Swipe horizontally with a real touch, starting at a given point. */
async function swipeFrom(page: Page, x: number, y: number): Promise<void> {
  await page.touchscreen.tap(x, y)
}

/**
 * Which element would receive a touch at this point?
 *
 * The whole defect is a hit-testing question, so this asks the browser the
 * hit-testing question directly instead of inferring it.
 */
async function targetAt(page: Page, x: number, y: number): Promise<string> {
  return page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px as number, py as number)

    return el === null ? 'none' : (el.tagName + '.' + el.className).slice(0, 60)
  }, [x, y])
}

test.describe('touch reaches the playfield', () => {
  test.skip(
    !process.env.PURRENADE_E2E_EMAIL || !process.env.PURRENADE_E2E_PASSWORD,
    'set PURRENADE_E2E_EMAIL and PURRENADE_E2E_PASSWORD',
  )

  test('the canvas is what a touch lands on, everywhere except the controls', async ({ page }) => {
    await openRun(page)

    const rows = ['.run__hud', '.run__meta', '.run__foot']

    for (const selector of rows) {
      const box = await page.locator(selector).boundingBox()

      expect(box, `${selector} should be laid out`).not.toBeNull()

      const x = Math.round(box!.x + box!.width / 2)
      const y = Math.round(box!.y + box!.height / 2)

      /*
       * The canvas, not the surface: Phaser's canvas is a child of
       * `.run__surface` and fills it, so it is what hit-testing returns. That
       * distinction is the whole point — Phaser starts a gesture only when the
       * touch target *is* the canvas, so asserting on the wrapper would pass
       * while gameplay still received nothing.
       */
      expect(await targetAt(page, x, y), `${selector} swallowed the touch`)
        .toContain('CANVAS')
    }
  })

  test('the controls still take their own touches', async ({ page }) => {
    await openRun(page)

    for (const selector of ['.run__slayyy-button', '.run__exit']) {
      const box = await page.locator(selector).boundingBox()
      const x = Math.round(box!.x + box!.width / 2)
      const y = Math.round(box!.y + box!.height / 2)

      const target = await targetAt(page, x, y)

      expect(target, `${selector} must remain tappable`).not.toContain('run__surface')
    }
  })

  test('a tap over the HUD is claimed by the game, not swallowed', async ({ page }) => {
    await openRun(page)

    const claimed = await page.evaluate(() => {
      const store = window as unknown as { __claimed?: boolean }

      store.__claimed = false
      document.addEventListener(
        'pointerdown',
        (event) => { store.__claimed = (event.target as HTMLElement)?.tagName === 'CANVAS' },
        { once: true, capture: true },
      )

      return true
    })

    expect(claimed).toBe(true)

    const box = (await page.locator('.run__foot').boundingBox())!

    await swipeFrom(page, Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2))

    expect(
      await page.evaluate(() => (window as unknown as { __claimed?: boolean }).__claimed),
      'a touch on the foot row must reach the canvas',
    ).toBe(true)
  })

  test('the SLAYYY control meets the touch-target minimum and drops browser gestures', async ({ page }) => {
    await openRun(page)

    const button = page.locator('.run__slayyy-button')
    const box = (await button.boundingBox())!

    expect(box.height, 'height at 360px').toBeGreaterThanOrEqual(44)
    expect(box.width, 'width at 360px').toBeGreaterThanOrEqual(44)

    // Without this a double tap zooms the page mid-run, which is exactly what a
    // player does when the first press appears not to fire.
    await expect(button).toHaveCSS('touch-action', 'manipulation')
  })
})

/**
 * The tutorial prompt, touched.
 *
 * It is a card painted over the canvas, which is exactly the shape of the
 * defect this file exists for — and the tutorial makes it worse, because the
 * prompt is on screen while the player is being *asked to swipe*. A card that
 * swallowed the swipe it requested would be a lesson that cannot be passed.
 *
 * So the prompt is `pointer-events: none` and only its Skip control opts back
 * in. Both halves are asserted here: the road takes a touch through the card,
 * and Skip still takes its own.
 */
test.describe('the tutorial prompt does not eat the gesture it asks for', () => {
  test.skip(
    !process.env.PURRENADE_E2E_EMAIL || !process.env.PURRENADE_E2E_PASSWORD,
    'set PURRENADE_E2E_EMAIL and PURRENADE_E2E_PASSWORD',
  )

  async function openTutorial(page: Page): Promise<void> {
    await page.goto('/run?mode=tutorial')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('.run__tutorial-card')).toBeVisible({ timeout: 30_000 })
  }

  test('a touch on the prompt reaches the canvas', async ({ page }) => {
    await openTutorial(page)

    const box = (await page.locator('.run__tutorial-card').boundingBox())!
    // The card's own text, not its edge — the middle is where a thumb lands.
    const x = Math.round(box.x + box.width / 2)
    const y = Math.round(box.y + 24)

    expect(await targetAt(page, x, y), 'the prompt must be transparent to touch').toContain('CANVAS')
  })

  test('the skip control still takes its own touch, at the approved size', async ({ page }) => {
    await openTutorial(page)

    const skip = page.locator('.run__tutorial-skip')
    const box = (await skip.boundingBox())!

    expect(box.height, 'Skip meets the touch-target minimum').toBeGreaterThanOrEqual(44)

    const target = await targetAt(page, Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2))

    expect(target, 'Skip opts back into pointer events').toContain('run__tutorial-skip')
  })
})
