<script setup lang="ts">
/**
 * Recovery codes, shown exactly once.
 *
 * They are stored hashed, so there is no endpoint that can show them again —
 * which makes the acknowledgement checkbox meaningful rather than ceremonial:
 * the player is confirming they have saved something that cannot be re-issued
 * without invalidating it.
 *
 * A copy button, not a download: a downloaded file lands wherever the browser
 * puts it, and on a phone that is frequently nowhere the player can find.
 */
const props = defineProps<{ codes: string[] }>()

defineEmits<{ acknowledge: [] }>()

const acknowledged = ref(false)
const copied = ref(false)

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.codes.join('\n'))
    copied.value = true
  }
  catch {
    // Clipboard access can be refused, and there is nothing useful to say about
    // it: the codes are on screen and can be selected by hand.
    copied.value = false
  }
}
</script>

<template>
  <div class="stack">
    <UiAuthNotice variant="info">
      {{ $t('account.security.recoveryCodesNotice') }}
    </UiAuthNotice>

    <ul
      class="codes"
      :aria-label="$t('account.security.recoveryCodesLabel')"
    >
      <li
        v-for="code in codes"
        :key="code"
        class="codes__item"
      >
        {{ code }}
      </li>
    </ul>

    <div class="row row--wrap">
      <UiAuthButton
        variant="quiet"
        @click="copy"
      >
        {{ copied ? $t('common.copied') : $t('common.copy') }}
      </UiAuthButton>
    </div>

    <label class="ack">
      <input
        v-model="acknowledged"
        type="checkbox"
        class="ack__box"
      >
      <span>{{ $t('account.security.recoveryCodesAcknowledge') }}</span>
    </label>

    <UiAuthButton
      :disabled="!acknowledged"
      @click="$emit('acknowledge')"
    >
      {{ $t('common.done') }}
    </UiAuthButton>
  </div>
</template>

<style scoped>
.codes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-4);
  background: var(--color-surface-soft);
  border-radius: var(--radius-md);
  list-style: none;
}

.codes__item {
  font-family: var(--font-body);
  font-size: var(--type-caption);
  font-weight: 700;
  letter-spacing: 0.04em;

  /* Selectable by hand, and wrapping rather than overflowing at 360px. */
  overflow-wrap: anywhere;
  user-select: all;
}

.ack {
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
  font-size: var(--type-caption);
  cursor: pointer;
}

.ack__box {
  /* A real checkbox, sized to the touch minimum. */
  width: 1.5rem;
  height: 1.5rem;
  margin: 0;
  accent-color: var(--action-secondary);
  flex-shrink: 0;
}
</style>
