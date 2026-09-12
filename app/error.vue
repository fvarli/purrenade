<script setup lang="ts">
import type { NuxtError } from '#app'

/**
 * The page a browser gets for a route that is not one.
 *
 * Without this file Nuxt renders its own error page, which in development
 * carries the stack trace and the source of whatever threw. The same shape of
 * gap the BFF's `[...unmatched]` handler closes for `/api/`: the surface had a
 * contract everywhere except where nothing had been routed.
 *
 * Built on the `auth` layout rather than on styling of its own — it is the same
 * card on the same ground, and a second implementation of that would be a
 * second thing to keep in step.
 *
 * It reads the status and says nothing further about what happened. An error
 * page is not the place to be informative about internals.
 */
const props = defineProps<{ error: NuxtError }>()

const { t } = useI18n()

const notFound = computed(() => props.error?.statusCode === 404)

function goHome(): void {
  clearError({ redirect: '/' })
}
</script>

<template>
  <NuxtLayout name="auth">
    <div class="error-page">
      <p class="error-page__status">
        {{ error?.statusCode ?? 500 }}
      </p>

      <h1 class="error-page__title">
        {{ notFound ? t('errors.page.notFound.title') : t('errors.page.generic.title') }}
      </h1>

      <p class="error-page__body">
        {{ notFound ? t('errors.page.notFound.body') : t('errors.page.generic.body') }}
      </p>

      <UiAuthButton type="button" @click="goHome">
        {{ t('errors.page.action') }}
      </UiAuthButton>
    </div>
  </NuxtLayout>
</template>

<style scoped>
.error-page {
  text-align: center;
}

.error-page__status {
  margin: 0;
  font-family: var(--font-display);
  font-size: 3rem;
  line-height: 1;
  color: var(--color-turquoise);
}

.error-page__title {
  margin-block: var(--space-3) 0;
  font-family: var(--font-display);
  color: var(--color-ink);
}

.error-page__body {
  margin-block: var(--space-2) var(--space-6);
  color: var(--color-text-muted);
}
</style>
