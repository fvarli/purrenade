<script setup lang="ts">
/**
 * Board 07 — Şifre Yenileme.
 *
 * The token and address arrive in the query, from the emailed link. Read as
 * plain strings and posted straight back through the BFF; the page makes no
 * claim about them and the server verifies the pair.
 *
 * On success, the player is told **their 2FA is untouched** — because it is, and
 * because "did I just lose my authenticator?" is the obvious worry at this
 * moment. The invariant is enforced server-side and pinned by gate S8; this is
 * the copy that makes it visible.
 */
definePageMeta({ layout: 'auth', middleware: 'guest' })

const { t } = useI18n()
const route = useRoute()
const client = useBffClient()
const { messageFor, fieldMessageFor } = useProblemMessage()

useHead({ title: () => t('auth.resetPassword.title') })

const MIN_PASSWORD_LENGTH = 12

const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''))
const email = computed(() => (typeof route.query.email === 'string' ? route.query.email : ''))

const password = ref('')
const passwordConfirmation = ref('')
const busy = ref(false)
const done = ref(false)
const problem = ref<ApiProblem | null>(null)

/** A link that lost half of itself cannot work; say so rather than failing later. */
const linkIncomplete = computed(() => token.value === '' || email.value === '')

const formError = computed(() =>
  problem.value && !problem.value.errors ? messageFor(problem.value) : null)

async function submit(): Promise<void> {
  if (busy.value || linkIncomplete.value) return

  busy.value = true
  problem.value = null

  try {
    await client.resetPassword({
      token: token.value,
      email: email.value,
      password: password.value,
      password_confirmation: passwordConfirmation.value,
    })

    // Every session was revoked upstream, and the BFF destroyed its own.
    invalidateCsrfToken()
    done.value = true
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
      <div class="stack stack--tight">
        <h1 class="auth-card__title">
          {{ $t('auth.resetPassword.heading') }}
        </h1>
        <p class="auth-card__lede">
          {{ $t('auth.resetPassword.lede') }}
        </p>
      </div>

      <template v-if="done">
        <UiAuthNotice variant="success">
          {{ $t('auth.resetPassword.done') }}
        </UiAuthNotice>

        <UiAuthNotice variant="info">
          {{ $t('auth.resetPassword.twoFactorUnaffected') }}
        </UiAuthNotice>

        <UiAuthButton @click="navigateTo('/auth/login')">
          {{ $t('auth.resetPassword.goToLogin') }}
        </UiAuthButton>
      </template>

      <template v-else>
        <UiAuthNotice
          v-if="linkIncomplete"
          variant="error"
        >
          {{ $t('auth.resetPassword.linkIncomplete') }}
        </UiAuthNotice>

        <UiAuthNotice
          v-else-if="formError"
          variant="error"
        >
          {{ formError }}
        </UiAuthNotice>

        <form
          class="stack"
          novalidate
          @submit.prevent="submit"
        >
          <div class="stack stack--tight">
            <UiPasswordField
              id="reset-password"
              v-model="password"
              :label="$t('auth.resetPassword.newPassword')"
              autocomplete="new-password"
              :hint="$t('auth.register.passwordHint', { min: MIN_PASSWORD_LENGTH })"
              :disabled="busy || linkIncomplete"
              :error="problem ? fieldMessageFor(problem, 'password') : null"
            />

            <AuthPasswordStrength
              :password="password"
              :min-length="MIN_PASSWORD_LENGTH"
            />
          </div>

          <UiPasswordField
            id="reset-password-confirmation"
            v-model="passwordConfirmation"
            :label="$t('auth.fields.passwordConfirmation')"
            autocomplete="new-password"
            :disabled="busy || linkIncomplete"
            :error="problem ? fieldMessageFor(problem, 'password_confirmation') : null"
          />

          <UiAuthButton
            type="submit"
            :busy="busy"
            :disabled="linkIncomplete"
            :busy-label="$t('auth.resetPassword.submitting')"
          >
            {{ $t('auth.resetPassword.submit') }}
          </UiAuthButton>
        </form>

        <p class="text-center text-caption">
          <NuxtLink to="/auth/forgot-password">
            {{ $t('auth.resetPassword.requestNewLink') }}
          </NuxtLink>
        </p>
      </template>
    </div>
  </div>
</template>
