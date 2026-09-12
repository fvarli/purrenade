<script setup lang="ts">
/**
 * The strength meter from v0.3 board 07.
 *
 * **This is copy, not policy.** `docs/security/authentication.md` §2 is explicit
 * about it: the server decides whether a password is acceptable, and it checks
 * things this cannot — whether the password appears in a breach corpus, in
 * particular, which no client-side heuristic can know.
 *
 * So the meter is encouragement, and it never blocks a submit. It scores only
 * what is honestly local: length first, because length is the property that
 * actually resists guessing, then variety as a secondary nudge.
 *
 * The score is announced politely, not on every keystroke: a live region that
 * fires per character makes a password field unusable with a screen reader.
 */
const props = defineProps<{ password: string, minLength: number }>()

const SEGMENTS = 4

const score = computed<number>(() => {
  const value = props.password

  if (value.length === 0) return 0

  // Below the server's minimum, nothing else matters — saying "strong" about a
  // password the server will refuse would be a lie the player acts on.
  if (value.length < props.minLength) return 1

  let points = 2

  if (value.length >= props.minLength + 6) points += 1

  const variety = [/\p{Ll}/u, /\p{Lu}/u, /\p{N}/u, /[^\p{L}\p{N}]/u]
    .filter(pattern => pattern.test(value)).length

  if (variety >= 3) points += 1

  return Math.min(points, SEGMENTS)
})

const labelKey = computed(() => {
  if (props.password.length === 0) return null

  return (['', 'weak', 'fair', 'good', 'strong'] as const)[score.value] || 'weak'
})
</script>

<template>
  <div
    v-if="password.length > 0"
    class="strength"
  >
    <div
      class="strength__track"
      aria-hidden="true"
    >
      <span
        v-for="segment in SEGMENTS"
        :key="segment"
        class="strength__segment"
        :class="{ 'strength__segment--filled': segment <= score }"
      />
    </div>

    <!-- Polite, and the text only changes when the band changes, so it is not
         re-announced on every keystroke. -->
    <p
      class="strength__label"
      aria-live="polite"
    >
      <template v-if="labelKey">{{ $t(`auth.password.strength.${labelKey}`) }}</template>
    </p>
  </div>
</template>

<style scoped>
.strength {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.strength__track {
  display: flex;
  gap: var(--space-1);
}

.strength__segment {
  flex: 1;
  height: 0.375rem;
  background: var(--line);
  border-radius: var(--radius-pill);
  transition: background var(--motion-base) var(--ease-out);
}

.strength__segment--filled {
  background: var(--state-success);
}

.strength__label {
  color: var(--color-green-deep);
  font-size: var(--type-caption);
  font-weight: 700;
}
</style>
