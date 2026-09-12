<script setup lang="ts">
/**
 * The primary action.
 *
 * v0.3 gives it a pill shape, a solid pressed rim, and a `▶` glyph — coral for
 * the main action, turquoise for the second factor's confirm (board 05).
 *
 * Three things it gets right that a plain `<button>` would not:
 *
 *  - **It is a `<button>`**, with a real `type`. A styled `<div>` is not
 *    focusable, not keyboard-activatable, and not announced as a control.
 *  - **Busy state is announced**, not just animated: `aria-busy` plus a label
 *    change, because a spinner alone tells a screen-reader user nothing.
 *  - **It never shrinks below the 44px touch minimum**, at any viewport.
 */
withDefaults(defineProps<{
  type?: 'button' | 'submit'
  variant?: 'primary' | 'secondary' | 'quiet'
  busy?: boolean
  disabled?: boolean
  busyLabel?: string
}>(), {
  type: 'button',
  variant: 'primary',
  busy: false,
  disabled: false,
  busyLabel: undefined,
})
</script>

<template>
  <button
    :type="type"
    class="btn"
    :class="[`btn--${variant}`, { 'btn--busy': busy }]"
    :disabled="disabled || busy"
    :aria-busy="busy ? 'true' : 'false'"
  >
    <span class="btn__label">
      <slot v-if="!busy" />
      <template v-else>{{ busyLabel ?? '…' }}</template>
    </span>

    <span
      v-if="variant !== 'quiet'"
      class="btn__glyph"
      aria-hidden="true"
    >▶</span>
  </button>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  width: 100%;
  min-height: var(--touch-min);
  padding: var(--space-3) var(--space-6);
  border: 0;
  border-radius: var(--radius-pill);
  color: var(--color-white);
  font-family: var(--font-display);
  font-size: var(--type-body-lg);
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: none;
  cursor: pointer;
  transition:
    transform var(--motion-fast) var(--ease-out),
    box-shadow var(--motion-fast) var(--ease-out),
    filter var(--motion-fast) var(--ease-out);
}

.btn--primary {
  background: var(--action-primary);
  box-shadow: var(--elevation-button);
}

.btn--secondary {
  background: var(--action-secondary);
  box-shadow: var(--elevation-button-secondary);
}

.btn--quiet {
  background: transparent;
  color: var(--color-pink-deep);
  box-shadow: none;
  font-family: var(--font-body);
  font-size: var(--type-body);
  letter-spacing: normal;
  text-decoration: underline;
}

/* Press: the button sinks onto its own rim. Reduced motion collapses the
   duration tokens, so this becomes instant rather than being special-cased. */
.btn:not(:disabled):active {
  transform: translateY(3px);
  box-shadow: none;
}

.btn:not(:disabled):hover {
  filter: brightness(1.04);
}

.btn:disabled {
  cursor: not-allowed;
  filter: grayscale(0.35);
  opacity: 0.7;
}

.btn--quiet:disabled {
  filter: none;
}

.btn__glyph {
  font-size: 0.75em;
}

/* No spinner animation: the busy state is carried by the label and aria-busy,
   which a screen reader can actually perceive. */
.btn--busy .btn__label {
  opacity: 0.85;
}
</style>
