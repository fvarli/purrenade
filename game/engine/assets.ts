/**
 * The runtime art manifest.
 *
 * Every path is under `public/game/`, and that is the whole point: these files
 * are **prepared output**, cut and cleaned from the production-art development
 * masters by `tools/prepare-run-assets.py` and committed. Nothing in `app/` or
 * `game/` reads the reference directory — the masters are review material, they
 * carry printed labels and captions, and `asset-strategy.md` §4.2 forbids
 * building, bundling or serving any of it. `scene.spec.ts` asserts both halves:
 * that every file here exists as a real PNG, and that no runtime source carries
 * a path into the reference tree.
 *
 * RGBA PNG, deliberately. Phaser 4's SVG loader produced browser-dependent
 * canvas textures for the previous authored vectors: Chromium accepted them and
 * then uploaded opaque black rectangles instead of the transparent content, so
 * the protagonist rendered as a black slab. Pre-rasterised PNG never touches
 * that loader path.
 */
export const RUN_ASSETS = {
  /** Ayşenur, facing the player — the camera v0.3 approves. Front turnaround. */
  aysenurRun: '/game/aysenur-run.png',
  /** The three-quarter turnaround, leaning into a lane change. */
  aysenurLeanLeft: '/game/aysenur-lean-left.png',
  aysenurLeanRight: '/game/aysenur-lean-right.png',
  /** The action master's own hit pose, so a lost heart reads as one. */
  aysenurHit: '/game/aysenur-hit.png',

  loli: '/game/loli-companion.png',

  cone: '/game/traffic-cone.png',
  coneSlayyy: '/game/traffic-cone-slayyy.png',
  barrier: '/game/low-barrier.png',
  barrierSlayyy: '/game/low-barrier-slayyy.png',
  paw: '/game/paw-token.png',
  pawSlayyy: '/game/paw-token-slayyy.png',

  /** Sky, mountains, coastal town and sea, mirrored so it tiles seamlessly. */
  horizon: '/game/world-horizon.png',
  railing: '/game/prop-railing.png',
  lamp: '/game/prop-lamp.png',
  bench: '/game/prop-bench.png',
  palm: '/game/prop-palm.png',
  flowerpot: '/game/prop-flowerpot.png',

  petal: '/game/fx-petal.png',
  sparkle: '/game/fx-sparkle.png',
  shadow: '/game/fx-shadow.png',
} as const

export type RunAssetKey = keyof typeof RUN_ASSETS

/**
 * The namespaced texture names, built once.
 *
 * Namespaced so a run's textures cannot collide with anything else's, and
 * precomputed because `textureKey` is called from the render path — once per
 * obstacle, once per Paw Token and once per character frame, which was some
 * eighty freshly built strings a frame. A lookup allocates nothing.
 */
const TEXTURE_KEYS = Object.freeze(
  Object.fromEntries(
    Object.keys(RUN_ASSETS).map(key => [key, `run-${key}`]),
  ) as Record<RunAssetKey, string>,
)

export function textureKey(key: RunAssetKey): string {
  return TEXTURE_KEYS[key]
}

/**
 * The smallest a prepared texture can legitimately be.
 *
 * Phaser's `TextureManager.exists` also answers `true` for its built-in
 * `__MISSING` placeholder, so "did it load" cannot be asked that way. A real
 * asset here is at least this wide and tall; anything smaller is the
 * placeholder or a truncated download, and the scene must take its primitive
 * fallback rather than draw a hazard as a black or missing-texture block.
 */
export const MIN_TEXTURE_PX = 48
