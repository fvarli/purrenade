import { advanceBuffer, applyInput } from './input'
import { sealState } from './state'
import { advanceJump } from './jump'
import { advanceObstacles, advanceSpawning } from './obstacles'
import { NOTHING_COLLECTED, advancePawSpawning, advancePawTokens, dropBlockedTokens, resolvePawTokens } from './collectibles'
import { advanceTutorial, advanceTutorialDirector, skipTutorial } from './tutorial'
import { advanceLoli, applyMagnet, applyPawsToCycle, clearLoli, earnLoliBonuses } from './loli'
import { distanceMilliFor, earnMilli, earnPoints } from './score'
import { advanceSlayyy, chargeFromPaws, chargeFromTime } from './slayyy'
import { resolveCollisions } from './collision'
import { TUNING } from './tuning'
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
   * A run that has ended is over, and no input reopens it.
   *
   * This guard used to sit *below* the input loop, which meant `pause` reached
   * `applyPhaseInput` first and walked the run straight out of its terminal
   * state into `paused` — with `resumePhase` captured as `ended`. That was
   * reachable without any test-only code: the app pauses on `blur`,
   * `visibilitychange` and `pagehide`, so switching tabs on the game-over
   * screen replaced it with a pause overlay offering a Resume button on a run
   * with zero hearts.
   */
  if (next.phase === 'ended') return sealState(next)

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

    if (isControlInput(input)) {
      next = applyControlInput(next, input)
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
  //
  // Hoisted above the world so everything downstream reads one consistent
  // clock. Difficulty is driven by elapsed time, so a tier boundary must be
  // crossed before the step that depends on it, not after.
  if (runningDeltaMs !== 0) {
    next = { ...next, elapsedMs: next.elapsedMs + runningDeltaMs }
  }

  // 6. The world scrolls, and the generator emits whatever the distance owes.
  //
  // Driven by `runningDeltaMs`, not the full delta: during the readiness beat
  // the player may move, but nothing approaches them.
  const distanceBefore = next.distanceUnits

  next = advanceObstacles(next, runningDeltaMs)
  next = advanceSpawning(next)

  // 6a. Paw Tokens travel and spawn on the same clock, from their own stream.
  //
  // After the obstacles, so a token group can see what the road already holds
  // and avoid placing itself inside a lane blocker — reading the world, never
  // drawing from its generator.
  next = advancePawTokens(next, runningDeltaMs)
  next = advancePawSpawning(next)

  // 6a(ii). The tutorial lays down its own road.
  //
  // Exactly where the two generators would have run, so an authored prop enters
  // the world at the point a generated one would have and is indistinguishable
  // from it afterwards — it scrolls, collides and despawns by the same rules.
  // A no-op on a normal run.
  next = advanceTutorialDirector(next)

  // 6b. The companion's lifecycle, then its magnet.
  //
  // In that order: a bonus that becomes active on this step should attract on
  // this step, and one that stops should not.
  next = advanceLoli(next, runningDeltaMs)
  next = applyMagnet(next, runningDeltaMs)

  /*
   * 6b(ii). A token a hazard has landed on stops being a token.
   *
   * After the magnet, not before, because the magnet moves tokens between lanes
   * and a token pulled into a blocker is bait just as surely as one spawned
   * into it. Reads the obstacle list and consumes no randomness, so the two
   * generators stay independent.
   */
  next = dropBlockedTokens(next)

  /*
   * 6c. Distance score, before anything can end the run.
   *
   * The multiplier is read from the state as it stands *now*, which fixes the
   * boundary precisely: the step on which SLAYYY expires still scores at ×2,
   * because the power was active for the whole of the movement being scored.
   * Nothing is ever multiplied retroactively — each step is settled at the rate
   * that applied while it happened, and never revisited.
   */
  const movedUnits = next.distanceUnits - distanceBefore

  if (movedUnits > 0) {
    next = { ...next, score: earnMilli(next, 'distanceMilli', distanceMilliFor(movedUnits)) }
  }

  // 7. Collision, then near miss, both after movement — occupancy flips at the
  //    midpoint of a lane change, and the player's position for this step is
  //    only settled once the transition and the jump have advanced.
  const resolved = resolveCollisions(next)

  next = resolved.state

  if (resolved.nearMisses > 0) {
    next = { ...next, nearMissCount: next.nearMissCount + resolved.nearMisses }
  }

  /*
   * Damage, unless this is the tutorial.
   *
   * The tutorial's safety is enforced here, at the rules level, exactly as
   * `tutorial.md` §3.1 requires — not by making the player invulnerable, which
   * would be a different and much worse design: `isProtected` would then be
   * true, every prop would resolve as `cleared`, and the lesson could no
   * longer tell a cone the player walked into from one they went around.
   *
   * So the collision is resolved by the real rules and the obstacle is stamped
   * exactly as it would be in a run; what changes is only that the heart is
   * not spent. The encounter still happened, which is what the lesson needs,
   * and it cost nothing, which is what the player is promised.
   */
  if (resolved.heartsLost > 0 && next.tutorial === null) {
    const hearts = Math.max(0, next.hearts - resolved.heartsLost)

    next = {
      ...next,
      hearts,
      // A hit starts the invulnerability window and changes nothing else. What
      // a collision does to an in-progress lane change, and whether it dips the
      // scroll speed, is CR-2 and still OPEN — so it does neither.
      invulnRemainingMs: TUNING.invuln.postHitMs,
    }

    if (hearts === 0) {
      // Terminal. No revive, no continue: the only way out is a new run.
      next = { ...next, phase: 'ended', resumePhase: 'running' }
    }
  }
  else if (next.invulnRemainingMs > 0) {
    next = { ...next, invulnRemainingMs: Math.max(0, next.invulnRemainingMs - runningDeltaMs) }
  }

  /*
   * 8. Collection, after damage has been settled.
   *
   * Deliberately not gated by it. Taking a heart and taking a token on the same
   * step are independent events, and the approved rule is that collection
   * continues normally during invulnerability and during SLAYYY.
   *
   * A run that ended on this step collects nothing: the terminal state is the
   * one place where "no further reward" is absolute.
   */
  let collectedIds: readonly number[] = NOTHING_COLLECTED

  if (next.phase !== 'ended') {
    const picked = resolvePawTokens(next)

    next = picked.state
    collectedIds = picked.collectedIds

    if (picked.collected > 0) {
      const cycle = applyPawsToCycle(next.loliCyclePaws, picked.collected)

      next = {
        ...next,
        runPaws: next.runPaws + picked.collected,
        loliCyclePaws: cycle.loliCyclePaws,
        score: earnPoints(next, 'collectionMilli', TUNING.score.perPaw * picked.collected),
        slayyy: chargeFromPaws(next.slayyy, picked.collected),
      }

      next = earnLoliBonuses(next, cycle.earned)
    }
  }

  // 9. The meter fills from surviving time, and the active window runs down.
  if (next.phase !== 'ended') {
    next = { ...next, slayyy: chargeFromTime(next, runningDeltaMs) }
    next = { ...next, slayyy: advanceSlayyy(next, runningDeltaMs) }
  }

  /*
   * 9a. The tutorial judges what just happened.
   *
   * Last, and after the meter, so it sees the finished state of everything it
   * reasons about — where the player ended up, what their prop resolved to,
   * which tokens were taken, whether SLAYYY actually fired. Judging earlier
   * would mean judging a half-settled step.
   *
   * A no-op on a normal run.
   */
  next = advanceTutorial(next, state, collectedIds, runningDeltaMs)

  /*
   * 10. Terminal cleanup.
   *
   * Everything M7 owns stops at the same instant the run does: the companion
   * leaves, the queue is discarded rather than banked, and the power window
   * closes without granting anything further. `loliActivations` and
   * `slayyyActivations` are untouched — they record what happened, and a run
   * ending does not un-happen them.
   */
  if (next.phase === 'ended') {
    next = clearLoli(next)

    if (next.slayyy.phase === 'active') {
      next = { ...next, slayyy: { ...next.slayyy, phase: 'cooldown', activeRemainingMs: 0 } }
    }
  }

  return sealState(next)
}

/**
 * Inputs that change what the run *is*, rather than what the player is doing.
 *
 * They apply whatever the phase, and they are never buffered. `tutorial_skip`
 * belongs here for the same reason pause does: a skip the player has to wait
 * for is a skip that did not work.
 */
function isControlInput(input: InputEvent): boolean {
  return input.type === 'pause' || input.type === 'resume' || input.type === 'tutorial_skip'
}

/**
 * The accepted vocabulary, written out rather than derived.
 *
 * TypeScript cannot check the edge this guards — a replay harness or a future
 * server-side validator feeds it input logs off the wire — so the set is the
 * check. It is also hand-maintained, which means **a new `InputEvent` variant
 * must be added here or the reducer throws on it**; `domain.spec.ts` asserts
 * the set and the union agree.
 */
const INPUT_TYPES: ReadonlySet<string> = new Set<InputEvent['type']>([
  'move_left', 'move_right', 'jump', 'slayyy', 'pause', 'resume', 'tutorial_skip',
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
function applyControlInput(state: RunState, input: InputEvent): RunState {
  // A no-op on a normal run: the rules refuse it, rather than every caller
  // having to remember not to send it.
  if (input.type === 'tutorial_skip') return skipTutorial(state)

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
