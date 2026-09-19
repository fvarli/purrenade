<script setup lang="ts">
/**
 * The signed-in shell.
 *
 * The shared signed-in product frame. It intentionally keeps navigation small:
 * board 08 puts the game menu first, while account/admin remain real links only
 * when their corresponding surfaces are available.
 */
const auth = useAuthStore()
</script>

<template>
  <div class="shell">
    <header class="shell__header">
      <NuxtLink
        to="/"
        class="shell__brand"
      >
        <UiBrandWordmark size="sm" />
      </NuxtLink>

      <nav
        class="shell__nav"
        :aria-label="$t('common.mainNavigation')"
      >
        <NuxtLink v-if="auth.isVerified" to="/settings">
          {{ $t('menu.settings') }}
        </NuxtLink>
        <NuxtLink
          v-if="auth.isVerified"
          to="/account/security"
        >
          {{ $t('account.security.navLabel') }}
        </NuxtLink>

        <!-- Only when this session could actually use it. Offering a link that
             the server will refuse is worse than not offering one. -->
        <NuxtLink
          v-if="auth.canUseAdminSurface"
          to="/admin"
        >
          {{ $t('admin.navLabel') }}
        </NuxtLink>
      </nav>
    </header>

    <main class="shell__main">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
}

.shell__header {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4);
}

.shell__brand {
  text-decoration: none;
}

.shell__nav {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  font-size: var(--type-caption);
}

.shell__main {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-width: var(--layout-product-max);
  margin: 0 auto;
  padding: var(--space-4) var(--space-4) var(--space-12);
}
</style>
