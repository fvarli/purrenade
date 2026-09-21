<script setup lang="ts">
import type { TutorialCorrection, TutorialLesson } from '~~/game/bridge'

/**
 * The lesson prompt — and deliberately **not** a dialog.
 *
 * Every other overlay on this route wears `RunOverlayDialog`, which draws a
 * full-viewport scrim and traps focus. Both would be wrong here, and wrong in
 * the same direction: the player has to keep playing while this is on screen.
 * The scrim exists precisely to stop gameplay gestures reaching the canvas, and
 * a focus trap would park the keyboard on a button — where `shouldHandleKey`
 * suppresses every gameplay binding, so the arrow keys the prompt is *asking
 * for* would stop working.
 *
 * So this is a card inside `.run__readouts`, which is `pointer-events: none`
 * with children opting back in. Only the Skip control opts in; the prompt
 * itself is inert and a swipe started on top of it still reaches the road.
 *
 * ## Why the copy is chosen here rather than sent
 *
 * The domain emits a lesson id. This picks the sentence — which is what keeps
 * player-facing strings out of the rules, and what lets the same lesson read
 * "Press ← or A" on a keyboard and "Swipe left" on a phone without the
 * simulation knowing which device it is running on.
 */

const props = defineProps<{
  lesson: TutorialLesson
  index: number
  total: number
  correction: TutorialCorrection | null
  attempt: number
  /** True while the completion is being persisted, so Skip cannot double-fire. */
  busy?: boolean
}>()

const emit = defineEmits<{ skip: [] }>()

const { t, te } = useI18n()

/**
 * Touch or keyboard, decided once.
 *
 * `(hover: none) and (pointer: coarse)` rather than a touch-capability test: a
 * laptop with a touchscreen reports touch support and is still a keyboard
 * machine, and telling such a player to swipe would be advice they cannot act
 * on.
 *
 * Read at setup rather than in `onMounted`, and that is not a style choice:
 * `/run` is `ssr: false`, so `matchMedia` is already available and there is no
 * server render to disagree with — while deferring it to mount would render the
 * keyboard copy for one frame on a phone and then swap it, which is a visible
 * flash of the wrong instruction at exactly the moment the player is reading it.
 */
const coarse = typeof globalThis.matchMedia === 'function'
  && globalThis.matchMedia('(hover: none) and (pointer: coarse)').matches === true

/** `dodge_cone` → `dodgeCone`, so the message keys read as prose. */
const camel = (value: string): string =>
  value.replace(/_(\w)/g, (_match: string, c: string) => c.toUpperCase())

const key = computed(() => camel(props.lesson))

const title = computed(() => t(`tutorial.lesson.${key.value}.title`))

/**
 * The instruction, in the vocabulary of the device in the player's hands.
 *
 * The greeting and the closing practice have a single `body` instead of a
 * gesture pair — they describe what is happening, not what to press — so this
 * falls back rather than rendering a missing key.
 */
const instruction = computed(() => {
  const variant = `tutorial.lesson.${key.value}.${coarse ? 'touch' : 'keyboard'}`

  if (te(variant)) return t(variant)

  const body = `tutorial.lesson.${key.value}.body`

  return te(body) ? t(body) : ''
})

const correctionText = computed(() =>
  props.correction === null ? '' : t(`tutorial.correction.${camel(props.correction)}`),
)

/** One dot per lesson, so progress reads without counting. */
const dots = computed(() => Array.from({ length: props.total }, (_, i) => i))
</script>

<template>
  <div class="run__tutorial">
    <div class="run__tutorial-card">
      <!--
        `polite`, not `assertive`: the prompt changes while the player is
        concentrating on the road, and an assertive region would interrupt them
        mid-lesson. The correction below is the same — it is guidance, not an
        alarm, and nothing here is urgent because nothing here can hurt them.
      -->
      <p class="run__tutorial-title" role="status" aria-live="polite">
        {{ title }}
      </p>

      <p v-if="instruction" class="run__tutorial-instruction">
        {{ instruction }}
      </p>

      <p v-if="correctionText" :key="attempt" class="run__tutorial-correction" role="status" aria-live="polite">
        {{ correctionText }}
      </p>

      <div class="run__tutorial-foot">
        <!--
          Progress as dots with a text label rather than "3 / 9" on screen:
          the design requirement is that progress is legible *without counting*,
          and a screen reader still gets the number.
        -->
        <ol class="run__tutorial-dots" :aria-label="t('tutorial.progressLabel')">
          <li
            v-for="dot in dots"
            :key="dot"
            class="run__tutorial-dot"
            :class="{ 'run__tutorial-dot--done': dot < index, 'run__tutorial-dot--live': dot === index }"
          />
        </ol>

        <span class="sr-only">{{ t('tutorial.progress', { step: index + 1, total }) }}</span>

        <!--
          Restrained by design: a quiet text button beside the progress, not a
          second primary action competing with the lesson.
        -->
        <button
          class="run__tutorial-skip"
          type="button"
          :disabled="busy"
          @click="emit('skip')"
        >
          {{ t('tutorial.skip') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * Inert by default, exactly like its siblings in `.run__readouts`.
 *
 * Anything added to this layer is dead to pointers until it says otherwise —
 * the safe default for a layer sitting over a game that is driven by swipes.
 */
/*
 * Its own row, not the banners'.
 *
 * The SLAYYY banner is live during the SLAYYY lesson, so sharing a grid area
 * would stack the prompt and the banner on top of each other at exactly the
 * moment the prompt is asking the player to press something.
 */
.run__tutorial {
  grid-area: tutorial;
  display: grid;
  justify-items: center;
  align-content: end;
  pointer-events: none;
}

.run__tutorial-card {
  inline-size: 100%;
  display: grid;
  gap: var(--space-1);
  padding: var(--space-3);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
  box-shadow: var(--elevation-card);
  text-align: center;
}

.run__tutorial-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--type-body-lg);
  font-weight: 800;
  color: var(--color-ink);
}

.run__tutorial-instruction {
  margin: 0;
  font-size: var(--type-body);
  color: var(--text-primary);
}

/*
 * Corrective, never punitive.
 *
 * `--state-info` rather than `--state-danger`: nothing has gone wrong. The
 * player tried something reasonable and is being told what the game actually
 * wants, which is the whole point of the cone lesson.
 */
.run__tutorial-correction {
  margin: 0;
  font-size: var(--type-caption);
  font-weight: 700;
  color: var(--state-info);
}

.run__tutorial-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-block-start: var(--space-1);
}

.run__tutorial-dots {
  display: flex;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.run__tutorial-dot {
  inline-size: 0.5rem;
  block-size: 0.5rem;
  border-radius: var(--radius-pill);
  background: var(--line);
}

.run__tutorial-dot--done {
  background: var(--color-turquoise);
}

.run__tutorial-dot--live {
  background: var(--action-primary);
  /* Shape as well as colour, so the live step is not carried by hue alone. */
  transform: scale(1.35);
}

/*
 * The one thing here that takes a tap.
 *
 * Full touch-target height, held to the approved minimum, without growing the
 * card: the padding does the work rather than the glyph.
 */
.run__tutorial-skip {
  pointer-events: auto;
  min-block-size: var(--touch-min);
  padding-inline: var(--space-3);
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  font: 700 var(--type-caption) var(--font-body);
  cursor: pointer;
}

.run__tutorial-skip:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
