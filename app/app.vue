<script setup lang="ts">
/**
 * The application root.
 *
 * `NuxtRouteAnnouncer` is not decoration: a single-page application changes the
 * document without a page load, and without it a screen reader is never told
 * that the route changed. accessibility.md.
 */
const { locale } = useI18n()

useHead({
  htmlAttrs: { lang: locale },
  titleTemplate: title => (title ? `${title} · Purrenade` : 'Purrenade'),
})
</script>

<template>
  <div>
    <NuxtRouteAnnouncer />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </div>
</template>
