import { advanceBuffer, applyInput } from './input'
import { sealState } from './state'
import { advanceJump } from './jump'
import { advanceLaneTransition } from './lanes'
import type { InputEvent, RunState } from './types'

/**
 * The whole game, as one pure function.
 *
 * ```ts
 * step(state, inputs, deltaMs): RunState
 * ```
 *
 * Same inputs, same output, every time. No ambient time — it arrives as
 * `deltaMs`. No ambient randomness — the generator is carried in the state. No
 * I/O, no DOM, no Phaser, no Vue. ESLint enforces the imports; the discipline
 * behind them is what makes the escape-path guarantee provable at M6 and what
 * keeps the domain portable if run validation ever needs to replay it
 * server-side.
 *
 * The caller drives this at a fixed rate with an accumulator. It does not
 * accept a variable frame delta, because variable-delta physics is
 * non-deterministic by construction: the same run at 60 fps and at 144 fps
 * would diverge.
 */
export function step(state: RunState, inputs: readonly InputEvent[], deltaMs: number): RunState {
  /*
   * The one place time is validated.
   *
   * `step` is the domain's only entry point, so this is the boundary the
   * invariant belongs on — not sprinkled through `advanceJump`,
   * `advanceLaneTransition` and every other hot-path function.
   *
   * It used to check the sign only, which is the wrong half. `NaN < 0` is
   * false, so a single `NaN` delta walked straight in and poisoned the run for
   * good: `elapsedMs` became `NaN` permanently, `jumpElapsedMs >= airborneMs`
   * was false forever so the player never landed, a lane transition never
   * settled so no further lane change was legal, and the readiness beat was
   * skipped entirely because `1500 - NaN > 0` is also false. `Infinity` was
   * accepted just as readily. The bridge's loop happened to filter both, which
   * meant the domain's invariant was being enforced by a module the domain is
   * explicitly forbidden to know exists.
   */
  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    throw new RangeError(`step: deltaMs must be a finite, non-negative number (got ${String(deltaMs)})`)
  }

  let next = state

  /*
   * Inputs, once, in the order they arrived.
   *
   * This was two passes — every phase input, then every gameplay input — which
   * threw the relative order away and made pause mean three different things:
   * `[jump, pause]` swallowed the jump, `[pause, jump, resume]` applied it, and
   * a jump arriving while already paused fired on the next resume. One ordered
   * pass gives the rule the rest of the milestone already states: **a gameplay
   * input applies only if the run is not paused at the moment it arrives.**
   *
   * Gameplay inputs are accepted during the readiness beat: the beat withholds
   * hazards, not agency, and a player who already knows what they are doing
   * should not have their first input eaten.
   */
  for (const input of inputs) {
    if (!isInputEvent(input)) {
      throw new TypeError(`step: not an input event (got ${JSON.stringify(input) ?? String(input)})`)
    }

    if (isPhaseInput(input)) {
      next = applyPhaseInput(next, input)
      continue
    }

    if (next.phase === 'paused') continue

    next = applyInput(next, input)
  }

  if (next.phase === 'paused') {
    // Nothing advances. Not the clock, not a lane change caught mid-movement,
    // not the jump arc, not the buffer's age. A player who pauses halfway
    // through a lane change resumes halfway through it.
    return sealState(next)
  }

  // 3. The readiness beat, if one is still running.
  const { state: afterReady, runningDeltaMs } = advanceReady(next, deltaMs)

  next = afterReady

  // 4. Movement, always by the full delta.
  //
  // Movement advances during the beat too. Freezing a lane change until the
  // beat ends would mean an input accepted in step 2 visibly does nothing,
  // which is the same unresponsiveness the input buffer exists to prevent.
  next = advanceLaneTransition(next, deltaMs)
  next = advanceJump(next, deltaMs)

  // After movement, so an input buffered during a lane change fires on the very
  // step that change settles rather than one step later — 8 ms the player would
  // feel as the buffer not quite working.
  next = advanceBuffer(next, deltaMs)

  // 5. Run time, which only accrues once the run is interactive.
  return sealState(runningDeltaMs === 0
    ? next
    : { ...next, elapsedMs: next.elapsedMs + runningDeltaMs })
}

function isPhaseInput(input: InputEvent): boolean {
  return input.type === 'pause' || input.type === 'resume'
}

const INPUT_TYPES: ReadonlySet<string> = new Set<InputEvent['type']>([
  'move_left', 'move_right', 'jump', 'pause', 'resume',
])

/**
 * Is this actually one of ours?
 *
 * TypeScript cannot help at the edge the domain is built for: a replay harness
 * or a future server-side validator feeds it input logs that came off the wire.
 * Without this, `null` threw a bare `TypeError` out of the reducer and took the
 * frame loop with it, and an unrecognised `type` was accepted in silence.
 */
function isInputEvent(input: unknown): input is InputEvent {
  return typeof input === 'object'
    && input !== null
    && INPUT_TYPES.has((input as { type?: unknown }).type as string)
}

/**
 * Pause and resume.
 *
 * Resume is **explicit**. Losing visibility pauses a run, and regaining it must
 * not un-pause one: a tab returning to the foreground while the player is
 * looking at something else would otherwise resume a live run nobody is
 * watching. So there is no automatic path out of `paused` — only an input.
 *
 * The phase to return to is remembered, so pausing during the readiness beat
 * resumes into the readiness beat rather than skipping it.
 */
function applyPhaseInput(state: RunState, input: InputEvent): RunState {
  if (input.type === 'pause') {
    if (state.phase === 'paused') return state

    return { ...state, phase: 'paused', resumePhase: state.phase }
  }

  if (input.type === 'resume') {
    if (state.phase !== 'paused') return state

    return { ...state, phase: state.resumePhase }
  }

  return state
}

/**
 * Count the readiness beat down, and report how much of this step was run time.
 *
 * The overshoot matters. If the beat has 3 ms left and the step is 8.33 ms, the
 * run has been interactive for 5.33 ms of it, and saying otherwise would make
 * a run's elapsed time depend on where the step boundary happened to fall
 * relative to the beat — a small non-determinism, but exactly the kind that
 * makes a replay diverge.
 */
function advanceReady(
  state: RunState,
  deltaMs: number,
): { state: RunState, runningDeltaMs: number } {
  if (state.phase === 'running') {
    return { state, runningDeltaMs: deltaMs }
  }

  const remaining = state.readyRemainingMs - deltaMs

  if (remaining > 0) {
    return { state: { ...state, readyRemainingMs: remaining }, runningDeltaMs: 0 }
  }

  return {
    state: { ...state, phase: 'running', readyRemainingMs: 0, resumePhase: 'running' },
    runningDeltaMs: -remaining,
  }
}
