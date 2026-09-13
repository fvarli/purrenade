// @vitest-environment happy-dom
//
// The scene's lifecycle, driven by a fake Phaser.
//
// `createRunScene` takes the Phaser namespace as a parameter, which means the
// half of the engine that actually leaks — listener registration and teardown —
// can be exercised in Node with no WebGL, no browser and no account. That
// matters: the browser suite that would otherwise cover this is gated behind
// credentials and is not a CI gate, so before this file the single most
// damaging defect in the milestone had no automated protection at all.

import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PALETTE, createRunScene } from './scene'
import { createRunLoop } from '../bridge'

/** A minimal event emitter, which is all the scene needs from Phaser's. */
function emitter() {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>()

  return {
    on(event: string, fn: (...args: unknown[]) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), fn])
      return this
    },
    once(event: string, fn: (...args: unknown[]) => void) {
      return this.on(event, fn)
    },
    off(event: string, fn: (...args: unknown[]) => void) {
      handlers.set(event, (handlers.get(event) ?? []).filter(h => h !== fn))
      return this
    },
    emit(event: string, ...args: unknown[]) {
      for (const fn of [...(handlers.get(event) ?? [])]) fn(...args)
      return this
    },
    count(event: string) {
      return (handlers.get(event) ?? []).length
    },
  }
}

function shape() {
  const self = {
    setPosition: () => self,
    setSize: () => self,
    setRadius: () => self,
    setDepth: () => self,
    setAlpha: () => self,
    setFillStyle: () => self,
  }

  return self
}

/**
 * Enough of Phaser to construct the scene.
 *
 * Deliberately not a mock of the renderer: nothing here draws. What it models
 * is the part the scene depends on for its lifetime — the scale manager, the
 * scene event emitter, and the input plugin.
 */
function fakePhaser(size = { width: 390, height: 844 }) {
  const events = emitter()
  const input = emitter()
  const scale = Object.assign(emitter(), size)

  class Scene {
    events = events
    input = input
    scale = scale
    add = { rectangle: shape, circle: shape }
  }

  return { phaser: { Scene } as never, events, input, scale }
}

function keydownListenerCount(): number {
  return added - removed
}

let added = 0
let removed = 0

function trackDocumentListeners(): void {
  added = 0
  removed = 0

  const add = document.addEventListener.bind(document)
  const remove = document.removeEventListener.bind(document)

  vi.spyOn(document, 'addEventListener').mockImplementation((type, fn, opts) => {
    if (type === 'keydown') added++
    add(type, fn as EventListener, opts)
  })

  vi.spyOn(document, 'removeEventListener').mockImplementation((type, fn, opts) => {
    if (type === 'keydown') removed++
    remove(type, fn as EventListener, opts)
  })
}

function mountScene(size?: { width: number, height: number }) {
  const { phaser, events, input, scale } = fakePhaser(size)
  const loop = createRunLoop({ seed: 1 })
  const pauseRequests: number[] = []

  const scene = createRunScene(phaser, {
    loop,
    onPauseRequested: () => pauseRequests.push(1),
  }) as unknown as { create: () => void }

  scene.create()

  return { events, input, scale, loop, pauseRequests }
}

describe('the scene releases everything it took', () => {
  it('removes its document keydown listener when Phaser destroys the scene', () => {
    /*
     * The regression this file exists for.
     *
     * Teardown was registered on `shutdown`, and `game.destroy(true)` never
     * emits it — `Systems.destroy` emits `destroy` and then drops every
     * listener. So the keydown handler survived every route visit, kept
     * calling `preventDefault()` on Space and the arrows across the rest of
     * the app, and kept enqueueing into a loop that would never run again.
     */
    trackDocumentListeners()

    const { events } = mountScene()

    expect(keydownListenerCount()).toBe(1)

    events.emit('destroy')

    expect(keydownListenerCount(), 'destroy must drain the teardown').toBe(0)

    vi.restoreAllMocks()
  })

  it('also releases on the shutdown path, for scene stop and sleep', () => {
    trackDocumentListeners()

    const { events } = mountScene()
    events.emit('shutdown')

    expect(keydownListenerCount()).toBe(0)

    vi.restoreAllMocks()
  })

  it('does not accumulate listeners across repeated mounts', () => {
    trackDocumentListeners()

    for (let visit = 0; visit < 5; visit++) {
      const { events } = mountScene()

      expect(keydownListenerCount(), `during visit ${visit}`).toBe(1)

      events.emit('destroy')

      expect(keydownListenerCount(), `after visit ${visit}`).toBe(0)
    }

    vi.restoreAllMocks()
  })

  it('stops acting on keys once destroyed', () => {
    const { events, loop } = mountScene()

    events.emit('destroy')

    const event = new KeyboardEvent('keydown', { code: 'ArrowLeft', bubbles: true, cancelable: true })

    document.dispatchEvent(event)

    expect(event.defaultPrevented, 'a destroyed scene must not claim the key').toBe(false)
    expect(loop.debugState().laneTransition, 'nor enqueue into a dead loop').toBeNull()
  })

  it('releases the resize and pointer handlers too', () => {
    const { events, input, scale } = mountScene()

    expect(scale.count('resize')).toBe(1)
    expect(input.count('pointerdown')).toBe(1)

    events.emit('destroy')

    expect(scale.count('resize')).toBe(0)
    expect(input.count('pointerdown')).toBe(0)
    expect(input.count('pointerup')).toBe(0)
    expect(input.count('pointerupoutside')).toBe(0)
  })
})

describe('the scene normalizes pointers honestly', () => {
  it('ignores a cancelled touch instead of committing the swipe', () => {
    // A system gesture — a notification shade, an incoming call — takes the
    // touch away. Committing the movement in progress is a lane change the
    // player never asked for, and at M6 it costs a heart.
    const { input, loop } = mountScene()

    input.emit('pointerdown', { id: 1, x: 300, y: 400, downTime: 0 })
    input.emit('pointerup', { id: 1, x: 200, y: 400, upTime: 100, wasCanceled: true })

    loop.frame(1000 / 120)

    expect(loop.debugState().laneTransition).toBeNull()
  })

  it('commits a real swipe', () => {
    const { input, loop } = mountScene()

    input.emit('pointerdown', { id: 1, x: 300, y: 400, downTime: 0 })
    input.emit('pointerup', { id: 1, x: 200, y: 400, upTime: 100, wasCanceled: false })

    loop.frame(1000 / 120)

    expect(loop.debugState().laneTransition?.to).toBe(0)
  })

  it('does not let a second finger hijack the first one\'s gesture', () => {
    /*
     * One tracker was shared by every pointer, so a second finger overwrote the
     * first one's start point. Lifting the *first* finger then resolved its
     * release against the *second* finger's origin — a swipe in whichever
     * direction the two fingers happened to be apart.
     */
    const { input, loop } = mountScene()

    input.emit('pointerdown', { id: 1, x: 300, y: 400, downTime: 0 })
    input.emit('pointerdown', { id: 2, x: 50, y: 400, downTime: 10 })
    input.emit('pointerup', { id: 1, x: 200, y: 400, upTime: 100, wasCanceled: false })

    loop.frame(1000 / 120)

    // The first finger swiped 100px left and that is what must register. With
    // one shared tracker the second finger's touchdown overwrote the start
    // point, and this release resolved against the wrong origin entirely.
    expect(loop.debugState().laneTransition?.to).toBe(0)
  })
})

describe('the scene does not steal keys it should not', () => {
  it('leaves a key alone while a text field has focus', () => {
    const { loop } = mountScene()

    const field = document.createElement('input')

    document.body.append(field)
    field.focus()

    const event = new KeyboardEvent('keydown', { code: 'ArrowLeft', bubbles: true, cancelable: true })

    document.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(loop.debugState().laneTransition).toBeNull()

    field.remove()
  })

  it('still pauses on Escape while a control has focus', () => {
    // The trap: gameplay keys are suppressed while a control has focus, the
    // pause button is a control, and the surface was not focusable. Tabbing to
    // pause left a keyboard player unable to move, jump *or* unpause.
    const { pauseRequests } = mountScene()

    const button = document.createElement('button')

    document.body.append(button)
    button.focus()

    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true, cancelable: true }))

    expect(pauseRequests, 'Escape must reach the run whatever has focus').toHaveLength(1)

    button.remove()
  })
})

describe('the scene palette is the token palette', () => {
  /*
   * Regression gate G12 forbids a raw hex colour outside the token module, and
   * `scene.ts` holds seven of them under a comment claiming they come from the
   * approved palette. A canvas cannot read a CSS custom property cheaply, so a
   * copy is the right implementation — but an unchecked copy is how a rebrand
   * ends up half-applied, with the DOM in the new colours and the game still in
   * the old ones. This is the check that was missing, not the copy.
   */
  it('matches every value in tokens.css', () => {
    // A path from the project root, not `import.meta.url`: this file runs in
    // happy-dom, where the module URL is not a `file:` URL.
    const tokens = readFileSync('app/assets/css/tokens.css', 'utf8')

    const declared = new Map<string, string>()

    for (const match of tokens.matchAll(/--color-([a-z-]+):\s*#([0-9a-fA-F]{6})\s*;/g)) {
      declared.set(match[2]!.toLowerCase(), `--color-${match[1]!}`)
    }

    const orphans = Object.entries(PALETTE)
      .map(([name, value]) => ({ name, hex: value.toString(16).padStart(6, '0') }))
      .filter(({ hex }) => !declared.has(hex))
      .map(({ name, hex }) => `${name}: #${hex} is in no token`)

    expect(orphans).toEqual([])
  })
})
