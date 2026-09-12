<script setup lang="ts">
/**
 * Board 05 — 2FA Doğrulama.
 *
 * Turquoise confirm button, "use a backup code" fallback, and the note that 2FA
 * is recommended for everyone and mandatory for admins.
 *
 * The challenge token is **not** here. It lives in the BFF's server-side
 * session, so this screen submits only the code the player typed — which is
 * what stops an XSS defect from yielding a first-factor-complete credential.
 */
definePageMeta({ layout: 'auth' })

const { t } = useI18n()
const auth = useAuthStore()
const client = useBffClient()
const signOut = useSignOut()
const { messageFor } = useProblemMessage()

useHead({ title: () => t('auth.twoFactor.title') })

const code = ref('')
const recoveryCode = ref('')
const usingRecoveryCode = ref(false)
const busy = ref(false)
const problem = ref<ApiProblem | null>(null)

/**
 * No challenge in progress: back to login.
 *
 * Also covers the expiry case — `/auth/me` drops a stranded session, so the
 * status becomes `guest` and this fires.
 */
watchEffect(() => {
  if (auth.status !== 'unknown' && !auth.needsTwoFactorChallenge) {
    navigateTo(auth.isSignedIn ? '/' : '/auth/login')
  }
})

const errorMessage = computed(() => (problem.value ? messageFor(problem.value) : null))

const canSubmit = computed(() => (usingRecoveryCode.value
  ? recoveryCode.value.trim().length > 0
  : code.value.length === 6))

async function submit(): Promise<void> {
  if (busy.value || !canSubmit.value) return

  busy.value = true
  problem.value = null

  try {
    const result = await client.completeTwoFactorChallenge(
      usingRecoveryCode.value
        ? { recovery_code: recoveryCode.value.trim() }
        : { code: code.value },
    )

    // The session rotated again on passing the second factor.
    invalidateCsrfToken()
    auth.setUser(result.user)

    await navigateTo('/')
  }
  catch (error) {
    problem.value = error instanceof BffError ? error.problem : toApiProblem(error)
    code.value = ''
    recoveryCode.value = ''
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div>
    <div class="auth-card__body">
      <div
        class="auth-badge auth-badge--mint"
        aria-hidden="true"
      >
        🔒
      </div>

      <div class="stack stack--tight text-center">
        <h1 class="auth-card__title">
          {{ $t('auth.twoFactor.heading') }}
        </h1>
        <p class="auth-card__lede">
          {{ usingRecoveryCode ? $t('auth.twoFactor.recoveryLede') : $t('auth.twoFactor.lede') }}
        </p>
      </div>

      <UiAuthNotice
        v-if="errorMessage"
        variant="error"
      >
        {{ errorMessage }}
      </UiAuthNotice>

      <form
        class="stack"
        novalidate
        @submit.prevent="submit"
      >
        <UiOtpInput
          v-if="!usingRecoveryCode"
          v-model="code"
          :label="$t('auth.twoFactor.codeLabel')"
          :disabled="busy"
          autofocus
          @complete="submit"
        />

        <UiAuthField
          v-else
          id="recovery-code"
          v-model="recoveryCode"
          :label="$t('auth.twoFactor.recoveryCodeLabel')"
          autocomplete="off"
          :maxlength="64"
          :hint="$t('auth.twoFactor.recoveryCodeHint')"
          :disabled="busy"
        />

        <UiAuthButton
          type="submit"
          variant="secondary"
          :busy="busy"
          :disabled="!canSubmit"
          :busy-label="$t('auth.twoFactor.submitting')"
        >
          {{ $t('auth.twoFactor.submit') }}
        </UiAuthButton>

        <!-- Offered only when a recovery code exists. A fallback that cannot
             work is worse than no fallback: the player spends their remaining
             calm on it. -->
        <UiAuthButton
          v-if="auth.recoveryCodesAvailable || usingRecoveryCode"
          variant="quiet"
          @click="usingRecoveryCode = !usingRecoveryCode"
        >
          {{ usingRecoveryCode ? $t('auth.twoFactor.useAuthenticator') : $t('auth.twoFactor.useRecoveryCode') }}
        </UiAuthButton>
      </form>

      <UiAuthButton
        variant="quiet"
        @click="signOut()"
      >
        {{ $t('auth.twoFactor.backToLogin') }}
      </UiAuthButton>
    </div>

    <div class="auth-card__footer">
      <span class="notice notice--info">{{ $t('auth.twoFactor.footerNote') }}</span>
    </div>
  </div>
</template>
