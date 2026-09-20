<script setup lang="ts">
/**
 * The modal shell both run overlays wear.
 *
 * A `<div role="dialog">` rather than `<dialog>.showModal()`, for two reasons
 * that both matter here. The top layer escapes the play column, so a native
 * modal would be centred on the window and drift away from the game on a wide
 * monitor — the same mistake `.run__readouts` exists to avoid. And a native
 * dialog closes itself on Escape, while Escape on this route already belongs to
 * the scene's document handler, which resumes the run: two handlers for one key
 * is how a pause overlay ends up closing without the simulation restarting.
 *
 * ## The scrim is load-bearing, not decoration
 *
 * It covers the whole viewport and takes pointer events, so a tap while an
 * overlay is up has this element as its `event.target`. Phaser's `pointerdown`
 * only fires when the target is the canvas, so gameplay gestures stop at the
 * scrim without anything having to know they were blocked. Keyboard is stopped
 * independently, by `shouldHandleKey` refusing every gameplay binding while an
 * activatable element has focus — and the trap below guarantees one always
 * does.
 */

const props = defineProps<{
  /** The id of the heading that names this dialog. */
  labelledBy: string
  /**
   * Where focus goes when the overlay leaves.
   *
   * The play surface, in practice. Passed in rather than found here because the
   * page already owns that element and the rule it encodes — a control hands
   * the keyboard back to the game — is the page's, not this component's.
   */
  restoreFocusTo?: HTMLElement | null
}>()

const panel = ref<HTMLElement | null>(null)

/**
 * Everything inside that can take focus, in document order.
 *
 * Queried per use rather than cached: the pause overlay's actions do not change
 * while it is open, but a cached list would be a trap waiting for the first one
 * that does.
 */
const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

function stops(): HTMLElement[] {
  if (panel.value === null) return []

  return Array.from(panel.value.querySelectorAll<HTMLElement>(FOCUSABLE))
}

/**
 * Keep Tab inside the dialog.
 *
 * Bound to the panel rather than to `document`, so there is no global listener
 * to remember to remove — the element going away takes the handler with it,
 * which is the only teardown story this component needs. Keydown bubbles from
 * the buttons, so every stop is covered.
 */
function trapTab(event: KeyboardEvent): void {
  const focusable = stops()

  if (focusable.length === 0) return

  const first = focusable[0]
  const last = focusable[focusable.length - 1]

  if (first === undefined || last === undefined) return

  const active = document.activeElement

  if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()

    return
  }

  if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

onMounted(() => {
  // The primary action, which is the first one in every overlay that uses this.
  stops()[0]?.focus()
})

onBeforeUnmount(() => {
  props.restoreFocusTo?.focus({ preventScroll: true })
})
</script>

<template>
  <div class="overlay">
    <div
      ref="panel"
      class="overlay__panel"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="labelledBy"
      @keydown.tab="trapTab"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: absolute;
  inset: 0;

  /*
   * Above `.run__readouts`, which is `z-index: 1`. The HUD stays visible behind
   * the scrim on purpose — v0.3's pause board shows the run it interrupted.
   */
  z-index: 2;

  display: grid;
  place-items: center;
  padding: var(--space-4);

  /*
   * `color-mix` rather than a literal `rgba(...)`: a raw hex outside the token
   * module fails the token gate, and the scrim should darken *the brand ink*
   * rather than an unrelated black that happens to look similar.
   */
  background: color-mix(in srgb, var(--color-ink) 62%, transparent);

  /* It blocks the canvas. That is its job. */
  pointer-events: auto;
}

.overlay__panel {
  /*
   * Held to the play column like the rest of the display, so the dialog sits on
   * the game rather than in the decorative seaside beside it.
   */
  inline-size: min(100%, var(--run-column));

  display: grid;
  justify-items: center;
  gap: var(--space-3);

  padding: var(--space-6) var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--color-cream);
  box-shadow: var(--elevation-card);
  text-align: center;

  animation: overlay-in var(--motion-base) var(--ease-out);
}

/*
 * The motion tokens already collapse to 1ms under `prefers-reduced-motion`, so
 * this needs no query of its own — the entrance simply stops being perceptible.
 */
@keyframes overlay-in {
  from { opacity: 0; transform: translateY(var(--space-2)); }
  to   { opacity: 1; transform: none; }
}
</style>
