<script setup lang="ts">
/**
 * Board 04 — E-posta Doğrulama.
 *
 * Six-digit entry with the 42-second resend countdown the design specifies. The
 * countdown is always seeded from the server, so it cannot drift from the
 * server's actual refusal.
 *
 * Behind the `auth` guard rather than `verified`, obviously: this is the screen
 * that exists because the address is unverified.
 */
definePageMeta({ layout: 'auth', middleware: 'auth' })

const { t } = useI18n()
const auth = useAuthStore()
const client = useBffClient()
const signOut = useSignOut()
const { messageFor } = useProblemMessage()
const cooldown = useCooldown()

useHead({ title: () => t('auth.verifyEmail.title') })

const code = ref('')
const busy = ref(false)
const resending = ref(false)
const problem = ref<ApiProblem | null>(null)
const resent = ref(false)

onMounted(() => {
  // Seeded from whatever the server last told us — register, login, or a
  // /auth/me read.
  cooldown.start(auth.emailVerification?.resend_available_in ?? 0)
})

/**
 * An already-verified account has no business here.
 *
 * Reachable by leaving the tab open while verifying on another device, so it is
 * handled rather than left to fail on submit.
 */
watch(() => auth.status, (status) => {
  if (status === 'authenticated' || status === 'admin_two_factor_setup_required') {
    navigateTo('/')
  }
})

const errorMessage = computed(() => (problem.value ? messageFor(problem.value) : null))

async function submit(): Promise<void> {
  if (busy.value || code.value.length !== 6) return

  busy.value = true
  problem.value = null
  resent.value = false

  try {
    const result = await client.verifyEmail({ code: code.value })

    auth.setUser(result.user)

    await navigateTo('/')
  }
  catch (error) {
    problem.value = error instanceof BffError ? error.problem : toApiProblem(error)

    // A wrong code is cleared so the boxes are ready for the next attempt
    // rather than requiring six backspaces.
    code.value = ''
  }
  finally {
    busy.value = false
  }
}

async function resend(): Promise<void> {
  if (resending.value || cooldown.active.value) return

  resending.value = true
  problem.value = null
  resent.value = false

  try {
    const state = await client.resendVerification()

    auth.setEmailVerification(state)
    cooldown.start(state.resend_available_in)
    resent.value = true
  }
  catch (error) {
    const failure = error instanceof BffError ? error.problem : toApiProblem(error)

    problem.value = failure

    // The cooldown and the hourly limit both answer 429 with `retry_after`.
    // Restarting the countdown from it keeps the button honest instead of
    // inviting another refusal.
    if (typeof failure.retry_after === 'number') {
      cooldown.start(failure.retry_after)
    }
  }
  finally {
    resending.value = false
  }
}
</script>

<template>
  <div>
    <div class="auth-card__body">
      <div
        class="auth-badge auth-badge--yellow"
        aria-hidden="true"
      >
        ✉
      </div>

      <div class="stack stack--tight text-center">
        <h1 class="auth-card__title">
          {{ $t('auth.verifyEmail.heading') }}
        </h1>
        <p class="auth-card__lede">
          {{ $t('auth.verifyEmail.lede', { email: auth.user?.email ?? '' }) }}
        </p>
      </div>

      <UiAuthNotice
        v-if="errorMessage"
        variant="error"
      >
        {{ errorMessage }}
      </UiAuthNotice>

      <UiAuthNotice
        v-else-if="resent"
        variant="success"
      >
        {{ $t('auth.verifyEmail.resent') }}
      </UiAuthNotice>

      <form
        class="stack"
        novalidate
        @submit.prevent="submit"
      >
        <UiOtpInput
          v-model="code"
          :label="$t('auth.verifyEmail.codeLabel')"
          :disabled="busy"
          autofocus
          @complete="submit"
        />

        <p class="text-center text-caption">
          <template v-if="cooldown.active.value">
            {{ $t('auth.verifyEmail.resendIn', { time: cooldown.formatted.value }) }}
          </template>
          <UiAuthButton
            v-else
            variant="quiet"
            :busy="resending"
            @click="resend"
          >
            {{ $t('auth.verifyEmail.resend') }}
          </UiAuthButton>
        </p>

        <UiAuthButton
          type="submit"
          :busy="busy"
          :disabled="code.length !== 6"
          :busy-label="$t('auth.verifyEmail.submitting')"
        >
          {{ $t('auth.verifyEmail.submit') }}
        </UiAuthButton>
      </form>

      <UiAuthButton
        variant="quiet"
        @click="signOut()"
      >
        {{ $t('auth.signOut') }}
      </UiAuthButton>
    </div>
  </div>
</template>
