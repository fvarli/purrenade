<script setup lang="ts">
/**
 * Board 06 — Şifremi Unuttum.
 *
 * The success state is **the same whatever happened**, because the server's
 * response is. Saying "we have sent a link" only for known addresses would turn
 * this screen into the account-existence oracle the endpoint was written to
 * avoid — so the copy is deliberately conditional-voiced: *if* that address
 * belongs to an account.
 */
definePageMeta({ layout: 'auth', middleware: 'guest' })

const { t } = useI18n()
const client = useBffClient()
const { messageFor, fieldMessageFor } = useProblemMessage()

useHead({ title: () => t('auth.forgotPassword.title') })

const email = ref('')
const busy = ref(false)
const sent = ref(false)
const problem = ref<ApiProblem | null>(null)

const formError = computed(() =>
  problem.value && !problem.value.errors ? messageFor(problem.value) : null)

async function submit(): Promise<void> {
  if (busy.value) return

  busy.value = true
  problem.value = null

  try {
    await client.forgotPassword({ email: email.value })

    sent.value = true
  }
  catch (error) {
    problem.value = error instanceof BffError ? error.problem : toApiProblem(error)
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div>
    <div class="auth-card__body">
      <div class="stack stack--tight text-center">
        <h1 class="auth-card__title">
          {{ $t('auth.forgotPassword.heading') }}
        </h1>
        <p class="auth-card__lede">
          {{ $t('auth.forgotPassword.lede') }}
        </p>
      </div>

      <UiAuthNotice
        v-if="sent"
        variant="success"
      >
        {{ $t('auth.forgotPassword.sent') }}
      </UiAuthNotice>

      <UiAuthNotice
        v-if="formError"
        variant="error"
      >
        {{ formError }}
      </UiAuthNotice>

      <form
        v-if="!sent"
        class="stack"
        novalidate
        @submit.prevent="submit"
      >
        <UiAuthField
          id="forgot-email"
          v-model="email"
          :label="$t('auth.fields.email')"
          type="email"
          autocomplete="email"
          inputmode="email"
          :maxlength="255"
          :disabled="busy"
          :error="problem ? fieldMessageFor(problem, 'email') : null"
        />

        <UiAuthButton
          type="submit"
          :busy="busy"
          :busy-label="$t('auth.forgotPassword.submitting')"
        >
          {{ $t('auth.forgotPassword.submit') }}
        </UiAuthButton>
      </form>

      <p class="text-center text-caption">
        <NuxtLink to="/auth/login">
          {{ $t('auth.forgotPassword.backToLogin') }}
        </NuxtLink>
      </p>
    </div>
  </div>
</template>
