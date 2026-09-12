<script setup lang="ts">
/**
 * A password input with a show/hide toggle (v0.3 board 03: "göster").
 *
 * The toggle is a real `<button type="button">` inside the field, not a styled
 * span: it must be reachable by keyboard and announced as a control, and
 * `type="button"` keeps it from submitting the form it sits in — a genuine bug
 * class, and one that only shows up when someone presses Enter.
 *
 * Its label changes with state and is announced, because "the eye icon" tells a
 * screen-reader user nothing about whether the password is currently visible.
 */
const props = withDefaults(defineProps<{
  id: string
  label: string
  modelValue: string
  autocomplete?: string
  hint?: string
  error?: string | null
  disabled?: boolean
}>(), {
  autocomplete: 'current-password',
  hint: undefined,
  error: null,
  disabled: false,
})

defineEmits<{ 'update:modelValue': [value: string] }>()

const revealed = ref(false)

const hintId = computed(() => `${props.id}-hint`)
const errorId = computed(() => `${props.id}-error`)

const describedBy = computed(() => {
  const ids: string[] = []

  if (props.hint) ids.push(hintId.value)
  if (props.error) ids.push(errorId.value)

  return ids.length > 0 ? ids.join(' ') : undefined
})
</script>

<template>
  <div class="field">
    <label
      class="field__label"
      :for="id"
    >{{ label }}</label>

    <div
      class="field__wrap"
      :class="{ 'field__wrap--invalid': !!error }"
    >
      <input
        :id="id"
        class="field__input"
        :type="revealed ? 'text' : 'password'"
        :value="modelValue"
        :autocomplete="autocomplete"
        required
        :disabled="disabled"
        :aria-invalid="error ? 'true' : 'false'"
        :aria-describedby="describedBy"
        @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      >

      <button
        type="button"
        class="field__toggle"
        :disabled="disabled"
        :aria-pressed="revealed"
        @click="revealed = !revealed"
      >
        {{ revealed ? $t('auth.password.hide') : $t('auth.password.show') }}
      </button>
    </div>

    <p
      v-if="hint"
      :id="hintId"
      class="field__hint"
    >
      {{ hint }}
    </p>

    <p
      :id="errorId"
      class="field__error"
      role="alert"
      aria-live="polite"
    >
      <template v-if="error">
        <span aria-hidden="true">⚠ </span>{{ error }}
      </template>
    </p>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.field__label {
  font-size: var(--type-caption);
  font-weight: 700;
}

.field__wrap {
  display: flex;
  align-items: center;
  background: var(--bg-field);
  border: 2px solid var(--line);
  border-radius: var(--radius-md);
  transition: border-color var(--motion-fast) var(--ease-out);
}

.field__wrap:focus-within {
  border-color: var(--color-turquoise);
}

/* The ring is drawn on the wrapper, not the inner input: the input has no
 * border of its own, so a ring on it would appear inside the field's frame. */
.field__wrap:has(:focus-visible) {
  outline: 3px solid var(--color-ink);
  outline-offset: 2px;
}

.field__wrap--invalid {
  border-color: var(--state-danger);
}

.field__input {
  flex: 1;
  min-width: 0;
  min-height: var(--touch-min);
  padding: var(--space-3) var(--space-4);
  background: transparent;
  border: 0;
  color: var(--text-primary);
  font-family: var(--font-body);
  font-size: 1rem;
}

/* See AuthField: the outline is suppressed for a mouse click only, so the
 * keyboard focus ring survives. */
.field__input:focus:not(:focus-visible) {
  outline: none;
}

.field__toggle {
  flex-shrink: 0;

  /* A 44px target even though the text is small — the touch minimum applies to
     every interactive element, not only the obvious ones. */
  min-width: var(--touch-min);
  min-height: var(--touch-min);
  padding: 0 var(--space-3);
  background: transparent;
  border: 0;
  color: var(--text-secondary);
  font-family: var(--font-body);
  font-size: var(--type-caption);
  font-weight: 700;
  cursor: pointer;
}

.field__toggle:hover:not(:disabled) {
  color: var(--color-pink-deep);
}

.field__hint {
  color: var(--text-secondary);
  font-size: var(--type-caption);
}

.field__error {
  min-height: 1.2em;
  color: var(--state-danger);
  font-size: var(--type-caption);
  font-weight: 700;
}
</style>
