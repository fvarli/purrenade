import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

/**
 * Two projects, because the code under test has two genuinely different needs.
 *
 * **`unit` runs in Node.** The majority of gameplay correctness lives in
 * `game/domain`, which is pure and must be provable without a browser — that is
 * a product requirement, not a convenience, and giving those tests a DOM would
 * let a DOM dependency creep in unnoticed. The BFF's pure helpers, the auth
 * store and the error-contract mapping run here too.
 *
 * **`component` runs in happy-dom.** The auth components are where the
 * accessibility and input-handling requirements live — OTP paste, backspace
 * navigation, `aria-describedby` wiring, the password toggle — and none of that
 * can be asserted without a document.
 *
 * Nuxt's own auto-imports are not available in either: these are plain Vitest
 * runs, not `@nuxt/test-utils` environment runs. That is deliberate. Booting
 * Nuxt per test file is slow enough that the suite stops being run, and each
 * test here stubs exactly the globals its subject uses — which also documents
 * what that subject depends on.
 */

const root = fileURLToPath(new URL('.', import.meta.url))

const alias = {
  '~~': root,
  '@@': root,
  '~': fileURLToPath(new URL('./app', import.meta.url)),
  '@': fileURLToPath(new URL('./app', import.meta.url)),
}

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        // Stated rather than inherited from `undefined`. Two modules branch on
        // these, and a test that passes because a constant happened to be
        // undefined is a test that stops meaning anything the day it is defined.
        define: {
          'import.meta.server': 'false',
          'import.meta.client': 'true',
        },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.spec.ts', 'game/**/*.spec.ts'],
          exclude: ['node_modules/**', '.nuxt/**', '.output/**', 'tests/e2e/**', 'tests/unit/**/*.ssr.spec.ts'],
          setupFiles: ['tests/setup/vue-auto-imports.ts'],
        },
      },
      {
        // The same modules, compiled the way the server sees them.
        //
        // `import.meta.server` is a *build-time* constant: esbuild folds it away
        // before a test can reach it, so no stub can flip it and "what this code
        // does during SSR" is simply unreachable from the `unit` project. Two
        // behaviours depend on it and both are load-bearing — `bootstrap()` must
        // not conclude `guest` on the server, and `useBffClient` must never cache
        // a CSRF token there. A second compilation is the only honest way to
        // assert them; the alternative is a comment claiming they hold.
        resolve: { alias },
        define: {
          'import.meta.server': 'true',
          'import.meta.client': 'false',
        },
        test: {
          name: 'unit-ssr',
          environment: 'node',
          include: ['tests/unit/**/*.ssr.spec.ts'],
          exclude: ['node_modules/**', '.nuxt/**', '.output/**'],
          setupFiles: ['tests/setup/vue-auto-imports.ts'],
        },
      },
      {
        // Single-file components need compiling. The plugin arrives with Nuxt's
        // own toolchain, so this adds no dependency — it only tells the
        // component project to use it, which the node project has no need for.
        plugins: [vue()],
        resolve: { alias },
        test: {
          name: 'component',
          environment: 'happy-dom',
          include: ['tests/component/**/*.spec.ts'],
          exclude: ['node_modules/**', '.nuxt/**', '.output/**'],
          setupFiles: [
            'tests/setup/vue-auto-imports.ts',
            'tests/setup/component.ts',
          ],
        },
      },
    ],
  },
})
