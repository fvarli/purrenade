<script setup lang="ts">
/**
 * The minimum admin surface.
 *
 * Exists to prove the access-control decisions work end to end, and to be honest
 * about what does not exist yet: the approved capability set is M13 work, so the
 * page says so rather than presenting an empty console.
 *
 * The route guard is UX. If it were removed, this page would render and every
 * call it makes would be refused by Laravel — which is the property that makes
 * the guard safe to be only a convenience.
 */
definePageMeta({ middleware: 'admin' })

const { t } = useI18n()
const client = useBffClient()
const { messageFor } = useProblemMessage()

useHead({ title: () => t('admin.title') })

const overview = ref<Awaited<ReturnType<typeof client.adminOverview>> | null>(null)
const problem = ref<ApiProblem | null>(null)
const loading = ref(true)

onMounted(async () => {
  try {
    overview.value = await client.adminOverview()
  }
  catch (error) {
    problem.value = error instanceof BffError ? error.problem : toApiProblem(error)
  }
  finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="stack admin">
    <h1 class="admin__title">
      {{ $t('admin.heading') }}
    </h1>

    <p
      v-if="loading"
      aria-live="polite"
      class="text-caption"
    >
      {{ $t('common.loading') }}
    </p>

    <UiAuthNotice
      v-else-if="problem"
      variant="error"
    >
      {{ messageFor(problem) }}
    </UiAuthNotice>

    <template v-else-if="overview">
      <section class="card">
        <h2 class="card__title">
          {{ $t('admin.accountsHeading') }}
        </h2>

        <dl class="counts">
          <div
            v-for="(value, key) in overview.accounts"
            :key="key"
            class="counts__item"
          >
            <dt>{{ $t(`admin.counts.${key}`) }}</dt>
            <dd>{{ value }}</dd>
          </div>
        </dl>
      </section>

      <UiAuthNotice variant="info">
        {{ $t('admin.capabilitiesPending', { milestone: overview.capabilities.planned_milestone }) }}
      </UiAuthNotice>
    </template>
  </div>
</template>

<style scoped>
.admin {
  width: 100%;
}

.admin__title {
  font-size: var(--type-title);
}

.card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--bg-page);
  border-radius: var(--radius-lg);
  box-shadow: var(--elevation-card);
}

.card__title {
  font-size: var(--type-body-lg);
}

.counts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
  gap: var(--space-3);
  margin: 0;
}

.counts__item dt {
  color: var(--text-secondary);
  font-size: var(--type-caption);
}

.counts__item dd {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--type-title);
  font-weight: 800;
}
</style>
