/**
 * Colours, from the approved token palette. Presentation only.
 *
 * A copy of the tokens rather than a read of them: a canvas cannot resolve a
 * CSS custom property per frame. `scene.spec.ts` asserts every value here still
 * exists in `tokens.css`, so the copy cannot drift silently and regression gate
 * G12 — no raw hex outside the token module — still holds.
 *
 * The list is short on purpose. The promenade's warmth, the sea, the coastal
 * town and every character and prop are *artwork* now; what is left for code is
 * the road surface, its markings, and the few tints SLAYYY lays over them.
 * Every colour the previous scene invented for an illustration it was drawing
 * out of circles has gone with the circles.
 */
export const PALETTE = {
  /** Above the horizon painting, which fades into this rather than ending. */
  sky: 0xC9ECF2,

  /** The promenade at the player's feet, and the shore beyond the road. */
  promenade: 0xF0E3D2,
  /** The same stone further away, hazed by distance. */
  promenadeFar: 0xF3EADF,
  /** The shoulder outside the lanes, and the desktop surround. */
  shoulder: 0xE8D9C5,
  /** Paving seams and the road's kerb. */
  seam: 0xB9AFA6,
  /** Planting beyond the balustrade, and the leaves in it. */
  garden: 0xD8EDDD,
  gardenDeep: 0x6FBF8B,

  laneLine: 0xFFFFFF,
  cream: 0xFFF6E9,
  ink: 0x33272A,

  /**
   * SLAYYY: the world becomes prettier, and these are what it becomes.
   *
   * Two, not four. The lilac and the sparkle gold that used to sit here were
   * never read by anything — the DOM control carries them as tokens, and the
   * scene's celebration is the master's own flower art plus these two washes.
   * An unread colour still passes the token gate, so nothing else would have
   * caught them.
   */
  bloom: 0xFFE1E9,
  bloomDeep: 0xFF8FAB,

  /**
   * The primitive fallback, used only when a prepared texture fails to load.
   *
   * Not decoration — a hazard the player cannot see is a hazard they cannot
   * fairly avoid, so a missing texture degrades to a readable shape rather than
   * to nothing. Two obstacle colours because there are two behaviours, and the
   * silhouettes differ too, so the distinction never rests on hue alone.
   */
  cone: 0xFF8C42,
  barrier: 0x6A8CAF,
  paw: 0xD96A8C,
  player: 0xFF6B4A,
  loli: 0xFFFFFF,
} as const
