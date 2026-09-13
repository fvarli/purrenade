<script setup lang="ts">
import type { AuthSession, TwoFactorEnrolmentResponse } from '~/types/auth'

/**
 * Board 20 — Hesap & Güvenlik.
 *
 * Everything a player can do to their own account's security, on one screen:
 * two-factor enrolment and removal, recovery codes, a password change, and the
 * list of signed-in devices.
 *
 * Every destructive or defence-weakening action asks for the current password.
 * That is not belt-and-braces — an open session is not proof that the owner is
 * at the keyboard, and this screen is exactly where a borrowed laptop does
 * damage. The server requires it too; asking here is what makes the requirement
 * a usable prompt rather than a 422.
 */
definePageMeta({ middleware: 'verified' })

const { t } = useI18n()
const route = useRoute()
const auth = useAuthStore()
const client = useBffClient()
const signOut = useSignOut()
const { messageFor, fieldMessageFor } = useProblemMessage()

useHead({ title: () => t('account.security.title') })

type Panel = 'none' | 'enrol' | 'codes' | 'disable' | 'password' | 'revokeAll'

const panel = ref<Panel>('none')
const busy = ref(false)
const problem = ref<ApiProblem | null>(null)
const notice = ref<string | null>(null)

const sessions = ref<AuthSession[]>([])
const sessionsLoading = ref(true)
const revokingId = ref<string | null>(null)

const enrolment = ref<TwoFactorEnrolmentResponse | null>(null)
const recoveryCodes = ref<string[] | null>(null)

const currentPassword = ref('')
const totpCode = ref('')
const newPassword = ref('')
const newPasswordConfirmation = ref('')

const MIN_PASSWORD_LENGTH = 12

/**
 * An administrator sent here to enrol arrives with `?enrol=required`.
 *
 * The banner explains *why* they cannot reach the admin surface, which a bare
 * redirect would not.
 */
const enrolmentRequired = computed(() =>
  route.query.enrol === 'required' || auth.needsAdminTwoFactorSetup)

const errorMessage = computed(() =>
  problem.value && !problem.value.errors ? messageFor(problem.value) : null)

onMounted(loadSessions)

async function loadSessions(): Promise<void> {
  sessionsLoading.value = true

  try {
    const result = await client.sessions()

    sessions.value = result.sessions
  }
  catch (error) {
    problem.value = error instanceof BffError ? error.problem : toApiProblem(error)
  }
  finally {
    sessionsLoading.value = false
  }
}

function resetForms(): void {
  currentPassword.value = ''
  totpCode.value = ''
  newPassword.value = ''
  newPasswordConfirmation.value = ''
  problem.value = null
}

function openPanel(next: Panel): void {
  resetForms()
  notice.value = null
  panel.value = next
}

/** Run an action, funnelling every failure into one place. */
async function run(action: () => Promise<void>): Promise<void> {
  if (busy.value) return

  busy.value = true
  problem.value = null

  try {
    await action()
  }
  catch (error) {
    problem.value = error instanceof BffError ? error.problem : toApiProblem(error)
  }
  finally {
    busy.value = false
  }
}

const beginEnrolment = () => run(async () => {
  enrolment.value = await client.beginTwoFactorEnrolment({ current_password: currentPassword.value })
  currentPassword.value = ''
})

const confirmEnrolment = () => run(async () => {
  const result = await client.confirmTwoFactorEnrolment({ code: totpCode.value })

  auth.setUser(result.user)
  recoveryCodes.value = result.recovery_codes
  enrolment.value = null
  totpCode.value = ''
  panel.value = 'codes'
})

const regenerateCodes = () => run(async () => {
  const result = await client.regenerateRecoveryCodes({ current_password: currentPassword.value })

  recoveryCodes.value = result.recovery_codes
  currentPassword.value = ''
  panel.value = 'codes'
})

const disableTwoFactor = () => run(async () => {
  await client.disableTwoFactor({ current_password: currentPassword.value })
  await auth.bootstrap()

  resetForms()
  panel.value = 'none'
  notice.value = t('account.security.twoFactorDisabled')
})

const changePassword = () => run(async () => {
  await client.changePassword({
    current_password: currentPassword.value,
    password: newPassword.value,
    password_confirmation: newPasswordConfirmation.value,
  })

  // The session rotated, so the cached CSRF token is stale; other devices were
  // signed out, so the list is stale too.
  invalidateCsrfToken()
  resetForms()
  panel.value = 'none'
  notice.value = t('account.security.passwordChanged')

  await loadSessions()
})

const revokeOthers = () => run(async () => {
  const result = await client.revokeOtherSessions({ current_password: currentPassword.value })

  resetForms()
  panel.value = 'none'
  notice.value = t('account.security.otherSessionsRevoked', { count: result.revoked_count })

  await loadSessions()
})

async function revokeSession(id: string): Promise<void> {
  revokingId.value = id

  try {
    const result = await client.revokeSession(id)

    // Revoking one's own session is a sign-out; the BFF already destroyed its
    // session, so staying on this page would show a screen with no credential.
    if (result.was_current) {
      auth.reset()
      await navigateTo('/auth/login')

      return
    }

    await loadSessions()
  }
  catch (error) {
    problem.value = error instanceof BffError ? error.problem : toApiProblem(error)
  }
  finally {
    revokingId.value = null
  }
}

function finishCodes(): void {
  recoveryCodes.value = null
  panel.value = 'none'
  notice.value = t('account.security.recoveryCodesSaved')
}
</script>

<template>
  <div class="stack security">
    <h1 class="security__title">
      {{ $t('account.security.heading') }}
    </h1>

    <UiAuthNotice
      v-if="enrolmentRequired"
      variant="info"
    >
      {{ $t('account.security.adminEnrolmentRequired') }}
    </UiAuthNotice>

    <UiAuthNotice
      v-if="notice"
      variant="success"
    >
      {{ notice }}
    </UiAuthNotice>

    <UiAuthNotice
      v-if="errorMessage"
      variant="error"
    >
      {{ errorMessage }}
    </UiAuthNotice>

    <!-- Recovery codes take over the screen: they are shown once, and burying
         them under other controls invites the player to navigate away. -->
    <section
      v-if="recoveryCodes"
      class="card"
    >
      <h2 class="card__title">
        {{ $t('account.security.recoveryCodesHeading') }}
      </h2>

      <AuthRecoveryCodeList
        :codes="recoveryCodes"
        @acknowledge="finishCodes"
      />
    </section>

    <template v-else>
      <!-- ------------------------------------------------ identity -->
      <section class="card">
        <h2 class="card__title">
          {{ $t('account.security.accountHeading') }}
        </h2>

        <dl class="facts">
          <dt>{{ $t('auth.fields.displayName') }}</dt>
          <dd>{{ auth.user?.display_name }}</dd>

          <dt>{{ $t('auth.fields.email') }}</dt>
          <dd>
            {{ auth.user?.email }}
            <span
              v-if="auth.user?.email_verified"
              class="facts__verified"
            >✓ {{ $t('account.security.verified') }}</span>
          </dd>

          <dt>{{ $t('account.security.role') }}</dt>
          <dd>{{ $t(`account.security.roles.${auth.user?.role ?? 'player'}`) }}</dd>
        </dl>
      </section>

      <!-- ------------------------------------------------ two-factor -->
      <section class="card">
        <h2 class="card__title">
          {{ $t('account.security.twoFactorHeading') }}
        </h2>

        <p class="text-caption text-muted">
          {{ auth.user?.two_factor_enabled
            ? $t('account.security.twoFactorOn')
            : $t('account.security.twoFactorOff') }}
        </p>

        <p
          v-if="auth.user?.two_factor_enabled"
          class="text-caption"
        >
          {{ $t('account.security.recoveryCodesRemaining', { count: auth.recoveryCodesRemaining }) }}
        </p>

        <!-- A player who has spent every code has no way back from a lost
             authenticator. Worth saying plainly. -->
        <UiAuthNotice
          v-if="auth.user?.two_factor_enabled && auth.recoveryCodesRemaining === 0"
          variant="error"
        >
          {{ $t('account.security.noRecoveryCodesLeft') }}
        </UiAuthNotice>

        <div
          v-if="panel !== 'enrol' && panel !== 'disable' && panel !== 'codes'"
          class="row row--wrap"
        >
          <UiAuthButton
            v-if="!auth.user?.two_factor_enabled"
            variant="secondary"
            @click="openPanel('enrol')"
          >
            {{ $t('account.security.enableTwoFactor') }}
          </UiAuthButton>

          <template v-else>
            <UiAuthButton
              variant="quiet"
              @click="openPanel('codes')"
            >
              {{ $t('account.security.regenerateRecoveryCodes') }}
            </UiAuthButton>

            <!-- Absent for an administrator: the server refuses it, and
                 offering a control that cannot work is worse than omitting it. -->
            <UiAuthButton
              v-if="!auth.isAdmin"
              variant="quiet"
              @click="openPanel('disable')"
            >
              {{ $t('account.security.disableTwoFactor') }}
            </UiAuthButton>

            <p
              v-else
              class="text-caption text-muted"
            >
              {{ $t('account.security.adminTwoFactorMandatory') }}
            </p>
          </template>
        </div>

        <!-- Begin enrolment -->
        <form
          v-if="panel === 'enrol' && !enrolment"
          class="stack"
          novalidate
          @submit.prevent="beginEnrolment"
        >
          <UiPasswordField
            id="enrol-current-password"
            v-model="currentPassword"
            :label="$t('auth.fields.currentPassword')"
            autocomplete="current-password"
            :hint="$t('account.security.reauthenticateHint')"
            :disabled="busy"
            :error="problem ? fieldMessageFor(problem, 'current_password') : null"
          />

          <div class="row row--wrap">
            <UiAuthButton
              type="submit"
              variant="secondary"
              :busy="busy"
            >
              {{ $t('common.continue') }}
            </UiAuthButton>
            <UiAuthButton
              variant="quiet"
              @click="openPanel('none')"
            >
              {{ $t('common.cancel') }}
            </UiAuthButton>
          </div>
        </form>

        <!-- Scan, then prove possession -->
        <div
          v-if="enrolment"
          class="stack"
        >
          <p class="text-caption">
            {{ $t('account.security.scanInstruction') }}
          </p>

          <!-- An <img> with a data: URI, never v-html. An image cannot execute
               script; injected markup can. -->
          <img
            class="qr"
            :src="enrolment.qr_code"
            :alt="$t('account.security.qrAlt')"
            width="220"
            height="220"
          >

          <p class="text-caption">
            {{ $t('account.security.manualEntry') }}
            <code class="secret">{{ enrolment.secret }}</code>
          </p>

          <form
            class="stack"
            novalidate
            @submit.prevent="confirmEnrolment"
          >
            <UiOtpInput
              v-model="totpCode"
              :label="$t('account.security.confirmCodeLabel')"
              :disabled="busy"
              :error="problem ? messageFor(problem) : null"
              @complete="confirmEnrolment"
            />

            <UiAuthButton
              type="submit"
              variant="secondary"
              :busy="busy"
              :disabled="totpCode.length !== 6"
            >
              {{ $t('account.security.confirmEnrolment') }}
            </UiAuthButton>
          </form>
        </div>

        <!-- Regenerate recovery codes -->
        <form
          v-if="panel === 'codes'"
          class="stack"
          novalidate
          @submit.prevent="regenerateCodes"
        >
          <UiAuthNotice variant="info">
            {{ $t('account.security.regenerateWarning') }}
          </UiAuthNotice>

          <UiPasswordField
            id="codes-current-password"
            v-model="currentPassword"
            :label="$t('auth.fields.currentPassword')"
            autocomplete="current-password"
            :disabled="busy"
            :error="problem ? fieldMessageFor(problem, 'current_password') : null"
          />

          <div class="row row--wrap">
            <UiAuthButton
              type="submit"
              :busy="busy"
            >
              {{ $t('account.security.regenerateRecoveryCodes') }}
            </UiAuthButton>
            <UiAuthButton
              variant="quiet"
              @click="openPanel('none')"
            >
              {{ $t('common.cancel') }}
            </UiAuthButton>
          </div>
        </form>

        <!-- Disable -->
        <form
          v-if="panel === 'disable'"
          class="stack"
          novalidate
          @submit.prevent="disableTwoFactor"
        >
          <UiAuthNotice variant="error">
            {{ $t('account.security.disableWarning') }}
          </UiAuthNotice>

          <UiPasswordField
            id="disable-current-password"
            v-model="currentPassword"
            :label="$t('auth.fields.currentPassword')"
            autocomplete="current-password"
            :disabled="busy"
            :error="problem ? fieldMessageFor(problem, 'current_password') : null"
          />

          <div class="row row--wrap">
            <UiAuthButton
              type="submit"
              :busy="busy"
            >
              {{ $t('account.security.confirmDisable') }}
            </UiAuthButton>
            <UiAuthButton
              variant="quiet"
              @click="openPanel('none')"
            >
              {{ $t('common.cancel') }}
            </UiAuthButton>
          </div>
        </form>
      </section>

      <!-- ------------------------------------------------ password -->
      <section class="card">
        <h2 class="card__title">
          {{ $t('account.security.passwordHeading') }}
        </h2>

        <UiAuthButton
          v-if="panel !== 'password'"
          variant="quiet"
          @click="openPanel('password')"
        >
          {{ $t('account.security.changePassword') }}
        </UiAuthButton>

        <form
          v-else
          class="stack"
          novalidate
          @submit.prevent="changePassword"
        >
          <UiPasswordField
            id="change-current-password"
            v-model="currentPassword"
            :label="$t('auth.fields.currentPassword')"
            autocomplete="current-password"
            :disabled="busy"
            :error="problem ? fieldMessageFor(problem, 'current_password') : null"
          />

          <div class="stack stack--tight">
            <UiPasswordField
              id="change-new-password"
              v-model="newPassword"
              :label="$t('account.security.newPassword')"
              autocomplete="new-password"
              :hint="$t('auth.register.passwordHint', { min: MIN_PASSWORD_LENGTH })"
              :disabled="busy"
              :error="problem ? fieldMessageFor(problem, 'password') : null"
            />

            <AuthPasswordStrength
              :password="newPassword"
              :min-length="MIN_PASSWORD_LENGTH"
            />
          </div>

          <UiPasswordField
            id="change-new-password-confirmation"
            v-model="newPasswordConfirmation"
            :label="$t('auth.fields.passwordConfirmation')"
            autocomplete="new-password"
            :disabled="busy"
            :error="problem ? fieldMessageFor(problem, 'password_confirmation') : null"
          />

          <UiAuthNotice variant="info">
            {{ $t('account.security.changePasswordNotice') }}
          </UiAuthNotice>

          <div class="row row--wrap">
            <UiAuthButton
              type="submit"
              :busy="busy"
            >
              {{ $t('account.security.changePassword') }}
            </UiAuthButton>
            <UiAuthButton
              variant="quiet"
              @click="openPanel('none')"
            >
              {{ $t('common.cancel') }}
            </UiAuthButton>
          </div>
        </form>
      </section>

      <!-- ------------------------------------------------ sessions -->
      <section class="card">
        <h2 class="card__title">
          {{ $t('account.security.sessionsHeading') }}
        </h2>

        <p class="text-caption text-muted">
          {{ $t('account.security.sessionsLede') }}
        </p>

        <p
          v-if="sessionsLoading"
          class="text-caption"
          aria-live="polite"
        >
          {{ $t('common.loading') }}
        </p>

        <ul
          v-else
          class="sessions"
        >
          <AuthSessionRow
            v-for="session in sessions"
            :key="session.id"
            :session="session"
            :busy="revokingId === session.id"
            @revoke="revokeSession"
          />
        </ul>

        <template v-if="sessions.length > 1">
          <UiAuthButton
            v-if="panel !== 'revokeAll'"
            variant="quiet"
            @click="openPanel('revokeAll')"
          >
            {{ $t('account.security.revokeOthers') }}
          </UiAuthButton>

          <form
            v-else
            class="stack"
            novalidate
            @submit.prevent="revokeOthers"
          >
            <UiPasswordField
              id="revoke-current-password"
              v-model="currentPassword"
              :label="$t('auth.fields.currentPassword')"
              autocomplete="current-password"
              :hint="$t('account.security.revokeOthersHint')"
              :disabled="busy"
              :error="problem ? fieldMessageFor(problem, 'current_password') : null"
            />

            <div class="row row--wrap">
              <UiAuthButton
                type="submit"
                :busy="busy"
              >
                {{ $t('account.security.revokeOthers') }}
              </UiAuthButton>
              <UiAuthButton
                variant="quiet"
                @click="openPanel('none')"
              >
                {{ $t('common.cancel') }}
              </UiAuthButton>
            </div>
          </form>
        </template>
      </section>

      <UiAuthButton
        class="account__sign-out"
        variant="quiet"
        @click="signOut()"
      >
        {{ $t('auth.signOut') }}
      </UiAuthButton>
    </template>
  </div>
</template>

<style scoped>
.security {
  width: 100%;
}

.security__title {
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

.facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-1) var(--space-4);
  margin: 0;
  font-size: var(--type-caption);
}

.facts dt {
  color: var(--text-secondary);
  font-weight: 700;
}

.facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.facts__verified {
  color: var(--color-green-deep);
  font-weight: 700;
}

.qr {
  align-self: center;
  border-radius: var(--radius-md);
}

.secret {
  display: inline-block;
  padding: 0 var(--space-1);
  background: var(--color-surface-soft);
  border-radius: var(--radius-sm);
  font-weight: 700;
  letter-spacing: 0.08em;
  overflow-wrap: anywhere;
  user-select: all;
}

.sessions {
  margin: 0;
  padding: 0;
}
</style>
