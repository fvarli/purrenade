<script setup lang="ts">
/**
 * A neutral frame for future rights-cleared character art. It deliberately does
 * not describe a person, clothing, face, or palette for any character.
 */
defineProps<{ muted?: boolean }>()
</script>

<template>
  <div class="character-placeholder" :class="{ 'character-placeholder--muted': muted }" aria-hidden="true">
    <span class="character-placeholder__frame">
      <span class="character-placeholder__sun" />
      <span class="character-placeholder__wave" />
    </span>
    <span class="character-placeholder__base" />
  </div>
</template>

<style scoped>
.character-placeholder { position: relative; display: grid; place-items: center; width: 9rem; height: 12rem; margin: auto; }
.character-placeholder__frame { position: relative; display: block; width: 7rem; height: 8.5rem; overflow: hidden; border: 2px dashed var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface-soft); }
.character-placeholder__sun { position: absolute; top: 1.25rem; right: 1.1rem; width: 1.3rem; height: 1.3rem; border-radius: var(--radius-pill); background: var(--color-yellow); }
.character-placeholder__wave { position: absolute; right: -.75rem; bottom: 1.4rem; left: -.75rem; height: 2.5rem; border-radius: 50% 50% 0 0; background: var(--color-turquoise-soft); }
.character-placeholder__base { position: absolute; bottom: .8rem; width: 7rem; height: .75rem; border-radius: var(--radius-pill); background: var(--color-surface-alt); }
.character-placeholder--muted { filter: grayscale(1); opacity: .5; }
</style>
