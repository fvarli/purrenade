<script setup lang="ts">
/**
 * The signed-in landing page.
 *
 * Board 08's real, intentionally non-persistent menu. Progress values are not
 * fabricated: until M9 can provide accepted run data, this screen only exposes
 * the product paths that genuinely exist.
 *
 * ## Two hooks in the template below are contracts, not decoration
 *
 * `data-purrenade-health="guest-home"` on the guest section is what
 * `deploy/bin/health-check.sh` greps for, on the loopback port and again on the
 * public origin. A release whose `/` does not serve it is rolled back.
 *
 * It is an attribute rather than a class deliberately. The contract used to be
 * the class `home__play`, and a production build inlines the stylesheet — so
 * that string sat in the `<head>` as a CSS rule whether or not the element ever
 * rendered. The gate was matching the stylesheet rather than the page, and it
 * passed while proving nothing at all about the body. When the product shell
 * replaced this page the rule went with it, and the next deployment failed a
 * gate it had never really been passing. An attribute casts no such shadow: it
 * appears only where it is rendered.
 *
 * `home__play` on the play button is the E2E interaction hook, and carries no
 * style rule. The two are deliberately separate: the health gate runs
 * unauthenticated and must never depend on a signed-in control existing.
 *
 * Neither string is named in a template comment, because template comments are
 * emitted into dev's server HTML — the string would match itself there.
 * `docs/production/ci-cd.md` records both.
 */
const { t } = useI18n()
const auth = useAuthStore()

useHead({ title: () => t('home.title') })
</script>

<template>
  <div class="product-shell home">

    <!-- Reachable only when the server could not resolve the session — the BFF
         or the API was unreachable inside the render's deadline. Not the common
         path: SSR normally knows the visitor before this component renders.
         Kept because the alternative for that case is the guest branch below,
         which would tell a signed-in player to sign in.

         The class on it is a test hook, and it has to be: `aria-live="polite"`
         alone cannot identify this state, because `UiAuthNotice` carries one
         too, so a test asserting its absence would pass on a page that
         legitimately contains one. Naming the hook here would defeat it —
         template comments are emitted into the server HTML, so the string would
         match itself. -->
    <p
      v-if="auth.status === 'unknown'"
      aria-live="polite"
      class="home__resolving text-caption text-center"
    >
      {{ $t('common.loading') }}
    </p>

    <template v-else-if="auth.isSignedIn">
      <section class="home__hero" aria-labelledby="menu-title">
        <div class="home__sun" aria-hidden="true" />
        <UiBrandWordmark />
        <p id="menu-title" class="home__greeting">
        {{ $t('home.greeting', { name: auth.user?.display_name ?? '' }) }}
        </p>
        <div class="home__sea" aria-hidden="true" />
        <UiCharacterPlaceholder />
      </section>

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
      <div v-if="auth.isVerified" class="home__actions">
        <!-- The class on the button below is the E2E interaction hook described
             in <script setup>. It has no style rule; it exists to be selected. -->
        <UiAuthButton class="home__play" @click="navigateTo('/run')">{{ $t('menu.play') }}</UiAuthButton>
        <div class="home__grid">
          <NuxtLink to="/leaderboard">{{ $t('menu.leaderboard') }}</NuxtLink>
          <NuxtLink to="/characters">{{ $t('menu.characters') }}</NuxtLink>
          <NuxtLink to="/settings">{{ $t('menu.settings') }}</NuxtLink>
          <NuxtLink to="/account/security">{{ $t('account.security.navLabel') }}</NuxtLink>
          <NuxtLink v-if="auth.canUseAdminSurface" to="/admin">{{ $t('admin.navLabel') }}</NuxtLink>
        </div>
      </div>
    </template>

    <template v-else>
      <!-- The deployment health contract is the data attribute below. See the
           note in <script setup>: naming it here would put the string into
           dev's server HTML, where it would match itself. -->
      <section
        class="home__entry"
        data-purrenade-health="guest-home"
        aria-labelledby="entry-title"
      >
        <div class="home__sun" aria-hidden="true" />
        <UiBrandWordmark />
        <p class="home__starring">{{ $t('splash.starring') }}</p>
        <h1 id="entry-title">{{ $t('splash.welcome') }}</h1>
        <UiCharacterPlaceholder />
        <p class="text-muted text-center">{{ $t('home.guestLede') }}</p>
        <UiAuthButton @click="navigateTo('/auth/login')">{{ $t('auth.login.submit') }}</UiAuthButton>
        <UiAuthButton variant="quiet" @click="navigateTo('/auth/register')">{{ $t('auth.register.submit') }}</UiAuthButton>
        <UiLocaleSwitcher />
      </section>
    </template>
  </div>
</template>

<style scoped>
.home { display: grid; align-content: start; gap: var(--space-4); padding-top: var(--space-4); }
.home__hero, .home__entry { position: relative; display: grid; justify-items: center; gap: var(--space-4); overflow: hidden; padding: var(--space-8) var(--space-4); border-radius: var(--radius-lg); background: var(--color-cream); box-shadow: var(--elevation-card); }
.home__hero { min-height: 30rem; }
.home__entry { min-height: calc(100dvh - var(--space-8)); }
.home__sun { position:absolute; top: 2rem; left: 2rem; width: 3.5rem; height: 3.5rem; border-radius: var(--radius-pill); background: var(--color-yellow); }
.home__sea { position:absolute; top: 10rem; right: -8%; left: -8%; height: 9rem; border-radius: 50% 50% 0 0; background: var(--color-turquoise-soft); z-index: 0; }
.home__hero :deep(.wordmark), .home__hero .home__greeting, .home__hero :deep(.character-placeholder) { z-index: 1; }
.home__starring { color: var(--color-turquoise); font-size: var(--type-caption); font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }

.home__greeting {
  font-family: var(--font-display);
  font-size: var(--type-title);
  font-weight: 800;
  text-align: center;
}
.home__actions { display:grid; gap: var(--space-4); }
.home__grid { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
.home__grid a { display:grid; place-items:center; min-height:4.75rem; padding:var(--space-3); background:var(--bg-field); border-radius:var(--radius-md); box-shadow:var(--elevation-card); text-align:center; }
</style>
