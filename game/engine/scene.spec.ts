// @vitest-environment happy-dom
//
// The scene's lifecycle and its rendering, driven by a fake Phaser.
//
// `createRunScene` takes the Phaser namespace as a parameter, which means the
// half of the engine that actually leaks — listener registration and teardown —
// can be exercised in Node with no WebGL, no browser and no account. That
// matters: the browser suite that would otherwise cover this is gated behind
// credentials and is not a CI gate, so before this file the single most
// damaging defect in the milestone had no automated protection at all.
//
// Nothing here asserts that the promenade is *pretty*. It asserts the things a
// screenshot cannot: that a hazard is never invisible, that a pool never
// overflows silently, that SLAYYY cannot move a cone, that reduced motion
// actually stops the decoration, and that the runtime never reaches into
// `design-reference/`. Visual review is a separate, human gate.

import { describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PALETTE, RUN_ASSETS, createRunScene } from './scene'
import { OBSTACLE_POOL_SIZE, PAW_POOL_SIZE } from './actors'
import { textureKey } from './assets'
import { createRunLoop, PLAYFIELD } from '../bridge'

/**
 * Phaser's emitter, including the part a smaller fake left out.
 *
 * `on(event, fn, context)` binds `context` as the handler's `this`, and the
 * scene relies on that for `handleResize`. A fake that dropped the third
 * argument could never have exercised the resize path at all — it threw on
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
 * A display object that remembers what was done to it.
 *
 * `width`/`height` are the *source* dimensions, as they are in Phaser, and
 * `displayWidth`/`displayHeight` are what a `setDisplaySize` asked for. The
 * distinction is load-bearing: `actors.ts` divides one by the other to keep an
 * illustration's aspect ratio, and a fake that let `setDisplaySize` overwrite
 * the source size would make every sprite converge on a square after a frame.
 */
interface FakeShape {
  kind: 'rect' | 'circle' | 'image' | 'tile'
  /** The texture it was created with. Stable, so a pool can be selected by it. */
  origin: string
  texture: string
  radius: number
  x: number
  y: number
  width: number
  height: number
  displayWidth: number
  displayHeight: number
  depth: number
  alpha: number
  fill: number
  tint: number
  rotation: number
  tilePosition: number
  visible: boolean
  setPosition: (x: number, y: number) => FakeShape
  setSize: (w: number, h: number) => FakeShape
  setRadius: (r: number) => FakeShape
  setDepth: (d: number) => FakeShape
  setAlpha: (a: number) => FakeShape
  setFillStyle: (c: number) => FakeShape
  setVisible: (v: boolean) => FakeShape
  setOrigin: (x: number, y?: number) => FakeShape
  setDisplaySize: (w: number, h: number) => FakeShape
  setScale: (x: number, y?: number) => FakeShape
  setTexture: (key: string) => FakeShape
  setTint: (colour: number) => FakeShape
  setRotation: (r: number) => FakeShape
  setTilePosition: (x: number) => FakeShape
  setTileScale: (s: number) => FakeShape
}

/** Source dimensions for every fake texture: non-square, so aspect bugs show. */
const SOURCE_WIDTH = 120
const SOURCE_HEIGHT = 200

function shape(kind: FakeShape['kind'], texture = ''): FakeShape {
  const self: FakeShape = {
    kind,
    origin: texture,
    texture,
    x: 0, y: 0,
    width: SOURCE_WIDTH, height: SOURCE_HEIGHT,
    displayWidth: 0, displayHeight: 0,
    radius: 0, depth: 0, alpha: 1, fill: 0, tint: 0xFFFFFF,
    rotation: 0, tilePosition: 0, visible: true,
    setPosition: (x, y) => { self.x = x; self.y = y; return self },
    setSize: (w, h) => { self.width = w; self.height = h; return self },
    setRadius: (r) => { self.radius = r; return self },
    setDepth: (d) => { self.depth = d; return self },
    setAlpha: (a) => { self.alpha = a; return self },
    setFillStyle: (c) => { self.fill = c; return self },
    setVisible: (v) => { self.visible = v; return self },
    setOrigin: () => self,
    setDisplaySize: (w, h) => { self.displayWidth = w; self.displayHeight = h; return self },
    setScale: () => self,
    setTexture: (key) => { self.texture = key; return self },
    setTint: (colour) => { self.tint = colour; return self },
    setRotation: (r) => { self.rotation = r; return self },
    setTilePosition: (x) => { self.tilePosition = x; return self },
    setTileScale: () => self,
  }

  if (kind === 'rect' || kind === 'circle') {
    self.width = 0
    self.height = 0
  }

  return self
}

interface FakeGraphics {
  kind: 'graphics'
  depth: number
  /** How many fills the last `clear()`-to-`clear()` pass issued. */
  fills: number
  passes: number
  setDepth: (d: number) => FakeGraphics
  setAlpha: () => FakeGraphics
  clear: () => FakeGraphics
  fillStyle: () => FakeGraphics
  fillRect: () => FakeGraphics
  fillTriangle: () => FakeGraphics
}

function graphics(): FakeGraphics {
  let pending = 0

  const self: FakeGraphics = {
    kind: 'graphics',
    depth: 0,
    fills: 0,
    passes: 0,
    setDepth: (d) => { self.depth = d; return self },
    setAlpha: () => self,
    clear: () => { self.fills = pending; pending = 0; self.passes++; return self },
    fillStyle: () => self,
    fillRect: () => { pending++; return self },
    fillTriangle: () => { pending++; return self },
  }

  return self
}

/**
 * Enough of Phaser to construct and drive the scene.
 *
 * Deliberately not a mock of the renderer: nothing here draws. What it models
 * is the part the scene depends on — the scale manager, the scene event
 * emitter, the input plugin, the texture manager and the display list.
 */
function fakePhaser(
  size = { width: 390, height: 844 },
  { texturesLoad = true } = {},
) {
  const events = emitter()
  const input = emitter()
  const scale = Object.assign(emitter(), size)
  const made: FakeShape[] = []
  const drawn: FakeGraphics[] = []
  const loaded: string[] = []

  const sourceImage = texturesLoad
    ? { width: SOURCE_WIDTH, height: SOURCE_HEIGHT }
    // Phaser's own `__MISSING` placeholder is 32x32 and `exists()` answers
    // `true` for it, which is why a size check is the only honest test.
    : { width: 32, height: 32 }

  class Scene {
    events = events
    input = input
    scale = scale
    load = { image: (key: string, path: string) => loaded.push(`${key} ${path}`) }
    textures = {
      exists: () => true,
      get: () => ({ getSourceImage: () => sourceImage }),
    }

    add = {
      rectangle: (..._args: unknown[]) => { const s = shape('rect'); made.push(s); return s },
      circle: (..._args: unknown[]) => { const s = shape('circle'); made.push(s); return s },
      image: (_x: number, _y: number, key: string) => {
        const s = shape('image', key)
        made.push(s)
        return s
      },
      tileSprite: (_x: number, _y: number, _w: number, _h: number, key: string) => {
        const s = shape('tile', key)
        Object.assign(s, { texture: { getSourceImage: () => sourceImage } })
        made.push(s)
        return s
      },
      graphics: () => { const g = graphics(); drawn.push(g); return g },
    }
  }

  return { phaser: { Scene } as never, events, input, scale, made, drawn, loaded }
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

interface MountOptions {
  readonly size?: { width: number, height: number }
  readonly texturesLoad?: boolean
}

function mountScene({ size, texturesLoad = true }: MountOptions = {}) {
  const { phaser, events, input, scale, made, drawn, loaded } = fakePhaser(size, { texturesLoad })
  const loop = createRunLoop({ seed: 1 })
  const pauseRequests: number[] = []

  const scene = createRunScene(phaser, {
    loop,
    onPauseRequested: () => pauseRequests.push(1),
  }) as unknown as { preload: () => void, create: () => void }

  scene.preload()
  scene.create()

  const rendered = scene as unknown as { update: (t: number, d: number) => void }

  /*
   * Pools are selected by the texture they were *created* with, not by an
   * index into the display list.
   *
   * Every previous version of this file counted objects — "circles 62 to 67 are
   * the sparkles" — and every time the scene gained a shape those slices
   * silently started addressing something else, so assertions passed against
   * the wrong objects. A name cannot drift that way.
   */
  const withOrigin = (key: string): FakeShape[] =>
    made.filter(s => s.origin === textureKey(key as never))

  const rects = (): FakeShape[] => made.filter(s => s.kind === 'rect')
  const circles = (): FakeShape[] => made.filter(s => s.kind === 'circle')

  return {
    events, input, scale, loop, pauseRequests, made, drawn, loaded,
    rects, circles,
    /** The obstacle pool: created on the cone texture, retextured per frame. */
    pool: () => (texturesLoad ? withOrigin('cone') : rects().slice(1)),
    /*
     * The obstacle pool's shadows are the *last* run of shadow images.
     *
     * This was `.slice(2)`, which assumed only the player's and Loli's shadows
     * were built before them. The promenade is created before the cast, so the
     * moment its dressing gained contact shadows that slice silently started
     * addressing scenery and every assertion below passed against the wrong
     * objects. Counting back from the end cannot drift that way.
     */
    obstacleShadows: () => withOrigin('shadow').slice(-OBSTACLE_POOL_SIZE),
    dressingShadows: () => withOrigin('shadow').slice(0, -OBSTACLE_POOL_SIZE - 2),
    paws: () => (texturesLoad ? withOrigin('paw') : circles().slice(2)),
    player: () => withOrigin('aysenurRun')[0]!,
    /** The character's own shadow: the first one the cast builds. */
    playerShadow: () => withOrigin('shadow').slice(-OBSTACLE_POOL_SIZE - 2)[0]!,
    playerCircle: () => circles()[0]!,
    loli: () => withOrigin('loli')[0]!,
    effects: () => [...withOrigin('petal'), ...withOrigin('sparkle')],
    dressing: () => [
      ...withOrigin('palm'), ...withOrigin('lamp'),
      ...withOrigin('bench'), ...withOrigin('flowerpot'),
    ],
    seafront: () => made.find(s => s.kind === 'tile'),
    ground: () => drawn[0]!,
    frame: (ms: number) => rendered.update(0, ms),
  }
}

describe('the scene releases everything it took', () => {
  it('removes its document keydown listener when Phaser destroys the scene', () => {
    trackDocumentListeners()

    const { events } = mountScene()

    expect(keydownListenerCount()).toBe(1)

    // `game.destroy(true)` emits `destroy`, never `shutdown`. Registering on
    // `shutdown` alone meant the teardown never ran on the route's own path.
    events.emit('destroy')

    expect(keydownListenerCount()).toBe(0)

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

    for (let i = 0; i < 5; i++) {
      const { events } = mountScene()

      events.emit('destroy')
    }

    expect(keydownListenerCount()).toBe(0)

    vi.restoreAllMocks()
  })

  it('stops acting on keys once destroyed', () => {
    const { events, loop } = mountScene()

    events.emit('destroy')

    const before = loop.snapshot().lanePosition

    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft', bubbles: true }))

    expect(loop.snapshot().lanePosition).toBe(before)
  })

  it('releases the resize and pointer handlers too', () => {
    const { events, scale, input } = mountScene()

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
    /*
     * Phaser routes `touchcancel` through `pointerup` and says so with
     * `wasCanceled`. Committing the half-finished movement is a lane change the
     * player never asked for, and it costs a heart.
     */
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
     * One tracker shared by every pointer let a second finger overwrite the
     * first one's start point, so lifting the first resolved against the
     * second's origin — a swipe in whichever direction they happened to be
     * apart.
     */
    const { input, loop } = mountScene()

    input.emit('pointerdown', { id: 1, x: 300, y: 400, downTime: 0 })
    input.emit('pointerdown', { id: 2, x: 50, y: 400, downTime: 10 })
    input.emit('pointerup', { id: 1, x: 200, y: 400, upTime: 100, wasCanceled: false })

    loop.frame(1000 / 120)

    expect(loop.debugState().laneTransition?.to).toBe(0)
  })
})

describe('the scene does not steal keys it should not', () => {
  it('leaves a key alone while a text field has focus', () => {
    const { loop } = mountScene()

    const field = document.createElement('input')

    document.body.append(field)
    field.focus()

    const before = loop.snapshot().lanePosition

    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft', bubbles: true }))
    loop.frame(1000 / 120)

    expect(loop.snapshot().lanePosition).toBe(before)

    field.remove()
  })

  it('still pauses on Escape while a control has focus', () => {
    /*
     * The exemption that keeps the pause trap closed: a player who has tapped
     * the on-screen pause button must still be able to press Escape.
     */
    const { pauseRequests } = mountScene()

    const button = document.createElement('button')

    document.body.append(button)
    button.focus()

    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }))

    expect(pauseRequests).toHaveLength(1)

    button.remove()
  })
})

describe('the scene palette is the token palette', () => {
  /*
   * Regression gate G12 forbids a raw hex colour outside the token module, and
   * `palette.ts` holds a copy of several of them. A canvas cannot read a CSS
   * custom property cheaply, so a copy is the right implementation — but an
   * unchecked copy is how a rebrand ends up half-applied, with the DOM in the
   * new colours and the game still in the old ones. This is the check that was
   * missing, not the copy.
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

describe('runtime presentation boundaries', () => {
  it('ships every texture it asks Phaser to load, as a real PNG', () => {
    for (const path of Object.values(RUN_ASSETS)) {
      expect(path.startsWith('/game/')).toBe(true)
      expect(path.endsWith('.png')).toBe(true)
      expect(existsSync(`public${path}`), `${path} must ship with the run`).toBe(true)

      const file = readFileSync(`public${path}`)

      expect(file.subarray(0, 8), `${path} must be a PNG`).toEqual(
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
      )

      // Colour type 6 — truecolour with alpha — at byte 25 of the IHDR. The
      // whole point of the PNG pipeline is that these stay transparent; an
      // opaque sprite would draw a cream box over the promenade.
      expect(file[25], `${path} must keep its alpha channel`).toBe(6)
    }
  })

  it('asks Phaser for exactly the textures the manifest declares', () => {
    const { loaded } = mountScene()

    expect(loaded).toHaveLength(Object.keys(RUN_ASSETS).length)

    for (const [key, path] of Object.entries(RUN_ASSETS)) {
      expect(loaded).toContain(`${textureKey(key as never)} ${path}`)
    }
  })

  it('keeps runtime application and engine source independent of design masters', () => {
    const runtimeFiles = (root: string): string[] => readdirSync(root, { withFileTypes: true })
      .flatMap((entry) => {
        const path = join(root, entry.name)

        if (entry.isDirectory()) return runtimeFiles(path)

        return /\.(?:ts|vue)$/.test(entry.name) && !/\.(?:spec|test)\.ts$/.test(entry.name)
          ? [path]
          : []
      })

    const offenders = ['app', 'game']
      .flatMap(runtimeFiles)
      // Inside a string literal, not anywhere in the file: naming the
      // reference directory in a comment is how the rule gets explained, and
      // putting it in a path is how the rule gets broken.
      .filter(path => /['"`][^'"`\n]*design-reference/.test(readFileSync(path, 'utf8')))

    expect(offenders).toEqual([])
  })
})

/** Scenery must stay below the Paw Tokens, which `actors.ts` puts at 8. */
const PAW_DEPTH_FLOOR = 8

/** A step at which the road is carrying two obstacles at once, one of each class. */
const TWO_OBSTACLES_STEP = 1660

/** A step at which one obstacle has gone by but has not yet despawned. */
const PASSED_OBSTACLE_STEP = 760

function atRunning(options: MountOptions = {}) {
  const scene = mountScene(options)

  for (let i = 0; i < TWO_OBSTACLES_STEP; i++) scene.frame(1000 / 120)

  return scene
}

/** A live snapshot with fields the test can override. */
function staged(scene: ReturnType<typeof mountScene>, over: Record<string, unknown>) {
  return { ...scene.loop.snapshot(), ...over }
}

describe('the scene draws the world it is given', () => {
  /*
   * Every test below asserts that it found what it came for before it asserts
   * anything about it. The first version of these sampled a step with a single
   * obstacle on screen, so the loop comparing one obstacle against the next
   * never executed and the test passed against a deliberately broken order.
   */
  function atTwoObstacles() {
    const scene = atRunning()
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
    const { visible } = atTwoObstacles()

    const sorted = [...visible].sort((a, b) => a.obstacle.distanceUnits - b.obstacle.distanceUnits)
    const nearer = sorted[0]!
    const further = sorted[1]!

    expect(nearer.obstacle.distanceUnits, 'the two must be at different distances')
      .toBeLessThan(further.obstacle.distanceUnits)
    expect(nearer.shape.depth, 'the nearer obstacle must draw on top')
      .toBeGreaterThan(further.shape.depth)
  })

  it('distinguishes the two obstacle classes by their own artwork', () => {
    const { visible } = atTwoObstacles()

    const cones = visible.filter(d => d.obstacle.kind === 'lane_blocking')
    const barriers = visible.filter(d => d.obstacle.kind !== 'lane_blocking')

    expect(cones.length, 'the sample must contain a lane blocker').toBe(1)
    expect(barriers.length, 'and something jumpable').toBe(1)

    expect(cones[0]!.shape.texture).toBe(textureKey('cone'))
    expect(barriers[0]!.shape.texture).toBe(textureKey('barrier'))
  })

  it('draws a lane blocker taller than something jumpable, at the same distance', () => {
    /*
     * The readability rule, and the review's "cones are tiny": the class a
     * player has to react to is carried by silhouette before it is carried by
     * anything else. A cone reaches above the knee and a barrier sits below it,
     * and both are measured against the character rather than against the
     * screen, so the relationship holds at every viewport.
     */
    const scene = atRunning()

    vi.spyOn(scene.loop, 'snapshot').mockReturnValue(staged(scene, {
      obstacles: [
        { id: 1, kind: 'lane_blocking', lane: 0, distanceUnits: 3, lengthUnits: 0.7 },
        { id: 2, kind: 'jumpable', lane: 2, distanceUnits: 3, lengthUnits: 0.7 },
      ],
    }) as never)

    scene.frame(1000 / 120)

    const [cone, barrier] = scene.pool()

    expect(cone!.displayHeight).toBeGreaterThan(barrier!.displayHeight * 1.4)
    expect(barrier!.displayWidth).toBeGreaterThan(cone!.displayWidth)
  })

  it('leaves the character well short of the road ahead', () => {
    /*
     * Half of the failure the reconstruction was commissioned for: a character
     * taller than a third of the screen hides the road she is running into, and
     * one much shorter than an eighth of it stops being the protagonist.
     */
    const player = atRunning({ size: { width: 430, height: 932 } }).player()

    expect(player.displayHeight).toBeLessThan(932 * 0.3)
    expect(player.displayHeight).toBeGreaterThan(932 * 0.12)
  })

  it('keeps the shipped character inside one lane at the mobile baseline', () => {
    /*
     * The other half, and it cannot be asserted against the fake: the width
     * comes from the illustration's own aspect ratio, so this measures the file
     * that actually ships. A character wider than her lane hides the lanes
     * beside her, which is what the last review saw.
     */
    const png = readFileSync(`public${RUN_ASSETS.aysenurRun}`)
    const width = png.readUInt32BE(16)
    const height = png.readUInt32BE(20)

    const viewport = { width: 430, height: 932 }
    const lanePitch = viewport.width * PLAYFIELD.roadWidthRatio / PLAYFIELD.laneCount
    const drawnHeight = atRunning({ size: viewport }).player().displayHeight

    expect(drawnHeight * (width / height)).toBeLessThan(lanePitch)
  })

  it('stands every obstacle on the road inside the play column', () => {
    const { visible } = atTwoObstacles()

    for (const { shape } of visible) {
      expect(shape.x).toBeGreaterThan(0)
      expect(shape.x).toBeLessThan(390)
      expect(shape.displayWidth).toBeGreaterThan(0)
      expect(shape.displayHeight).toBeGreaterThan(0)
    }
  })

  it('converges the lanes, so a far obstacle sits nearer the middle than a close one', () => {
    const scene = atRunning()

    vi.spyOn(scene.loop, 'snapshot').mockReturnValue(staged(scene, {
      obstacles: [
        { id: 1, kind: 'lane_blocking', lane: 0, distanceUnits: 0.5, lengthUnits: 0.7 },
        { id: 2, kind: 'lane_blocking', lane: 0, distanceUnits: 9, lengthUnits: 0.7 },
      ],
    }) as never)

    scene.frame(1000 / 120)

    const [near, far] = scene.pool()

    expect(near!.x).toBeLessThan(far!.x)
    expect(far!.y).toBeLessThan(near!.y)
    expect(far!.displayHeight).toBeLessThan(near!.displayHeight)
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
    const scene = atRunning()
    const snapshot = scene.loop.snapshot()

    vi.spyOn(scene.loop, 'snapshot').mockReturnValue({
      ...snapshot,
      obstacles: Array.from({ length: OBSTACLE_POOL_SIZE + 1 }, () => snapshot.obstacles[0]!),
    })

    expect(() => scene.frame(1000 / 120)).toThrow(/exceed the pool/)
  })
})

describe('the scene draws the M7 layer', () => {
  it('draws a Paw Token where the domain says it is', () => {
    const scene = atRunning()

    vi.spyOn(scene.loop, 'snapshot').mockReturnValue(staged(scene, {
      pawTokens: [{ id: 1, laneOffset: 0, distanceUnits: 3 }],
    }) as never)

    scene.frame(1000 / 120)

    const [token] = scene.paws()

    expect(token!.visible).toBe(true)
    expect(token!.displayWidth).toBeGreaterThan(0)
    // Lane 0 sits left of centre; the token follows its own offset, not a lane.
    expect(token!.x).toBeLessThan(390 / 2)
  })

  it('follows a magnetised token between lanes', () => {
    const scene = atRunning()
    const positions: number[] = []

    for (const laneOffset of [0, 0.5, 1]) {
      vi.spyOn(scene.loop, 'snapshot').mockReturnValue(staged(scene, {
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

    vi.spyOn(scene.loop, 'snapshot').mockReturnValue(staged(scene, {
      pawTokens: [{ id: 1, laneOffset: 1, distanceUnits: 3 }],
    }) as never)

    scene.frame(1000 / 120)

    expect(scene.paws().filter(s => s.visible)).toHaveLength(1)
  })

  it('recycles an obstacle and its contact shadow together', () => {
    const scene = atRunning()

    vi.spyOn(scene.loop, 'snapshot').mockReturnValue(staged(scene, {
      obstacles: [{ id: 1, kind: 'lane_blocking', lane: 1, distanceUnits: 3, lengthUnits: 1 }],
    }) as never)
    scene.frame(1000 / 120)

    expect(scene.pool()[0]!.visible).toBe(true)
    expect(scene.obstacleShadows()[0]!.visible).toBe(true)

    vi.spyOn(scene.loop, 'snapshot').mockReturnValue(staged(scene, { obstacles: [] }) as never)
    scene.frame(1000 / 120)

    expect(scene.pool()[0]!.visible).toBe(false)
    expect(scene.obstacleShadows()[0]!.visible).toBe(false)
  })

  it('refuses to run out of paw pool rather than dropping a token', () => {
    const scene = atRunning()

    vi.spyOn(scene.loop, 'snapshot').mockReturnValue(staged(scene, {
      pawTokens: Array.from({ length: PAW_POOL_SIZE + 1 }, (_, i) => ({
        id: i, laneOffset: 1, distanceUnits: 3,
      })),
    }) as never)

    expect(() => scene.frame(1000 / 120)).toThrow(/paw tokens exceed the pool/)
  })

  it('draws tokens below the obstacles, so a reward never hides a hazard', () => {
    const scene = atRunning()

    vi.spyOn(scene.loop, 'snapshot').mockReturnValue(staged(scene, {
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
    const scene = atRunning()
    const base = scene.loop.snapshot()

    vi.spyOn(scene.loop, 'snapshot').mockReturnValue({
      ...base,
      slayyy: {
        phase: slayyyActive ? 'active' : 'charging',
        charge: 0,
        percent: 0,
        activeRemainingMs: slayyyActive ? 5000 : 0,
      },
    } as never)

    scene.frame(1000 / 120)

    return {
      hazards: scene.pool().filter(s => s.visible).map(s => ({
        x: s.x,
        y: s.y,
        width: s.displayWidth,
        height: s.displayHeight,
        depth: s.depth,
        texture: s.texture,
      })),
      effects: scene.effects(),
    }
  }

  it('redraws every hazard as its prettier self', () => {
    const plain = frameWith(false)
    const pretty = frameWith(true)

    expect(plain.hazards.length).toBeGreaterThan(0)
    expect(pretty.hazards).toHaveLength(plain.hazards.length)

    for (let i = 0; i < plain.hazards.length; i++) {
      expect(pretty.hazards[i]!.texture, 'the world should visibly transform')
        .not.toBe(plain.hazards[i]!.texture)
      expect(pretty.hazards[i]!.texture).toMatch(/slayyy/i)
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

    for (let i = 0; i < plain.hazards.length; i++) {
      const { texture: _plain, ...plainGeometry } = plain.hazards[i]!
      const { texture: _pretty, ...prettyGeometry } = pretty.hazards[i]!

      expect(prettyGeometry).toEqual(plainGeometry)
    }
  })

  it('shows its petals only while the window is open', () => {
    expect(frameWith(false).effects.every(e => !e.visible)).toBe(true)
    expect(frameWith(true).effects.every(e => e.visible)).toBe(true)
  })
})

describe('reduced-motion presentation', () => {
  it('freezes decoration while keeping snapshot position authoritative', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))

    try {
      const scene = atRunning()
      const base = scene.loop.snapshot()
      const render = (elapsedMs: number, lanePosition = base.lanePosition): void => {
        vi.spyOn(scene.loop, 'snapshot').mockReturnValue({
          ...base,
          elapsedMs,
          lanePosition,
          slayyy: { ...base.slayyy, phase: 'active' },
        } as never)
        scene.frame(1000 / 120)
      }

      render(0)

      const stationary = {
        player: [scene.player().x, scene.player().y],
        effect: [scene.effects()[0]!.x, scene.effects()[0]!.y],
        seafront: scene.seafront()!.tilePosition,
        rotation: scene.player().rotation,
      }

      render(5_000)

      expect([scene.player().x, scene.player().y], 'the run bob must hold still')
        .toEqual(stationary.player)
      expect([scene.effects()[0]!.x, scene.effects()[0]!.y], 'petals must not drift')
        .toEqual(stationary.effect)
      expect(scene.seafront()!.tilePosition, 'the coast must not drift')
        .toEqual(stationary.seafront)
      expect(scene.player().rotation).toBe(0)

      // What must *not* freeze: the position the domain reports.
      render(5_000, 0)
      expect(scene.player().x).not.toBe(stationary.player[0])
    }
    finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('the promenade scrolls with the world it is under', () => {
  it('advances while the run is live and freezes when it is not', () => {
    const scene = atRunning()
    const ground = scene.ground()

    // The road is rebuilt every frame rather than accumulating geometry.
    const passes = ground.passes

    scene.frame(1000 / 120)
    expect(ground.passes).toBe(passes + 1)
    expect(ground.fills).toBeGreaterThan(0)

    const dressing = scene.dressing().filter(d => d.visible)

    expect(dressing.length, 'the promenade must actually be dressed').toBeGreaterThan(0)

    const before = dressing.map(d => d.y)

    for (let i = 0; i < 40; i++) scene.frame(1000 / 120)

    expect(scene.dressing().filter(d => d.visible).map(d => d.y))
      .not.toEqual(before)

    scene.loop.pause()

    const paused = scene.dressing().map(d => d.y)

    for (let i = 0; i < 40; i++) scene.frame(1000 / 120)

    expect(scene.loop.snapshot().phase).toBe('paused')
    expect(scene.dressing().map(d => d.y), 'a paused world must stop moving').toEqual(paused)
  })

  it('gives both sides of the road the same kinds of scenery', () => {
    /*
     * The imbalance the review saw, as an invariant.
     *
     * `side` and `piece` were both taken from the pool index — `index % 2` and
     * `index % 4` — which locks them in step: the left side got pieces 0 and 2
     * for ever and the right side 1 and 3. With a palm at index 0 that put
     * every palm in the scene on one side, and a palm is by far the largest
     * prop. Asserting the *sets* rather than the positions keeps the two sides
     * staggered in distance, which is what stops them reading as a corridor.
     */
    const scene = atRunning({ size: { width: 1440, height: 900 } })
    const centre = 1440 / 2

    const kinds = (towards: 'left' | 'right'): string[] => [
      ...new Set(
        scene.dressing()
          .filter(d => (towards === 'left' ? d.x < centre : d.x > centre))
          .map(d => d.origin),
      ),
    ].sort()

    expect(kinds('left').length, 'the promenade must be dressed on the left').toBeGreaterThan(1)
    expect(kinds('left')).toEqual(kinds('right'))
  })

  it('stands every visible prop on a shadow, and hides both together', () => {
    const scene = atRunning({ size: { width: 1440, height: 900 } })

    const props = scene.dressing()
    const shadows = scene.dressingShadows()

    expect(props.length).toBeGreaterThan(0)
    expect(shadows).toHaveLength(props.length)

    // Paired by the same `onScreen` flag, so the counts cannot drift apart —
    // a prop drawn without its shadow is the floating-sticker defect returning.
    expect(shadows.filter(s => s.visible)).toHaveLength(props.filter(p => p.visible).length)

    for (const shadow of shadows.filter(s => s.visible)) {
      expect(shadow.displayWidth).toBeGreaterThan(0)
      expect(shadow.depth).toBeLessThan(PAW_DEPTH_FLOOR)
    }
  })

  it('shrinks the jump shadow to its smallest at the apex, whatever the apex is', () => {
    /*
     * The shadow used to divide `heightPx` by a local copy of the tuned jump
     * apex. That copy was a second, silent home for a number the domain owns:
     * retune `jump.apexHeightPx` and the shadow would quietly stop reaching its
     * smallest at the top of the jump, with nothing to catch it. It is driven
     * by the arc's own progress now, so this asserts the shape — widest on the
     * ground and at both ends of the arc, narrowest in the middle — and names
     * no height at all.
     */
    const scene = atRunning()
    const base = scene.loop.snapshot()

    const widthAt = (heightPx: number, jumpProgress: number): number => {
      vi.spyOn(scene.loop, 'snapshot').mockReturnValue({ ...base, heightPx, jumpProgress } as never)
      scene.frame(1000 / 120)

      return scene.playerShadow().displayWidth
    }

    const grounded = widthAt(0, 0)
    const takeoff = widthAt(4, 0.02)
    const apex = widthAt(96, 0.5)
    const landing = widthAt(4, 0.98)

    expect(apex).toBeLessThan(takeoff)
    expect(apex).toBeLessThan(landing)
    expect(takeoff).toBeCloseTo(landing, 5)
    expect(takeoff).toBeLessThanOrEqual(grounded)

    /*
     * And the part that pins *which* input it reads.
     *
     * Two apexes at the same point in the arc and different heights must draw
     * the same shadow. Dividing the height by a copy of the tuned apex passes
     * every assertion above and fails this one, which is exactly the drift
     * being guarded against: the arc is the thing the shadow tracks.
     */
    expect(widthAt(48, 0.5)).toBeCloseTo(apex, 5)
  })

  it('keeps the outer row off a phone entirely', () => {
    /*
     * It exists to fill the room a desktop has beside the protected column. On
     * a phone there is no such room, so those pieces are never drawn rather
     * than drawn and clipped off the edge.
     */
    const phone = atRunning({ size: { width: 430, height: 932 } })
    const desktop = atRunning({ size: { width: 1920, height: 1080 } })

    expect(phone.dressing().filter(d => d.visible).length).toBeGreaterThan(0)
    expect(desktop.dressing().filter(d => d.visible).length)
      .toBeGreaterThan(phone.dressing().filter(d => d.visible).length)
  })
})

describe('the Loli companion', () => {
  function sceneWithLoli(phase: string, phaseProgress = 1) {
    const scene = atRunning()

    vi.spyOn(scene.loop, 'snapshot').mockReturnValue(staged(scene, {
      loli: { phase, phaseProgress, queuedLoliBonuses: 0 },
    }) as never)

    scene.frame(1000 / 120)

    return scene
  }

  it('is absent until a bonus starts', () => {
    expect(sceneWithLoli('inactive').loli().visible).toBe(false)
  })

  it('appears for the whole lifecycle', () => {
    for (const phase of ['entering', 'active', 'exiting']) {
      expect(sceneWithLoli(phase).loli().visible, phase).toBe(true)
    }
  })

  it('grows in and shrinks out rather than popping', () => {
    const entering = sceneWithLoli('entering', 0.2).loli().displayHeight
    const settled = sceneWithLoli('active', 0.5).loli().displayHeight
    const leaving = sceneWithLoli('exiting', 0.8).loli().displayHeight

    expect(entering).toBeLessThan(settled)
    expect(leaving).toBeLessThan(settled)
  })

  it('appears at full size when the player asked for less motion', () => {
    /*
     * `accessibility.md` §2.2: a UI transition becomes instant rather than a
     * scale. The companion still appears — that is the information — it just
     * does not pop.
     */
    vi.stubGlobal('matchMedia', () => ({ matches: true }))

    try {
      const entering = sceneWithLoli('entering', 0.2).loli().displayHeight
      const settled = sceneWithLoli('active', 0.5).loli().displayHeight
      const leaving = sceneWithLoli('exiting', 0.8).loli().displayHeight

      expect(entering).toBe(settled)
      expect(leaving).toBe(settled)
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('stands beside the player and under her, never on top', () => {
    const scene = sceneWithLoli('active')
    const loli = scene.loli()

    expect(loli.x).not.toBe(scene.player().x)
    expect(loli.depth).toBeLessThan(scene.player().depth)
  })
})

describe('a failed texture falls back to shapes rather than to nothing', () => {
  /*
   * A hazard the player cannot see is a hazard they cannot fairly avoid. This
   * is the one case where the pretty layer is not the product: if a prepared
   * PNG is truncated or blocked, the run still has to be finishable.
   *
   * Phaser's `__MISSING` placeholder is 32x32 and `exists()` answers `true` for
   * it, which is why the check is a size check.
   */
  it('draws the world with primitives when the art did not load', () => {
    const scene = atRunning({ texturesLoad: false })

    expect(scene.made.some(s => s.kind === 'image'), 'no illustration may be built').toBe(false)

    const hazards = scene.pool().filter(s => s.visible)

    expect(hazards.length).toBeGreaterThan(0)

    for (const hazard of hazards) {
      expect(hazard.width).toBeGreaterThan(0)
      expect(hazard.height).toBeGreaterThan(0)
      expect([PALETTE.cone, PALETTE.barrier]).toContain(hazard.fill)
    }

    expect(scene.playerCircle().radius).toBeGreaterThan(0)
  })

  it('still refuses to overflow a pool', () => {
    const scene = atRunning({ texturesLoad: false })
    const snapshot = scene.loop.snapshot()

    vi.spyOn(scene.loop, 'snapshot').mockReturnValue({
      ...snapshot,
      obstacles: Array.from({ length: OBSTACLE_POOL_SIZE + 1 }, () => snapshot.obstacles[0]!),
    })

    expect(() => scene.frame(1000 / 120)).toThrow(/exceed the pool/)
  })
})

/**
 * The reduced-motion preference, while a run is on screen.
 *
 * It used to be read once, when the scene was built, and never again — so a
 * player who turned the setting on mid-run kept the decoration until the scene
 * was destroyed and rebuilt, which in practice meant leaving the route and
 * coming back. Every consumer already reads the flag off the view object once
 * per frame, so the whole fix is to keep watching; what needs testing is the
 * listener's lifetime, not the sampling.
 */
function fakeMotionPreference(initial: boolean) {
  const handlers = new Set<(event: { matches: boolean }) => void>()

  const query = {
    matches: initial,
    addEventListener: (_type: string, fn: (event: { matches: boolean }) => void) => {
      handlers.add(fn)
    },
    removeEventListener: (_type: string, fn: (event: { matches: boolean }) => void) => {
      handlers.delete(fn)
    },
  }

  return {
    query,
    listeners: () => handlers.size,
    /** The player changes the system setting with the run already running. */
    set: (matches: boolean) => {
      query.matches = matches
      for (const fn of [...handlers]) fn({ matches })
    },
  }
}

describe('reduced motion is watched, not sampled once', () => {
  it('installs exactly one listener for the life of the scene', () => {
    const preference = fakeMotionPreference(false)
    vi.stubGlobal('matchMedia', () => preference.query)

    try {
      mountScene()

      expect(preference.listeners()).toBe(1)
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('lands on the next frame, with no rebuild and no reload', () => {
    const preference = fakeMotionPreference(false)
    vi.stubGlobal('matchMedia', () => preference.query)

    try {
      const scene = atRunning()
      const base = scene.loop.snapshot()

      // Two points of the run bob a full half-cycle apart, so "it moved" and
      // "it held still" cannot be confused for one another.
      const renderAt = (elapsedMs: number): void => {
        vi.spyOn(scene.loop, 'snapshot').mockReturnValue({
          ...base,
          elapsedMs,
          heightPx: 0,
          jumpProgress: 0,
        } as never)
        scene.frame(1000 / 120)
      }

      renderAt(170)
      const crest = scene.player().y

      renderAt(510)
      expect(scene.player().y, 'the bob must be live to begin with')
        .not.toBe(crest)

      preference.set(true)

      renderAt(170)
      const stilled = scene.player().y

      renderAt(510)
      expect(scene.player().y, 'the bob must stop without the scene being rebuilt')
        .toBe(stilled)
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('goes back when the preference does', () => {
    const preference = fakeMotionPreference(true)
    vi.stubGlobal('matchMedia', () => preference.query)

    try {
      const scene = atRunning()
      const base = scene.loop.snapshot()
      const renderAt = (elapsedMs: number): void => {
        vi.spyOn(scene.loop, 'snapshot').mockReturnValue({
          ...base,
          elapsedMs,
          heightPx: 0,
          jumpProgress: 0,
        } as never)
        scene.frame(1000 / 120)
      }

      renderAt(170)
      const stilled = scene.player().y
      renderAt(510)
      expect(scene.player().y).toBe(stilled)

      preference.set(false)

      renderAt(170)
      const crest = scene.player().y
      renderAt(510)
      expect(scene.player().y).not.toBe(crest)
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  /*
   * Both teardown events, for the reason the rest of this file's teardown is
   * registered on both: `game.destroy(true)` emits `destroy` and never
   * `shutdown`, which is the path the run route actually takes.
   */
  for (const event of ['destroy', 'shutdown'] as const) {
    it(`removes its listener on ${event}`, () => {
      const preference = fakeMotionPreference(false)
      vi.stubGlobal('matchMedia', () => preference.query)

      try {
        const scene = mountScene()
        expect(preference.listeners()).toBe(1)

        scene.events.emit(event)

        expect(preference.listeners()).toBe(0)
      }
      finally {
        vi.unstubAllGlobals()
      }
    })
  }

  /*
   * Replay is a destroy and a fresh mount, so a listener that outlived its
   * scene would accumulate one per play-again and apply the preference N times
   * on every change.
   */
  it('does not accumulate across replays', () => {
    const preference = fakeMotionPreference(false)
    vi.stubGlobal('matchMedia', () => preference.query)

    try {
      for (let replay = 0; replay < 3; replay++) {
        const scene = mountScene()
        expect(preference.listeners()).toBe(1)
        scene.events.emit('destroy')
        expect(preference.listeners()).toBe(0)
      }
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  /*
   * A media query that reports `matches` and nothing else is a reasonable stub
   * and an old browser's reality alike. The preference still applies; only the
   * watching is skipped.
   */
  it('still reads the preference when the query cannot be listened to', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))

    try {
      expect(() => mountScene()).not.toThrow()
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('survives an environment with no matchMedia at all', () => {
    vi.stubGlobal('matchMedia', undefined)

    try {
      expect(() => mountScene()).not.toThrow()
    }
    finally {
      vi.unstubAllGlobals()
    }
  })
})
