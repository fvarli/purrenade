import type Phaser from 'phaser'
import { PLAYFIELD } from '../bridge'
import type { RenderSnapshot } from '../bridge'
import { textureKey } from './assets'
import type { RunAssetKey } from './assets'
import { PALETTE } from './palette'
import { distanceScale, distanceToY, heightToY, laneToX, laneToXAtDistance } from './layout'
import type { PlayfieldLayout } from './layout'

/**
 * Everything that stands on the promenade: Ayşenur, Loli, the hazards, the
 * Paw Tokens and the SLAYYY effect.
 *
 * Reads the snapshot and draws it. It has no access to `RunState` and could not
 * consult the rules even if a future edit wanted it to — which lane the player
 * occupies, whether that cone was hit, how long the power has left are all
 * already decided by the time a value reaches here.
 *
 * **Scale is the whole argument of this file.** The review's complaint was not
 * that the character was ugly, it was that she was enormous, the cones were
 * specks and the road vanished behind her. So every size below is expressed as
 * a fraction of one number — the character's height — and that height is itself
 * a fraction of the viewport, bounded by the lane she has to fit inside.
 *
 * None of it reaches the rules. Collision is decided in `game/domain` from
 * lanes and distances; an illustration could be drawn at twice this size and
 * the same cone would hit at the same moment.
 */

export interface CastView {
  readonly layout: PlayfieldLayout
  readonly snapshot: RenderSnapshot
  readonly live: boolean
  readonly reducedMotion: boolean
  /** The post-hit blink's current alpha. Owned by the scene, applied here. */
  readonly blink: number
  /** `0`–`1` into the SLAYYY world. */
  readonly bloom: number
}

export interface Cast {
  resize: (layout: PlayfieldLayout) => void
  render: (view: CastView) => void
}

/**
 * How tall Ayşenur is, and therefore how big everything else is.
 *
 * A fraction of the viewport, so she keeps the same presence on a tall phone
 * and a short laptop, then clamped against the lane pitch so she can never
 * spill into the lanes beside her. The upper bound is the one the review was
 * about: at 2.3 lane widths tall her shoulders are still inside her own lane,
 * and the road ahead of her stays visible.
 */
const CHARACTER_VIEWPORT_RATIO = 0.215
const CHARACTER_MIN_LANES = 1.5
const CHARACTER_MAX_LANES = 2.3

/**
 * Everything else, as a fraction of the character's height.
 *
 * The hierarchy is the point. A traffic cone reaches a little above her knee
 * and a low barrier sits below it — which is what tells a player, before they
 * have read anything, that one has to be gone round and the other can be
 * jumped. The class is decided by the domain either way; this is what makes
 * that decision legible in the half-second they have to act on it.
 */
const CONE_HEIGHT_RATIO = 0.48
const BARRIER_HEIGHT_RATIO = 0.30
const LOLI_HEIGHT_RATIO = 0.46
const PAW_DIAMETER_LANE_RATIO = 0.54
const SHADOW_WIDTH_RATIO = 0.62

/** A barrier spans most of its lane; a cone stands in the middle of one. */
const BARRIER_WIDTH_LANE_RATIO = 0.94
const CONE_WIDTH_LANE_RATIO = 0.46

/** Depths. The promenade is 0–5; everything here sits above it. */
const PAW_DEPTH = 8
const OBSTACLE_DEPTH = 20
const LOLI_DEPTH = 40
const PLAYER_DEPTH = 50
const FX_DEPTH = 60

/**
 * How many obstacle shapes to keep around.
 *
 * Pooled rather than created per spawn: the world turns over continuously, and
 * building and destroying Phaser objects at that rate is how a run starts
 * stuttering after a minute. The pool is sized well above what the generator
 * can put on screen — a long-run test asserts the world stays under forty — and
 * unused slots are simply hidden.
 */
export const OBSTACLE_POOL_SIZE = 48

/** Paw Tokens on screen at once. Sized the same way, against the same test. */
export const PAW_POOL_SIZE = 48

/** SLAYYY petals and sparkles. Decoration; the count is not a rule. */
const FX_POOL_SIZE = 16

/** How far Loli trots from the player's lane centre, in lane widths. */
const LOLI_LANE_OFFSET = 0.62

const MS_PER_SECOND = 1000

export interface CastOptions {
  /** False when a prepared texture failed to load. Selects the fallback. */
  readonly artReady: boolean
}

/**
 * A hazard the player cannot see is a hazard they cannot fairly avoid, and an
 * uncollectable token that is visibly absent is a bug report while an invisible
 * one is a mystery. Both pools are sized above anything the generator can
 * produce, so overflowing one is a developer error — and it is loud.
 */
function assertPool(count: number, size: number, what: string): void {
  if (count > size) {
    throw new Error(`run scene: ${count} ${what} exceed the pool of ${size}`)
  }
}

export function createCast(scene: Phaser.Scene, { artReady }: CastOptions): Cast {
  /*
   * Two presentations, chosen once, never blended.
   *
   * The previous build created both the illustrations and a full set of
   * primitives and then drove every one of them every frame, switching with
   * alpha — twice the objects, twice the arithmetic, and a rule about which
   * layer owned each property repeated at a dozen call sites. `artReady` is
   * knowable the moment `create` runs, so the decision is made once and only
   * the chosen objects are ever built.
   */
  return artReady ? illustratedCast(scene) : primitiveCast(scene)
}

/** How tall the character is for this layout. Every other size derives from it. */
function characterHeight(layout: PlayfieldLayout): number {
  return Math.min(
    layout.lanePitchPx * CHARACTER_MAX_LANES,
    Math.max(
      layout.lanePitchPx * CHARACTER_MIN_LANES,
      layout.viewportHeightPx * CHARACTER_VIEWPORT_RATIO,
    ),
  )
}

/** The size an obstacle of this class is drawn at, at this distance. */
export function obstacleSize(
  layout: PlayfieldLayout,
  kind: 'lane_blocking' | 'jumpable',
  distanceUnits: number,
): { widthPx: number, heightPx: number } {
  const scale = distanceScale(distanceUnits)
  const tall = kind === 'lane_blocking'
  const height = characterHeight(layout)
    * (tall ? CONE_HEIGHT_RATIO : BARRIER_HEIGHT_RATIO)
    * scale

  return {
    heightPx: height,
    widthPx: layout.lanePitchPx
      * (tall ? CONE_WIDTH_LANE_RATIO : BARRIER_WIDTH_LANE_RATIO)
      * scale,
  }
}

// --- the illustrated cast --------------------------------------------------

function illustratedCast(scene: Phaser.Scene): Cast {
  const image = (key: RunAssetKey): Phaser.GameObjects.Image =>
    scene.add.image(0, 0, textureKey(key))

  const playerShadow = image('shadow').setDepth(PLAYER_DEPTH - 1).setOrigin(0.5, 0.5)
  const player = image('aysenurRun').setDepth(PLAYER_DEPTH).setOrigin(0.5, 1)

  const loliShadow = image('shadow').setDepth(LOLI_DEPTH - 1).setOrigin(0.5, 0.5).setVisible(false)
  const loli = image('loli').setDepth(LOLI_DEPTH).setOrigin(0.5, 1).setVisible(false)

  const obstacles = Array.from({ length: OBSTACLE_POOL_SIZE }, () =>
    image('cone').setOrigin(0.5, 1).setVisible(false))
  const obstacleShadows = Array.from({ length: OBSTACLE_POOL_SIZE }, () =>
    image('shadow').setOrigin(0.5, 0.5).setVisible(false))

  const paws = Array.from({ length: PAW_POOL_SIZE }, () =>
    image('paw').setOrigin(0.5, 0.5).setVisible(false))

  const effects = Array.from({ length: FX_POOL_SIZE }, (_, index) =>
    image(index % 2 === 0 ? 'petal' : 'sparkle').setDepth(FX_DEPTH).setVisible(false))

  let heightPx = 0
  let current: PlayfieldLayout | null = null

  /**
   * Which way the player is moving, remembered between frames.
   *
   * The snapshot reports where the character *is*, not where she is heading,
   * and the lean has to pick a side. One number of renderer-local memory rather
   * than a new field on the bridge: the direction is a presentation question,
   * and the boundary is deliberately narrow.
   */
  let lastLanePosition = PLAYFIELD.startLane
  let lean = 0

  /** Size an image to a height, keeping its source aspect ratio. */
  function fitHeight(target: Phaser.GameObjects.Image, wanted: number): void {
    const aspect = target.height === 0 ? 1 : target.width / target.height

    target.setDisplaySize(wanted * aspect, wanted)
  }

  function resize(layout: PlayfieldLayout): void {
    current = layout
    heightPx = characterHeight(layout)
  }

  function renderPlayer(view: CastView): void {
    const { layout, snapshot } = view
    const x = laneToX(layout, snapshot.lanePosition)
    const airborne = snapshot.heightPx > 0
    const y = heightToY(layout, snapshot.heightPx)

    const delta = snapshot.lanePosition - lastLanePosition
    if (Math.abs(delta) > 0.0005) lean = Math.sign(delta)
    if (snapshot.laneProgress >= 1) lean = 0
    lastLanePosition = snapshot.lanePosition

    /*
     * The run, as a bob.
     *
     * The production master's run cycle is drawn in side view; using its frames
     * would put the protagonist in a different camera from the world she runs
     * through, and cutting cells out of the turnaround and calling them frames
     * would be inventing an animation the master does not contain. What is
     * honest — and what v0.3's own gameplay boards do — is a front-facing
     * character with a run bob under her, so that is what this is.
     */
    const bob = airborne || view.reducedMotion
      ? 0
      : Math.sin(snapshot.elapsedMs / 108) * layout.lanePitchPx * 0.035

    player.setTexture(textureKey(
      snapshot.protection.hitRecovery
        ? 'aysenurHit'
        : lean < 0
          ? 'aysenurLeanLeft'
          : lean > 0
            ? 'aysenurLeanRight'
            : 'aysenurRun',
    ))

    /*
     * A tilt into the lane change and a stretch through the jump.
     *
     * Transforms on one illustration rather than separate drawings, which is
     * the line this file holds: real art where the master provides it,
     * controlled motion where it does not, and nothing pretending to be a frame
     * that is not one.
     */
    const aspect = player.height === 0 ? 1 : player.width / player.height

    player.setDisplaySize(
      heightPx * aspect * (airborne ? 0.96 : 1),
      heightPx * (airborne ? 1.05 : 1),
    )
    player.setPosition(x, y + bob)
    player.setRotation(view.reducedMotion ? 0 : lean * 0.085 * (1 - snapshot.laneProgress))
    player.setAlpha((view.live ? 1 : 0.65) * view.blink)
    player.setTint(view.bloom > 0 ? PALETTE.bloom : 0xFFFFFF)

    /*
     * The shadow stays on the ground and shrinks as she leaves it, which is
     * what tells the player how high the jump is. Without it a jump is a
     * character sliding up the screen and the landing is a surprise.
     *
     * Driven by the arc's own progress rather than by dividing the height by a
     * copy of the tuned apex. That copy was a second, silent home for a number
     * the domain owns: retune `jump.apexHeightPx` and the shadow would have
     * stopped reaching zero at the top of the jump, with nothing to catch it.
     * `sin(pi * progress)` is 0 at takeoff and landing and 1 at the apex
     * whatever the apex happens to be.
     */
    const lift = airborne ? Math.sin(Math.PI * snapshot.jumpProgress) : 0
    const shadowWidth = heightPx * SHADOW_WIDTH_RATIO * (1 - lift * 0.42)

    playerShadow.setVisible(true)
    playerShadow.setDisplaySize(shadowWidth, shadowWidth * 0.33)
    playerShadow.setPosition(x, layout.groundYPx)
    playerShadow.setAlpha((view.live ? 0.5 : 0.3) * (1 - lift * 0.5))
  }

  function renderObstacles(view: CastView): void {
    const { layout, snapshot } = view
    const pretty = snapshot.slayyy.phase === 'active'

    snapshot.obstacles.forEach((obstacle, index) => {
      const shape = obstacles[index]

      if (shape === undefined) return

      const isCone = obstacle.kind === 'lane_blocking'

      /*
       * Visible only while it is on the road ahead.
       *
       * The far edge was checked and the near one was not, so a passed obstacle
       * kept full size, slid down past the player's feet and vanished mid-frame
       * instead of leaving at the bottom of the picture.
       */
      const onScreen = obstacle.distanceUnits <= PLAYFIELD.visibleUnits
        && obstacle.distanceUnits + obstacle.lengthUnits > 0

      const groundY = distanceToY(layout, obstacle.distanceUnits)
      const x = laneToXAtDistance(layout, obstacle.lane, obstacle.distanceUnits)

      /*
       * Nearer obstacles draw on top.
       *
       * Every shape shared one depth, so Phaser fell back to display-list
       * order — which is pool index, which is snapshot order, which is nearest
       * *first*. The nearest obstacle was painted underneath the one behind it,
       * visible wherever a pattern puts two in the same lane.
       */
      const depth = OBSTACLE_DEPTH + (PLAYFIELD.visibleUnits - obstacle.distanceUnits)
      const alpha = view.live ? 1 : 0.75
      const { widthPx, heightPx: obstacleHeight } = obstacleSize(layout, obstacle.kind, obstacle.distanceUnits)

      /*
       * SLAYYY beautifies, and beautification is a *different drawing of the
       * same object*. The master draws both, so the cone that becomes a
       * flower-covered cone is the master's own art rather than a recolour —
       * and it is still `LANE_BLOCKING`, still in the same lane, still the same
       * footprint. A renderer that changed its size here would be a renderer
       * quietly changing what the collision rules already decided.
       */
      shape.setTexture(textureKey(
        isCone ? (pretty ? 'coneSlayyy' : 'cone') : (pretty ? 'barrierSlayyy' : 'barrier'),
      ))

      shape.setVisible(onScreen)
      shape.setDepth(depth)
      shape.setAlpha(alpha)
      shape.setDisplaySize(widthPx, obstacleHeight)
      shape.setPosition(x, groundY)

      const shadow = obstacleShadows[index]

      if (shadow !== undefined) {
        shadow.setVisible(onScreen)
        shadow.setDisplaySize(widthPx * 0.9, widthPx * 0.28)
        shadow.setPosition(x, groundY)
        shadow.setDepth(depth - 0.5)
        shadow.setAlpha(alpha * 0.4)
      }
    })

    for (let index = snapshot.obstacles.length; index < obstacles.length; index++) {
      obstacles[index]?.setVisible(false)
      obstacleShadows[index]?.setVisible(false)
    }

    assertPool(snapshot.obstacles.length, obstacles.length, 'obstacles')
  }

  function renderPaws(view: CastView): void {
    const { layout, snapshot } = view
    const pretty = snapshot.slayyy.phase === 'active'

    /*
     * `laneOffset` rather than a lane index: the Loli magnet moves a token
     * between lanes, and the domain reports where it actually is.
     */
    snapshot.pawTokens.forEach((token, index) => {
      const shape = paws[index]

      if (shape === undefined) return

      const scale = distanceScale(token.distanceUnits)
      const onScreen = token.distanceUnits <= PLAYFIELD.visibleUnits
        && token.distanceUnits + PLAYFIELD.pawLengthUnits > 0

      const pulse = view.reducedMotion
        ? 1
        : 1 + Math.sin(snapshot.elapsedMs / 260 + token.id) * 0.07

      const diameter = layout.lanePitchPx * PAW_DIAMETER_LANE_RATIO * scale * pulse

      shape.setTexture(textureKey(pretty ? 'pawSlayyy' : 'paw'))
      shape.setVisible(onScreen)
      shape.setAlpha(view.live ? 1 : 0.75)
      shape.setDisplaySize(diameter, diameter)
      // Above the road, below the hazards: a reward must never hide a hazard.
      shape.setDepth(PAW_DEPTH + (PLAYFIELD.visibleUnits - token.distanceUnits) / PLAYFIELD.visibleUnits)
      shape.setPosition(
        laneToXAtDistance(layout, token.laneOffset, token.distanceUnits),
        distanceToY(layout, token.distanceUnits) - diameter * 0.55,
      )
    })

    for (let index = snapshot.pawTokens.length; index < paws.length; index++) {
      paws[index]?.setVisible(false)
    }

    assertPool(snapshot.pawTokens.length, paws.length, 'paw tokens')
  }

  function renderLoli(view: CastView): void {
    const { layout, snapshot } = view
    const visible = snapshot.loli.phase !== 'inactive'

    loli.setVisible(visible)
    loliShadow.setVisible(visible)

    if (!visible) return

    /*
     * The "puf" entrance and exit, unless the player asked for less.
     *
     * `accessibility.md` §2.2 puts UI transitions on the reduced side of the
     * line — instant rather than scale — and a companion popping into existence
     * is decoration, not information. What survives the setting is the
     * companion *being there*, which is the part that tells the player the
     * magnet is on.
     */
    const grow = view.reducedMotion
      ? 1
      : snapshot.loli.phase === 'entering'
        ? snapshot.loli.phaseProgress
        : snapshot.loli.phase === 'exiting'
          ? 1 - snapshot.loli.phaseProgress
          : 1

    /*
     * Beside the player, never over them, and never over a hazard. She takes
     * the side with more road on it, so she is not pushed off the edge in an
     * outer lane.
     */
    const side = snapshot.lanePosition <= PLAYFIELD.startLane ? 1 : -1
    const x = laneToX(layout, snapshot.lanePosition + LOLI_LANE_OFFSET * side)
    const y = layout.groundYPx - layout.lanePitchPx * 0.04
    const height = Math.max(0.01, heightPx * LOLI_HEIGHT_RATIO * grow)
    const alpha = view.live ? 1 : 0.75

    fitHeight(loli, height)
    loli.setPosition(x, y)
    loli.setAlpha(alpha)

    loliShadow.setDisplaySize(height, height * 0.3)
    loliShadow.setPosition(x, y)
    loliShadow.setAlpha(alpha * 0.4)
  }

  /**
   * SLAYYY, as light rather than as objects.
   *
   * Petals and sparkles around the character and nothing on the road: the
   * approved presentation is "the world becomes more beautiful", and a power
   * that also scattered things across the lanes would be a power that made
   * hazards harder to read. None of this is collidable, none of it is in the
   * snapshot, and all of it is off when the window is.
   */
  function renderEffects(view: CastView): void {
    const { layout, snapshot } = view
    const active = snapshot.slayyy.phase === 'active'
    const x = laneToX(layout, snapshot.lanePosition)
    const y = heightToY(layout, snapshot.heightPx) - heightPx * 0.45

    effects.forEach((effect, index) => {
      effect.setVisible(active)

      if (!active) return

      const turn = (index / effects.length) * Math.PI * 2
      const drift = view.reducedMotion
        ? 0
        : (snapshot.elapsedMs / MS_PER_SECOND) * (index % 2 === 0 ? 1.1 : -0.8)

      const angle = turn + drift
      /*
       * A wide, shallow orbit, clear of the character.
       *
       * The first radius put petals on her face and across her top — pretty in
       * a still frame and, in motion, decoration covering the one thing on
       * screen the player is tracking. Pushing the ring out past her shoulders
       * and flattening it keeps the celebration around her rather than on her.
       */
      const radius = heightPx * (0.62 + (index % 3) * 0.16)
      const size = heightPx * (index % 2 === 0 ? 0.13 : 0.1)

      effect.setDisplaySize(size, size)
      effect.setPosition(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius * 0.5)
      effect.setAlpha(0.55 + 0.35 * Math.abs(Math.sin(angle)))
      effect.setRotation(view.reducedMotion ? 0 : angle)
    })
  }

  function render(view: CastView): void {
    const resolved: CastView = { ...view, layout: current ?? view.layout }

    renderObstacles(resolved)
    renderPaws(resolved)
    renderLoli(resolved)
    renderPlayer(resolved)
    renderEffects(resolved)
  }

  return { resize, render }
}

// --- the fallback cast -----------------------------------------------------

/**
 * What the run looks like when a prepared texture did not load.
 *
 * Not a second design — a safety net. It keeps the two obstacle classes
 * distinguishable by silhouette as well as by colour, keeps the player and the
 * tokens on screen, and keeps the pool guarantees. A player should never meet
 * it; a player who does should still be able to finish the run.
 */
function primitiveCast(scene: Phaser.Scene): Cast {
  const player = scene.add.circle(0, 0, 1, PALETTE.player).setDepth(PLAYER_DEPTH)
  const loli = scene.add.circle(0, 0, 1, PALETTE.loli).setDepth(LOLI_DEPTH).setVisible(false)

  const obstacles = Array.from({ length: OBSTACLE_POOL_SIZE }, () =>
    scene.add.rectangle(0, 0, 1, 1, PALETTE.cone).setDepth(OBSTACLE_DEPTH).setVisible(false))

  const paws = Array.from({ length: PAW_POOL_SIZE }, () =>
    scene.add.circle(0, 0, 1, PALETTE.paw).setDepth(PAW_DEPTH).setVisible(false))

  let heightPx = 0
  let current: PlayfieldLayout | null = null

  function resize(layout: PlayfieldLayout): void {
    current = layout
    heightPx = characterHeight(layout)
    player.setRadius(heightPx * 0.2)
  }

  function render(view: CastView): void {
    const layout = current ?? view.layout
    const { snapshot } = view
    const alpha = view.live ? 1 : 0.75

    snapshot.obstacles.forEach((obstacle, index) => {
      const shape = obstacles[index]

      if (shape === undefined) return

      const onScreen = obstacle.distanceUnits <= PLAYFIELD.visibleUnits
        && obstacle.distanceUnits + obstacle.lengthUnits > 0
      const size = obstacleSize(layout, obstacle.kind, obstacle.distanceUnits)
      const groundY = distanceToY(layout, obstacle.distanceUnits)

      shape.setVisible(onScreen)
      shape.setAlpha(alpha)
      shape.setFillStyle(obstacle.kind === 'lane_blocking' ? PALETTE.cone : PALETTE.barrier)
      shape.setSize(size.widthPx, size.heightPx)
      shape.setDepth(OBSTACLE_DEPTH + (PLAYFIELD.visibleUnits - obstacle.distanceUnits))
      shape.setPosition(
        laneToXAtDistance(layout, obstacle.lane, obstacle.distanceUnits),
        groundY - size.heightPx / 2,
      )
    })

    for (let index = snapshot.obstacles.length; index < obstacles.length; index++) {
      obstacles[index]?.setVisible(false)
    }

    assertPool(snapshot.obstacles.length, obstacles.length, 'obstacles')

    snapshot.pawTokens.forEach((token, index) => {
      const shape = paws[index]

      if (shape === undefined) return

      const radius = layout.lanePitchPx * PAW_DIAMETER_LANE_RATIO * distanceScale(token.distanceUnits) / 2

      shape.setVisible(token.distanceUnits <= PLAYFIELD.visibleUnits
        && token.distanceUnits + PLAYFIELD.pawLengthUnits > 0)
      shape.setAlpha(alpha)
      shape.setRadius(radius)
      shape.setDepth(PAW_DEPTH + (PLAYFIELD.visibleUnits - token.distanceUnits) / PLAYFIELD.visibleUnits)
      shape.setPosition(
        laneToXAtDistance(layout, token.laneOffset, token.distanceUnits),
        distanceToY(layout, token.distanceUnits) - radius,
      )
    })

    for (let index = snapshot.pawTokens.length; index < paws.length; index++) {
      paws[index]?.setVisible(false)
    }

    assertPool(snapshot.pawTokens.length, paws.length, 'paw tokens')

    const visible = snapshot.loli.phase !== 'inactive'

    loli.setVisible(visible)

    if (visible) {
      const side = snapshot.lanePosition <= PLAYFIELD.startLane ? 1 : -1
      const radius = Math.max(0.01, heightPx * LOLI_HEIGHT_RATIO / 2)

      loli.setRadius(radius)
      loli.setAlpha(alpha)
      loli.setPosition(
        laneToX(layout, snapshot.lanePosition + LOLI_LANE_OFFSET * side),
        layout.groundYPx - radius,
      )
    }

    player.setPosition(
      laneToX(layout, snapshot.lanePosition),
      heightToY(layout, snapshot.heightPx) - player.radius,
    )
    player.setAlpha((view.live ? 1 : 0.65) * view.blink)
  }

  return { resize, render }
}
