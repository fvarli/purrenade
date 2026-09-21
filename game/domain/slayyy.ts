import { TUNING } from './tuning'
import type { RunState, SlayyyState } from './types'

/**
 * SLAYYY: earned across a run, spent by the player, never automatic.
 *
 * `scoring-and-progression.md` §3 is unusually firm about the negatives, and
 * they shape this module more than the positives do. The meter **arms**; it
 * never fires. There is no decay. There is no carry across runs. There is no
 * cooldown mechanic — the only re-activation rule the specification gives is
 * "once the meter refills", so inventing a lockout would be inventing a
 * mechanic nobody approved.
 *
 * `cooldown` exists in the state machine because four states were named, but it
 * is transient by construction: the active window ends into it and the same
 * step leaves it. Keeping the name without keeping a lockout is the honest way
 * to satisfy both the documented machine and the documented rule.
 */

const MS_PER_SECOND = 1000

/** One charge point, in the internal unit. Derived, so no literal escapes the registry. */
const MILLI = 1000
const MICRO = MILLI * MILLI

export const EMPTY_SLAYYY: SlayyyState = Object.freeze({
  phase: 'charging',
  chargeMicro: 0,
  activeRemainingMs: 0,
})

/** A full meter, in the internal unit. */
export function chargeCeilingMicro(): number {
  return TUNING.slayyy.chargeMax * MICRO
}

/**
 * Add charge, and arm the meter when it fills.
 *
 * Bounded at the ceiling, so no amount of collecting can bank charge past full
 * — there is no overcharge and nothing carries into the next activation. The
 * excess is simply not granted, which is the only behaviour that keeps a full
 * meter meaning one activation rather than an unpredictable number.
 */
function addCharge(slayyy: SlayyyState, micro: number): SlayyyState {
  /*
   * Nothing accrues during the active window.
   *
   * Structural rather than a tunable, following the precedent in `tuning.ts`
   * for `nearMiss.awardsScore`: reading a `false` and branching on it would add
   * a way to switch the rule off, and "charge does not accrue while SLAYYY is
   * active" is a specification sentence, not a knob.
   */
  if (slayyy.phase === 'active') return slayyy

  const ceiling = chargeCeilingMicro()
  const chargeMicro = Math.min(ceiling, slayyy.chargeMicro + micro)
  const phase = chargeMicro >= ceiling ? 'ready' : slayyy.phase

  return { ...slayyy, chargeMicro, phase: phase === 'cooldown' ? 'charging' : phase }
}

/** The slow fill: surviving time, at the documented per-second rate. */
export function chargeFromTime(state: RunState, deltaMs: number): SlayyyState {
  if (deltaMs === 0) return state.slayyy

  const micro = Math.round(TUNING.slayyy.chargePerSecond * MICRO * (deltaMs / MS_PER_SECOND))

  return addCharge(state.slayyy, micro)
}

/** The fast fill: one Paw Token's worth, per token. */
export function chargeFromPaws(slayyy: SlayyyState, collected: number): SlayyyState {
  if (collected === 0) return slayyy

  return addCharge(slayyy, Math.round(TUNING.slayyy.chargePerPaw * MICRO) * collected)
}

/** Is the meter armed and the run in a state where firing means anything? */
export function canActivateSlayyy(state: RunState): boolean {
  return state.phase === 'running' && state.slayyy.phase === 'ready'
}

/**
 * Fire it.
 *
 * Spends the whole meter rather than the threshold's worth: the charge is not a
 * currency with change, and leaving a remainder would let a player bank toward
 * the next activation — the same thing `addCharge` refuses to allow by not
 * accruing during the active window.
 *
 * Returns the state unchanged when the meter is not armed, so a repeated key,
 * a click during the active window, or an activation on a paused or ended run
 * is a deterministic no-op rather than an error.
 */
export function activateSlayyy(state: RunState): RunState {
  if (!canActivateSlayyy(state)) return state

  return {
    ...state,
    slayyy: {
      phase: 'active',
      chargeMicro: 0,
      activeRemainingMs: TUNING.slayyy.durationMs,
    },
    slayyyActivations: state.slayyyActivations + 1,
  }
}

/**
 * Run the active window down.
 *
 * Driven by the running delta, so a paused run does not burn the power the
 * player is not using — `core-run.md` §pause: *"no SLAYYY or Loli duration
 * burn"*.
 */
export function advanceSlayyy(state: RunState, deltaMs: number): SlayyyState {
  const slayyy = state.slayyy

  if (slayyy.phase !== 'active') return slayyy

  const activeRemainingMs = slayyy.activeRemainingMs - deltaMs

  if (activeRemainingMs > 0) return { ...slayyy, activeRemainingMs }

  /*
   * Straight through `cooldown` to `charging`, in one step.
   *
   * The named state is honoured and the meter is immediately able to refill,
   * which is exactly what "re-activation once the meter refills" means. A
   * lingering cooldown would be a different game.
   */
  return { phase: 'charging', chargeMicro: 0, activeRemainingMs: 0 }
}

/**
 * Fill the meter outright. **The tutorial's, and nothing else's.**
 *
 * The SLAYYY lesson cannot wait out a real fill — that is 35–45 s of a healthy
 * run, and it is the reason `tutorial.md` §2 originally excluded SLAYYY from
 * the tutorial altogether. Filling the meter for the lesson answers that
 * objection without touching the thing the objection was about: `chargePerSecond`,
 * `chargePerPaw` and `addCharge` are untouched, so normal progression is
 * exactly what it was.
 *
 * Deliberately *not* an activation. `canActivateSlayyy` still decides,
 * `activateSlayyy` still spends the meter and still counts, and the player
 * still presses the key or the button. What is granted is the opportunity, not
 * the power — which is what keeps the lesson's success condition the real
 * mechanic rather than an imitation of it.
 */
export function primeSlayyy(slayyy: SlayyyState): SlayyyState {
  if (slayyy.phase === 'active') return slayyy

  return { phase: 'ready', chargeMicro: chargeCeilingMicro(), activeRemainingMs: 0 }
}

/**
 * Is SLAYYY protecting the player right now?
 *
 * The single definition of the rule. `collision.ts` calls this rather than
 * re-testing the phase, for the same reason `scoreMultiplier` is the only place
 * the ×2 lives: two copies of an approved rule are two things to keep in step,
 * and the copy nobody calls is the one that rots.
 */
export function slayyyProtects(state: RunState): boolean {
  return state.slayyy.phase === 'active'
}

/** The meter as a `0..1` fraction, for the HUD. */
export function chargeFraction(slayyy: SlayyyState): number {
  return slayyy.chargeMicro / chargeCeilingMicro()
}
