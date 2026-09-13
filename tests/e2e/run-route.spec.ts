import { expect, test } from '@playwright/test'

/**
 * The run route against the live stack.
 *
 * Two things are worth asserting in a real browser and cannot be asserted
 * anywhere else: that the route guard actually redirects, and that the SPA
 * fallback for a client-only route is served correctly by Nginx and Nitro
 * rather than 404ing.
 *
 * The surface itself is exercised in the manual acceptance pass, because
 * reaching it needs a verified account and seeding one from here would couple
 * this suite to the backend's database. What is automated here is what does not
 * need an account.
 */

const VIEWPORTS = [
  { name: '360x640', width: 360, height: 640 },
  { name: '360x800', width: 360, height: 800 },
  { name: 'desktop', width: 1280, height: 900 },
]

test.describe('the run route is guarded', () => {
  test('sends a signed-out visitor to sign in, and remembers where they were going', async ({ page }) => {
    // The guard is convenience, not authorization — the server owns that — but
    // a broken guard would drop a signed-out player onto a canvas that cannot
    // do anything.
    await page.goto('/run')
    await page.waitForURL(/\/auth\/login/)

    expect(page.url()).toContain('/auth/login')
    expect(decodeURIComponent(page.url())).toContain('redirect=/run')
  })

  test('does not load the engine for a visitor who cannot play', async ({ page }) => {
    // 1.3 MB of Phaser fetched before a redirect would be a real cost on a
    // phone, and a sign that the lazy import had moved somewhere eager.
    const engineRequests: string[] = []

    page.on('request', (request) => {
      if (/phaser/i.test(request.url())) engineRequests.push(request.url())
    })

    await page.goto('/run')
    await page.waitForURL(/\/auth\/login/)

    expect(engineRequests).toEqual([])
  })
})

test.describe('the entry bundle stays small', () => {
  for (const viewport of VIEWPORTS) {
    test(`no Phaser is fetched on the sign-in screen at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })

      const scripts: string[] = []

      page.on('response', (response) => {
        if (response.request().resourceType() === 'script') scripts.push(response.url())
      })

      await page.goto('/auth/login')
      await page.waitForLoadState('networkidle')

      // Chunk names are hashed, so size is the honest signal: Phaser's chunk is
      // over a megabyte and nothing else in this app comes close.
      const large = await Promise.all(
        scripts.map(async (url) => {
          const response = await page.request.get(url)
          return { url, bytes: (await response.body()).length }
        }),
      )

      const oversized = large.filter(s => s.bytes > 900_000)

      expect(oversized, `unexpectedly large scripts: ${JSON.stringify(oversized)}`).toEqual([])
    })
  }
})
