<script setup lang="ts">
/**
 * One labelled form field.
 *
 * The accessibility requirements live here once, so no screen has to remember
 * them (accessibility.md):
 *
 *  - a real `<label>` bound by `for`/`id` — a placeholder is not a label, and it
 *    disappears the moment someone starts typing;
 *  - the error is bound with `aria-describedby` and `aria-invalid`, so it is
 *    *associated* rather than merely nearby;
 *  - the error is announced by an `aria-live` region, because a validation
 *    message that appears silently after a submit is invisible to a screen
 *    reader;
 *  - `autocomplete` is passed through, so a password manager can do its job.
 */
const props = withDefaults(defineProps<{
  id: string
  label: string
  modelValue: string
  type?: string
  autocomplete?: string
  hint?: string
  error?: string | null
  required?: boolean
  inputmode?: 'text' | 'email' | 'numeric'
  maxlength?: number
  disabled?: boolean
}>(), {
  type: 'text',
  autocomplete: undefined,
  hint: undefined,
  error: null,
  required: true,
  inputmode: undefined,
  maxlength: undefined,
  disabled: false,
})

defineEmits<{ 'update:modelValue': [value: string] }>()

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
    >
      {{ label }}
      <span
        v-if="!required"
        class="field__optional"
      >({{ $t('common.optional') }})</span>
    </label>

    <input
      :id="id"
      class="field__input"
      :class="{ 'field__input--invalid': !!error }"
      :type="type"
      :value="modelValue"
      :autocomplete="autocomplete"
      :inputmode="inputmode"
      :maxlength="maxlength"
      :required="required"
      :disabled="disabled"
      :aria-invalid="error ? 'true' : 'false'"
      :aria-describedby="describedBy"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    >

    <p
      v-if="hint"
      :id="hintId"
      class="field__hint"
    >
      {{ hint }}
    </p>

    <!-- Always rendered, so the live region exists before it has content. A
         region inserted at the same moment as its text is frequently missed. -->
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
  color: var(--text-primary);
  font-size: var(--type-caption);
  font-weight: 700;
}

.field__optional {
  color: var(--text-secondary);
  font-weight: 400;
}

.field__input {
  min-height: var(--touch-min);
  padding: var(--space-3) var(--space-4);
  background: var(--bg-field);
  border: 2px solid var(--line);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-family: var(--font-body);

  /* 1rem, never smaller: iOS Safari zooms the viewport when a focused input's
     text is below 16px, which breaks the layout mid-form. */
  font-size: 1rem;
  transition: border-color var(--motion-fast) var(--ease-out);
}

.field__input::placeholder {
  color: var(--text-secondary);
}

/* `:focus:not(:focus-visible)`, never a bare `:focus`.
 *
 * A bare `.field__input:focus { outline: none }` is later in the cascade than
 * the global `:focus-visible` ring and more specific, so it removes the ring
 * for keyboard users too — leaving the border colour as the only focus signal,
 * which is colour-only and fails for anyone who cannot distinguish it. This
 * form removes the outline for a mouse click and keeps it for the keyboard. */
.field__input:focus {
  border-color: var(--color-turquoise);
}

.field__input:focus:not(:focus-visible) {
  outline: none;
}

.field__input--invalid {
  /* Not colour alone: the message below carries a glyph and is announced. */
  border-color: var(--state-danger);
}

.field__input:disabled {
  background: var(--color-surface-soft);
  cursor: not-allowed;
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
