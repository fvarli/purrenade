import { randomUUID } from 'node:crypto'
import { PROGRESS } from '~~/game/bridge'
import { BffProblemCode, bffProblem } from './problem'
import type { RunResult, RunTelemetry, StartedRun } from './contracts'
import { clearPendingRunFinish, readPendingRunFinish, writePendingRunFinish } from './session'
import { UpstreamProblem } from './upstream'

/**
 * The pending run finish: a **stable retry payload**, nothing more.
 *
 * When a run ends the browser proposes a result. The first time that proposal
 * reaches this BFF it is stored here — the run, the three telemetry integers,
 * and a UUID `Idempotency-Key` generated once — **before** Laravel is called.
 * Every retry, including one after a reload or a BFF restart, resends exactly
 * this: the same run, the same payload, the same key. That is what makes a
 * retried finish safe to apply exactly once.
 *
 * It is not a gameplay fact and it has no authority. It is a copy of an
 * untrusted proposal kept so retries are identical; Laravel alone classifies
 * the run and decides what, if anything, it changes.
 *
 * Held server-side, in the session store, and never in browser storage
 * (`docs/architecture/api-client.md` §6).
 */
export interface PendingRunFinish {
  runId: string
  idempotencyKey: string
  telemetry: RunTelemetry
  /** Epoch milliseconds. Lets the session sweeper age it out with the session. */
  createdAt: number
}

export interface PendingRunFinishStore {
  get(sessionId: string): Promise<PendingRunFinish | null>
  set(sessionId: string, pending: PendingRunFinish): Promise<void>
  clear(sessionId: string): Promise<void>
}

/** The real store: a sibling key of the BFF session record. */
export const sessionPendingRunFinishStore: PendingRunFinishStore = {
  get: sessionId => readPendingRunFinish<PendingRunFinish>(sessionId),
  set: (sessionId, pending) => writePendingRunFinish(sessionId, pending),
  clear: sessionId => clearPendingRunFinish(sessionId),
}

/**
 * Is this upstream answer final for the pending finish?
 *
 * Final — clear it: `200` (handled by the caller), and a refusal that a
 * resend of the *same* request would get again — `403`, `404`, `409`, `422`.
 *
 * Not final — keep it for the next retry: `429` (the limiter consumed no
 * idempotency slot), `401` (the session's credential, not the run), every
 * `5xx`, a timeout and an unreachable API. Retrying those with the stored key
 * either applies the finish once or replays the result it already produced.
 */
export function isFinalRefusal(status: number): boolean {
  return status === 403 || status === 404 || status === 409 || status === 422
}

/**
 * Three JSON integers, or null.
 *
 * `Number.isSafeInteger` rather than a range: whether a value is plausible is
 * Laravel's decision, and an out-of-domain integer is answered there with an
 * honest `rejected`. This only refuses what is not a well-formed proposal.
 */
export function parseTelemetry(value: unknown): RunTelemetry | null {
  if (typeof value !== 'object' || value === null) return null

  const candidate = value as Record<string, unknown>
  const members = ['reported_duration_ms', 'reported_score', 'reported_run_paws'] as const

  for (const member of members) {
    if (!Number.isSafeInteger(candidate[member])) return null
  }

  return {
    reported_duration_ms: candidate.reported_duration_ms as number,
    reported_score: candidate.reported_score as number,
    reported_run_paws: candidate.reported_run_paws as number,
  }
}

export interface SubmitRunFinishInput {
  store: PendingRunFinishStore
  sessionId: string
  runId: string
  /** The browser's proposal. Ignored when this run's finish is already pending. */
  telemetry: RunTelemetry | null
  /** Sends the stored payload upstream with its stored key. */
  send: (pending: PendingRunFinish) => Promise<RunResult>
  newKey?: () => string
  now?: () => number
}

/**
 * Deliver a run's finish: persist the retry payload first, then send it.
 *
 * - A pending finish for **this** run is resent as stored — key and telemetry —
 *   whatever the browser sent this time.
 * - A pending finish for **another** run is refused (`409`): it has to be
 *   resolved first, so one session never has two outstanding proposals.
 * - With nothing pending, the proposal is stored under a new key before the
 *   first attempt, so a crash between the two can only ever retry, never
 *   re-key.
 *
 * Cleared only on a final answer. The caller learns which by the outcome: a
 * result, or an `UpstreamProblem` whose status says whether to retry.
 */
export async function submitRunFinish(input: SubmitRunFinishInput): Promise<RunResult> {
  const { store, sessionId, runId, send } = input
  const newKey = input.newKey ?? randomUUID
  const now = input.now ?? Date.now

  let pending = await store.get(sessionId)

  if (pending !== null && pending.runId !== runId) {
    throw new UpstreamProblem(bffProblem(
      BffProblemCode.RunFinishPending,
      409,
      'A previous run is still being saved. It has to finish first.',
    ))
  }

  if (pending === null) {
    if (input.telemetry === null) {
      throw new UpstreamProblem(bffProblem(
        BffProblemCode.InvalidRequest,
        422,
        'A finish needs the run\'s telemetry.',
      ))
    }

    pending = { runId, idempotencyKey: newKey(), telemetry: input.telemetry, createdAt: now() }
    await store.set(sessionId, pending)
  }

  try {
    const result = await send(pending)
    await store.clear(sessionId)

    return result
  }
  catch (error) {
    if (error instanceof UpstreamProblem && isFinalRefusal(error.problem.status)) {
      await store.clear(sessionId)
    }

    throw error
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Refuse a start response the browser could not safely use.
 *
 * The seed initialises the deterministic domain, which throws on anything that
 * is not a uint32; a malformed value is an upstream fault, not something to
 * pass on and discover inside Phaser.
 */
export function isUsableStartedRun(value: unknown): value is StartedRun {
  if (typeof value !== 'object' || value === null) return false

  const run = value as Record<string, unknown>

  return typeof run.run_id === 'string' && UUID.test(run.run_id)
    && typeof run.character_id === 'string'
    && Number.isInteger(run.seed) && (run.seed as number) >= 0 && (run.seed as number) <= 0xFFFFFFFF
    && typeof run.started_at === 'string'
    && Number.isInteger(run.loli_cycle_paws)
    && (run.loli_cycle_paws as number) >= 0 && (run.loli_cycle_paws as number) < PROGRESS.loliThreshold
}

/** Refuse a finish result that is not one of the three outcomes for this run. */
export function isUsableRunResult(value: unknown, runId: string): value is RunResult {
  if (typeof value !== 'object' || value === null) return false

  const result = value as Record<string, unknown>

  return result.run_id === runId
    && (result.status === 'accepted' || result.status === 'flagged' || result.status === 'rejected')
    && typeof result.progression === 'object' && result.progression !== null
}
