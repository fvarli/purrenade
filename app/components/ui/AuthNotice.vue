<script setup lang="ts">
/**
 * A form-level message: an error, a confirmation, or a hint.
 *
 * Errors and successes are announced. A form that fails and shows a message
 * without telling assistive technology is, to a screen-reader user, a form that
 * did nothing — the single most common accessibility defect in auth flows.
 *
 * `role="alert"` for errors (interrupts), `aria-live="polite"` for everything
 * else (waits for a pause). Each carries a glyph, so the meaning never rests on
 * colour alone.
 */
withDefaults(defineProps<{ variant?: 'info' | 'error' | 'success' }>(), {
  variant: 'info',
})

const GLYPHS = { info: 'ℹ', error: '⚠', success: '✓' } as const
</script>

<template>
  <p
    class="notice"
    :class="`notice--${variant}`"
    :role="variant === 'error' ? 'alert' : 'status'"
    :aria-live="variant === 'error' ? 'assertive' : 'polite'"
  >
    <span aria-hidden="true">{{ GLYPHS[variant] }}</span>
    <span><slot /></span>
  </p>
</template>

<style scoped>
.notice {
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
}
</style>
