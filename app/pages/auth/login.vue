<script setup lang="ts">
/**
 * Board 03 — Giriş.
 *
 * Two outcomes, and the screen's job is to route to the right one: a session, or
 * a two-factor challenge. Nothing about the challenge is held here — the token
 * stays in the BFF's session, so this page only learns that a code is owed.
 */
definePageMeta({ layout: 'auth', middleware: 'guest' })

const { t } = useI18n()
const auth = useAuthStore()
const client = useBffClient()
const route = useRoute()
const { messageFor, fieldMessageFor } = useProblemMessage()

useHead({ title: () => t('auth.login.title') })

const email = ref('')
const password = ref('')
const busy = ref(false)
const problem = ref<ApiProblem | null>(null)

/** An admin whose session lacks a passed challenge is sent here with a reason. */
const reason = computed(() => (route.query.reason === 'two_factor_required'
  ? t('auth.login.reauthenticateForAdmin')
  : null))

const formError = computed(() => {
  if (!problem.value) return null

  // Field-level problems belong on their fields; only the rest is form-level.
  return problem.value.errors ? null : messageFor(problem.value)
})

async function submit(): Promise<void> {
  if (busy.value) return

  busy.value = true
  problem.value = null

  try {
    const result = await client.login({ email: email.value, password: password.value })

    if (result.status === 'two_factor_required') {
      auth.setTwoFactorRequired(result.challenge_expires_at, result.recovery_codes_available)

      await navigateTo('/auth/two-factor')

      return
    }

    // The session rotated upstream, so the cached CSRF token is stale.
    invalidateCsrfToken()
    auth.setUser(result.user)

    await navigateTo(auth.needsEmailVerification
      ? '/auth/verify-email'
      : redirectTarget())
  }
  catch (error) {
    problem.value = error instanceof BffError ? error.problem : toApiProblem(error)
  }
  finally {
    busy.value = false
  }
}

/**
 * Where to go after signing in.
 *
 * Only an in-app path is honoured — see `resolveRedirectTarget`, which is
 * shared with its test so the rule has one definition.
 */
function redirectTarget(): string {
  return resolveRedirectTarget(route.query.redirect)
}
</script>

<template>
  <div>
    <div class="auth-card__banner auth-card__banner--sky">
      <UiBrandWordmark />
    </div>

    <div class="auth-card__body">
      <div class="stack stack--tight">
        <h1 class="auth-card__title">
          {{ $t('auth.login.heading') }}
        </h1>
        <p class="auth-card__lede">
          {{ $t('auth.login.lede') }}
        </p>
      </div>

      <UiAuthNotice
        v-if="reason"
        variant="info"
      >
        {{ reason }}
      </UiAuthNotice>

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
          id="login-email"
          v-model="email"
          :label="$t('auth.fields.email')"
          type="email"
          autocomplete="username"
          inputmode="email"
          :maxlength="255"
          :disabled="busy"
          :error="problem ? fieldMessageFor(problem, 'email') : null"
        />

        <UiPasswordField
          id="login-password"
          v-model="password"
          :label="$t('auth.fields.password')"
          autocomplete="current-password"
          :disabled="busy"
          :error="problem ? fieldMessageFor(problem, 'password') : null"
        />

        <p class="text-caption login__forgot">
          <NuxtLink to="/auth/forgot-password">
            {{ $t('auth.login.forgotPassword') }}
          </NuxtLink>
        </p>

        <UiAuthButton
          type="submit"
          :busy="busy"
          :busy-label="$t('auth.login.submitting')"
        >
          {{ $t('auth.login.submit') }}
        </UiAuthButton>
      </form>

      <p class="text-center text-caption">
        {{ $t('auth.login.noAccount') }}
        <NuxtLink to="/auth/register">
          {{ $t('auth.login.registerLink') }}
        </NuxtLink>
      </p>
    </div>

    <div class="auth-card__footer">
      <UiLocaleSwitcher />
    </div>
  </div>
</template>

<style scoped>
.login__forgot {
  text-align: right;
}
</style>
