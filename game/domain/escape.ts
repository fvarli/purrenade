import { createRunState } from './state'
import { step } from './step'
import { STEP_MS, TUNING } from './tuning'
import type { InputEvent, LaneIndex, Obstacle, RunState } from './types'

/**
 * The escape-path solver.
 *
 * The product guarantee is that **every generated pattern has at least one
 * survivable path** from every starting lane, within the action and reaction
 * budget. That is a hard invariant, not a hope about randomness, so it needs a
 * proof rather than an inspection.
 *
 * The important design choice here is that the solver does not model the game —
 * **it runs the game**. Every candidate future is advanced with the real
 * `step()`, over real obstacles, at the real scroll speed for that point in the
 * run. A separate hand-written model of lane timing and jump arcs could be
 * subtly wrong and would then certify patterns the actual rules kill you on;
 * this cannot disagree with the rules, because it is the rules.
 *
 * The search is a breadth-first walk over simulation steps. At each step the
 * player may do nothing, or spend one of their budgeted actions. States are
 * memoised on the few fields that can differ — lane, transition, jump, actions
 * spent — so the branching stays polynomial rather than combinatorial: the
 * obstacles' positions are a function of the step index and need not be keyed.
 */

export interface EscapeQuery {
  readonly startLane: LaneIndex
  /** The pattern under test, positioned ahead of the player. */
  readonly obstacles: readonly Obstacle[]
  /** Where in the run this happens, which fixes the scroll speed. */
  readonly elapsedMs: number
  /** Defaults to `escape.maxActionsPerPattern`. */
  readonly maxActions?: number
  /** Defaults to `escape.reactionBudgetMs`. */
  readonly reactionBudgetMs?: number
  /**
   * The state the player arrives in, when it is not a standing start.
   *
   * A pattern is almost never met from rest. The player reaches it part-way
   * through a lane change, part-way through a jump, holding a buffered input,
   * or still flashing from a hit — all of which *remove* options: a transition
   * in flight refuses a new lane change, an airborne player cannot start
   * another jump, and a buffered input will spend itself the moment the way
   * clears, possibly into a lane the player no longer wants.
   *
   * Proving safety only from a standing start proves the easy case. These
   * fields let the caller pose the hard one, and the join test uses the *real*
   * exit state of the preceding pattern rather than an invented one.
   */
  readonly start?: EscapeStartState
}

/** A mid-action arrival state. Every field is optional and defaults to rest. */
export interface EscapeStartState {
  /** A lane change already in flight. `to` is where the player ends up. */
  readonly laneTransition?: { readonly from: LaneIndex, readonly to: LaneIndex, readonly elapsedMs: number } | null
  /** Milliseconds already spent airborne, or `null` when on the ground. */
  readonly jumpElapsedMs?: number | null
  /** An input already remembered, and how long it has been waiting. */
  readonly buffered?: { readonly type: InputEvent['type'], readonly ageMs: number } | null
}

/*
 * There is deliberately no way to start the solver invulnerable.
 *
 * Invulnerability only ever *protects*: it removes no option and closes no
 * path, so modelling it can never turn a safe pattern unsafe — but it can turn
 * an unsafe one "safe", because the solver's kill condition is a lost heart and
 * a protected player loses none. A first attempt at this interface accepted
 * `invulnRemainingMs`, and a pattern with an unavoidable collision was duly
 * certified survivable, which is the exact failure the escape guarantee exists
 * to prevent.
 *
 * So the solver always answers the unprotected question. A run whose safety
 * depends on still flashing from the last hit is not a safe run.
 */

export interface EscapeResult {
  readonly survivable: boolean
  /** The first surviving schedule found, for a counterexample-free report. */
  readonly actions: readonly { readonly atMs: number, readonly input: InputEvent['type'] }[]
  /** How many simulation steps the search covered. */
  readonly steps: number
}

const CANDIDATE_ACTIONS: readonly InputEvent['type'][] = ['move_left', 'move_right', 'jump']

/**
 * Actions are considered on a coarse grid, not on every simulation step.
 *
 * Two reasons, and the second is the important one. The cheap reason is cost: a
 * decision on every one of 8.33 ms steps makes the schedule space quadratic in
 * a number in the hundreds, and the search stops finishing. The real reason is
 * that a grid finer than human intent proves the wrong thing — the reaction
 * budget already says a person cannot act inside 350 ms, so certifying a
 * pattern that needs frame-perfect timing would be certifying something nobody
 * can do. A tenth of a second is well inside a 160 ms lane change and well
 * under the budget, so nothing survivable is lost.
 */
const GRID_MS = TUNING.escape.solverGridMs

/**
 * A synthetic run holding exactly the obstacles under test.
 *
 * Spawning is switched off by pushing the generator's cursor out of reach, so
 * the solver judges the pattern it was handed and not whatever the generator
 * would have added on top of it.
 */
function stateFor(query: EscapeQuery): RunState {
  const base = createRunState({ seed: 1 })
  const start = query.start ?? {}
  const transition = start.laneTransition ?? null

  /*
   * `lane` and `laneTransition` have to agree, and the direction matters.
   *
   * `startLaneChange` leaves `state.lane` at the lane being *left* and only
   * `advanceLaneTransition` settles it onto `transition.to`. So a state in
   * flight has `lane === transition.from`, not `to`. Getting this backwards
   * describes a state the rules never produce — the collision lane and the
   * settle target would disagree — and any answer the solver gave for it would
   * be about a game that does not exist.
   */
  if (transition !== null && transition.from !== query.startLane) {
    throw new Error(
      `findEscapePath: startLane ${query.startLane} must be the lane being left `
      + `(the transition leaves ${transition.from})`,
    )
  }

  return {
    ...base,
    phase: 'running',
    readyRemainingMs: 0,
    resumePhase: 'running',
    elapsedMs: query.elapsedMs,
    lane: query.startLane,
    laneTransition: transition === null ? null : Object.freeze({ ...transition }),
    jumpElapsedMs: start.jumpElapsedMs ?? null,
    buffered: start.buffered == null
      ? null
      : Object.freeze({ event: Object.freeze({ type: start.buffered.type }), ageMs: start.buffered.ageMs }),
    // Never inherited from the caller: see the note on EscapeStartState.
    invulnRemainingMs: 0,
    obstacles: query.obstacles.map(obstacle => Object.freeze({ ...obstacle })),
    spawn: { nextAtUnits: Number.POSITIVE_INFINITY, recentPatternIds: [] },
  }
}

/**
 * Everything about a state that can differ between two candidate futures.
 *
 * The step index is part of the key, and leaving it out was a real bug: the
 * obstacles' positions are a function of it, so two identical-looking player
 * states one step apart are *not* the same situation. Without it the "do
 * nothing" branch produced the same signature every step, deduplicated against
 * itself, and the search died one step in — reporting every pattern in the
 * catalogue as unsurvivable.
 */
function signature(state: RunState, actionsUsed: number, stepIndex: number): string {
  const transition = state.laneTransition

  return [
    stepIndex,
    state.lane,
    transition === null ? 'x' : `${transition.from}:${transition.to}:${Math.round(transition.elapsedMs)}`,
    state.jumpElapsedMs === null ? 'g' : Math.round(state.jumpElapsedMs),
    state.buffered === null ? 'n' : state.buffered.event.type,
    actionsUsed,
  ].join('|')
}

/** Has every obstacle in the pattern finished resolving? */
function allResolved(state: RunState): boolean {
  return state.obstacles.every(obstacle => obstacle.outcome !== 'pending')
}

interface Node {
  readonly state: RunState
  readonly actionsUsed: number
  readonly stepIndex: number
  readonly taken: readonly { readonly atMs: number, readonly input: InputEvent['type'] }[]
}

/**
 * Can the player get through this pattern unharmed?
 *
 * Survivable means: reaching the far side with every obstacle resolved and no
 * heart lost, spending no more than the budgeted actions, and taking none of
 * them before the reaction budget has elapsed. That last part is what turns
 * "technically possible" into "humanly fair" — a pattern a machine could thread
 * on the first frame is not a pattern a person can.
 *
 * Depth-first, not breadth-first, and the difference is the whole runtime. A
 * breadth-first walk has to expand every state at every level before it can
 * reach the far side, so even a pattern the player survives by standing still
 * costs the entire search. Depth-first follows one future to the end and
 * returns the moment it works, which is almost immediately for a well-authored
 * pattern; the memo keeps the exhaustive case — proving something *unsafe* —
 * from revisiting states it has already refuted.
 *
 * Doing nothing is tried first, so a start lane that is already safe costs one
 * pass and no branching.
 */
export function findEscapePath(query: EscapeQuery): EscapeResult {
  const maxActions = query.maxActions ?? TUNING.escape.maxActionsPerPattern
  const reactionBudgetMs = query.reactionBudgetMs ?? TUNING.escape.reactionBudgetMs

  const start = stateFor(query)
  const startElapsed = start.elapsedMs

  if (allResolved(start)) return { survivable: true, actions: [], steps: 0 }

  const stack: Node[] = [{ state: start, actionsUsed: 0, stepIndex: 0, taken: [] }]
  const seen = new Set<string>()

  let expanded = 0

  while (stack.length > 0) {
    const node = stack.pop()!

    if (allResolved(node.state)) {
      return { survivable: true, actions: node.taken, steps: expanded }
    }

    if (node.stepIndex >= MAX_SEARCH_STEPS) continue

    expanded++

    const sinceStart = node.state.elapsedMs - startElapsed
    const onGrid = Math.floor(sinceStart / GRID_MS) !== Math.floor((sinceStart - STEP_MS) / GRID_MS)

    const mayAct = node.actionsUsed < maxActions
      && sinceStart >= reactionBudgetMs
      && onGrid

    // Pushed in reverse: the stack pops `null` first, so an already-safe lane
    // resolves without ever branching.
    const branches: readonly (InputEvent['type'] | null)[] = mayAct
      ? [...[...CANDIDATE_ACTIONS].reverse(), null]
      : [null]

    for (const action of branches) {
      const inputs: InputEvent[] = action === null ? [] : [{ type: action }]
      const advanced = step(node.state, inputs, STEP_MS)

      // Any heart lost kills the branch: survivable means unharmed.
      if (advanced.hearts < node.state.hearts) continue

      const actionsUsed = node.actionsUsed + (action === null ? 0 : 1)
      const stepIndex = node.stepIndex + 1
      const key = signature(advanced, actionsUsed, stepIndex)

      if (seen.has(key)) continue

      seen.add(key)

      stack.push({
        state: advanced,
        actionsUsed,
        stepIndex,
        taken: action === null ? node.taken : [...node.taken, { atMs: sinceStart, input: action }],
      })
    }
  }

  return { survivable: false, actions: [], steps: expanded }
}

/**
 * A ceiling on the search depth.
 *
 * A pattern plus its gap is a few seconds of simulation; anything that has not
 * resolved by here is a configuration mistake, and running forever would turn
 * that mistake into a hung test rather than a failing one.
 */
const MAX_SEARCH_STEPS = TUNING.escape.solverMaxSteps
