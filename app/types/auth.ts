/**
 * The auth types the browser half of the application works with.
 *
 * Mirrors what the BFF returns, which is a **narrowed** view of the API's
 * responses — no token, no challenge token, nothing the browser has no business
 * holding. Kept separate from `server/utils/contracts.ts` on purpose: that file
 * describes the API, this one describes the browser boundary, and conflating
 * them is how a server-only field ends up in a component.
 */

export type UserRole = 'player' | 'admin'

export interface AuthUser {
  id: number
  display_name: string
  email: string
  role: UserRole
  email_verified: boolean
  email_verified_at: string | null
  two_factor_enabled: boolean
  two_factor_pending: boolean
  two_factor_recovery_codes_remaining: number
  requires_two_factor_enrolment: boolean
  created_at: string | null
  session: {
    id: string
    device: string
    two_factor_satisfied: boolean
    created_at: string | null
  } | null
}

export interface AuthSession {
  id: string
  device: string
  is_current: boolean
  two_factor_satisfied: boolean
  created_at: string | null
  last_active_at: string | null
}

/**
 * The authentication state machine.
 *
 * Every value is a state the application can actually be in, and each one has
 * exactly one screen. Derived from the server's *facts* rather than sent by it,
 * so the client cannot be told it is in a state the facts contradict.
 *
 * - `unknown` — before the first `/api/auth/me`. Distinct from `guest` because
 *   rendering a login screen to someone who turns out to be signed in is a
 *   visible flash, and a route guard that cannot tell the two apart produces it
 *   on every page load.
 *
 * - `guest` — no session.
 *
 * - `two_factor_required` — the password was accepted and a code is owed. Not
 *   authenticated: no credential exists yet.
 *
 * - `unverified` — signed in, address unconfirmed. Reaches four endpoints and
 *   one screen.
 *
 * - `admin_two_factor_setup_required` — an administrator who has not enrolled.
 *   A real, reachable state (an operator can promote a player who has no second
 *   factor), so it is represented rather than collapsed into `authenticated`
 *   where the admin surface would simply 403 with no explanation.
 *
 * - `authenticated` — fully signed in.
 */
export type AuthStatus =
  | 'unknown'
  | 'guest'
  | 'two_factor_required'
  | 'unverified'
  | 'admin_two_factor_setup_required'
  | 'authenticated'

export interface EmailVerificationState {
  resend_available_in: number
  expires_in?: number
}

/** What `GET /api/auth/me` returns. */
export interface MeResponse {
  status: 'guest' | 'authenticated' | 'two_factor_required'
  user: AuthUser | null
  email_verification?: EmailVerificationState | null
  challenge_expires_at?: string
  recovery_codes_available?: boolean
}

export interface TwoFactorStateResponse {
  enabled: boolean
  pending: boolean
  confirmed_at: string | null
  recovery_codes_remaining: number
  mandatory: boolean
}

export interface TwoFactorEnrolmentResponse {
  secret: string
  otpauth_uri: string
  /** A `data:` URI. Rendered with `<img>`; never with `v-html`. */
  qr_code: string
}
