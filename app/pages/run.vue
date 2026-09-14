<script setup lang="ts">
import { HEARTS, PLAY_COLUMN_MAX_PX, PROGRESS } from '~~/game/bridge'

/**
 * The run surface.
 *
 * Board 10 in the approved inventory, reached from the authenticated branch of
 * the navigation map. The engine boundary and the movement rules arrived at M5,
 * obstacles and hearts at M6, and the heads-up display with everything it shows
 * at M7. Submitting a result is M9, so the page still says so rather than
 * implying the number it shows goes anywhere.
 *
 * **Client-only.** A canvas cannot be server-rendered and Phaser reads `window`
 * at import time, so `nuxt.config.ts` marks this route `ssr: false`.
 *
 * Thin on purpose. The lifetime of the engine — mounting, pausing when the tab
 * is hidden, and tearing the WebGL context down on leave — lives in
 * `useRunSurface`, where it can be driven by a fake engine in a test instead of
 * being verified by opening a browser and hoping.
 */

definePageMeta({
  layout: false,
  middleware: 'verified',
})

const { t } = useI18n()

const surface = useTemplateRef<HTMLElement>('surface')
const {
  phase, loading, failed, isPaused, hasEnded, hearts, start, stop, togglePause,
  score, cyclePaws, loliActive, slayyy, slayyyPercent, activateSlayyy,
} = useRunSurface()

/**
 * The paw readout switches to `n / 200` near the threshold.
 *
 * `paw.hudThresholdProximity` is PROPOSED at 25, and the v0.3 boards show both
 * presentations — a bare count most of the time, the fraction when a bonus is
 * close enough to play for.
 *
 * **Both presentations show `loliCyclePaws`**, which is what
 * `scoring-and-progression.md` §2.3 specifies: progress toward the next bonus
 * is the thing the readout is for, and the fraction near the threshold is the
 * same number in a different dress. This showed `runPaws` until the M7 review —
 * identical until the first bonus, and then permanently wrong, because a player
 * on their second cycle saw a total that no longer had anything to do with the
 * `/ 200` they were about to see.
 */
const nearThreshold = computed(
  () => cyclePaws.value >= PROGRESS.loliThreshold - PROGRESS.hudThresholdProximity,
)

/**
 * One key for the label, the state name never reaches the player.
 *
 * While charging the label carries the percentage, because `accessibility.md`
 * §3.1 requires the control to communicate progress and §4.1 forbids that cue
 * from resting on the fill's colour. Armed and active have no number: there is
 * nothing left to fill, and "100%" beside "ready" reads as noise.
 */
const slayyyLabel = computed(() => (
  slayyy.value === 'ready'
    ? t('run.slayyyReady')
    : slayyy.value === 'active'
      ? t('run.slayyyActive')
      : t('run.slayyyCharging', { percent: slayyyPercent.value })
))

/**
 * What a screen reader is told, and when.
 *
 * The accessible *name* changing does not announce anything — a name is read
 * when the control is reached, and a player watching the road is not on it. So
 * the two moments that matter get a polite live region of their own, and the
 * charging percentage deliberately stays out of it: announcing every tick of a
 * meter that takes a minute to fill would make the run unusable.
 */
const slayyyAnnouncement = computed(() => (
  slayyy.value === 'charging' ? '' : slayyyLabel.value
))

/**
 * Hand the keyboard back to the game after using an on-screen control.
 *
 * Gameplay keys are suppressed while a control has focus — `shouldHandleKey`
 * refuses every binding but Escape when `document.activeElement` claims
 * activation — and a `<button>` keeps focus after a click. So tapping Pause,
 * Resume or SLAYYY left the player unable to move, jump or fire until they
 * clicked the canvas, and the SLAYYY case did it for the five seconds the power
 * was running. Escape alone stayed reachable, which is why this survived M6: the
 * exemption that rescued the pause trap hid the rest of it.
 *
 * One function for all three controls rather than a per-button workaround. It
 * moves focus, never removes it, so there is no moment with nothing focused and
 * no trap — the surface is `tabindex="0"` and Tab still reaches every control
 * from there. `preventScroll` keeps the page from jumping on a short viewport,
 * and the surface's ring is `:focus-visible`, so a mouse click restores play
 * silently while a keyboard activation still shows where focus went.
 */
function returnFocusToSurface(): void {
  surface.value?.focus({ preventScroll: true })
}

/** Pause or resume, then give the keyboard back. */
function pauseFromControl(): void {
  togglePause()
  returnFocusToSurface()
}

/** Fire SLAYYY, then give the keyboard back — before the window starts running. */
function slayyyFromControl(): void {
  activateSlayyy()
  returnFocusToSurface()
}

useHead({
  title: () => t('run.title'),
})

/*
 * There is deliberately no viewport override here.
 *
 * This page used to set `maximum-scale=1, user-scalable=no`, justified as
 * stopping a pinch during a swipe from zooming the page. `.run__surface`
 * already sets `touch-action: none`, which by specification takes every
 * browser panning and zooming gesture — pinch included — away from that
 * element. So the meta bought nothing for the surface and took page zoom away
 * from everything else, including the 13px phase pill and status panel, which
 * are exactly what a low-vision player would pinch to read. That is a WCAG 2.2
 * 1.4.4 failure in exchange for nothing.
 */

onMounted(() => {
  if (surface.value !== null) void start(surface.value)
})

onBeforeUnmount(stop)
</script>

<template>
  <div
    class="run"
    :style="{ '--run-column': `${PLAY_COLUMN_MAX_PX}px` }"
  >
    <h1 class="run__heading">
      {{ t('run.title') }}
    </h1>

    <!--
      An interactive surface, not a picture.

      `role="img"` declared a static graphic, made every descendant
      presentational, and — because it carries no `tabindex` — left the element
      outside the tab order. That combination locked keyboard players out: the
      pause button is a `<button>`, gameplay keys are suppressed while a control
      has focus, and there was nothing focusable to move focus back to. It is a
      focusable group now, and Escape is exempt from the focus rule, so both
      halves of that trap are gone.
    -->
    <div
      ref="surface"
      class="run__surface"
      role="group"
      tabindex="0"
      :aria-label="t('run.surfaceLabel')"
    />

    <div class="run__chrome">
      <NuxtLink to="/" class="run__exit">
        {{ t('run.leave') }}
      </NuxtLink>

      <p class="run__phase" aria-live="polite">
        {{ t(`run.phase.${phase}`) }}
      </p>

      <UiAuthButton
        v-if="!failed"
        type="button"
        variant="quiet"
        :disabled="loading || hasEnded"
        @click="pauseFromControl"
      >
        {{ isPaused ? t('run.resume') : t('run.pause') }}
      </UiAuthButton>
    </div>

    <!--
      The heads-up display.

      Four facts, one row each on a narrow screen, all inside the same play
      column as the rest of the chrome. Every one of them is real text as well
      as a shape: `accessibility.md` §4 requires gameplay state to exist as DOM
      outside the canvas, and none of it may rest on hue alone.
    -->
    <div class="run__hud">
      <p class="run__score">
        <span class="run__score-label">{{ t('run.scoreLabel') }}</span>
        <span class="run__score-value">{{ score }}</span>
      </p>

      <p class="run__paws">
        <span aria-hidden="true" class="run__paw-glyph">🐾</span>
        <span>{{ nearThreshold
          ? t('run.cycleProgress', { count: cyclePaws, total: PROGRESS.loliThreshold })
          : t('run.paws', { count: cyclePaws })
        }}</span>
      </p>

      <p v-if="loliActive" class="run__loli" role="status">
        <span aria-hidden="true">🐈</span>
        {{ t('run.loliActive') }}
      </p>
    </div>

    <div class="run__slayyy">
      <!--
        A real button, not a bar with a tap handler.

        `accessibility.md` §3.1 is explicit: the armed control is focusable and
        labelled, and its accessible name carries both state and action. The
        meter behind it is decorative — the state is in the text, so a player
        who cannot see the fill still knows the power is available.
      -->
      <button
        type="button"
        class="run__slayyy-button"
        :class="`run__slayyy-button--${slayyy}`"
        :style="{ '--slayyy-fill': `${slayyyPercent}%` }"
        :disabled="loading || hasEnded || slayyy !== 'ready'"
        :aria-label="slayyyLabel"
        @click="slayyyFromControl"
      >
        <span aria-hidden="true" class="run__slayyy-mark">✨</span>
        <span class="run__slayyy-text">{{ slayyyLabel }}</span>
      </button>

      <!--
        The global `sr-only` utility, not a page-local copy: this is exactly the
        case `base.css` documents it for — live-region text a screen reader
        needs and the design does not show.
      -->
      <p class="sr-only" role="status">
        {{ slayyyAnnouncement }}
      </p>
    </div>

    <div class="run__meta">
      <!--
        Hearts, the fourth HUD fact.

        Separate from `.run__hud` only because it predates it and its own tests
        address it by that class; it is part of the same display and sits in the
        same column. The shapes are decorative and the count beside them is the
        accessible fact. Countable shapes rather than a colour bar, so nothing
        here depends on hue alone.
      -->
      <p class="run__hearts">
        <span aria-hidden="true">
          <span
            v-for="index in HEARTS.max"
            :key="index"
            class="run__heart"
            :class="{ 'run__heart--spent': index > hearts }"
          >♥</span>
        </span>
        <span class="run__hearts-count">{{ t('run.hearts', { count: hearts, max: HEARTS.max }) }}</span>
      </p>
    </div>

    <div class="run__foot">
      <p v-if="loading" class="run__status">
        {{ t('run.loading') }}
      </p>

      <UiAuthNotice v-else-if="failed" variant="error">
        {{ t('run.failed') }}
      </UiAuthNotice>

      <p v-else-if="hasEnded" class="run__status run__status--ended" role="status">
        {{ t('run.ended') }}
      </p>

      <p v-else class="run__status">
        {{ t('run.scopeNotice') }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.run {
  position: relative;
  display: flex;
  flex-direction: column;
  min-block-size: 100dvh;
  background: var(--bg-page);

  /*
   * No pull-to-refresh anywhere on this page.
   *
   * `touch-action: none` covers the play surface, but the chrome and the foot
   * sit above it with their own stacking context and no touch-action of their
   * own — so a downward drag starting on the top strip reached the browser's
   * overscroll gesture and reloaded the run away. The milestone's own
   * acceptance criterion names refresh alongside scroll and zoom.
   */
  overscroll-behavior: none;
}

/*
 * The page needs a heading, and the canvas cannot be one.
 *
 * Visually hidden rather than absent: `layout: false` means this route bypasses
 * the shell that provides the app's only `<main>`, so without it a screen
 * reader arrives at four nested divs with nothing to orient by.
 */
.run__heading {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.run__surface {
  position: absolute;
  inset: 0;

  /*
   * The canvas owns its gestures. Without this the browser claims a vertical
   * swipe as a scroll and a horizontal one as a back-navigation, and neither
   * ever reaches the game.
   */
  touch-action: none;
  overscroll-behavior: none;
  user-select: none;
  -webkit-user-select: none;
}

/*
 * The global ring sits 2px *outside* its element. This one fills the viewport,
 * so an outside ring would be drawn off-screen and a keyboard player would have
 * no idea the surface had focus. Same width and colour, turned inwards.
 */
.run__surface:focus-visible {
  outline: 3px solid var(--color-ink);
  outline-offset: -3px;
  border-radius: 0;
}

/*
 * Chrome and foot are held to the play column, not the viewport.
 *
 * The playfield caps at the approved column width and lets the seaside expand
 * decoratively around it. Letting the controls span the full window put them
 * seven hundred pixels from the game on a wide monitor, out in the decorative
 * area, while the player's attention was on the centre.
 */
.run__chrome,
.run__foot {
  inline-size: min(100%, var(--run-column));
  margin-inline: auto;
}

/*
 * The chrome rows do not take touches; their controls do.
 *
 * `.run__surface` is `position: absolute; inset: 0`, so the canvas is the whole
 * viewport and every row below is painted *over* the playfield. Without this,
 * each row is also a hit target: a touch starting on one has that row as its
 * `event.target`, Phaser's `pointerdown` only fires when the target is the
 * canvas, and the gesture never begins. At 360x640 that made roughly the top
 * quarter and the entire bottom third of the screen dead to swipes — including
 * the strip a thumb naturally rests on. Keyboard play was unaffected, which is
 * why it went unnoticed through two milestones.
 *
 * So every row is transparent to pointers and each genuinely interactive child
 * opts back in. The rule is deliberately on the children rather than on a
 * wrapper: anything new added to these rows is inert until someone says it
 * should not be, which is the safe default for a layer sitting on the game.
 */
.run__chrome {
  position: relative;
  z-index: 1;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: space-between;

  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
}

.run__exit,
.run__chrome button,
.run__slayyy-button {
  pointer-events: auto;
}

.run__exit {
  display: inline-flex;
  align-items: center;

  /*
   * The label carries a leading arrow. Inside a flex container its intrinsic
   * width came out a few pixels under the text's own, so the arrow wrapped onto
   * a line of its own.
   */
  white-space: nowrap;
  min-block-size: var(--touch-min);
  font-weight: 700;
  color: var(--color-ink);
}

/*
 * The heart row sits on its own line, below the controls.
 *
 * Four things across a 320 px viewport do not fit, and the first attempt let
 * the control row wrap instead — which dropped the pause button onto the sea,
 * out of the chrome and into the middle of the picture. A separate row is
 * predictable at every width.
 */
/*
 * The HUD rows.
 *
 * Same column idiom as the chrome and the hearts: `min(100%, --run-column)`
 * centred, so on a wide monitor the readouts stay beside the 460 px playfield
 * instead of drifting to the window edges. `flex-wrap` rather than a fixed
 * layout, because Turkish and Spanish run longer than English and a HUD that
 * only fits in one language is a HUD that is broken in two.
 */
.run__hud {
  position: relative;
  z-index: 1;
  pointer-events: none;
  inline-size: min(100%, var(--run-column));
  margin-inline: auto;
  padding: 0 var(--space-4);
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2) var(--space-3);
}

.run__score {
  display: flex;
  align-items: baseline;
  gap: var(--space-1);
  margin: 0;
}

.run__score-label {
  font-size: var(--type-caption);
  /* Ink for the same reason as the SLAYYY control: `--text-secondary` is
     3.81:1 on the page ground, and 13px is small text. The hierarchy is
     carried by size and weight against the value beside it, not by fading
     the label below the contrast floor. */
  color: var(--color-ink);
}

.run__score-value {
  font-family: var(--font-display);
  font-size: var(--type-title);
  font-weight: 800;
  color: var(--color-ink);
  /* Tabular figures, so a rising score does not jitter the row beside it. */
  font-variant-numeric: tabular-nums;
}

.run__paws,
.run__loli {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin: 0;
  font-size: var(--type-caption);
  color: var(--color-ink);
}

.run__paw-glyph {
  font-size: 1.1em;
}

.run__slayyy {
  position: relative;
  z-index: 1;
  pointer-events: none;
  inline-size: min(100%, var(--run-column));
  margin-inline: auto;
  padding: var(--space-2) var(--space-4) 0;
}

/*
 * The activation control.
 *
 * Three states, and each is distinguishable without colour: charging is
 * outlined and quiet, ready is filled and carries the sparkle, active is
 * filled and says so. The text changes in every state, which is what a screen
 * reader and a greyscale display both rely on.
 */
.run__slayyy-button {
  /*
   * The fill is a background layer, and it is deliberately the *second* cue.
   * `accessibility.md` §4.1 requires the meter to be readable without relying
   * on colour, so the percentage is in the label and this only reinforces it —
   * remove the fill entirely and the control still tells you where it is.
   */
  background-image: linear-gradient(
    to right,
    var(--color-pink-soft) 0 var(--slayyy-fill, 0%),
    transparent var(--slayyy-fill, 0%)
  );
  background-repeat: no-repeat;

  /*
   * No double-tap zoom, no drag-scroll from the control.
   *
   * The surface sets `touch-action: none`; the button is its sibling and
   * inherits nothing. Two quick presses — which is exactly what a player does
   * when the first appears not to fire — zoomed the page mid-run, and a finger
   * that drifted vertically scrolled it. `manipulation` keeps the tap and drops
   * the gestures nobody asked for.
   */
  touch-action: manipulation;

  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  inline-size: 100%;
  min-block-size: var(--touch-min);
  padding: 0 var(--space-3);
  border: 2px solid var(--color-border);
  border-radius: var(--radius-pill);
  /* `background-color`, never the shorthand: the shorthand would reset the
     fill layer declared above and the meter would silently stop showing. */
  background-color: transparent;
  /*
   * Ink, not `--text-secondary`.
   *
   * The muted grey is 3.81:1 on the page and 3.34:1 over a filled meter, and
   * this is 13px bold — small text, so WCAG 2.2 1.4.3 wants 4.5:1 and neither
   * figure reaches it. Ink is 13.4:1 and 11.7:1 respectively. The disabled
   * state is carried by the border, the fill and the word "charging", none of
   * which needs the text to be hard to read.
   */
  color: var(--color-ink);
  font: inherit;
  font-size: var(--type-caption);
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: not-allowed;
  transition: background var(--motion-base) var(--ease-out),
    color var(--motion-base) var(--ease-out),
    border-color var(--motion-base) var(--ease-out);
}

.run__slayyy-button--ready {
  border-color: var(--color-pink-deep);
  /* `background`, not `background-color`: the shorthand clears the fill layer,
     which is at 100% here and would otherwise draw over the flat colour. */
  background: var(--color-pink);
  color: var(--color-ink);
  cursor: pointer;
}

.run__slayyy-button--active {
  border-color: var(--color-lilac);
  /* Same reason as above: the meter is spent, and the shorthand clears it. */
  background: var(--color-lilac);
  color: var(--color-ink);
}

.run__slayyy-mark {
  font-size: 1.1em;
}

.run__slayyy-button:disabled {
  opacity: 0.85;
}

.run__meta {
  position: relative;
  z-index: 1;
  pointer-events: none;
  inline-size: min(100%, var(--run-column));
  margin-inline: auto;
  padding: 0 var(--space-4);
}

.run__hearts {
  display: flex;
  flex: 0 1 auto;
  min-inline-size: 0;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--type-caption);
  color: var(--color-ink);
}

.run__heart {
  color: var(--color-coral);
  font-size: 1.1em;
}

/* Hollow, not merely faded: the difference must survive a greyscale display. */
.run__heart--spent {
  color: transparent;
  -webkit-text-stroke: 1px var(--color-border);
}

.run__hearts-count {
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--color-white);
}

.run__phase {
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-pill);
  background: var(--color-white);
  font-size: var(--type-caption);
  color: var(--color-ink);
}

.run__foot {
  position: relative;
  z-index: 1;
  pointer-events: none;
  margin-block-start: auto;
  padding: var(--space-4);
}

.run__status--ended {
  font-weight: 700;
  color: var(--color-ink);
}

.run__status {
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-white);
  font-size: var(--type-caption);
  color: var(--text-secondary);
  text-align: center;
}
</style>
