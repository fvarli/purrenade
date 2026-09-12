<script setup lang="ts">
/**
 * Six single-character boxes for a numeric code (v0.3 boards 04 and 05).
 *
 * The design shows six boxes, so six boxes is what this renders — but the
 * usability of that pattern lives entirely in the details, and getting them
 * wrong makes it worse than one plain input:
 *
 *  - **Paste fills every box.** Codes arrive in an email and are pasted. A
 *    per-box `maxlength="1"` without paste handling silently discards five of
 *    the six characters.
 *  - **Backspace moves back** from an empty box, so correcting a mistake does
 *    not require the mouse.
 *  - **Arrow keys move between boxes**, because they are one field to a person.
 *  - **`inputmode="numeric"`** brings up a number pad, and `autocomplete="one-time-code"`
 *    lets the platform offer a code it has seen.
 *  - **A single group label**, so a screen reader announces "verification code"
 *    once rather than six unlabelled boxes.
 *  - Non-digits are rejected on input rather than on submit.
 */
const props = withDefaults(defineProps<{
  modelValue: string
  label: string
  error?: string | null
  disabled?: boolean
  autofocus?: boolean
}>(), {
  error: null,
  disabled: false,
  autofocus: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'complete': [value: string]
}>()

const LENGTH = 6

const boxes = ref<HTMLInputElement[]>([])
const groupId = useId()
const errorId = computed(() => `${groupId}-error`)

const digits = computed<string[]>(() =>
  Array.from({ length: LENGTH }, (_, i) => props.modelValue[i] ?? ''),
)

function commit(next: string): void {
  const cleaned = next.replace(/\D/g, '').slice(0, LENGTH)

  emit('update:modelValue', cleaned)

  if (cleaned.length === LENGTH) emit('complete', cleaned)
}

function focusBox(index: number): void {
  boxes.value[Math.max(0, Math.min(LENGTH - 1, index))]?.focus()
}

function onInput(index: number, event: Event): void {
  const input = event.target as HTMLInputElement
  const typed = input.value.replace(/\D/g, '')

  // A multi-character value here means a paste or a platform autofill landed in
  // one box: spread it across the rest rather than keeping the first digit.
  if (typed.length > 1) {
    const chars = [...props.modelValue.slice(0, index), ...typed].join('').slice(0, LENGTH)

    commit(chars)
    focusBox(chars.length)
    input.value = chars[index] ?? ''

    return
  }

  const chars = digits.value.slice()
  chars[index] = typed

  // Non-digits never reach the model, and the box is cleared so what is on
  // screen matches what is stored.
  input.value = typed

  commit(chars.join(''))

  if (typed) focusBox(index + 1)
}

function onKeydown(index: number, event: KeyboardEvent): void {
  if (event.key === 'Backspace' && !digits.value[index] && index > 0) {
    event.preventDefault()

    const chars = digits.value.slice()
    chars[index - 1] = ''

    commit(chars.join(''))
    focusBox(index - 1)

    return
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    focusBox(index - 1)
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault()
    focusBox(index + 1)
  }
}

function onPaste(event: ClipboardEvent): void {
  event.preventDefault()

  const pasted = (event.clipboardData?.getData('text') ?? '').replace(/\D/g, '').slice(0, LENGTH)

  if (!pasted) return

  commit(pasted)
  focusBox(pasted.length)
}

onMounted(() => {
  if (props.autofocus) focusBox(0)
})
</script>

<template>
  <div
    class="otp"
    role="group"
    :aria-labelledby="groupId"
    :aria-describedby="error ? errorId : undefined"
  >
    <span
      :id="groupId"
      class="otp__label"
    >{{ label }}</span>

    <div class="otp__boxes">
      <input
        v-for="(digit, index) in digits"
        :key="index"
        :ref="el => { if (el) boxes[index] = el as HTMLInputElement }"
        class="otp__box"
        :class="{ 'otp__box--invalid': !!error }"
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        :value="digit"
        :disabled="disabled"
        :aria-label="$t('auth.otp.digit', { position: index + 1, total: 6 })"
        :aria-invalid="error ? 'true' : 'false'"
        @input="onInput(index, $event)"
        @keydown="onKeydown(index, $event)"
        @paste="onPaste"
        @focus="($event.target as HTMLInputElement).select()"
      >
    </div>

    <p
      :id="errorId"
      class="otp__error"
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
.otp {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-items: center;
}

.otp__label {
  color: var(--text-primary);
  font-size: var(--type-caption);
  font-weight: 700;
}

.otp__boxes {
  display: flex;
  gap: var(--space-2);

  /* Wraps rather than overflowing at 360px: six 44px boxes plus gaps exceed
     the narrowest supported viewport once the card padding is taken. */
  flex-wrap: wrap;
  justify-content: center;
}

.otp__box {
  width: var(--touch-min);
  height: 3.25rem;
  padding: 0;
  background: var(--bg-field);
  border: 2px solid var(--line);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-family: var(--font-display);

  /* 1.5rem is above the 16px iOS zoom threshold as well as being the design's
     size, so a focused box never rescales the viewport. */
  font-size: 1.5rem;
  font-weight: 800;
  text-align: center;
  transition: border-color var(--motion-fast) var(--ease-out);
}

/* See AuthField: keyboard focus keeps its ring. On this screen especially —
 * six identical boxes are impossible to navigate without knowing which one has
 * focus. */
.otp__box:focus {
  border-color: var(--color-pink);
}

.otp__box:focus:not(:focus-visible) {
  outline: none;
}

.otp__box--invalid {
  border-color: var(--state-danger);
}

.otp__box:disabled {
  background: var(--color-surface-soft);
}

.otp__error {
  min-height: 1.2em;
  color: var(--state-danger);
  font-size: var(--type-caption);
  font-weight: 700;
  text-align: center;
}
</style>
