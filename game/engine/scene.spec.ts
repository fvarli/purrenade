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
import { createRunLoop, PLAYFIELD } from '../bridge'

/** A minimal event emitter, which is all the scene needs from Phaser's. */
/**
 * Phaser's emitter, including the part this fake used to leave out.
 *
 * `on(event, fn, context)` binds `context` as the handler's `this`, and the
 * scene relies on that for `handleResize`. The fake dropped the third argument,
 * so the resize path could never have been exercised here at all — it threw on
 * `this.scale` the moment a test tried.
 */
interface Handler { fn: (...args: unknown[]) => void, context?: unknown }

function emitter() {
  const handlers = new Map<string, Handler[]>()

  return {
    on(event: string, fn: (...args: unknown[]) => void, context?: unknown) {
      handlers.set(event, [...(handlers.get(event) ?? []), { fn, context }])
      return this
    },
    once(event: string, fn: (...args: unknown[]) => void, context?: unknown) {
      return this.on(event, fn, context)
    },
    off(event: string, fn: (...args: unknown[]) => void) {
      handlers.set(event, (handlers.get(event) ?? []).filter(h => h.fn !== fn))
      return this
    },
    emit(event: string, ...args: unknown[]) {
      for (const h of [...(handlers.get(event) ?? [])]) h.fn.call(h.context, ...args)
      return this
    },
    count(event: string) {
      return (handlers.get(event) ?? []).length
    },
  }
}

/**
 * A shape that remembers what was done to it.
 *
 * The original returned bare self-references, so even if `update()` had been
 * called nothing could be asserted — which is why the entire render path, the
 * pool, the depth order and the dimming went untested and four defects lived
 * there.
 */
interface FakeShape {
  kind: 'rect' | 'circle'
  radius: number
  x: number
  y: number
  width: number
  height: number
  depth: number
  alpha: number
  fill: number
  visible: boolean
  setPosition: (x: number, y: number) => FakeShape
  setSize: (w: number, h: number) => FakeShape
  setRadius: (r: number) => FakeShape
  setDepth: (d: number) => FakeShape
  setAlpha: (a: number) => FakeShape
  setFillStyle: (c: number) => FakeShape
  setVisible: (v: boolean) => FakeShape
}

function shape(kind: 'rect' | 'circle' = 'rect'): FakeShape {
  const self: FakeShape = {
    kind,
    x: 0, y: 0, width: 0, height: 0, radius: 0, depth: 0, alpha: 1, fill: 0, visible: true,
    setPosition: (x, y) => { self.x = x; self.y = y; return self },
    setSize: (w, h) => { self.width = w; self.height = h; return self },
    setRadius: (r) => { self.radius = r; return self },
    setDepth: (d) => { self.depth = d; return self },
    setAlpha: (a) => { self.alpha = a; return self },
    setFillStyle: (c) => { self.fill = c; return self },
    setVisible: (v) => { self.visible = v; return self },
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
  const made: FakeShape[] = []

  class Scene {
    events = events
    input = input
    scale = scale
    add = {
      rectangle: (..._args: unknown[]) => { const s = shape('rect'); made.push(s); return s },
      circle: (..._args: unknown[]) => { const s = shape('circle'); made.push(s); return s },
    }
  }

  return { phaser: { Scene } as never, events, input, scale, made }
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
  const { phaser, events, input, scale, made } = fakePhaser(size)
  const loop = createRunLoop({ seed: 1 })
  const pauseRequests: number[] = []

  const scene = createRunScene(phaser, {
    loop,
    onPauseRequested: () => pauseRequests.push(1),
  }) as unknown as { create: () => void }

  scene.create()

  const rendered = scene as unknown as { update: (t: number, d: number) => void }

  /*
   * The pooled obstacle rectangles, in creation order.
   *
   * Derived from the end of the display list rather than from a hardcoded
   * offset: the player circle is created last, and the pool is the run of
   * rectangles immediately before it. A count of backdrop shapes written down
   * here would go quietly wrong the first time the scene gains a shape.
   */
  /*
   * Selected by shape kind and construction order, not by counting back from
   * the end. M7 added two more pools and a two-part companion between the
   * obstacles and the player, and a positional slice silently started
   * returning paw tokens — every obstacle assertion then passed against the
   * wrong objects.
   */
  const rects = (): FakeShape[] => made.filter(s => s.kind === 'rect')
  const circles = (): FakeShape[] => made.filter(s => s.kind === 'circle')

  /** sky, sea, sand, road and two lane lines come first; the pool follows. */
  const pool = (): FakeShape[] => rects().slice(BACKDROP_RECTS, BACKDROP_RECTS + POOL_SIZE)
  const paws = (): FakeShape[] => circles().slice(0, PAW_POOL_SIZE)
  const loli = (): { body: FakeShape, mark: FakeShape } => ({
    body: circles()[PAW_POOL_SIZE]!,
    mark: circles()[PAW_POOL_SIZE + 1]!,
  })

  return {
    events, input, scale, loop, pauseRequests, made,
    pool, paws, loli, rects, circles,
    frame: (ms: number) => rendered.update(0, ms),
  }
}

/** `OBSTACLE_POOL_SIZE` in scene.ts. */
const POOL_SIZE = 48
/** `PAW_POOL_SIZE` in scene.ts. */
const PAW_POOL_SIZE = 48
/** sky, sea, sand, road, and two lane lines. */
const BACKDROP_RECTS = 6

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

describe('the scene draws the world it is given', () => {
  /*
   * A step at which the road is carrying two obstacles at once, one of each
   * class, with the run still live.
   *
   * Chosen by measurement, not by guesswork. The first version of these tests
   * sampled a step with a single obstacle on screen, so the loop comparing one
   * obstacle against the next never executed and the test passed against a
   * deliberately broken painter's order. Every test below asserts that it found
   * what it came for before it asserts anything about it.
   */
  const TWO_OBSTACLES_STEP = 1660

  /** A step at which one obstacle has gone by but has not yet despawned. */
  const PASSED_OBSTACLE_STEP = 760

  function atTwoObstacles() {
    const scene = mountScene()

    for (let i = 0; i < TWO_OBSTACLES_STEP; i++) scene.frame(1000 / 120)

    const snapshot = scene.loop.snapshot()
    const shapes = scene.pool()
    const drawn = snapshot.obstacles.map((obstacle, index) => ({ obstacle, shape: shapes[index]! }))

    expect(snapshot.phase, 'the sample must be taken from a live run').toBe('running')
    expect(drawn.filter(d => d.shape.visible).length, 'the sample must show two obstacles').toBe(2)

    return { scene, snapshot, shapes, drawn, visible: drawn.filter(d => d.shape.visible) }
  }

  it('gives every on-road obstacle a shape and hides the rest of the pool', () => {
    const { snapshot, shapes, drawn } = atTwoObstacles()

    for (const { obstacle, shape } of drawn) {
      const onRoad = obstacle.distanceUnits <= PLAYFIELD.visibleUnits
        && obstacle.distanceUnits + obstacle.lengthUnits > 0

      expect(shape.visible, `obstacle at ${obstacle.distanceUnits} units`).toBe(onRoad)
    }

    const unused = shapes.slice(snapshot.obstacles.length)

    expect(unused.length).toBeGreaterThan(0)
    expect(unused.every(s => !s.visible), 'an unused pool slot must not linger on screen').toBe(true)
  })

  it('hides an obstacle the player has already passed', () => {
    /*
     * The far edge was checked and the near one was not, so an obstacle that
     * had gone by kept full size and slid down past the player's feet until the
     * domain despawned it. There is a real window for this: the domain keeps a
     * passed obstacle until it is `world.despawnBehindUnits` behind.
     */
    const scene = mountScene()

    for (let i = 0; i < PASSED_OBSTACLE_STEP; i++) scene.frame(1000 / 120)

    const snapshot = scene.loop.snapshot()
    const shapes = scene.pool()
    const passed = snapshot.obstacles
      .map((obstacle, index) => ({ obstacle, shape: shapes[index]! }))
      .filter(d => d.obstacle.distanceUnits + d.obstacle.lengthUnits <= 0)

    expect(snapshot.phase).toBe('running')
    expect(passed.length, 'the sample must contain a passed obstacle').toBe(1)
    expect(passed[0]!.shape.visible, 'a passed obstacle must leave the screen').toBe(false)
  })

  it('draws nearer obstacles on top of further ones', () => {
    /*
     * Every shape shared one depth, so Phaser fell back to display-list order —
     * pool index, which is nearest first — and painted the nearest obstacle
     * underneath the one behind it.
     */
    const { visible } = atTwoObstacles()

    const sorted = [...visible].sort((a, b) => a.obstacle.distanceUnits - b.obstacle.distanceUnits)
    const nearer = sorted[0]!
    const further = sorted[1]!

    expect(nearer.obstacle.distanceUnits, 'the two must be at different distances')
      .toBeLessThan(further.obstacle.distanceUnits)
    expect(nearer.shape.depth, 'the nearer obstacle must draw on top')
      .toBeGreaterThan(further.shape.depth)
  })

  it('distinguishes the two obstacle classes by colour', () => {
    const { visible } = atTwoObstacles()

    const cones = visible.filter(d => d.obstacle.kind === 'lane_blocking')
    const barriers = visible.filter(d => d.obstacle.kind !== 'lane_blocking')

    expect(cones.length, 'the sample must contain a lane blocker').toBe(1)
    expect(barriers.length, 'and something jumpable').toBe(1)
    expect(PALETTE.cone).not.toBe(PALETTE.barrier)

    expect(cones[0]!.shape.fill).toBe(PALETTE.cone)
    expect(barriers[0]!.shape.fill).toBe(PALETTE.barrier)
  })

  it('dims the hazards along with the road when the run is not live', () => {
    const { scene, visible } = atTwoObstacles()

    expect(visible.every(d => d.shape.alpha === 1)).toBe(true)

    scene.loop.pause()
    scene.frame(1000 / 120)

    expect(scene.loop.snapshot().phase).toBe('paused')
    expect(
      visible.every(d => d.shape.alpha < 1),
      'a paused world must not sit bright on a dimmed road',
    ).toBe(true)
  })

  it('stands every obstacle on the road inside the play column', () => {
    const { visible } = atTwoObstacles()

    for (const { shape } of visible) {
      expect(shape.x).toBeGreaterThan(0)
      expect(shape.x).toBeLessThan(390)
      expect(shape.width).toBeGreaterThan(0)
      expect(shape.height).toBeGreaterThan(0)
    }
  })

  it('re-places the hazards when the viewport changes', () => {
    const { scene, visible } = atTwoObstacles()
    const before = visible.map(d => d.shape.x)

    Object.assign(scene.scale, { width: 800, height: 600 })
    scene.scale.emit('resize')

    const after = visible.map(d => d.shape.x)

    // A wider viewport centres a capped play column, so the road moves right
    // and every hazard standing on it moves with it.
    for (let i = 0; i < after.length; i++) expect(after[i]).toBeGreaterThan(before[i]!)
  })

  it('refuses to run out of pool rather than dropping a hazard on the floor', () => {
    /*
     * An obstacle without a shape is an invisible hazard that still costs a
     * heart. The pool cannot overflow from real generation, so this drives the
     * guard directly — it used to be a silent `return`.
     */
    const scene = mountScene()

    for (let i = 0; i < TWO_OBSTACLES_STEP; i++) scene.frame(1000 / 120)

    const snapshot = scene.loop.snapshot()
    const overfull = {
      ...snapshot,
      obstacles: Array.from({ length: POOL_SIZE + 1 }, () => snapshot.obstacles[0]!),
    }

    vi.spyOn(scene.loop, 'snapshot').mockReturnValue(overfull)

    expect(() => scene.frame(1000 / 120)).toThrow(/exceed the pool/)
  })
})

describe('the scene draws the M7 layer', () => {
  const TWO_OBSTACLES_STEP = 1660

  /** A live snapshot with M7 fields the test can override. */
  function stagedSnapshot(scene: ReturnType<typeof mountScene>, over: Record<string, unknown>) {
    const base = scene.loop.snapshot()

    return { ...base, ...over }
  }

  function atRunning() {
    const scene = mountScene()

    for (let i = 0; i < TWO_OBSTACLES_STEP; i++) scene.frame(1000 / 120)

    return scene
  }

  it('draws a Paw Token where the domain says it is', () => {
    const scene = atRunning()

    vi.spyOn(scene.loop, 'snapshot').mockReturnValue(stagedSnapshot(scene, {
      pawTokens: [{ id: 1, laneOffset: 0, distanceUnits: 3 }],
    }) as never)

    scene.frame(1000 / 120)

    const [token] = scene.paws()

    expect(token!.visible).toBe(true)
    expect(token!.radius).toBeGreaterThan(0)
    // Lane 0 sits left of centre; the token follows its own offset, not a lane.
    expect(token!.x).toBeLessThan(390 / 2)
  })

  it('follows a magnetised token between lanes', () => {
    const scene = atRunning()
    const positions: number[] = []

    for (const laneOffset of [0, 0.5, 1]) {
      vi.spyOn(scene.loop, 'snapshot').mockReturnValue(stagedSnapshot(scene, {
        pawTokens: [{ id: 1, laneOffset, distanceUnits: 3 }],
      }) as never)

      scene.frame(1000 / 120)
      positions.push(scene.paws()[0]!.x)
    }

    // Strictly increasing: a fractional offset is a real position, not rounded
    // to the nearest lane.
    expect(positions[0]).toBeLessThan(positions[1]!)
    expect(positions[1]).toBeLessThan(positions[2]!)
  })

  it('hides the pool slots no token is using', () => {
    const scene = atRunning()

    vi.spyOn(scene.loop, 'snapshot').mockReturnValue(stagedSnapshot(scene, {
      pawTokens: [{ id: 1, laneOffset: 1, distanceUnits: 3 }],
    }) as never)

    scene.frame(1000 / 120)

    expect(scene.paws().filter(s => s.visible)).toHaveLength(1)
  })

  it('refuses to run out of paw pool rather than dropping a token', () => {
    const scene = atRunning()

    vi.spyOn(scene.loop, 'snapshot').mockReturnValue(stagedSnapshot(scene, {
      pawTokens: Array.from({ length: PAW_POOL_SIZE + 1 }, (_, i) => ({
        id: i, laneOffset: 1, distanceUnits: 3,
      })),
    }) as never)

    expect(() => scene.frame(1000 / 120)).toThrow(/paw tokens exceed the pool/)
  })

  it('draws tokens below the obstacles, so a reward never hides a hazard', () => {
    const scene = atRunning()

    vi.spyOn(scene.loop, 'snapshot').mockReturnValue(stagedSnapshot(scene, {
      pawTokens: [{ id: 1, laneOffset: 1, distanceUnits: 3 }],
    }) as never)

    scene.frame(1000 / 120)

    const token = scene.paws()[0]!
    const hazards = scene.pool().filter(s => s.visible)

    expect(hazards.length).toBeGreaterThan(0)

    for (const hazard of hazards) {
      expect(token.depth, 'a token must never paint over an obstacle').toBeLessThan(hazard.depth)
    }
  })
})

describe('SLAYYY beautifies without touching the geometry', () => {
  function frameWith(slayyyActive: boolean) {
    const scene = mountScene()

    for (let i = 0; i < 1660; i++) scene.frame(1000 / 120)

    const base = scene.loop.snapshot()

    vi.spyOn(scene.loop, 'snapshot').mockReturnValue({
      ...base,
      slayyy: { phase: slayyyActive ? 'active' : 'charging', charge: 0, activeRemainingMs: slayyyActive ? 5000 : 0 },
    } as never)

    scene.frame(1000 / 120)

    return scene.pool().filter(s => s.visible).map(s => ({
      x: s.x, y: s.y, width: s.width, height: s.height, depth: s.depth, fill: s.fill,
    }))
  }

  it('changes the colour of every hazard', () => {
    const plain = frameWith(false)
    const pretty = frameWith(true)

    expect(plain.length).toBeGreaterThan(0)
    expect(pretty).toHaveLength(plain.length)

    for (let i = 0; i < plain.length; i++) {
      expect(pretty[i]!.fill, 'the world should visibly transform').not.toBe(plain[i]!.fill)
    }
  })

  it('changes nothing else about them', () => {
    /*
     * The invariant the whole feature rests on. A cone that becomes a flower is
     * still `LANE_BLOCKING` with the same footprint — if beautification ever
     * moved or resized a hazard, the picture and the collision rules would
     * disagree and the player would be hit by something that was not there.
     */
    const plain = frameWith(false)
    const pretty = frameWith(true)

    for (let i = 0; i < plain.length; i++) {
      const { fill: _plainFill, ...plainGeometry } = plain[i]!
      const { fill: _prettyFill, ...prettyGeometry } = pretty[i]!

      expect(prettyGeometry).toEqual(plainGeometry)
    }
  })
})

describe('the Loli companion', () => {
  function sceneWithLoli(phase: string, phaseProgress = 1) {
    const scene = mountScene()

    for (let i = 0; i < 1660; i++) scene.frame(1000 / 120)

    const base = scene.loop.snapshot()

    vi.spyOn(scene.loop, 'snapshot').mockReturnValue({
      ...base,
      loli: { phase, phaseProgress, queuedLoliBonuses: 0 },
    } as never)

    scene.frame(1000 / 120)

    return scene
  }

  it('is absent until a bonus starts', () => {
    const { body, mark } = sceneWithLoli('inactive').loli()

    expect(body.visible).toBe(false)
    expect(mark.visible).toBe(false)
  })

  it('appears for the whole lifecycle', () => {
    for (const phase of ['entering', 'active', 'exiting']) {
      expect(sceneWithLoli(phase).loli().body.visible, phase).toBe(true)
    }
  })

  it('grows in and shrinks out rather than popping', () => {
    const entering = sceneWithLoli('entering', 0.2).loli().body.radius
    const settled = sceneWithLoli('active', 0.5).loli().body.radius
    const leaving = sceneWithLoli('exiting', 0.8).loli().body.radius

    expect(entering).toBeLessThan(settled)
    expect(leaving).toBeLessThan(settled)
  })

  it('appears at full size when the player asked for less motion', () => {
    /*
     * `accessibility.md` §2.2: a UI transition becomes instant rather than a
     * scale. The companion still appears — that is the information — it just
     * does not pop.
     */
    const reduced = { matches: true, addEventListener: () => {}, removeEventListener: () => {} }

    vi.stubGlobal('matchMedia', () => reduced)

    try {
      const entering = sceneWithLoli('entering', 0.2).loli().body.radius
      const settled = sceneWithLoli('active', 0.5).loli().body.radius
      const leaving = sceneWithLoli('exiting', 0.8).loli().body.radius

      expect(entering).toBe(settled)
      expect(leaving).toBe(settled)
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('stands beside the player, never on top of them', () => {
    const scene = sceneWithLoli('active')
    const { body } = scene.loli()
    const snapshot = scene.loop.snapshot()

    expect(body.x).not.toBe(snapshot.lanePosition)
    // Below the player's depth, so it can never mask the character.
    expect(body.depth).toBeLessThan(10)
  })
})
