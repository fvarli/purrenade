import { expect, test } from '@playwright/test'

/**
 * What survives a run after the player leaves it.
 *
 * Counting `<canvas>` elements proves the picture went away. It does not prove
 * the run went away — a destroyed run whose keyboard listener is still attached
 * to `document` keeps swallowing Space and the arrow keys on every later page,
 * and the only symptom is that the rest of the app quietly stops scrolling.
 *
 * These tests assert the behaviour instead: after leaving, an ordinary control
 * must receive its keys untouched, and repeated visits must not accumulate
 * handlers.
 */

async function open(page: import('@playwright/test').Page, path: string): Promise<void> {
  await page.goto(path)
  await page.waitForLoadState('networkidle')
}

/**
 * Leave the run the way a player now has to.
 *
 * The leave control pauses instead of navigating: abandoning a run is not
 * undoable — there is no revive and no continue — so it goes through the
 * approved pause screen, which already offers *return to menu* beside
 * *resume*. Two deliberate taps, and the second one is the confirmation.
 */
async function leaveRun(page: import('@playwright/test').Page): Promise<void> {
  await page.click('.run__exit')
  await page.click('.run__menu')
  await page.waitForURL('**/')
}

test.describe('a run that has been left', () => {
  test.describe.configure({ mode: 'serial' })

  test.skip(
    !process.env.PURRENADE_E2E_EMAIL || !process.env.PURRENADE_E2E_PASSWORD,
    'set PURRENADE_E2E_EMAIL and PURRENADE_E2E_PASSWORD',
  )

  test('does not keep swallowing gameplay keys on other pages', async ({ page }) => {
    await open(page, '/run')
    await page.waitForFunction(() => document.querySelector('canvas') !== null, null, { timeout: 20_000 })

    await leaveRun(page)
    await expect.poll(async () => page.locator('canvas').count(), { timeout: 5_000 }).toBe(0)

    // A window listener in the bubble phase runs after any document listener on
    // the same event, so `defaultPrevented` here reports what the page did.
    const prevented = await page.evaluate(async () => {
      const seen: string[] = []

      const probe = (event: KeyboardEvent): void => {
        if (event.defaultPrevented) seen.push(event.code)
      }

      window.addEventListener('keydown', probe)

      for (const code of ['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp']) {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }))
      }

      window.removeEventListener('keydown', probe)

      return seen
    })

    expect(prevented, 'a destroyed run must not preventDefault on the page it left behind').toEqual([])
  })

  test('does not accumulate keydown handlers across repeated visits', async ({ page }) => {
    await open(page, '/')

    await page.evaluate(() => {
      const w = window as unknown as { __keydownCount: number }
      w.__keydownCount = 0

      const add = document.addEventListener.bind(document)
      const remove = document.removeEventListener.bind(document)

      document.addEventListener = function (type: string, ...rest: unknown[]) {
        if (type === 'keydown') w.__keydownCount++
        return (add as never)(type, ...rest)
      } as typeof document.addEventListener

      document.removeEventListener = function (type: string, ...rest: unknown[]) {
        if (type === 'keydown') w.__keydownCount--
        return (remove as never)(type, ...rest)
      } as typeof document.removeEventListener
    })

    const counts: number[] = []

    for (let visit = 0; visit < 4; visit++) {
      await page.click('.home__play')
      await page.waitForURL('**/run')
      await page.waitForFunction(() => document.querySelector('canvas') !== null, null, { timeout: 20_000 })

      await leaveRun(page)
      await expect.poll(async () => page.locator('canvas').count(), { timeout: 5_000 }).toBe(0)

      counts.push(await page.evaluate(() => (window as unknown as { __keydownCount: number }).__keydownCount))
    }

    // Net zero after every complete visit. A rising line is a leak.
    expect(counts, `net document keydown listeners after each visit: ${counts.join(', ')}`).toEqual([0, 0, 0, 0])
  })
})

test.describe('the run surface stays usable by keyboard and at zoom', () => {
  test.describe.configure({ mode: 'serial' })

  test.skip(
    !process.env.PURRENADE_E2E_EMAIL || !process.env.PURRENADE_E2E_PASSWORD,
    'set PURRENADE_E2E_EMAIL and PURRENADE_E2E_PASSWORD',
  )

  test('does not take page zoom away from the player', async ({ page }) => {
    // WCAG 1.4.4. The route used to ship `maximum-scale=1, user-scalable=no`,
    // justified as stopping a pinch mid-swipe — which `touch-action: none` on
    // the surface already does, without disabling zoom for the 13px status text
    // that a low-vision player would pinch to read.
    await open(page, '/run')
    await page.waitForFunction(() => document.querySelector('canvas') !== null, null, { timeout: 20_000 })

    const viewport = await page.evaluate(() =>
      document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '')

    expect(viewport).not.toContain('user-scalable=no')
    expect(viewport).not.toContain('maximum-scale=1')
  })

  test('lets a keyboard player reach the game and back out of a control', async ({ page }) => {
    /*
     * The trap this closes: gameplay keys are suppressed while a control has
     * focus, the pause button is a control, and the play surface was
     * `role="img"` with no tabindex — so tabbing to pause left a keyboard
     * player unable to move, unable to jump and unable to unpause, with nothing
     * focusable to move focus back to.
     */
    await open(page, '/run')
    await expect(page.locator('.run__phase')).toHaveText(/Koşuyor|Running|En marcha/, { timeout: 20_000 })

    const surface = page.locator('.run__surface')

    await expect(surface).toHaveAttribute('tabindex', '0')
    await expect(surface).not.toHaveAttribute('role', 'img')

    // Escape must pause even while the button holds focus.
    await page.locator('.run__pause').focus()
    await page.keyboard.press('Escape')

    await expect(page.locator('.run__phase')).toHaveText(/Duraklatıldı|Paused|En pausa/)

    await page.keyboard.press('Escape')

    await expect(page.locator('.run__phase')).toHaveText(/Koşuyor|Running|En marcha/)
  })

  test('gives the page a heading and does not let the chrome pull to refresh', async ({ page }) => {
    await open(page, '/run')
    await page.waitForFunction(() => document.querySelector('canvas') !== null, null, { timeout: 20_000 })

    await expect(page.locator('h1')).toHaveCount(1)

    const overscroll = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.run') as Element).overscrollBehaviorY)

    expect(overscroll, 'the run must not offer the browser a pull-to-refresh').toBe('none')
  })
})

/** Wait until the readiness beat is over and the world is actually moving. */
async function running(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.locator('.run__phase')).toHaveText(
    /Koşuyor|Running|En marcha/,
    { timeout: 20_000 },
  )
}

/** The score, from the text the player and a screen reader both get. */
async function score(page: import('@playwright/test').Page): Promise<number> {
  return Number((await page.locator('.run__score-value').textContent())?.trim() ?? Number.NaN)
}

/** Hearts remaining, from the counter beside the shapes. */
async function hearts(page: import('@playwright/test').Page): Promise<number> {
  const text = (await page.locator('.run__hearts-count').textContent()) ?? ''

  return Number(/(\d+)/.exec(text)?.[1] ?? Number.NaN)
}

test.describe('the run lifecycle, from pause to replay', () => {
  test.describe.configure({ mode: 'serial' })

  test.skip(
    !process.env.PURRENADE_E2E_EMAIL || !process.env.PURRENADE_E2E_PASSWORD,
    'set PURRENADE_E2E_EMAIL and PURRENADE_E2E_PASSWORD',
  )

  test('pauses into the approved screen and resumes the same run', async ({ page }) => {
    await open(page, '/run')
    await running(page)

    // Play far enough in that "the score survived" is a real claim.
    await expect.poll(async () => score(page), { timeout: 20_000 }).toBeGreaterThan(20)

    await page.keyboard.press('Escape')

    const dialog = page.locator('[role="dialog"]')

    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('aria-modal', 'true')

    // Board 12's three actions, all present.
    await expect(page.locator('.run__resume')).toBeVisible()
    await expect(page.locator('.run__restart')).toBeVisible()
    await expect(page.locator('.run__menu')).toBeVisible()

    const held = await score(page)
    const heldHearts = await hearts(page)

    await page.waitForTimeout(2_500)

    expect(await score(page), 'a paused run must earn nothing').toBe(held)
    expect(await hearts(page), 'a paused run cannot be hit').toBe(heldHearts)

    await page.click('.run__resume')

    await expect(dialog).toHaveCount(0)
    await running(page)

    // The same run, not a new one: a restart would have put this back to zero.
    expect(await score(page), 'resuming must continue the run it paused')
      .toBeGreaterThanOrEqual(held)
  })

  test('does not let gameplay keys through the pause screen', async ({ page }) => {
    await open(page, '/run')
    await running(page)

    await page.keyboard.press('Escape')
    await expect(page.locator('[role="dialog"]')).toBeVisible()

    /*
     * Asserted through `defaultPrevented`, the same instrument the teardown
     * test above uses. The scene takes a gameplay key by preventing its
     * default; a key it declines passes through untouched. While an overlay
     * button holds focus, every binding but Escape must be declined.
     */
    const prevented = await page.evaluate(() => {
      const seen: string[] = []

      const probe = (event: KeyboardEvent): void => {
        if (event.defaultPrevented) seen.push(event.code)
      }

      window.addEventListener('keydown', probe)

      for (const code of ['ArrowLeft', 'ArrowRight', 'Space', 'ArrowUp', 'KeyE']) {
        document.activeElement?.dispatchEvent(
          new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }),
        )
      }

      window.removeEventListener('keydown', probe)

      return seen
    })

    expect(prevented, 'the overlay must not pass gameplay keys to the run behind it')
      .toEqual([])
  })

  test('ends the run once, truthfully, and replays into a clean new one', async ({ page }) => {
    // A standing player loses three hearts in roughly twenty to ninety seconds
    // depending on how loaded the dev server is; the poll below carries the
    // budget and this carries the poll.
    test.setTimeout(240_000)

    await open(page, '/run')
    await running(page)

    const complete = page.locator('.run__complete')

    await expect(complete).toBeVisible({ timeout: 150_000 })

    // Once. A second transition would mean the terminal state is not terminal.
    await expect(complete).toHaveCount(1)
    await expect(page.locator('[role="dialog"]')).toHaveCount(1)
    expect(await hearts(page), 'the run ends when the last heart goes').toBe(0)

    // The summary is the run's own score, not a number of its own.
    const final = await score(page)

    expect(final).toBeGreaterThan(0)
    expect(Number((await page.locator('.run__final-score-value').textContent())?.trim()))
      .toBe(final)

    // Nothing here claims a record, because there is no record to claim.
    await expect(page.locator('.run__record')).toHaveCount(0)
    await expect(page.locator('.run__highscore')).toHaveCount(0)

    await page.click('.run__replay')

    await expect(complete).toHaveCount(0)
    await running(page)

    // One engine, not two: replay destroys before it mounts.
    await expect.poll(async () => page.locator('canvas').count(), { timeout: 10_000 }).toBe(1)
    expect(await hearts(page), 'a replay starts with a full row of hearts').toBe(3)
  })
})
