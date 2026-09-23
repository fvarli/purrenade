<script setup lang="ts">
import type { RunReasonCode, RunResult, RunSubmissionView } from '~/types/run'

/**
 * Board 13 — run complete, and what the server made of it (M9).
 *
 * The run ended on this device; whether it *counts* is the server's decision,
 * and this screen says only what is actually known at each moment:
 *
 * | `submission` | What it shows |
 * | --- | --- |
 * | `saving` | The score as played, and that it is being saved |
 * | `retrying` | That the run will be saved when the connection returns — keep the page open |
 * | `outcome` | The **server's** answer: accepted, flagged or rejected, with its numbers |
 * | `closed` | That the run could no longer be recorded |
 * | `local` | The tutorial's case: nothing is submitted |
 *
 * **Never the client's own verdict.** Until the server answers, the number on
 * screen is labelled as the score *played*; once it answers, only the server's
 * values are shown (`api-client.md` §6). A flagged run is shown honestly as
 * recorded but not counted; a rejected one explicitly, never as a success.
 * Neither shows a progression, Paw or personal-best change, because none
 * happened.
 */

const props = defineProps<{
  score: number
  paws: number
  busy?: boolean
  submission?: RunSubmissionView
  outcome?: RunResult | null
  restoreFocusTo?: HTMLElement | null
}>()

const emit = defineEmits<{
  replay: []
  menu: []
  retry: []
}>()

const { t } = useI18n()
const titleId = useId()

const state = computed<RunSubmissionView>(() => props.submission ?? 'local')

/** The server's answer, once there is one. */
const result = computed(() => (state.value === 'outcome' ? props.outcome ?? null : null))

/** The first reason, for one honest sentence rather than a list of codes. */
const reason = computed<RunReasonCode | null>(() => result.value?.reasons[0] ?? null)

/**
 * Replaying waits for a final answer: a new run cannot start while this one's
 * finish is still being delivered.
 */
const replayBusy = computed(() => props.busy === true || state.value === 'saving' || state.value === 'retrying')
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
        The score card. Before the server answers it is the score as played;
        after, the server's — and for a rejected run there is no score to show.
      -->
      <p v-if="result === null || result.score !== null" class="run__final-score">
        <span class="run__final-score-label">
          {{ result === null ? t('run.submit.playedScore') : t('run.scoreLabel') }}
        </span>
        <span class="run__final-score-value">{{ result?.score ?? score }}</span>
      </p>

      <template v-if="result?.status === 'accepted'">
        <p class="run__final-paws">
          <span aria-hidden="true" class="run__paw-glyph">🐾</span>
          {{ t('run.complete.pawsGained', { count: result.run_paws ?? 0 }) }}
        </p>

        <p class="run__outcome run__outcome--accepted" role="status">
          {{ result.is_personal_best
            ? t('run.outcome.personalBest')
            : t('run.outcome.accepted', { best: result.progression.best_score }) }}
        </p>
      </template>

      <template v-else-if="result?.status === 'flagged'">
        <p class="run__outcome run__outcome--flagged" role="status">
          {{ t('run.outcome.flagged') }}
        </p>
        <p v-if="reason !== null" class="run__overlay-note">
          {{ t(`run.reason.${reason}`) }}
        </p>
      </template>

      <template v-else-if="result?.status === 'rejected'">
        <p class="run__outcome run__outcome--rejected" role="status">
          {{ t('run.outcome.rejected') }}
        </p>
        <p v-if="reason !== null" class="run__overlay-note">
          {{ t(`run.reason.${reason}`) }}
        </p>
      </template>

      <p v-else-if="state === 'saving'" class="run__overlay-note" role="status">
        {{ t('run.submit.saving') }}
      </p>

      <template v-else-if="state === 'retrying'">
        <p class="run__overlay-note" role="status">
          {{ t('run.submit.retrying') }}
        </p>
        <UiAuthButton variant="secondary" class="run__retry" @click="emit('retry')">
          {{ t('run.submit.retryNow') }}
        </UiAuthButton>
      </template>

      <p v-else-if="state === 'closed'" class="run__outcome run__outcome--rejected" role="status">
        {{ t('run.outcome.closed') }}
      </p>

      <div class="run__overlay-actions">
        <UiAuthButton class="run__replay" :busy="replayBusy" @click="emit('replay')">
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

.run__outcome {
  margin: 0;
  font-size: var(--type-body);
  font-weight: 800;
  text-align: center;
  color: var(--color-ink);
  max-inline-size: 34ch;
}

.run__overlay-actions {
  display: grid;
  gap: var(--space-2);
  inline-size: 100%;
  margin-block-start: var(--space-2);
}
</style>
