import { STEP_MS, TUNING, createRunState, step } from '../domain'
import type { InputEvent, RunPhase, RunState } from '../domain'
import { interpolateSnapshot, toRenderSnapshot } from './snapshot'
import type { RenderSnapshot, RunEvent, RunEventSink } from './types'

/**
 * The fixed-step loop: variable frames in, fixed simulation steps out.
 *
 * The domain refuses a variable delta, because variable-delta physics is
 * non-deterministic by construction — the same run at 60 fps and at 144 fps
 * would diverge. This is the adapter that makes a real display drive it anyway:
 * frame deltas go into an accumulator, whole steps come out, and what is left
 * over becomes the interpolation factor for the frame.
 *
 * It lives in the bridge rather than the engine because none of it is
 * Phaser-shaped, and because the invariants below are worth testing in Node
 * rather than in a browser.
 *
 * ### Two protections against a stalled tab
 *
 * A backgrounded tab, a GC pause or a sleeping laptop leaves the loop owing
 * more time than it can honestly simulate.
 *
 * 1. **The accumulator is cleared on pause.** Losing visibility pauses a run,
 *    and a pause throws away what has accrued rather than banking it. Without
 *    this, ten minutes in a background tab would come back as ten minutes of
 *    simulation the instant the player returned.
 * 2. **Catch-up is bounded.** Even unpaused, at most `sim.maxCatchUpSteps` are
 *    simulated per frame and the excess is discarded, not queued. Simulating a
 *    backlog instantly teleports the player through whatever accumulated —
 *    which at M6 means through every obstacle in it.
 */

export interface RunLoopOptions {
  readonly seed: number
  /** Coarse run events for the app layer. Never called with gameplay state. */
  readonly onEvent?: RunEventSink
}

export interface RunLoop {
  /** The interpolated snapshot for this frame. Safe to hand to a renderer. */
  snapshot(): RenderSnapshot
  /** Advance by one display frame. */
  frame(frameDeltaMs: number): void
  /** Queue an input for the next simulation step. */
  enqueue(input: InputEvent): void
  /** Pause, and discard whatever time had accrued. */
  pause(): void
  /** Resume. Explicit — nothing else lifts a pause. */
  resume(): void
  /** The current phase, for the app layer's UI. */
  phase(): RunPhase
  /**
   * A copy of the run state, for tests and debugging. Never for rendering.
   *
   * A copy because the live object was reachable from the engine through this
   * method, which made "the mutable state object never leaves the domain" false
   * of the one accessor that returned it.
   */
  debugState(): RunState
}

export function createRunLoop({ seed, onEvent }: RunLoopOptions): RunLoop {
  let state = createRunState({ seed })
  let previous = toRenderSnapshot(state)
  let current = previous

  let accumulatorMs = 0
  let pending: InputEvent[] = []
  let lastPhase: RunPhase = state.phase

  const emit = (event: RunEvent): void => onEvent?.(event)

  emit({ type: 'run_started' })

  /** Run one simulation step with whatever inputs have arrived. */
  const simulate = (): void => {
    const inputs = pending
    pending = []

    previous = current
    state = step(state, inputs, STEP_MS)
    current = toRenderSnapshot(state)

    if (state.phase !== lastPhase) {
      // `run_interactive` is the moment hazards become legal, which is the one
      // the app layer actually cares about — M6 will start spawning on it.
      if (lastPhase === 'ready' && state.phase === 'running') {
        emit({ type: 'run_interactive' })
      }

      lastPhase = state.phase
      emit({ type: 'phase_changed', phase: state.phase })
    }
  }

  /**
   * Take a phase transition now, without advancing time.
   *
   * Shares `simulate`'s event bookkeeping so a pause reaches the app layer the
   * same way any other phase change does, and refreshes the snapshot so a
   * renderer that paints once more sees the paused state.
   */
  const applyControl = (input: InputEvent): void => {
    previous = current
    state = step(state, [input], 0)
    current = toRenderSnapshot(state)

    if (state.phase !== lastPhase) {
      lastPhase = state.phase
      emit({ type: 'phase_changed', phase: state.phase })
    }
  }

  return {
    snapshot(): RenderSnapshot {
      // While paused there is nothing to interpolate towards, and blending
      // would make a frozen run visibly drift.
      if (state.phase === 'paused') return current

      return interpolateSnapshot(previous, current, accumulatorMs / STEP_MS)
    },

    frame(frameDeltaMs: number): void {
      if (!Number.isFinite(frameDeltaMs) || frameDeltaMs < 0) return

      if (state.phase === 'paused') {
        /*
         * Discard what is queued; bank no time.
         *
         * This used to call `simulate()`, which runs a full `STEP_MS` the
         * accumulator never paid for. Harmless while the queue could only hold
         * gameplay inputs that a paused `step` ignores — but `enqueue` is public
         * and accepts `resume`, so a queued resume flipped the phase inside that
         * same step and bought 8.33 ms of free simulation, against the one
         * invariant this loop exists to hold.
         *
         * Control transitions do not need the queue: `pause()` and `resume()`
         * apply synchronously.
         */
        pending = []
        accumulatorMs = 0

        return
      }

      accumulatorMs += frameDeltaMs

      // A frame can land a float ULP short of the threshold and defer its step
      // to the next one. That is not a lost step — the remainder carries, and
      // the total tracks the time supplied. Nudging the comparison with an
      // epsilon would trade a harmless one-frame quantisation for the risk of
      // running a step that has not been paid for.
      let steps = 0

      while (accumulatorMs >= STEP_MS && steps < TUNING.sim.maxCatchUpSteps) {
        simulate()
        accumulatorMs -= STEP_MS
        steps++
      }

      if (accumulatorMs >= STEP_MS) {
        // Owed more than the budget. Drop the excess rather than simulate it,
        // and keep the sub-step remainder so interpolation stays smooth.
        accumulatorMs %= STEP_MS
      }
    },

    enqueue(input: InputEvent): void {
      pending.push(input)
    },

    /*
     * Pause and resume apply **immediately**, not as queued input.
     *
     * They were queued once, and it produced a genuine deadlock. A queued
     * transition is only applied by the next `frame()`, and `frame()` is driven
     * by the renderer's update loop — which Phaser stops when the window loses
     * focus. So a player who paused, or whose run was paused for them by that
     * same blur, pressed Resume and nothing happened: the input sat in a queue
     * waiting for a loop that pausing had stopped. The button was dead in
     * exactly the circumstance it exists for.
     *
     * Control operations must not depend on the thing they control. Applying
     * them synchronously also makes `phase()` truthful the instant the caller
     * asks, which the app layer relies on to label the button.
     *
     * `step` with a zero delta advances no time — it only takes the transition.
     * Anything already queued is discarded by the next paused frame, and `step`
     * ignores gameplay input that arrives while paused, so a jump pressed in
     * the same breath as a pause is swallowed rather than fired on resume.
     */
    pause(): void {
      accumulatorMs = 0
      applyControl({ type: 'pause' })
    },

    resume(): void {
      accumulatorMs = 0
      applyControl({ type: 'resume' })
    },

    phase(): RunPhase {
      return state.phase
    },

    debugState(): RunState {
      return structuredClone(state)
    },
  }
}
