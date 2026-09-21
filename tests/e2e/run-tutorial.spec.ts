import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * The first-run tutorial, in a real browser.
 *
 * What a browser proves here is integration — that PLAY reaches the tutorial,
 * that a prompt is drawn over a live canvas, that the skip dialog stops play,
 * and that the layout survives a 320 px phone. The *lessons* are settled in the
 * pure domain, deterministically, where a scripted player can attempt a
 * thousand wrong actions without a timing tolerance.
 *
 * One case here is deliberately not left to the domain: **jumping at the cone.**
 * It is the misconception this milestone exists to correct, and it is worth
 * seeing it corrected through the real input path, the real renderer and the
 * real prompt.
 */

test.describe.configure({ mode: 'serial' })

test.skip(
  !process.env.PURRENADE_E2E_EMAIL || !process.env.PURRENADE_E2E_PASSWORD,
  'set PURRENADE_E2E_EMAIL and PURRENADE_E2E_PASSWORD',
)

/** The prompt's text, flattened. Null when no lesson is being taught. */
async function prompt(page: Page): Promise<string | null> {
  const card = page.locator('.run__tutorial-card')

  return (await card.count()) === 0 ? null : (await card.innerText()).replace(/\s*\n+\s*/g, ' | ')
}

async function openRun(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await page.waitForLoadState('networkidle')
  // The engine is a lazy 1.3 MB chunk; the phase readout is the first thing
  // that proves the simulation is actually running.
  await expect(page.locator('.run__phase')).toHaveText(/Koşuyor|Running|En marcha/, { timeout: 30_000 })
}

/**
 * Press a gameplay key.
 *
 * Through the page, not the canvas: the scene binds `keydown` on `document`, so
 * this exercises the same path a player's keyboard does.
 */
async function press(page: Page, key: string): Promise<void> {
  await page.locator('.run__surface').focus()
  await page.keyboard.press(key)
}

/**
 * Wait for a lesson to be the one on screen.
 *
 * Gating on the prompt rather than sleeping is what makes this stable: a lane
 * change takes 160 ms to settle and the lesson only passes once it has, so
 * pressing twice in a row races the rules and loses.
 */
async function waitForLesson(page: Page, pattern: RegExp): Promise<void> {
  await expect(page.locator('.run__tutorial-card')).toContainText(pattern, { timeout: 30_000 })
}

/** Play the two movement lessons, in whichever locale the account is using. */
async function reachTheCone(page: Page): Promise<void> {
  await waitForLesson(page, /Sola geç|Move left|izquierda/i)
  await press(page, 'ArrowLeft')

  await waitForLesson(page, /Sağa geç|Move right|derecha/i)

  // Left lane to right lane is two settled changes.
  await press(page, 'ArrowRight')
  await page.waitForTimeout(400)
  await press(page, 'ArrowRight')

  await waitForLesson(page, /Koni|cone|cono/i)
}

test.describe('first-run routing', () => {
  /**
   * PLAY follows the server, whichever way the server happens to be pointing.
   *
   * Deliberately **not** written as "an untaught player is taught": that would
   * depend on this fixture account's completion flag, which is a durable row
   * any earlier test — or any earlier acceptance pass — may legitimately have
   * set. What is actually being asserted is the contract: `/run` mounts the
   * tutorial exactly when the account has not completed it, and a normal run
   * otherwise. Reading the flag first makes the test true in both states
   * instead of true on a Tuesday.
   */
  test('sends the player wherever their completion flag says', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const completed = await page.evaluate(async () => {
      const me = await fetch('/api/auth/me').then(r => r.json())

      return me.user?.tutorial_completed === true
    })

    await page.locator('.home__play').click()

    await expect(page).toHaveURL(/\/run$/)

    if (completed) {
      await expect(page.locator('.run__phase')).toHaveText(/Koşuyor|Running|En marcha/, { timeout: 40_000 })
      await expect(page.locator('.run__tutorial-card')).toHaveCount(0)
      // A normal run shows the readouts the tutorial withholds.
      await expect(page.locator('.run__score')).toBeVisible()
    }
    else {
      await expect(page.locator('.run__tutorial-card')).toBeVisible({ timeout: 40_000 })
    }
  })

  test('withholds the progression readouts it does not grant', async ({ page }) => {
    await openRun(page, '/run?mode=tutorial')

    // A score the tutorial throws away, and a paw counter that reads
    // `loliCyclePaws` — which a tutorial paw never adds to.
    await expect(page.locator('.run__score')).toHaveCount(0)
    await expect(page.locator('.run__paws')).toHaveCount(0)
    await expect(page.locator('.run__aside--goal')).toHaveCount(0)

    // Hearts stay: they are the proof they are never spent.
    await expect(page.locator('.run__hearts-count')).toBeVisible()
  })

  test('draws exactly one canvas', async ({ page }) => {
    await openRun(page, '/run?mode=tutorial')

    expect(await page.locator('canvas').count()).toBe(1)
  })
})

test.describe('the cone lesson', () => {
  test('refuses a jump, corrects it, and costs no heart', async ({ page }) => {
    await openRun(page, '/run?mode=tutorial')

    // Reach the cone lesson by doing what the first two ask.
    await reachTheCone(page)

    const hearts = await page.locator('.run__hearts-count').innerText()

    // Now do the wrong thing, the way a new player does: stay in the cone's
    // lane and jump at it.
    for (let attempt = 0; attempt < 16; attempt++) {
      await press(page, 'Space')
      await page.waitForTimeout(600)

      if ((await prompt(page))?.match(/zıplayamazsın|can't jump|No puedes saltar/i)) break
    }

    const text = await prompt(page)

    // The lesson is not satisfied…
    expect(text).toMatch(/Koni|cone|cono/i)
    // …the player is told why, in the words that match what they did…
    expect(text).toMatch(/zıplayamazsın|can't jump|No puedes saltar/i)
    // …and it cost nothing.
    expect(await page.locator('.run__hearts-count').innerText()).toBe(hearts)
    await expect(page.locator('.run__phase')).not.toHaveText(/Bitti|Ended|Terminado/)
    await expect(page.locator('.run__tutorial-complete')).toHaveCount(0)
  })
})

test.describe('skipping', () => {
  test('asks first, stops the road, and can be changed', async ({ page }) => {
    await openRun(page, '/run?mode=tutorial')

    await page.locator('.run__tutorial-skip').click()

    const dialog = page.locator('[role="dialog"]')

    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    // Paused to ask — a reversible decision is not taken against a moving world.
    await expect(page.locator('.run__phase')).toHaveText(/Duraklatıldı|Paused|En pausa/)
    // And the pause screen is not raised behind the question.
    await expect(page.locator('.run__pause-screen')).toHaveCount(0)

    await page.locator('.run__tutorial-continue').click()

    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.run__tutorial-card')).toBeVisible()
    await expect(page.locator('.run__phase')).toHaveText(/Koşuyor|Running|En marcha/)
  })
})

test.describe('the Settings replay', () => {
  test('is offered, and launches the tutorial', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    const replay = page.locator('a[href="/run?mode=tutorial"]')

    await expect(replay).toBeVisible()
    await expect(replay).not.toBeEmpty()

    await replay.click()

    await expect(page.locator('.run__tutorial-card')).toBeVisible({ timeout: 30_000 })
  })
})

/**
 * The narrow widths.
 *
 * 320 is the floor the product supports, 360 the common Android, 430 a current
 * large iPhone. The prompt is the most translation-sensitive surface in the
 * product — short, imperative, and duplicated per gesture vocabulary — so it is
 * the one most likely to overflow in a locale nobody checked.
 */
/**
 * Turkish is the source locale and the default, so it carries the full pass at
 * every width. English and Spanish are spot-checked at the narrowest width,
 * which is where a long translation shows first — `tutorial.correction.*` is
 * the longest string in the namespace in all three.
 */
const NARROW: ReadonlyArray<{ width: number, locale: string }> = [
  { width: 320, locale: 'tr' },
  { width: 360, locale: 'tr' },
  { width: 430, locale: 'tr' },
  { width: 320, locale: 'en' },
  { width: 320, locale: 'es' },
]

for (const { width, locale } of NARROW) {
  test.describe(`at ${width}px in ${locale}`, () => {
    test.use({ viewport: { width, height: 800 }, locale })

    test.beforeEach(async ({ context }) => {
      // The switcher writes this cookie; setting it directly is the same
      // mechanism without a click.
      await context.addCookies([{
        name: 'purrenade_locale',
        value: locale,
        domain: 'purrenade.test',
        path: '/',
        secure: true,
        sameSite: 'Lax',
      }])
    })

    test('lays the tutorial out without overflow or clipping', async ({ page }) => {
      await openRun(page, '/run?mode=tutorial')
      await expect(page.locator('.run__tutorial-card')).toBeVisible({ timeout: 30_000 })

      const report = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth
        const card = document.querySelector('.run__tutorial-card')
        const skip = document.querySelector('.run__tutorial-skip')
        const dots = document.querySelector('.run__tutorial-dots')
        const box = (el: Element | null) => (el === null ? null : el.getBoundingClientRect())
        const cardBox = box(card)
        const skipBox = box(skip)

        return {
          vw,
          pageOverflows: document.documentElement.scrollWidth > vw + 1,
          cardInside: cardBox !== null && cardBox.left >= -1 && cardBox.right <= vw + 1,
          // Clipped copy: the card is shorter than the text inside it.
          cardClipped: card !== null && card.scrollHeight > card.clientHeight + 1,
          skipHeight: skipBox === null ? 0 : skipBox.height,
          skipInside: skipBox !== null && skipBox.left >= -1 && skipBox.right <= vw + 1,
          dotsInside: (() => {
            const b = box(dots)

            return b !== null && b.left >= -1 && b.right <= vw + 1
          })(),
          canvases: document.querySelectorAll('canvas').length,
          // The gameplay surface must still be visible enough to play on.
          surfaceHeight: box(document.querySelector('.run__surface'))?.height ?? 0,
          text: card === null ? '' : (card as HTMLElement).innerText,
        }
      })

      expect(report.vw).toBe(width)
      expect(report.pageOverflows, 'no horizontal page scroll').toBe(false)
      expect(report.cardInside, 'the prompt fits the viewport').toBe(true)
      expect(report.cardClipped, 'no clipped tutorial copy').toBe(false)
      expect(report.skipInside, 'Skip is reachable').toBe(true)
      // `--touch-min`, the approved minimum.
      expect(report.skipHeight, 'Skip meets the touch target minimum').toBeGreaterThanOrEqual(44)
      expect(report.dotsInside, 'progress fits').toBe(true)
      expect(report.canvases, 'one gameplay surface').toBe(1)
      expect(report.surfaceHeight, 'the road is still playable').toBeGreaterThan(300)
      // A missing message renders as its own key, which is a locale gap the
      // parity check cannot see — parity proves the key exists, not that it was
      // reached.
      expect(report.text, 'the prompt is translated').not.toMatch(/tutorial\./)
      expect(report.text.trim().length, 'the prompt says something').toBeGreaterThan(10)
    })

    test('keeps the skip dialog usable', async ({ page }) => {
      await openRun(page, '/run?mode=tutorial')
      await page.locator('.run__tutorial-skip').click()

      const dialog = page.locator('[role="dialog"]')

      await expect(dialog).toBeVisible()

      const report = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth
        const panel = document.querySelector('[role="dialog"]')
        const buttons = [...document.querySelectorAll('[role="dialog"] button')]

        return {
          pageOverflows: document.documentElement.scrollWidth > vw + 1,
          panelInside: (() => {
            const b = panel?.getBoundingClientRect()

            return b !== undefined && b.left >= -1 && b.right <= vw + 1
          })(),
          shortestButton: Math.min(...buttons.map(b => b.getBoundingClientRect().height)),
          buttonCount: buttons.length,
        }
      })

      expect(report.pageOverflows).toBe(false)
      expect(report.panelInside).toBe(true)
      expect(report.buttonCount).toBe(2)
      expect(report.shortestButton).toBeGreaterThanOrEqual(44)
    })
  })
}
