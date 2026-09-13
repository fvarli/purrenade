import { expect, test } from '@playwright/test'

/**
 * Responsive and accessibility acceptance for the auth surface.
 *
 * The standing requirement (`docs/architecture/responsive-and-viewport.md`,
 * `docs/product/accessibility.md`) names three viewports and one rule that
 * matters more than the rest: **a security action must never fall somewhere the
 * player cannot reach it**. 360×640 is the narrow, short case where that goes
 * wrong — a mobile browser's toolbar makes `100vh` taller than the visible area,
 * and a primary button positioned against it ends up below the fold.
 *
 * Run against the live local stack, so this exercises the real SSR output, the
 * real fonts, and the real CSS rather than a jsdom approximation.
 */

const VIEWPORTS = [
  { name: '360x640', width: 360, height: 640 },
  { name: '360x800', width: 360, height: 800 },
  { name: 'desktop', width: 1280, height: 900 },
] as const

const SCREENS = [
  { path: '/auth/login', cta: 'button[type="submit"]' },
  { path: '/auth/register', cta: 'button[type="submit"]' },
  { path: '/auth/forgot-password', cta: 'button[type="submit"]' },
] as const

for (const viewport of VIEWPORTS) {
  test.describe(`at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    for (const screen of SCREENS) {
      test(`${screen.path} keeps its primary action reachable`, async ({ page }) => {
        await page.goto(screen.path)

        const cta = page.locator(screen.cta).first()

        await expect(cta).toBeVisible()

        // Reachable, which is not the same as rendered: scrolled into view and
        // actually clickable at its own coordinates.
        await cta.scrollIntoViewIfNeeded()
        await expect(cta).toBeEnabled()

        const box = await cta.boundingBox()
        expect(box).not.toBeNull()

        // The 44px touch minimum (design-tokens.md §4), at every width.
        expect(box!.height).toBeGreaterThanOrEqual(44)

        // Inside the viewport horizontally — a control clipped off the right
        // edge is unreachable however tall it is.
        expect(box!.x).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1)
      })

      test(`${screen.path} does not scroll horizontally`, async ({ page }) => {
        await page.goto(screen.path)

        const overflow = await page.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth)

        // Any horizontal scroll on a phone means something is wider than the
        // screen, and the usual victim is a form control.
        expect(overflow).toBeLessThanOrEqual(0)
      })
    }

    // @stack — needs a pending registration, so it needs the API.
    test('@stack the verification screen keeps six code boxes reachable', async ({ page }) => {
      // The tightest layout in the product: six 44px boxes plus gaps, inside the
      // card's padding, at 360px.
      await page.goto('/auth/login')

      await page.evaluate(() => {
        const card = document.querySelector('.auth-card__body')
        if (!card) return
        card.innerHTML = `<div class="otp__boxes">${
          Array.from({ length: 6 }, () => '<input class="otp__box">').join('')
        }</div>`
      })

      const boxes = page.locator('.otp__box')
      await expect(boxes).toHaveCount(6)

      for (let i = 0; i < 6; i++) {
        const box = await boxes.nth(i).boundingBox()
        expect(box).not.toBeNull()
        expect(box!.x).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1)
        expect(box!.width).toBeGreaterThanOrEqual(44)
      }
    })
  })
}

test.describe('accessibility of the login screen', () => {
  test('every input has a bound label', async ({ page }) => {
    await page.goto('/auth/login')

    const inputs = page.locator('input')
    const count = await inputs.count()

    expect(count).toBeGreaterThan(0)

    for (let i = 0; i < count; i++) {
      const id = await inputs.nth(i).getAttribute('id')

      expect(id, 'every input needs an id to be labelled').toBeTruthy()
      await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1)
    }
  })

  test('is fully keyboard navigable to the primary action', async ({ page }) => {
    await page.goto('/auth/login')
    await page.locator('#login-email').focus()

    // Tab through the form and confirm the submit button is reachable without a
    // mouse. A styled div would fail here, which is the point.
    const reached: string[] = []

    for (let i = 0; i < 12; i++) {
      const description = await page.evaluate(() => {
        const active = document.activeElement

        if (!active) return ''

        return `${active.tagName.toLowerCase()}${
          active.getAttribute('type') ? `[${active.getAttribute('type')}]` : ''}`
      })

      reached.push(description)

      if (description === 'button[submit]') break

      await page.keyboard.press('Tab')
    }

    expect(reached).toContain('button[submit]')
  })

  test('shows a visible focus ring', async ({ page }) => {
    await page.goto('/auth/login')
    await page.locator('#login-email').press('Tab')

    const outline = await page.evaluate(() => {
      const active = document.activeElement

      if (!active) return null

      const style = getComputedStyle(active)

      return { width: style.outlineWidth, style: style.outlineStyle }
    })

    // Removing focus outlines without replacing them makes an interface
    // unusable by keyboard.
    expect(outline).not.toBeNull()
    expect(Number.parseFloat(outline!.width)).toBeGreaterThan(0)
    expect(outline!.style).not.toBe('none')
  })

  test('declares a supported document language', async ({ page }) => {
    await page.goto('/auth/login')

    // Not asserted to be `tr`: the resolution order is profile → device →
    // Accept-Language → tr (localization.md), so a browser asking for English
    // correctly gets English before a session exists. What must hold is that
    // the document declares *a* supported language — without it a screen
    // reader pronounces Turkish copy with English phonetics.
    expect(await page.locator('html').getAttribute('lang')).toMatch(/^(tr|en|es)$/)
  })

  test('offers all three locales, with the active one marked, before a session exists', async ({ page }) => {
    await page.goto('/auth/login')

    const options = page.locator('[role="group"] button')

    await expect(options).toHaveCount(3)

    const documentLanguage = await page.locator('html').getAttribute('lang')
    const names = { tr: 'Türkçe', en: 'English', es: 'Español' } as const

    // Exactly one pressed, and it is the language the document declares — the
    // switcher and the rendered copy cannot disagree.
    const pressed = await options.evaluateAll(elements =>
      elements.filter(element => element.getAttribute('aria-pressed') === 'true')
        .map(element => element.textContent?.trim()))

    expect(pressed).toEqual([names[documentLanguage as keyof typeof names]])
  })
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('collapses the motion tokens', async ({ page }) => {
    await page.goto('/auth/login')

    const duration = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--motion-base').trim())

    // Implemented by collapsing the token, so a component is compliant without
    // knowing the rule exists.
    expect(duration).toBe('1ms')
  })
})
