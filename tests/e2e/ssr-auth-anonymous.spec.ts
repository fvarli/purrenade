import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { CREDENTIAL_NEEDLES, CREDENTIAL_SHAPES } from './credentials'

/**
 * What the server sends before a single line of JavaScript runs.
 *
 * M6 shipped with the auth store unresolved during SSR, so every page was
 * server-rendered as "we do not know yet" and then rewritten on the client.
 * Vue called that a hydration mismatch and said plainly that it would **not**
 * rectify the DOM in production — so the wrong screen could simply stay.
 *
 * These are the anonymous cases, and they run in the `chrome` project, which
 * means they run **in CI against a production build**. That matters more than
 * it looks: Vue compiles its hydration warning out of a production bundle, so
 * "no warning was logged" proves nothing there. What the pre-hydration HTML
 * *contains* is build-independent, and that is what these assert. The console
 * check is a second net for the dev stack, where the warning does exist.
 */

/** The server-rendered document. */
async function serverHtml(page: Page, path: string): Promise<string> {
  const response = await page.context().request.get(path)

  expect(response.status(), `${path} should render, not error`).toBe(200)

  return await response.text()
}

/**
 * The rendered markup, without the head.
 *
 * A production build inlines the stylesheet, so every scoped class name appears
 * in the `<head>` whether or not the element was rendered. Content assertions
 * against the whole document pass on a page that rendered nothing of the sort.
 */
async function serverBody(page: Page, path: string): Promise<string> {
  return (await serverHtml(page, path)).split('</head>').pop() ?? ''
}

/** Hydration complaints, as a development-build backstop. */
function watchForHydrationTrouble(page: Page): string[] {
  const complaints: string[] = []

  page.on('console', (message) => {
    if (/hydrat/i.test(message.text())) complaints.push(message.text().split('\n')[0]!)
  })
  page.on('pageerror', error => complaints.push(`pageerror: ${error.message}`))

  return complaints
}

/** `goto` resolves before Vue hydrates under the dev server. Wait for both. */
async function open(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await page.waitForLoadState('networkidle')
}

test.describe('a signed-out visitor', () => {
  test('is server-rendered as a guest, not as "unknown"', async ({ page }) => {
    /*
     * The case the M6 audit missed entirely: it only ever probed `/` while
     * signed in, so nobody noticed that the *anonymous* home page mismatched
     * too. The server rendered the loading caption to everybody.
     */
    const body = await serverBody(page, '/')

    expect(body, 'the guest sign-in button belongs in the server-rendered body')
      .toContain('btn btn--primary')
    expect(body, 'the unresolved loading branch must not be server-rendered')
      .not.toContain('home__resolving')

    /*
     * The deployment health contract, asserted where it is actually produced.
     * `deploy/bin/health-check.sh` greps a production response for this exact
     * string, and rolls a release back when it is missing. Nothing else in the
     * test suite notices if the attribute is renamed or dropped — the specs
     * that drive the home page need a session and do not run in CI — so a
     * silent removal would be found by a failed deployment, which is how this
     * contract broke the first time.
     */
    expect(body, 'the deployment health marker belongs in the guest body')
      .toContain('data-purrenade-health="guest-home"')
  })

  test('hydrates the home page without a mismatch', async ({ page }) => {
    const complaints = watchForHydrationTrouble(page)

    await open(page, '/')

    expect(complaints).toEqual([])
  })

  test('hydrates the sign-in page without a mismatch', async ({ page }) => {
    const complaints = watchForHydrationTrouble(page)

    await open(page, '/auth/login')

    expect(page.locator('.auth-shell')).toBeTruthy()
    expect(complaints).toEqual([])
  })

  test('is still redirected away from a protected page, by the server', async ({ page }) => {
    /*
     * The guards must keep working — the fix makes them decide against real
     * state, it does not defer or soften them. Asserted on the raw response so
     * a client-side redirect cannot stand in for a server-side one.
     */
    const response = await page.context().request.get('/account/security', { maxRedirects: 0 })

    expect(response.status()).toBeGreaterThanOrEqual(300)
    expect(response.status()).toBeLessThan(400)
    expect(decodeURIComponent(response.headers().location ?? ''))
      .toContain('/auth/login?redirect=/account/security')
  })

  test('keeps the destination it was sent to sign in for', async ({ page }) => {
    await open(page, '/account/security')

    expect(decodeURIComponent(page.url())).toContain('redirect=/account/security')
  })

  test('survives several sequential loads', async ({ page }) => {
    // A session that resolves once and not three times would show up here.
    const complaints = watchForHydrationTrouble(page)

    for (let i = 0; i < 3; i++) {
      await open(page, '/')
      await page.reload()
      await page.waitForLoadState('networkidle')
    }

    expect(complaints).toEqual([])
  })

  test('is unaffected by back and forward navigation', async ({ page }) => {
    const complaints = watchForHydrationTrouble(page)

    await open(page, '/')
    await open(page, '/auth/login')
    await page.goBack()
    await page.waitForLoadState('networkidle')

    expect(new URL(page.url()).pathname).toBe('/')

    await page.goForward()
    await page.waitForLoadState('networkidle')

    expect(new URL(page.url()).pathname).toBe('/auth/login')
    expect(complaints).toEqual([])
  })

  test('is still kept out of the run route', async ({ page }) => {
    // `/run` is `ssr: false` and must stay that way; this change must not have
    // reached it.
    await open(page, '/run')

    expect(page.url()).toContain('/auth/login')
  })
})

test.describe('the server-rendered page carries no credential', () => {
  test('not on any anonymous page', async ({ page }) => {
    for (const path of ['/', '/auth/login', '/auth/register']) {
      const html = await serverHtml(page, path)

      for (const needle of CREDENTIAL_NEEDLES) {
        expect(html, `${needle} in ${path}`).not.toContain(needle)
      }

      for (const shape of CREDENTIAL_SHAPES) {
        expect(html, `${shape} in ${path}`).not.toMatch(shape)
      }
    }
  })
})
