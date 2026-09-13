/**
 * Shapes that must never appear in a server-rendered page.
 *
 * Every one is grounded in a real value this system holds, not a guess:
 * `prrn_` is the Sanctum token prefix, `apiToken` and `csrfToken` are
 * `SessionRecord` fields, the 64-character run is a 2FA challenge token, the
 * hyphenated pair is a Fortify recovery code, and `otpauth://` carries a TOTP
 * secret in its query string.
 *
 * A plain module rather than an export from a spec file: importing one spec
 * from another makes Playwright register its tests in the importing project
 * too, so the anonymous cases ran a second time under the authenticated
 * project and failed there for the right reason at the wrong moment.
 */
export const CREDENTIAL_NEEDLES = [
  'prrn_',
  'apiToken',
  'csrfToken',
  'pendingTwoFactor',
  'challengeToken',
  'two_factor_secret',
  'otpauth://',
  'Bearer ',
]

export const CREDENTIAL_SHAPES = [
  /\d+\|prrn_/,
  /\b[A-Za-z0-9]{10}-[A-Za-z0-9]{10}\b/,
  /\b[A-Za-z0-9]{64}\b/,
]
