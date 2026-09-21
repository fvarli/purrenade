<script setup lang="ts">
import type { TutorialOutcome } from '~~/game/bridge'

/**
 * The end of the tutorial, and the one place its persistence can be seen.
 *
 * A separate component from `CompleteOverlay` rather than a variant of it. That
 * one is board 13 — a score and a paw count from a run that happened. The
 * tutorial has neither: it produced no score anybody should keep, and saying
 * so by passing zeros would be showing a result rather than withholding one.
 *
 * ## Why the failure state lives here
 *
 * Completion is only true once the server says so. If the write fails, this
 * overlay stays up with a retry rather than quietly continuing into a run:
 * routing past it would mean the player is told they have finished, and then
 * meets the mandatory tutorial again on their next sign-in with nothing to
 * explain why. The honest thing is to say it did not save and offer the button
 * again — and the call is idempotent, so pressing it twice is free.
 */

defineProps<{
  outcome: TutorialOutcome
  /** The persistence request is in flight. */
  busy?: boolean
  /** The persistence request failed. The player has not been lied to. */
  failed?: boolean
  restoreFocusTo?: HTMLElement | null
}>()

const emit = defineEmits<{
  play: []
  menu: []
}>()

const { t } = useI18n()
const titleId = useId()
</script>

<template>
  <RunOverlayDialog :labelled-by="titleId" :restore-focus-to="restoreFocusTo">
    <div class="run__tutorial-complete">
      <h2 :id="titleId" class="run__overlay-title">
        {{ t('tutorial.complete.title') }}
      </h2>

      <p class="run__overlay-line">
        {{ outcome === 'skipped' ? t('tutorial.complete.skipped') : t('tutorial.complete.body') }}
      </p>

      <UiAuthNotice v-if="failed" variant="error" class="run__tutorial-error">
        {{ t('tutorial.saveFailed') }}
      </UiAuthNotice>

      <div class="run__overlay-actions">
        <!--
          The label becomes "try again" when the save failed, because that is
          what the button now does: the same idempotent call, not a second
          attempt at finishing.
        -->
        <UiAuthButton
          class="run__tutorial-play"
          :busy="busy"
          :busy-label="t('tutorial.saving')"
          @click="emit('play')"
        >
          {{ failed ? t('tutorial.retry') : t('tutorial.complete.play') }}
        </UiAuthButton>

        <UiAuthButton variant="quiet" class="run__tutorial-menu" :disabled="busy" @click="emit('menu')">
          {{ t('tutorial.complete.menu') }}
        </UiAuthButton>
      </div>
    </div>
  </RunOverlayDialog>
</template>

<style scoped>
.run__tutorial-complete {
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
  text-align: center;
}

.run__tutorial-error {
  inline-size: 100%;
}

.run__overlay-actions {
  display: grid;
  gap: var(--space-2);
  inline-size: 100%;
  margin-block-start: var(--space-2);
}
</style>
