import * as vue from 'vue'

/**
 * Provide Vue's reactivity API as globals.
 *
 * Nuxt auto-imports `ref`, `computed`, `watch` and the lifecycle hooks, so
 * application code uses them unqualified. These are plain Vitest runs rather
 * than `@nuxt/test-utils` environment runs — booting Nuxt per test file is slow
 * enough that the suite stops being run — so the auto-imports have to be
 * supplied here.
 *
 * Only Vue's own API, deliberately. Nuxt globals with behaviour —
 * `navigateTo`, `useBffClient`, `useRuntimeConfig` — are **not** stubbed
 * globally: each test stubs the ones its subject uses, which keeps the stub
 * honest and documents that subject's dependencies.
 */
const AUTO_IMPORTS = [
  'ref',
  'shallowRef',
  'computed',
  'reactive',
  'readonly',
  'toRef',
  'toRefs',
  'unref',
  'isRef',
  'watch',
  'watchEffect',
  'nextTick',
  'onMounted',
  'onUnmounted',
  'onBeforeUnmount',
  'useId',
  'defineComponent',
] as const

for (const name of AUTO_IMPORTS) {
  const implementation = (vue as unknown as Record<string, unknown>)[name]

  if (implementation !== undefined) {
    ;(globalThis as unknown as Record<string, unknown>)[name] = implementation
  }
}
