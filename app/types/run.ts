import type { components } from '~~/shared/contracts/api.generated'

/**
 * The run types the browser half works with (M9).
 *
 * Aliases of the generated contract, so the backend's OpenAPI document stays
 * the only definition of these shapes. The BFF relays them as they are:
 * nothing in them is a credential, and nothing in them is the client's own.
 */
type Schemas = components['schemas']

/** A server-started run: its identity, seed, start and starting Loli progress. */
export type StartedRun = Schemas['StartedRun']

/** The server's classification of a finished run, and the resulting progression. */
export type RunResult = Schemas['RunResult']

export type RunOutcome = RunResult['status']

/** The stable reason codes behind a flagged or rejected outcome. */
export type RunReasonCode = RunResult['reasons'][number]

export type Progression = Schemas['Progression']

/** The untrusted proposal a finish carries. */
export type RunTelemetry = Schemas['RunTelemetry']

/** What the run-complete screen can say about the submission. */
export type RunSubmissionView = 'local' | 'saving' | 'retrying' | 'outcome' | 'closed'

/** `GET /api/game-runs/pending`: a finish the BFF is still holding, if any. */
export interface PendingRunFinishView {
  runId: string
  telemetry: RunTelemetry
}
