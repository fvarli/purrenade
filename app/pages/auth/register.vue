<script setup lang="ts">
/**
 * Board 02 — Kayıt.
 *
 * Registration issues a session immediately, so the player lands on the
 * verification screen able to resend a code. The mint notice below is the
 * design's own "check your spam folder" line, which matters more than it looks:
 * a verification mail that lands in spam is the most common reason a new account
 * is abandoned.
 */
definePageMeta({ layout: 'auth', middleware: 'guest' })

const { t } = useI18n()
const auth = useAuthStore()
const client = useBffClient()
const { messageFor, fieldMessageFor } = useProblemMessage()

useHead({ title: () => t('auth.register.title') })

const displayName = ref('')
const email = ref('')
const password = ref('')
const passwordConfirmation = ref('')
const busy = ref(false)
const problem = ref<ApiProblem | null>(null)

/** Mirrors the server minimum. Client validation mirrors, never replaces, it. */
const MIN_PASSWORD_LENGTH = 12

const formError = computed(() =>
  problem.value && !problem.value.errors ? messageFor(problem.value) : null)

async function submit(): Promise<void> {
  if (busy.value) return

  busy.value = true
  problem.value = null

  try {
    const result = await client.register({
      display_name: displayName.value,
      email: email.value,
      password: password.value,
      password_confirmation: passwordConfirmation.value,
    })

    invalidateCsrfToken()
    auth.setUser(result.user)
    auth.setEmailVerification(result.email_verification)

    await navigateTo('/auth/verify-email')
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
    <div class="auth-card__banner auth-card__banner--pink">
      <UiBrandWordmark />
    </div>

    <div class="auth-card__body">
      <div class="stack stack--tight">
        <h1 class="auth-card__title">
          {{ $t('auth.register.heading') }}
        </h1>
        <p class="auth-card__lede">
          {{ $t('auth.register.lede') }}
        </p>
      </div>

      <UiAuthNotice
        v-if="formError"
        variant="error"
      >
        {{ formError }}
      </UiAuthNotice>

      <form
        class="stack"
        novalidate
        @submit.prevent="submit"
      >
        <UiAuthField
          id="register-display-name"
          v-model="displayName"
          :label="$t('auth.fields.displayName')"
          autocomplete="nickname"
          :maxlength="20"
          :hint="$t('auth.register.displayNameHint')"
          :disabled="busy"
          :error="problem ? fieldMessageFor(problem, 'display_name') : null"
        />

        <UiAuthField
          id="register-email"
          v-model="email"
          :label="$t('auth.fields.email')"
          type="email"
          autocomplete="username"
          inputmode="email"
          :maxlength="255"
          :disabled="busy"
          :error="problem ? fieldMessageFor(problem, 'email') : null"
        />

        <div class="stack stack--tight">
          <UiPasswordField
            id="register-password"
            v-model="password"
            :label="$t('auth.fields.password')"
            autocomplete="new-password"
            :hint="$t('auth.register.passwordHint', { min: MIN_PASSWORD_LENGTH })"
            :disabled="busy"
            :error="problem ? fieldMessageFor(problem, 'password') : null"
          />

          <AuthPasswordStrength
            :password="password"
            :min-length="MIN_PASSWORD_LENGTH"
          />
        </div>

        <UiPasswordField
          id="register-password-confirmation"
          v-model="passwordConfirmation"
          :label="$t('auth.fields.passwordConfirmation')"
          autocomplete="new-password"
          :disabled="busy"
          :error="problem ? fieldMessageFor(problem, 'password_confirmation') : null"
        />

        <UiAuthNotice variant="info">
          {{ $t('auth.register.verificationNotice') }}
        </UiAuthNotice>

        <UiAuthButton
          type="submit"
          :busy="busy"
          :busy-label="$t('auth.register.submitting')"
        >
          {{ $t('auth.register.submit') }}
        </UiAuthButton>
      </form>

      <p class="text-center text-caption">
        {{ $t('auth.register.haveAccount') }}
        <NuxtLink to="/auth/login">
          {{ $t('auth.register.loginLink') }}
        </NuxtLink>
      </p>
    </div>

    <div class="auth-card__footer">
      {{ $t('auth.register.terms') }}
    </div>
  </div>
</template>
