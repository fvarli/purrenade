// @nuxt/eslint generates a Nuxt-aware flat config; this extends it with the
// boundaries the architecture actually depends on.
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  {
    ignores: [
      'design-reference/**', // reference material — never built, never linted
      '.nuxt/**',
      '.output/**',
      'dist/**',
      'coverage/**',
    ],
  },
  {
    // The game domain must stay pure. These are the two dependencies most likely
    // to be added by reflex, and both would silently destroy determinism.
    files: ['game/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['phaser', 'phaser/*'], message: 'game/domain must not import Phaser. Rendering belongs in game/engine.' },
          { group: ['vue', 'vue/*', '#app', '#imports'], message: 'game/domain must not import Vue or Nuxt. It is pure TypeScript.' },
        ],
      }],
      'no-restricted-globals': ['error',
        { name: 'window', message: 'game/domain must not touch the DOM.' },
        { name: 'document', message: 'game/domain must not touch the DOM.' },
      ],
      'no-restricted-properties': ['error',
        { object: 'Math', property: 'random', message: 'game/domain must use the seeded RNG carried in RunState — determinism is a product requirement.' },
        { object: 'Date', property: 'now', message: 'game/domain must take time as an explicit deltaMs parameter.' },
      ],
    },
  },
  {
    // Phaser must never enter a non-run bundle.
    files: ['app/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['phaser', 'phaser/*'], message: 'Phaser must not be imported from app/. It is lazily loaded on the run route only, through game/engine.' },
        ],
      }],
    },
  },
)
