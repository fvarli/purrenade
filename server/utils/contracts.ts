/**
 * The shapes this BFF expects from the Laravel API.
 *
 * Hand-written for M2, and that is a known temporary state. `docs/architecture/
 * api-client.md` §1 makes generation from `openapi.draft.yaml` the rule, so a
 * contract change surfaces as a type error rather than a runtime surprise. The
 * generator is a toolchain task of its own; until it lands, these types are
 * kept deliberately small and are checked against the OpenAPI document by hand
 * whenever either changes.
 *
 * Recorded as OPEN in the decision register so it is a scheduled task rather
 * than a quiet omission.
 */

/** The `/auth/me` projection. Mirrors App\Http\Resources\AuthenticatedUserResource. */
export interface AuthenticatedUser {
  id: number
  display_name: string
  email: string
  role: 'player' | 'admin'
  email_verified: boolean
  email_verified_at: string | null
  two_factor_enabled: boolean
  two_factor_pending: boolean
  two_factor_recovery_codes_remaining: number
  requires_two_factor_enrolment: boolean
  /**
   * Has the player finished — or skipped — the first-run tutorial?
   *
   * A read projection. Progression owns the fact and
   * `POST /progression/tutorial` is the only thing that can change it; this
   * rides along on `/auth/me` because the decision it feeds is where PLAY goes,
   * and that is decided during server-side render.
   *
   * The server stores a timestamp and sends a boolean. When a player finished
   * is not a decision this client makes differently.
   */
  tutorial_completed: boolean
  created_at: string | null
  session: {
    id: string
    device: string
    two_factor_satisfied: boolean
    created_at: string | null
  } | null
}

export interface EmailVerificationMeta {
  resend_available_in: number
  expires_in?: number
}

export interface MeEnvelope {
  /** Present on register and login; absent on a plain `/auth/me` read. */
  status?: string
  data: AuthenticatedUser
  meta?: {
    /** Present only on register/login responses; never relayed to the browser. */
    token?: string
    email_verification?: EmailVerificationMeta
  }
}

/**
 * Login is a discriminated union on the top-level `status`.
 *
 * A union rather than optional fields, so the compiler refuses to read
 * `challenge_token` from an authenticated response — the mistake that would
 * otherwise send a challenge token to a browser.
 */
export type LoginEnvelope =
  | {
    status: 'authenticated'
    data: AuthenticatedUser
    meta: { token: string }
  }
  | {
    status: 'two_factor_required'
    data?: undefined
    meta: {
      challenge_token: string
      challenge_expires_at: string
      recovery_codes_available: boolean
    }
  }

/** `POST /progression/tutorial`. One bit, and deliberately nothing else. */
export interface TutorialStateEnvelope {
  data: { tutorial_completed: boolean }
}

export interface TwoFactorChallengeEnvelope {
  status: 'authenticated'
  data: AuthenticatedUser
  meta: {
    token: string
    used_recovery_code: boolean
    recovery_codes_remaining: number
  }
}

export interface TwoFactorEnrolmentEnvelope {
  status: string
  data: {
    secret: string
    otpauth_uri: string
    /** `data:image/svg+xml;base64,…` — rendered with <img>, never v-html. */
    qr_code: string
  }
  meta: { detail: string }
}

export interface TwoFactorConfirmEnvelope {
  status: string
  data: AuthenticatedUser
  meta: {
    /** Transmitted exactly once, at enrolment. Never stored by the BFF. */
    recovery_codes: string[]
    detail: string
  }
}

export interface RecoveryCodesEnvelope {
  status: string
  meta: {
    recovery_codes: string[]
    detail: string
  }
}

export interface TwoFactorStateEnvelope {
  data: {
    enabled: boolean
    pending: boolean
    confirmed_at: string | null
    recovery_codes_remaining: number
    mandatory: boolean
  }
}

export interface SessionSummary {
  id: string
  device: string
  is_current: boolean
  two_factor_satisfied: boolean
  created_at: string | null
  last_active_at: string | null
}

export interface SessionListEnvelope {
  data: SessionSummary[]
}

export interface AdminOverviewEnvelope {
  data: {
    administrator: { id: number, display_name: string }
    accounts: {
      total: number
      verified: number
      administrators: number
      with_two_factor: number
    }
    capabilities: { available: string[], planned_milestone: string }
  }
}
