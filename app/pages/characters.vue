<script setup lang="ts">
definePageMeta({ middleware: 'verified' })
const { t } = useI18n()
useHead({ title: () => t('characters.title') })
const locked = ['Büşo', 'Ogito', 'Sero'] as const
</script>

<template>
  <main class="product-shell characters">
    <NuxtLink class="back-link" to="/">← {{ $t('common.back') }}</NuxtLink>
    <h1>{{ $t('characters.title') }}</h1>
    <section class="characters__featured surface-card" :aria-label="$t('characters.aysenur')">
      <p class="characters__badge">★ {{ $t('characters.ourStar') }}</p>
      <UiCharacterPlaceholder />
      <h2>{{ $t('characters.aysenur') }}</h2>
      <p>{{ $t('characters.aysenurLede') }}</p>
      <p class="characters__power">{{ $t('characters.power') }}: SLAYYY</p>
    </section>
    <div class="characters__locked" :aria-label="$t('characters.lockedGroup')">
      <article v-for="name in locked" :key="name" class="characters__lock surface-card">
        <UiCharacterPlaceholder muted />
        <h2>{{ name }}</h2><p>🔒 {{ $t('characters.locked') }}</p>
      </article>
    </div>
    <p class="text-muted text-center">{{ $t('characters.artNote') }}</p>
    <UiAuthButton variant="secondary" @click="navigateTo('/run')">{{ $t('characters.playWith') }}</UiAuthButton>
  </main>
</template>

<style scoped>
.characters { display:grid; gap:var(--space-4); align-content:start; }.characters > h1{text-align:center}.characters__featured{display:grid;justify-items:center;padding:var(--space-6);text-align:center}.characters__badge{padding:var(--space-2) var(--space-4);border-radius:var(--radius-pill);background:var(--color-yellow);font-weight:700}.characters__power{color:var(--color-pink-deep);font-weight:700}.characters__locked{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-2)}.characters__lock{padding:var(--space-2);text-align:center;font-size:var(--type-caption)}.characters__lock :deep(.character-placeholder){width:4.25rem;height:5.5rem}.characters__lock :deep(.character-placeholder__frame){width:3.2rem;height:3.7rem;border-radius:var(--radius-sm)}.characters__lock :deep(.character-placeholder__sun){top:.55rem;right:.45rem;width:.65rem;height:.65rem}.characters__lock :deep(.character-placeholder__wave){bottom:.55rem;height:1.2rem}.characters__lock :deep(.character-placeholder__base){bottom:.35rem;width:3.2rem;height:.4rem}
</style>
