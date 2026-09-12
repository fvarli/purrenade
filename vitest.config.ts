import { defineConfig } from 'vitest/config'

// Bootstrap test configuration.
//
// The default environment is `node`, deliberately: the majority of gameplay
// correctness lives in `game/domain`, which is pure and must be provable
// without a browser. Component and Nuxt-environment tests arrive with the
// screens they cover (M4+), using @nuxt/test-utils.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.spec.ts', 'game/**/*.spec.ts'],
    exclude: ['node_modules/**', '.nuxt/**', '.output/**', 'tests/e2e/**'],
  },
})
