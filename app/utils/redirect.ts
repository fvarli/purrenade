/**
 * Resolve a post-login redirect target.
 *
 * Login honours a `redirect` query so a player who was sent to sign in lands
 * back where they were going. Taken at face value that is a phishing primitive:
 * `?redirect=https://evil.example` would send a **freshly authenticated** player
 * straight off-site, at the moment they are most likely to trust the page.
 *
 * So only an in-app path is honoured, and anything else becomes `/`.
 *
 * The regex is `^\/(?!\/)` rather than `startsWith('/')`, and that is the whole
 * subtlety: `//evil.example` begins with a slash and is a fully qualified URL to
 * another host. A naive prefix check lets it through.
 *
 * Extracted into its own module so the page and its test share **one**
 * definition. A predicate this security-relevant duplicated in a test is a
 * predicate whose test can keep passing after the page diverges.
 */
export function resolveRedirectTarget(requested: unknown): string {
  if (typeof requested !== 'string') return '/'

  return /^\/(?!\/)/.test(requested) ? requested : '/'
}
