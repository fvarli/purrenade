import { config } from '@vue/test-utils'
import { ref } from 'vue'

/**
 * Component-test harness.
 *
 * The components use two Nuxt-provided things that are not available in a plain
 * mount: the `$t` translation helper and the `useI18n` composable. Both are
 * stubbed with a **real key echo** rather than real messages.
 *
 * That is deliberate. These tests assert *behaviour* — that a label is bound to
 * its input, that paste fills every OTP box, that the toggle flips the input
 * type — and asserting against translated prose would make them fail whenever
 * the copy is improved. The locale files' completeness is checked separately, by
 * key parity.
 *
 * Interpolation is applied, because some behaviour depends on it (the
 * countdown's `{time}`, the OTP box's `{position}`).
 */

function translate(key: string, values?: Record<string, unknown>): string {
  if (!values) return key

  const parameters = Object.entries(values)
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(',')

  return `${key}(${parameters})`
}

config.global.mocks = {
  $t: translate,
  $te: () => true,
}

config.global.provide = {}

/**
 * Real refs, not plain objects.
 *
 * `useI18n()` returns `locale` and `locales` as refs, and Vue unwraps refs in a
 * template. A mock that returns `{ value: 'tr' }` looks equivalent and is not:
 * the template compares the object itself, so `locale === 'tr'` is false and
 * every locale-dependent assertion quietly inverts. A stub that does not behave
 * like the thing it stands in for tests nothing.
 */
;(globalThis as unknown as Record<string, unknown>).useI18n = () => ({
  t: translate,
  te: () => true,
  locale: ref('tr'),
  locales: ref([
    { code: 'tr', name: 'Türkçe' },
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Español' },
  ]),
  setLocale: () => {},
})
