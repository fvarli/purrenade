import { describe, expect, it } from 'vitest'
import { STEP_MS, createRunState } from '../domain'
import { createRunLoop } from './loop'
import { toRenderSnapshot } from './snapshot'
import type { RunEvent } from './types'

/**
 * What the tutorial tells the app, and what it keeps to itself.
 *
 * The lessons themselves are proved in `game/domain/tutorial.spec.ts`, against
 * the rules. This file is about the boundary: that the app is told enough to
 * draw a prompt, that it is told each thing exactly once, and that it is not
 * told anything about the road.
 */

function collect(mode: 'run' | 'tutorial') {
  const events: RunEvent[] = []
  const loop = createRunLoop({ seed: 7, mode, onEvent: e => events.push(e) })

  return { events, loop }
}

function run(loop: ReturnType<typeof createRunLoop>, ms: number): void {
  for (let i = 0; i < Math.round(ms / STEP_MS); i++) loop.frame(STEP_MS)
}

const tutorialEvents = (events: readonly RunEvent[]): RunEvent[] =>
  events.filter(e => e.type.startsWith('tutorial_'))

describe('the tutorial speaks only through coarse events', () => {
  it('announces the opening lesson before anything has happened', () => {
    const { events } = collect('tutorial')

    /*
     * Emitted at construction rather than left for the first frame to notice.
     * The first lesson is not a *change* — there is nothing for it to differ
     * from — so a diff-only implementation would leave the player looking at an
     * empty road being told nothing until the second lesson arrived.
     */
    expect(events[0]).toEqual({ type: 'run_started' })
    expect(events[1]).toEqual({ type: 'tutorial_lesson', lesson: 'intro', index: 0, total: 9 })
  })

  it('says nothing about a tutorial during a normal run', () => {
    const { events, loop } = collect('run')

    run(loop, 30_000)

    expect(tutorialEvents(events)).toEqual([])
  })

  it('moves through the lessons one event at a time, in order', () => {
    const { events, loop } = collect('tutorial')

    run(loop, 20_000)

    const lessons = events
      .filter((e): e is Extract<RunEvent, { type: 'tutorial_lesson' }> => e.type === 'tutorial_lesson')
      .map(e => e.lesson)

    // A player pressing nothing gets past the greeting and then stops, because
    // every lesson after it needs an action.
    expect(lessons).toEqual(['intro', 'move_left'])
    // Announced once each, never repeated by a re-prompt.
    expect(new Set(lessons).size).toBe(lessons.length)
  })

  it('nudges a silent player, and counts the attempts for them', () => {
    const { events, loop } = collect('tutorial')

    run(loop, 25_000)

    const corrections = events.filter(
      (e): e is Extract<RunEvent, { type: 'tutorial_correction' }> => e.type === 'tutorial_correction',
    )

    expect(corrections.length).toBeGreaterThan(1)
    expect(corrections[0]).toMatchObject({ lesson: 'move_left', correction: 'no_input', attempt: 1 })
    // The attempt number climbs, so the copy can become more explicit without
    // the app keeping its own tally.
    expect(corrections[1]?.attempt).toBe(2)
  })

  it('reports a skip, through the path a skip actually takes', () => {
    const { events, loop } = collect('tutorial')

    run(loop, 5_000)
    loop.skipTutorial()

    /*
     * `skipTutorial` goes through `applyControl`, which used to emit nothing
     * but a phase change — so this is the test that stops the skip button from
     * silently doing nothing to the UI.
     */
    expect(events.at(-1)).toEqual({ type: 'tutorial_completed', outcome: 'skipped' })
  })

  it('reports a skip once, however often it is asked for', () => {
    const { events, loop } = collect('tutorial')

    run(loop, 5_000)
    loop.skipTutorial()
    loop.skipTutorial()

    expect(events.filter(e => e.type === 'tutorial_completed')).toHaveLength(1)
  })

  it('ignores a skip on a normal run', () => {
    const { events, loop } = collect('run')

    run(loop, 3_000)
    loop.skipTutorial()

    expect(tutorialEvents(events)).toEqual([])
    expect(loop.phase()).not.toBe('ended')
  })
})

describe('the renderer learns nothing new', () => {
  it('has the same snapshot shape in both modes', () => {
    /*
     * The tutorial introduces no new visual vocabulary: its props are ordinary
     * obstacles and Paw Tokens, so the frozen contract between the rules and
     * the renderer does not widen. A new field here would be a new thing for
     * the scene to draw, which is precisely what "derive the treatment from the
     * existing system" rules out.
     */
    const asRun = toRenderSnapshot(createRunState({ seed: 1 }))
    const asTutorial = toRenderSnapshot(createRunState({ seed: 1, mode: 'tutorial' }))

    expect(Object.keys(asTutorial).sort()).toEqual(Object.keys(asRun).sort())
    expect(asTutorial).toEqual(asRun)
  })
})
