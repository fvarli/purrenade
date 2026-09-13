<script setup lang="ts">
import { HEARTS, PLAY_COLUMN_MAX_PX } from '~~/game/bridge'

/**
 * The run surface.
 *
 * Board 10 in the approved inventory, reached from the authenticated branch of
 * the navigation map. What exists at M5 is the engine boundary and the movement
 * rules: three lanes, input, jump, pause. Obstacles are M6, the HUD and
 * everything it shows are M7, and submitting a result is M9 — so the page says
 * so rather than presenting an empty score.
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
const { phase, loading, failed, isPaused, hasEnded, hearts, start, stop, togglePause } = useRunSurface()

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
        @click="togglePause"
      >
        {{ isPaused ? t('run.resume') : t('run.pause') }}
      </UiAuthButton>
    </div>

    <div class="run__meta">
      <!--
        Provisional M6 feedback, not the HUD.

        M7 owns the real heads-up display. What is needed now is enough to see a
        heart go, and enough for a screen reader to know it went: the shapes are
        decorative, and the count beside them is the accessible fact. Hearts are
        countable shapes rather than a colour bar, so nothing here depends on
        hue alone.
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

.run__chrome {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;

  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
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
.run__meta {
  position: relative;
  z-index: 1;
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
