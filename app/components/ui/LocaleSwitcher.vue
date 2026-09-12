<script setup lang="ts">
/**
 * Türkçe / English / Español (v0.3 board 03).
 *
 * On the **login** screen, which is the load-bearing detail: the language
 * switcher appears before a session exists, so locale has to work without one.
 * The choice is held by the i18n cookie until a profile can own it, at which
 * point the server value wins (state-management.md §4).
 *
 * Real `<button>`s in a labelled group with `aria-pressed`, not a select: three
 * options read better as a segmented control, and the current one must be
 * announced as pressed rather than merely looking different.
 */
const { locale, locales, setLocale } = useI18n()

const options = computed(() =>
  (locales.value as Array<{ code: string, name?: string }>).map(entry => ({
    code: entry.code,
    name: entry.name ?? entry.code,
  })),
)
</script>

<template>
  <div
    class="locales"
    role="group"
    :aria-label="$t('common.language')"
  >
    <button
      v-for="option in options"
      :key="option.code"
      type="button"
      class="locales__option"
      :class="{ 'locales__option--active': locale === option.code }"
      :aria-pressed="locale === option.code"
      @click="setLocale(option.code as typeof locale)"
    >
      {{ option.name }}
    </button>
  </div>
</template>

<style scoped>
.locales {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: center;
}

.locales__option {
  min-height: var(--touch-min);
  padding: var(--space-2) var(--space-4);
  background: var(--bg-field);
  border: 2px solid var(--line);
  border-radius: var(--radius-pill);
  color: var(--text-secondary);
  font-family: var(--font-body);
  font-size: var(--type-caption);
  font-weight: 700;
  cursor: pointer;
  transition:
    background var(--motion-fast) var(--ease-out),
    color var(--motion-fast) var(--ease-out);
}

.locales__option--active {
  background: var(--color-ink);
  border-color: var(--color-ink);
  color: var(--color-cream);
}
</style>
