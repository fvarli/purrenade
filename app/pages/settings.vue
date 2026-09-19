<script setup lang="ts">
definePageMeta({ middleware: 'verified' })
const { t } = useI18n()
const signOut = useSignOut()
useHead({ title: () => t('settings.title') })
</script>

<template>
  <main class="product-shell settings">
    <NuxtLink class="back-link" to="/">← {{ $t('common.back') }}</NuxtLink>
    <h1>{{ $t('settings.title') }}</h1>
    <section class="surface-card settings__section"><h2>{{ $t('settings.language') }}</h2><UiLocaleSwitcher /></section>
    <section class="surface-card settings__section"><h2>{{ $t('settings.account') }}</h2><NuxtLink to="/account/security">{{ $t('account.security.navLabel') }} →</NuxtLink></section>
    <button class="settings__signout" type="button" @click="signOut()">{{ $t('auth.signOut') }}</button>
  </main>
</template>

<style scoped>
.settings{display:grid;gap:var(--space-4);align-content:start}.settings>h1{text-align:center}.settings__section{display:grid;gap:var(--space-3);padding:var(--space-6)}.settings__signout{min-height:var(--touch-min);border:0;background:transparent;color:var(--state-danger);font:700 var(--type-body) var(--font-body);cursor:pointer}
</style>
