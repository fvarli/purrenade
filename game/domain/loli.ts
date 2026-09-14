import { lanePosition } from './collision'
import { TUNING } from './tuning'
import type { LoliState, PawToken, RunState } from './types'

/**
 * The Loli Bonus: a companion, not a coin.
 *
 * Three concepts that read alike and are not alike, and keeping them apart is
 * most of this module (`scoring-and-progression.md` §2.4):
 *
 *  - **earned** — 200 paws crossed. Consumes the cycle, preserves the overflow.
 *  - **queued** — earned while one was already running. A counter, not a flag,
 *    because more than one can queue inside a run.
 *  - **activated** — the bonus *actually started*. Only this counts toward
 *    `loliActivations`, and only this is what a later milestone may submit.
 *
 * A threshold crossed and never started is not an activation. The run ending
 * first is the ordinary way that happens, and it must leave the counter alone.
 *
 * What Loli does: attracts Paw Tokens. What Loli does not do: protect, heal,
 * add a life, or multiply score. All four are APPROVED negatives.
 */

const MS_PER_SECOND = 1000

export const EMPTY_LOLI: LoliState = Object.freeze({
  phase: 'inactive',
  phaseRemainingMs: 0,
  queuedLoliBonuses: 0,
})

export interface ThresholdResult {
  readonly loliCyclePaws: number
  /** Completed thresholds, which may be more than one from a single collection. */
  readonly earned: number
}

/**
 * Move the cycle counter on, and report how many thresholds it completed.
 *
 * Integer division rather than a loop or a single subtraction: one collection
 * can cross more than one threshold, and code that assumes it cannot is code
 * that silently drops a bonus the moment a magnet sweeps a dense run of tokens.
 * `195 + 10` earns one and leaves 5; `390 + 20` earns two and leaves 10.
 */
export function applyPawsToCycle(loliCyclePaws: number, collected: number): ThresholdResult {
  const total = loliCyclePaws + collected
  const threshold = TUNING.paw.loliThreshold

  return {
    loliCyclePaws: total % threshold,
    earned: Math.floor(total / threshold),
  }
}

/** Can a bonus begin right now? */
function canStart(state: RunState): boolean {
  return state.phase === 'running' && state.loli.phase === 'inactive'
}

/**
 * Begin a queued bonus, if one is waiting and nothing is running.
 *
 * This is the **only** place `loliActivations` moves, which is what makes the
 * "earned is not activated" rule structural rather than a convention someone
 * has to remember at four call sites.
 */
function startIfPossible(state: RunState): RunState {
  if (state.loli.queuedLoliBonuses <= 0 || !canStart(state)) return state

  /*
   * `concurrentInstances` is APPROVED at 1 and read rather than assumed. If it
   * ever became 2, the queue arithmetic above would still be correct and only
   * this gate would need to know.
   */
  if (TUNING.loli.concurrentInstances < 1) return state

  return {
    ...state,
    loli: {
      phase: 'entering',
      phaseRemainingMs: TUNING.loli.enteringMs,
      queuedLoliBonuses: state.loli.queuedLoliBonuses - 1,
    },
    loliActivations: state.loliActivations + 1,
  }
}

/** Record earned bonuses, then start one if the moment allows. */
export function earnLoliBonuses(state: RunState, earned: number): RunState {
  if (earned <= 0) return startIfPossible(state)

  const queuedState: RunState = {
    ...state,
    loli: { ...state.loli, queuedLoliBonuses: state.loli.queuedLoliBonuses + earned },
  }

  return startIfPossible(queuedState)
}

/**
 * Run the companion's lifecycle forward.
 *
 * `entering` → `active` → `exiting` → `inactive`, then the next queued bonus
 * may begin on the same step. The entrance and exit exist because the approved
 * art brief names a "puf" entry and exit as distinct states; they are short,
 * PROPOSED, and the magnet is deliberately live only during `active`.
 */
export function advanceLoli(state: RunState, deltaMs: number): RunState {
  const loli = state.loli

  if (loli.phase === 'inactive') return startIfPossible(state)
  if (deltaMs === 0) return state

  const remaining = loli.phaseRemainingMs - deltaMs

  if (remaining > 0) {
    return { ...state, loli: { ...loli, phaseRemainingMs: remaining } }
  }

  /*
   * The overshoot is carried into the next phase, exactly as the readiness beat
   * carries it, so a lifecycle's total duration does not depend on where the
   * step boundaries happened to fall.
   */
  const overshoot = -remaining

  if (loli.phase === 'entering') {
    return {
      ...state,
      loli: { ...loli, phase: 'active', phaseRemainingMs: Math.max(0, TUNING.loli.durationMs - overshoot) },
    }
  }

  if (loli.phase === 'active') {
    return {
      ...state,
      loli: { ...loli, phase: 'exiting', phaseRemainingMs: Math.max(0, TUNING.loli.exitingMs - overshoot) },
    }
  }

  // exiting → inactive, and the next queued bonus may begin immediately.
  return startIfPossible({ ...state, loli: { ...loli, phase: 'inactive', phaseRemainingMs: 0 } })
}

/** Is the magnet live? Only during the active window, never the entrance or exit. */
export function magnetIsActive(state: RunState): boolean {
  return state.loli.phase === 'active'
}

/**
 * Pull eligible tokens toward the player.
 *
 * Deterministic, domain-owned, and free of randomness — a Phaser proximity
 * trick would put collection authority in the renderer, where a dropped frame
 * changes what the player collected.
 *
 * The magnet moves **tokens**, never the player, and it never touches an
 * obstacle. It closes the lateral gap at a fixed rate and leaves the
 * longitudinal position to the world's own scroll, so a token still arrives
 * when the road says it does; what changes is which lane it arrives in.
 */
export function applyMagnet(state: RunState, deltaMs: number): RunState {
  if (!magnetIsActive(state) || deltaMs === 0 || state.pawTokens.length === 0) return state

  const position = lanePosition(state)
  const step = TUNING.loli.magnetPullPerSecond * (deltaMs / MS_PER_SECOND)

  let changed = false

  const pawTokens: PawToken[] = state.pawTokens.map((token) => {
    /*
     * Reach is bounded on **both** axes.
     *
     * It used to be lateral only, which read as "within 1.5 lanes" and behaved
     * as an infinitely long strip: tokens were pulled from the whole spawn
     * lookahead, well past the visible road, and finished the entire lateral
     * move before the player could see them. `magnetPullPerSecond` is tuned to
     * be "slow enough to be visible" and that intent was being spent off-screen.
     *
     * Two independent bounds rather than a Euclidean radius, because the two
     * axes mean different things to a player: sideways reach is about which
     * lanes Loli can serve, forward reach is about how far ahead she notices.
     * A single radius would tie them together and force one of the two to be
     * wrong.
     */
    if (token.distanceUnits > TUNING.loli.magnetReachUnits) return token

    const gap = position - token.laneOffset
    const distance = Math.abs(gap)

    // Out of lateral reach, or already home.
    if (distance > TUNING.loli.magnetRadiusUnits || distance === 0) return token

    const move = Math.min(distance, step)
    const laneOffset = token.laneOffset + Math.sign(gap) * move

    changed = true

    return Object.freeze({ ...token, laneOffset })
  })

  if (!changed) return state

  return { ...state, pawTokens }
}

/** Everything Loli is doing stops. Used when a run reaches its terminal state. */
export function clearLoli(state: RunState): RunState {
  if (state.loli.phase === 'inactive' && state.loli.queuedLoliBonuses === 0) return state

  return { ...state, loli: EMPTY_LOLI }
}
