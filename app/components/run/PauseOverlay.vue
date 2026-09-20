<script setup lang="ts">
/**
 * Board 12 — the pause screen.
 *
 * The approved content is a title, the reassurance that the score is safe with
 * the score itself beside it, and three actions: resume, restart, return to
 * menu. All three are here.
 *
 * **The audio controls the board also shows are deliberately absent.** Their
 * contract is approved — quick music and effects mute, independent of volume —
 * but there is no audio runtime to control: the engine starts Phaser with
 * `audio: { noAudio: true }`, there is no settings store, and no preference is
 * persisted anywhere. Drawing two toggles that change nothing would be a
 * screenshot of a feature. `docs/product/screen-inventory.md` records the gap.
 */

defineProps<{
  score: number
  restoreFocusTo?: HTMLElement | null
}>()

const emit = defineEmits<{
  resume: []
  restart: []
  menu: []
}>()

const { t } = useI18n()
const titleId = useId()
</script>

<template>
  <RunOverlayDialog :labelled-by="titleId" :restore-focus-to="restoreFocusTo">
    <div class="run__pause-screen">
      <h2 :id="titleId" class="run__overlay-title">
        {{ t('run.pauseScreen.title') }}
      </h2>

      <p class="run__overlay-line">
        {{ t('run.pauseScreen.scoreSafe', { score }) }}
      </p>

      <div class="run__overlay-actions">
        <UiAuthButton class="run__resume" @click="emit('resume')">
          {{ t('run.resume') }}
        </UiAuthButton>

        <UiAuthButton variant="secondary" class="run__restart" @click="emit('restart')">
          {{ t('run.restart') }}
        </UiAuthButton>

        <UiAuthButton variant="quiet" class="run__menu" @click="emit('menu')">
          {{ t('run.mainMenu') }}
        </UiAuthButton>
      </div>
    </div>
  </RunOverlayDialog>
</template>

<style scoped>
.run__pause-screen {
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

.run__overlay-actions {
  display: grid;
  gap: var(--space-2);
  inline-size: 100%;
  margin-block-start: var(--space-2);
}
</style>
