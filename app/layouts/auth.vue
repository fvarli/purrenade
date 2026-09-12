<script setup lang="ts">
/**
 * The layout behind boards 02–07: a card on the seaside ground.
 *
 * The shell is a `<main>` with the card inside it, so a screen reader's
 * landmark navigation works and the skip target is real.
 */
</script>

<template>
  <div class="auth-shell">
    <main class="auth-card">
      <slot />
    </main>
  </div>
</template>
