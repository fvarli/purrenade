<script setup lang="ts">
/**
 * The Purrenade wordmark.
 *
 * The approved brand mark: ink letters with a **coral `RR`**, a turquoise wave
 * and a pink paw, and a single `✦`. Rendered as text rather than an image so it
 * scales, stays selectable, and carries no baked-in copy — `localization.md`
 * forbids text inside images.
 *
 * The `✦` is part of the wordmark itself here; elsewhere `✦ / ✨` belongs to
 * SLAYYY alone and is not general brand language (design-tokens.md §6).
 */
withDefaults(defineProps<{ size?: 'sm' | 'lg' }>(), { size: 'lg' })
</script>

<template>
  <div
    class="wordmark"
    :class="`wordmark--${size}`"
    role="img"
    aria-label="Purrenade"
  >
    <p
      class="wordmark__text"
    >
      <!-- Split so the RR can take coral. Marked aria-hidden and labelled on
           the parent, so a screen reader reads one word rather than fragments. -->
      <span aria-hidden="true">PU<span class="wordmark__accent">RR</span>ENADE</span>
      <span
        class="wordmark__sparkle"
        aria-hidden="true"
      >✦</span>
    </p>

    <div
      class="wordmark__motif"
      aria-hidden="true"
    >
      <span class="wordmark__wave" />
      <span class="wordmark__paw"><i /><i /><i /><i /></span>
    </div>
  </div>
</template>

<style scoped>
.wordmark {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
}

.wordmark__text {
  position: relative;
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-weight: 800;
  letter-spacing: 0.01em;
  line-height: 1;
}

.wordmark--lg .wordmark__text {
  font-size: 2.125rem;
}

.wordmark--sm .wordmark__text {
  font-size: 1.375rem;
}

.wordmark__accent {
  color: var(--color-coral);
}

.wordmark__sparkle {
  position: relative;
  top: -0.5em;
  margin-left: 0.1em;
  color: var(--color-pink);
  font-size: 0.5em;
}

.wordmark__motif {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.wordmark__wave {
  width: 3.25rem;
  height: 0.5rem;

  /* The paw + wave motif, used sparingly as the tokens require. Drawn with a
     repeating gradient rather than an asset: it is two colours and a curve. */
  background-image: radial-gradient(
    circle at 50% 100%,
    var(--color-turquoise) 0 45%,
    transparent 46%
  );
  background-size: 0.85rem 0.85rem;
  background-repeat: repeat-x;
}

.wordmark__paw {
  position: relative;
  display: block;
  width: 1rem;
  height: 0.85rem;
  border-radius: 50% 50% 45% 45%;
  background: var(--color-pink);
}

.wordmark__paw::before,
.wordmark__paw i {
  position: absolute;
  width: 0.27rem;
  height: 0.27rem;
  border-radius: var(--radius-pill);
  background: var(--color-pink);
  content: '';
}

.wordmark__paw::before { top: -0.17rem; left: 0.1rem; }
.wordmark__paw i:nth-child(1) { top: -0.29rem; left: 0.37rem; }
.wordmark__paw i:nth-child(2) { top: -0.17rem; right: 0.1rem; }
.wordmark__paw i:nth-child(n + 3) { display: none; }
</style>
