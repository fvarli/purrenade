<script setup lang="ts">
/**
 * The signed-in landing page.
 *
 * A shell, not the main menu. M2 delivers authentication and access control;
 * board 08 and everything behind it belongs to the milestones that own them, and
 * building a placeholder menu now would be gameplay-adjacent scope.
 *
 * What it does do is make the authenticated state visible, so the manual
 * acceptance pass has somewhere to land and a player is not returned to a blank
 * page after signing in.
 */
const { t } = useI18n()
const auth = useAuthStore()

useHead({ title: () => t('home.title') })
</script>

<template>
  <div class="stack home">
    <UiBrandWordmark />

    <p
      v-if="auth.status === 'unknown'"
      aria-live="polite"
      class="text-caption text-center"
    >
      {{ $t('common.loading') }}
    </p>

    <template v-else-if="auth.isSignedIn">
      <p class="home__greeting">
        {{ $t('home.greeting', { name: auth.user?.display_name ?? '' }) }}
      </p>

      <UiAuthNotice variant="info">
        {{ $t('home.milestoneNotice') }}
      </UiAuthNotice>

      <!-- An administrator who has not enrolled cannot use the admin surface.
           Saying so here, where they land, beats a silent missing link. -->
      <UiAuthNotice
        v-if="auth.needsAdminTwoFactorSetup"
        variant="error"
      >
        {{ $t('home.adminEnrolmentRequired') }}
      </UiAuthNotice>

      <!-- The run surface. Verified players only, matching the approved
           navigation map, where Run sits in the authenticated branch. -->
      <div v-if="auth.isVerified" class="home__play">
        <UiAuthButton
          type="button"
          @click="navigateTo('/run')"
        >
          {{ $t('home.playAction') }}
        </UiAuthButton>

        <p class="text-caption text-muted text-center">
          {{ $t('home.playHint') }}
        </p>
      </div>

      <div class="row row--wrap home__actions">
        <NuxtLink
          class="home__link"
          to="/account/security"
        >
          {{ $t('account.security.navLabel') }}
        </NuxtLink>

        <NuxtLink
          v-if="auth.canUseAdminSurface"
          class="home__link"
          to="/admin"
        >
          {{ $t('admin.navLabel') }}
        </NuxtLink>
      </div>
    </template>

    <template v-else>
      <p class="text-center">
        {{ $t('home.guestLede') }}
      </p>

      <UiAuthButton @click="navigateTo('/auth/login')">
        {{ $t('auth.login.submit') }}
      </UiAuthButton>

      <UiAuthButton
        variant="quiet"
        @click="navigateTo('/auth/register')"
      >
        {{ $t('auth.register.submit') }}
      </UiAuthButton>
    </template>
  </div>
</template>

<style scoped>
.home {
  width: 100%;
  padding-top: var(--space-8);
}

.home__greeting {
  font-family: var(--font-display);
  font-size: var(--type-title);
  font-weight: 800;
  text-align: center;
}

.home__play {
  display: grid;
  gap: var(--space-2);
  justify-items: center;
}

.home__actions {
  justify-content: center;
}

.home__link {
  min-height: var(--touch-min);
  display: inline-flex;
  align-items: center;
  padding: var(--space-2) var(--space-4);
  background: var(--bg-field);
  border-radius: var(--radius-pill);
  box-shadow: var(--elevation-card);
}
</style>
