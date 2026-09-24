<script setup lang="ts">
/**
 * Skor Tablosu — board 15 (M10).
 *
 * Verified players only, like the API it reads. The board itself — tabs,
 * podium, rows, the pinned own entry — is `LeaderboardBoard`; this page is the
 * shell, the title and the way back.
 */
definePageMeta({ middleware: 'verified' })

const { t } = useI18n()

useHead({ title: () => t('leaderboard.title') })
</script>

<template>
  <main class="product-shell leaderboard-page">
    <NuxtLink class="back-link" to="/">← {{ $t('common.back') }}</NuxtLink>
    <h1>{{ $t('leaderboard.title') }}</h1>
    <LeaderboardBoard />
  </main>
</template>

<style scoped>
.leaderboard-page { display: grid; gap: var(--space-4); align-content: start; }
.leaderboard-page > h1 { text-align: center; }
</style>
