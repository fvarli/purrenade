import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { CREDENTIAL_NEEDLES, CREDENTIAL_SHAPES } from './credentials'

/**
 * The signed-in half of the server-rendering contract.
 *
 * These need a real session, so they cannot run in CI without coupling the two
 * repositories — they are listed in the workflow's `expected-unrun` accounting
 * with that reason, never counted as passing, and run against the live stack at
 * milestone exit.
 *
 * The four defects they pin, all one root cause — the auth store was never
 * resolved during SSR:
 *
 *  1. `/` server-rendered its loading branch to a signed-in player.
 *  2. The layout nav server-rendered without the links that player has.
 *  3. `/auth/login` server-rendered the login form under the wrong layout,
 *     because the guest guard saw "unknown" and did not redirect.
 *  4. A deep link to a protected page bounced to `/` and lost its destination.
 */

const EMAIL = process.env.PURRENADE_E2E_EMAIL
const PASSWORD = process.env.PURRENADE_E2E_PASSWORD

test.describe.configure({ mode: 'serial' })

test.skip(!EMAIL || !PASSWORD, 'set PURRENADE_E2E_EMAIL and PURRENADE_E2E_PASSWORD')

/**
 * The server-rendered document, with the visitor's session attached explicitly.
 *
 * The cookie is passed by hand rather than left to the context's jar, because
 * the BFF session cookie is `Secure` and the production-build check runs over
 * plain `http://127.0.0.1`. Playwright's request context declines to send a
 * Secure cookie there, so the helper silently fetched an *anonymous* page and
 * the assertions measured the wrong thing — a failure that looks exactly like
 * the bug under test.
 */
async function serverHtml(page: Page, path: string): Promise<string> {
  const cookies = await page.context().cookies()
  const header = cookies.map(c => `${c.name}=${c.value}`).join('; ')
  const response = await page.context().request.get(path, {
    headers: header ? { cookie: header } : {},
  })

  expect(response.status(), `${path} should render, not error`).toBe(200)

  return await response.text()
}

/**
 * The rendered markup, without the head.
 *
 * Content assertions must not run against the whole document. A production
 * build inlines the stylesheet, so every scoped class name that carries a style
 * rule — `home__greeting`, `home__hero` — appears in the `<head>` whether or not
 * the element was ever rendered. Asserting `toContain('home__greeting')` on the
 * full document therefore passes on a page that rendered nothing of the sort,
 * which is precisely how this file briefly claimed a production run was correct
 * while the body was still unresolved.
 *
 * The same trap took the deployment health gate, which matched `home__play` in
 * the head for as long as that class had a rule. It no longer has one — it is a
 * bare interaction hook now — but stripping the head is what makes these
 * assertions mean anything regardless.
 */
async function serverBody(page: Page, path: string): Promise<string> {
  return (await serverHtml(page, path)).split('</head>').pop() ?? ''
}

/** The raw response, unfollowed, with the session attached. See `serverHtml`. */
async function serverResponse(page: Page, path: string) {
  const cookies = await page.context().cookies()
  const header = cookies.map(c => `${c.name}=${c.value}`).join('; ')

  return await page.context().request.get(path, {
    maxRedirects: 0,
    headers: header ? { cookie: header } : {},
  })
}

function watchForHydrationTrouble(page: Page): string[] {
  const complaints: string[] = []

  page.on('console', (message) => {
    if (/hydrat/i.test(message.text())) complaints.push(message.text().split('\n')[0]!)
  })
  page.on('pageerror', error => complaints.push(`pageerror: ${error.message}`))

  return complaints
}

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await page.waitForLoadState('networkidle')
}

/**
 * How long to wait for a rendered element.
 *
 * Not the 5s default. The full suite runs eleven workers against one dev server,
 * and a test doing four navigations is competing with a Phaser run for the same
 * process — `.home__play` was correct every time when measured serially, and
 * still missed a 5s deadline twice in three full-suite runs. The assertion
 * budget has to match the environment the assertion runs in, or the suite
 * reports load as failure.
 */
const RENDER_TIMEOUT = 20_000

test.describe('a signed-in visitor @stack', () => {
  test('is recognised by the server, before any JavaScript runs', async ({ page }) => {
    const body = await serverBody(page, '/')

    expect(body, 'the greeting belongs in the server-rendered body').toContain('home__greeting')
    expect(body, 'and so does the play button').toContain('home__play')
    expect(body, 'the unresolved loading branch must not be server-rendered')
      .not.toContain('home__resolving')
  })

  test('gets their own navigation in the server HTML', async ({ page }) => {
    // Defect 2. The nav lives in the layout, so this is the assertion that
    // proves the *layout* sees the session and not merely the page.
    const body = await serverBody(page, '/')

    /*
     * The `<nav>` element itself, not "the class name appears somewhere near
     * the link". A production build inlines the stylesheet, so `shell__nav`
     * occurs in the CSS some four thousand characters before the markup — a
     * proximity match anchors on that instead and measures nothing.
     */
    const nav = /<nav[^>]*shell__nav[^>]*>([\s\S]*?)<\/nav>/.exec(body)?.[1]

    expect(nav, 'the signed-in shell must render its nav').toBeTruthy()
    expect(nav).toContain('href="/account/security"')
  })

  test('hydrates the home page without a mismatch', async ({ page }) => {
    const complaints = watchForHydrationTrouble(page)

    await open(page, '/')

    await expect(page.locator('.home__play')).toBeVisible({ timeout: RENDER_TIMEOUT })
    expect(complaints).toEqual([])
  })

  test('is never served the sign-in screen', async ({ page }) => {
    /*
     * Defect 3, asserted at the root rather than at the symptom. The old
     * behaviour server-rendered the login form under `auth-shell` and only then
     * bounced on the client; now the guest guard has real state during SSR, so
     * the form is never rendered at all.
     */
    const response = await serverResponse(page, '/auth/login')

    expect(response.status()).toBeGreaterThanOrEqual(300)
    expect(response.status()).toBeLessThan(400)
    expect(response.headers().location).toBe('/')
  })

  test('lands on /auth/login at the home page, cleanly', async ({ page }) => {
    const complaints = watchForHydrationTrouble(page)

    await open(page, '/auth/login')

    expect(new URL(page.url()).pathname).toBe('/')
    expect(complaints).toEqual([])
  })

  test('reaches a protected page by deep link, keeping the destination', async ({ page }) => {
    // Defect 4 — the one the audit had not found. This used to end on `/`.
    const complaints = watchForHydrationTrouble(page)

    await open(page, '/account/security')

    expect(new URL(page.url()).pathname).toBe('/account/security')
    expect(complaints).toEqual([])
  })

  test('stays there across a refresh', async ({ page }) => {
    const complaints = watchForHydrationTrouble(page)

    await open(page, '/account/security')
    await page.reload()
    await page.waitForLoadState('networkidle')

    expect(new URL(page.url()).pathname).toBe('/account/security')
    expect(complaints).toEqual([])
  })

  test('stays there across three refreshes', async ({ page }) => {
    /*
     * A session that survives one round trip and not three would show up here —
     * `touchSession` writes on the SSR path now, and a rotation bug there would
     * sign the visitor out on the second or third load rather than the first.
     */
    const complaints = watchForHydrationTrouble(page)

    await open(page, '/account/security')

    for (let i = 0; i < 3; i++) {
      await page.reload()
      await page.waitForLoadState('networkidle')
      expect(new URL(page.url()).pathname, `refresh ${i + 1}`).toBe('/account/security')
    }

    expect(complaints).toEqual([])
  })

  test('is not sent to the sign-in screen by back or forward navigation', async ({ page }) => {
    test.setTimeout(90_000)

    const complaints = watchForHydrationTrouble(page)
    const visited: string[] = []

    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname)
    })

    await open(page, '/')
    await open(page, '/account/security')
    await page.goBack()
    await page.waitForLoadState('networkidle')

    expect(new URL(page.url()).pathname).toBe('/')
    await expect(page.locator('.home__play')).toBeVisible({ timeout: RENDER_TIMEOUT })

    await page.goForward()
    await page.waitForLoadState('networkidle')

    expect(new URL(page.url()).pathname).toBe('/account/security')
    expect(visited, 'no bounce through the sign-in screen').not.toContain('/auth/login')
    expect(complaints).toEqual([])
  })
})

test.describe('signing in and out moves the shell with it @stack', () => {
  /*
   * This block performs a real sign-in, which makes **two logins per suite run**
   * once the `setup` project's own is counted.
   *
   * That matters when repeating the suite: the login limiter is real, it is five
   * per minute per identifier, and it *escalates* — running the full suite
   * back-to-back eventually returns `rate_limited` with a `retry_after` in the
   * twenty-minute range. That is the product working correctly, not a flake, and
   * a failing `setup` step with a `waitForURL` timeout is what it looks like from
   * here. Space repeated runs, or use a different identifier.
   *
   * The login cannot be avoided: requirement is that the shell transitions on
   * sign-in and sign-out, and there is no way to observe that without doing it.
   */
  test.use({ storageState: { cookies: [], origins: [] } })

  test('a fresh sign-in leaves the next server render signed in', async ({ page }) => {
    test.setTimeout(90_000)

    /*
     * Proves the SSR path picks up a session that was created client-side —
     * i.e. that the two halves share one session rather than two views of one.
     */
    const complaints = watchForHydrationTrouble(page)

    await open(page, '/auth/login')
    await page.fill('#login-email', EMAIL!)
    await page.fill('#login-password', PASSWORD!)
    await page.click('form button[type=submit]')
    await page.waitForURL('**/')
    await expect(page.locator('.home__play')).toBeVisible({ timeout: RENDER_TIMEOUT })

    expect(await serverBody(page, '/')).toContain('home__greeting')
    expect(complaints).toEqual([])

    // And signing out again must move it back, in the server HTML too.
    await open(page, '/account/security')
    /*
     * The account sign-out, by its own hook.
     *
     * A role-and-name locator is wrong here: every device row on this page has
     * its own "Sign out" button, thirteen of them on a well-used account, and
     * `.first()` cheerfully revokes a *device* instead — a click that succeeds,
     * changes something real, and does not sign anybody out. Naming the button
     * this test means is the only stable way to say it.
     */
    await page.locator('.account__sign-out').click()
    await page.waitForURL(/\/auth\/login/)

    const after = await serverBody(page, '/')

    expect(after, 'the destroyed session must not still server-render as signed in')
      .not.toContain('home__greeting')
    expect(after).not.toContain('home__play')
  })
})

test.describe('a signed-in page carries no credential @stack', () => {
  test('not in the HTML, and not in the Nuxt payload', async ({ page }) => {
    const cookies = await page.context().cookies()
    const session = cookies.find(c => c.name === '__Host-purrenade_session')

    expect(session, 'the fixture must actually hold a session').toBeTruthy()

    for (const path of ['/', '/account/security']) {
      const html = await serverHtml(page, path)

      /*
       * The opaque pointer itself. Every other check here is a *shape*; this is
       * the literal value, and no shape-based check would catch it being echoed
       * into the page.
       */
      expect(html, `the session cookie value appears in ${path}`).not.toContain(session!.value)

      for (const needle of CREDENTIAL_NEEDLES) {
        expect(html, `${needle} in ${path}`).not.toContain(needle)
      }

      for (const shape of CREDENTIAL_SHAPES) {
        expect(html, `${shape} in ${path}`).not.toMatch(shape)
      }

      // Narrowed to the payload as well as the whole document: a hit anywhere
      // is a failure, but a hit inside `__NUXT_DATA__` specifically means the
      // store was widened, which is a different fix.
      const payload = /<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? ''

      expect(payload.length, 'the payload should exist to be checked').toBeGreaterThan(0)
      expect(payload).not.toContain(session!.value)

      for (const needle of CREDENTIAL_NEEDLES) {
        expect(payload, `${needle} in the ${path} payload`).not.toContain(needle)
      }
    }
  })

  test('and the application writes nothing to web storage', async ({ page }) => {
    /*
     * ADR-0005: the browser's only credential is a cookie it cannot read.
     *
     * Asserted as "nothing the application owns, and nothing credential-shaped"
     * rather than "storage is empty". Under the dev server Vue DevTools writes
     * its own Pinia settings key, which is a tooling artefact that does not
     * exist in a production build — demanding literal emptiness would make this
     * test fail for a reason that has nothing to do with what it protects.
     */
    await open(page, '/')

    const stored = await page.evaluate(() => {
      const dump = (store: Storage) =>
        Object.keys(store).map(key => ({ key, value: store.getItem(key) ?? '' }))

      return { local: dump(localStorage), session: dump(sessionStorage) }
    })

    const entries = [...stored.local, ...stored.session]
      .filter(entry => !entry.key.startsWith('__VUE_DEVTOOLS'))

    expect(entries.map(e => e.key), 'the app owns no web-storage key').toEqual([])

    // And whatever tooling did write, it wrote nothing that looks like a secret.
    for (const entry of [...stored.local, ...stored.session]) {
      for (const needle of CREDENTIAL_NEEDLES) {
        expect(entry.value, `${needle} under ${entry.key}`).not.toContain(needle)
      }

      for (const shape of CREDENTIAL_SHAPES) {
        expect(entry.value, `${shape} under ${entry.key}`).not.toMatch(shape)
      }
    }
  })
})
