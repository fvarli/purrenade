<script setup lang="ts">
/**
 * Board 13 — run complete.
 *
 * Everything on it is a fact the finished run actually produced: the score the
 * HUD was already showing, and the Paw Tokens collected during it. Both stop
 * changing when the run ends, because the domain seals the terminal state and
 * emits no further `score_changed` or `paws_changed`.
 *
 * ## What the approved board shows and this does not
 *
 * The board pairs the score with a **record**, adds an achievement progress
 * chip, and has a sibling board for a new personal best. None of those can be
 * stated truthfully yet: there is no personal best anywhere in this frontend —
 * no store, no web-storage write, no field on the run surface — because the
 * authoritative score is decided by the backend on submission, and submission
 * is M9. Achievements are M11 and the leaderboard is M10.
 *
 * So the record slot is left out rather than filled with a session-local number
 * dressed as a record, and the one durable sentence from the retired
 * `run.scopeNotice` takes its place: saving progress arrives later. That is the
 * honest version of the same information, and it leaves M9 a clean slot.
 */

defineProps<{
  score: number
  paws: number
  busy?: boolean
  restoreFocusTo?: HTMLElement | null
}>()

const emit = defineEmits<{
  replay: []
  menu: []
}>()

const { t } = useI18n()
const titleId = useId()
</script>

<template>
  <RunOverlayDialog :labelled-by="titleId" :restore-focus-to="restoreFocusTo">
    <div class="run__complete">
      <h2 :id="titleId" class="run__overlay-title">
        {{ t('run.complete.title') }}
      </h2>

      <p class="run__overlay-line">
        {{ t('run.complete.flavour') }}
      </p>

      <!--
        The same score card the HUD uses, at the size this screen deserves. The
        caption is the existing `run.scoreLabel`, not a second translation of
        the same word.
      -->
      <p class="run__final-score">
        <span class="run__final-score-label">{{ t('run.scoreLabel') }}</span>
        <span class="run__final-score-value">{{ score }}</span>
      </p>

      <p class="run__final-paws">
        <span aria-hidden="true" class="run__paw-glyph">🐾</span>
        {{ t('run.complete.pawsGained', { count: paws }) }}
      </p>

      <p class="run__overlay-note">
        {{ t('run.complete.persistenceNotice') }}
      </p>

      <div class="run__overlay-actions">
        <UiAuthButton class="run__replay" :busy="busy" @click="emit('replay')">
          {{ t('run.replay') }}
        </UiAuthButton>

        <UiAuthButton variant="quiet" class="run__menu" @click="emit('menu')">
          {{ t('run.mainMenu') }}
        </UiAuthButton>
      </div>
    </div>
  </RunOverlayDialog>
</template>

<style scoped>
.run__complete {
  display: grid;
  justify-items: center;
  gap: var(--space-3);
  inline-size: 100%;
}

.run__overlay-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--type-title);
  font-weight: 800;
  color: var(--color-ink);
}

.run__overlay-line {
  margin: 0;
  font-size: var(--type-body);
  color: var(--text-primary);
}

/* v0.3's score card, borrowed: ink block, gold caption, large cream number. */
.run__final-score {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin: 0;
  padding: var(--space-2) var(--space-6) var(--space-3);
  border-radius: var(--radius-lg);
  background: var(--color-ink);
}

.run__final-score-label {
  font-size: var(--type-micro);
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-yellow);
}

.run__final-score-value {
  font-family: var(--font-display);
  font-size: var(--type-display);
  font-weight: 800;
  line-height: 1.05;
  color: var(--color-cream);
  font-variant-numeric: tabular-nums;
}

.run__final-paws {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin: 0;
  font-size: var(--type-body-lg);
  font-weight: 700;
  color: var(--color-ink);
}

.run__overlay-note {
  margin: 0;
  font-size: var(--type-caption);
  color: var(--text-primary);
  max-inline-size: 34ch;
}

.run__overlay-actions {
  display: grid;
  gap: var(--space-2);
  inline-size: 100%;
  margin-block-start: var(--space-2);
}
</style>
