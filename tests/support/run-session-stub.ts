import { reactive } from 'vue'
import { vi } from 'vitest'
import type { RunSessionPhase } from '~/stores/run-session'
import type { RunResult, RunTelemetry, StartedRun } from '~/types/run'

/**
 * A stand-in for the `runSession` store, for tests that mount the run page.
 *
 * The page reads the store's state and calls four actions; this fakes exactly
 * that, reactively, so a test can put the session in any phase — including
 * the ones a scripted player cannot reach — and assert what the page says.
 *
 * `begin()` succeeds at once by default, like a server that started a run.
 */
export function runSessionStub() {
  const session = reactive({
    phase: 'idle' as RunSessionPhase,
    run: null as StartedRun | null,
    resumed: false,
    starts: 0,
    outcome: null as RunResult | null,
    problemCode: null as string | null,
    retryAt: null as number | null,
    attempt: 0,
    proposed: null as RunTelemetry | null,
    previousDelivered: null as RunResult | null,
    characterId: 'aysenur',
    get busy(): boolean {
      return session.phase === 'resolving' || session.phase === 'starting' || session.phase === 'submitting'
    },
    get saving(): boolean {
      return session.phase === 'submitting' || session.phase === 'retry_wait'
    },
    begin: vi.fn(async (_characterId?: string) => {
      session.run = {
        run_id: '01999999-9999-7999-8999-999999999999',
        character_id: 'aysenur',
        seed: 4242,
        started_at: '2026-09-23T12:00:00.000Z',
        loli_cycle_paws: 7,
      }
      session.phase = 'ready'
      session.starts++
    }),
    submit: vi.fn(async (_summary: unknown) => {
      session.phase = 'submitting'
    }),
    retryNow: vi.fn(async () => {}),
    acknowledge: vi.fn(),
  })

  return session
}

export type RunSessionStub = ReturnType<typeof runSessionStub>
