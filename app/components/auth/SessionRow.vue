<script setup lang="ts">
import type { AuthSession } from '~/types/auth'

/**
 * One row of the active-sessions list (v0.3 board 20).
 *
 * Shows device, relative last-seen, and a "this device" marker. **No IP and no
 * location**, because none is recorded — AUTH-4 is still OPEN, and a column
 * added now would create a personal-data retention obligation before the
 * decision that governs it.
 *
 * The revoke control is disabled for the current session, so "sign out of this
 * device" never masquerades as ending someone else's.
 */
const props = defineProps<{ session: AuthSession, busy: boolean }>()

defineEmits<{ revoke: [id: string] }>()

const { t, locale } = useI18n()

/**
 * Relative time, localised.
 *
 * `Intl.RelativeTimeFormat` rather than a hand-rolled "x minutes ago": the
 * pluralisation rules differ per locale, and Turkish and Spanish do not agree
 * with English about them.
 */
const lastActive = computed(() => {
  const timestamp = props.session.last_active_at ?? props.session.created_at

  if (!timestamp) return t('account.security.sessionNeverUsed')

  const elapsedMs = Date.now() - new Date(timestamp).getTime()
  const formatter = new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' })

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ]

  for (const [unit, ms] of units) {
    if (Math.abs(elapsedMs) >= ms) {
      return formatter.format(-Math.round(elapsedMs / ms), unit)
    }
  }

  return formatter.format(0, 'minute')
})
</script>

<template>
  <li class="session">
    <div class="session__detail">
      <p class="session__device">
        {{ session.device }}
        <span
          v-if="session.is_current"
          class="session__badge"
        >{{ $t('account.security.thisDevice') }}</span>
      </p>

      <p class="session__meta">
        {{ lastActive }}
        <template v-if="session.two_factor_satisfied">
          · {{ $t('account.security.sessionTwoFactor') }}
        </template>
      </p>
    </div>

    <UiAuthButton
      variant="quiet"
      :busy="busy"
      :disabled="session.is_current"
      @click="$emit('revoke', session.id)"
    >
      {{ $t('account.security.revokeSession') }}
    </UiAuthButton>
  </li>
</template>

<style scoped>
.session {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--line);
  list-style: none;
}

.session:last-child {
  border-bottom: 0;
}

.session__detail {
  min-width: 0;
}

.session__device {
  font-weight: 700;
}

.session__badge {
  display: inline-block;
  margin-left: var(--space-2);
  padding: 0 var(--space-2);
  background: var(--color-mint);
  border-radius: var(--radius-pill);
  color: var(--color-green-deep);
  font-size: var(--type-micro);
  font-weight: 700;
  text-transform: uppercase;
}

.session__meta {
  color: var(--text-secondary);
  font-size: var(--type-caption);
}
</style>
