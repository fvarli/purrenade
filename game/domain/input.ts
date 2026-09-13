import { canStartLaneChange, startLaneChange } from './lanes'
import { canJump, startJump } from './jump'
import { TUNING } from './tuning'
import type { InputEvent, RunState } from './types'

/**
 * Applying inputs, and holding one back when it cannot be applied yet.
 *
 * The buffer exists because of a specific feel bug: a player who inputs
 * correctly but slightly early — during a lane transition, or a few frames
 * before landing — has their input silently dropped and concludes the controls
 * are unresponsive. Queueing one pending action and firing it the moment it
 * becomes legal fixes that without letting inputs pile up into a queue the
 * player has lost track of.
 *
 * Depth is one. A second pending input **replaces** the first rather than
 * queueing behind it, because the most recent intent is the one the player
 * still holds; executing a stale input two seconds later is its own feel bug.
 */

/** Would this input do something right now? */
function isActionable(state: RunState, event: InputEvent): boolean {
  switch (event.type) {
    case 'move_left':
    case 'move_right':
      return canStartLaneChange(state)
    case 'jump':
      return canJump(state)
    case 'pause':
    case 'resume':
      // Never buffered. A pause the player has to wait for is a pause that did
      // not work, and buffering one would let it fire after they resumed.
      return true
  }
}

/**
 * Apply one input to a running state.
 *
 * Pause and resume are handled by the caller (`step`) because they change the
 * phase rather than the movement, and a phase change is not something the
 * movement rules should be able to make.
 */
function applyActionable(state: RunState, event: InputEvent): RunState {
  switch (event.type) {
    case 'move_left':
      return startLaneChange(state, -1)
    case 'move_right':
      return startLaneChange(state, 1)
    case 'jump':
      return startJump(state)
    case 'pause':
    case 'resume':
      return state
  }
}

/** Can this kind of input wait? */
function isBufferable(event: InputEvent): boolean {
  return event.type === 'move_left' || event.type === 'move_right' || event.type === 'jump'
}

/**
 * Apply an input, or hold it.
 *
 * An input that cannot act and cannot wait is discarded, which is the correct
 * outcome for a lane change into a wall: it is a no-op, not something to
 * remember and perform later when the player has moved on.
 */
export function applyInput(state: RunState, event: InputEvent): RunState {
  if (isActionable(state, event)) {
    const applied = applyActionable(state, event)

    // `startLaneChange` returns the state unchanged at the playfield edge. That
    // is a no-op, and a no-op must not be buffered — a player pressing left at
    // the left edge should not lurch left the instant a gap appears.
    return applied
  }

  if (!isBufferable(event)) return state

  return { ...state, buffered: { event, ageMs: 0 } }
}

/**
 * Age the buffered input, firing or discarding it.
 *
 * Called after movement has advanced, so an input buffered during a transition
 * fires on the step the transition settles rather than one step later.
 */
export function advanceBuffer(state: RunState, deltaMs: number): RunState {
  const buffered = state.buffered

  if (buffered === null) return state

  if (isActionable(state, buffered.event)) {
    const applied = applyActionable({ ...state, buffered: null }, buffered.event)

    // Still unchanged means the input became legal but did nothing — a queued
    // lane change that the player has since moved to the edge for. Spend it
    // rather than holding it for the full window.
    return applied
  }

  const ageMs = buffered.ageMs + deltaMs

  if (ageMs >= TUNING.input.bufferMs) {
    return { ...state, buffered: null }
  }

  return { ...state, buffered: { ...buffered, ageMs } }
}
