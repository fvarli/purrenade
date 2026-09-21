<script setup lang="ts">
/**
 * "Skip the tutorial?" — and here a dialog is exactly right.
 *
 * The lesson prompt deliberately is not one, because the player has to keep
 * playing while it is up. This is the opposite: a decision to leave should stop
 * the road, take the taps, and hold the keyboard until it is answered. Wearing
 * `RunOverlayDialog` gives all three — the scrim makes the canvas stop
 * receiving `pointerdown`, and the focus trap means an activatable element
 * always holds focus, which is what makes `shouldHandleKey` suppress every
 * gameplay binding. Neither leak has to be handled here.
 *
 * The page pauses the run before mounting this, mirroring how leaving a run
 * already works: a decision the player can reverse should not be made against a
 * world that is still moving.
 */

defineProps<{
  /** True while the skip is being persisted, so neither action double-fires. */
  busy?: boolean
  restoreFocusTo?: HTMLElement | null
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const { t } = useI18n()
const titleId = useId()
</script>

<template>
  <RunOverlayDialog :labelled-by="titleId" :restore-focus-to="restoreFocusTo">
    <div class="run__tutorial-confirm">
      <h2 :id="titleId" class="run__overlay-title">
        {{ t('tutorial.skipConfirm.title') }}
      </h2>

      <p class="run__overlay-line">
        {{ t('tutorial.skipConfirm.body') }}
      </p>

      <div class="run__overlay-actions">
        <!--
          Continuing is the primary action and comes first, so the dialog
          defaults to the outcome that keeps teaching. `OverlayDialog` focuses
          the first focusable element, which makes Enter mean "carry on" rather
          than "leave" for anyone answering from the keyboard.
        -->
        <UiAuthButton class="run__tutorial-continue" :disabled="busy" @click="emit('cancel')">
          {{ t('tutorial.skipConfirm.cancel') }}
        </UiAuthButton>

        <UiAuthButton
          variant="quiet"
          class="run__tutorial-confirm-skip"
          :busy="busy"
          @click="emit('confirm')"
        >
          {{ t('tutorial.skipConfirm.confirm') }}
        </UiAuthButton>
      </div>
    </div>
  </RunOverlayDialog>
</template>

<style scoped>
.run__tutorial-confirm {
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

.run__overlay-actions {
  display: grid;
  gap: var(--space-2);
  inline-size: 100%;
  margin-block-start: var(--space-2);
}
</style>
