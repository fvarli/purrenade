import type { components, paths } from '~~/shared/contracts/api.generated'

/**
 * The shapes this BFF expects from the Laravel API.
 *
 * **Generated where it matters, migrated incrementally** (`docs/architecture/
 * api-client.md` §1A). The source is the backend's OpenAPI document, pinned as
 * a snapshot under `contracts/openapi/` and turned into
 * `shared/contracts/api.generated.ts` by `npm run contract:generate`; CI
 * regenerates and diffs it. Everything M9 introduced — the run lifecycle and
 * progression — and every shape M9 touched is an alias of a generated type, so
 * a contract change is a type error here rather than a runtime surprise.
 *
 * The remaining hand-written envelopes are the authentication ones M9 does not
 * touch. They move to generated aliases when they are next changed, not in an
 * unrelated sweep. A drift found on the way is fixed in the backend's OpenAPI
 * document, never by forking a generated type here.
 */
type Schemas = components['schemas']

/** The JSON body of an operation's response, straight from the contract. */
type JsonBody<Operation, Status extends number>
  = Operation extends { responses: Record<Status, { content: { 'application/json': infer Body } }> }
    ? Body
    : never

/**
 * The `/auth/me` projection. Generated: `AuthenticatedUser` in the contract.
 *
 * `tutorial_completed` rides along for first-run routing: the server stores a
 * timestamp and sends a boolean, because when a player finished is not a
 * decision this client makes differently.
 */
export type AuthenticatedUser = Schemas['AuthenticatedUser']

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
export type TutorialStateEnvelope = JsonBody<paths['/progression/tutorial']['post'], 200>

// --- M9: runs and progression ------------------------------------------------

/** `GET /progression`. */
export type ProgressionEnvelope = JsonBody<paths['/progression']['get'], 200>
export type Progression = Schemas['Progression']

/** `POST /game-runs` — `201` for a new run, `200` for a resumed one. Same body. */
export type StartedRunEnvelope = JsonBody<paths['/game-runs']['post'], 201>
export type StartedRun = Schemas['StartedRun']

/** `POST /game-runs/{runId}/finish`. */
export type RunResultEnvelope = JsonBody<paths['/game-runs/{runId}/finish']['post'], 200>
export type RunResult = Schemas['RunResult']

/** The untrusted proposal a finish carries. Integers only, by protocol. */
export type RunTelemetry = Schemas['RunTelemetry']

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
