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
      // Generated from the backend's OpenAPI document by `npm run
      // contract:generate`, byte for byte, and diffed in CI. Reformatting it
      // would make every regeneration a diff.
      'shared/contracts/api.generated.ts',
    ],
  },
  /*
   * The architectural boundaries.
   *
   * Three things about `no-restricted-imports` shape every rule below, and all
   * three cost this milestone real enforcement before they were understood:
   *
   *   - `patterns[].group` is matched with **gitignore** semantics, where a
   *     leading `#` starts a comment. `'#app'` and `'#imports'` were therefore
   *     dropped silently from every block, and "must not import Nuxt" was never
   *     enforced anywhere. They are expressed as `regex` here instead.
   *   - The rule visits `ImportDeclaration` and `Export*Declaration` only. A
   *     dynamic `import()` is invisible to it, so the domain could have reached
   *     for Phaser through one. `no-restricted-syntax` closes that.
   *   - `files` is an extension allowlist. A `.js`, `.mjs` or `.cjs` file in the
   *     same directory was unrestricted, so the globs name every extension the
   *     bundler will actually load.
   */

  {
    // The game domain must stay pure. These are the dependencies most likely to
    // be added by reflex, and each would silently destroy determinism.
    files: ['game/domain/**/*.{ts,mts,cts,js,mjs,cjs}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['phaser', 'phaser/*'], message: 'game/domain must not import Phaser. Rendering belongs in game/engine.' },
          { regex: '^#(app|imports|nuxt)', message: 'game/domain must not import Nuxt virtual modules. They re-export the whole Vue runtime.' },
          { group: ['vue', 'vue/*', 'pinia'], message: 'game/domain must not import Vue or Pinia. It is pure TypeScript.' },
          // The dependency runs domain → bridge → engine and never back. A
          // domain that imports the engine is a domain that cannot be replayed
          // headlessly, which is the whole point of keeping it pure.
          { group: ['**/engine', '**/engine/**'], message: 'game/domain must not import game/engine. The dependency runs the other way, through game/bridge.' },
          { group: ['**/bridge', '**/bridge/**'], message: 'game/domain must not import game/bridge either. The bridge adapts the domain; the domain does not know it exists.' },
        ],
      }],
      'no-restricted-globals': ['error',
        { name: 'window', message: 'game/domain must not touch the DOM.' },
        { name: 'document', message: 'game/domain must not touch the DOM.' },
        { name: 'performance', message: 'game/domain must take time as an explicit deltaMs parameter.' },
        { name: 'localStorage', message: 'game/domain must not read ambient state. Pass it in.' },
        { name: 'sessionStorage', message: 'game/domain must not read ambient state. Pass it in.' },
        { name: 'fetch', message: 'game/domain performs no I/O.' },
        { name: 'XMLHttpRequest', message: 'game/domain performs no I/O.' },
        { name: 'WebSocket', message: 'game/domain performs no I/O.' },
        { name: 'navigator', message: 'game/domain must not read ambient state. Pass it in.' },
      ],
      'no-restricted-properties': ['error',
        { object: 'Math', property: 'random', message: 'game/domain must use the seeded RNG carried in RunState — determinism is a product requirement.' },
        { object: 'Date', property: 'now', message: 'game/domain must take time as an explicit deltaMs parameter.' },
        { object: 'performance', property: 'now', message: 'game/domain must take time as an explicit deltaMs parameter.' },
        { object: 'globalThis', property: 'performance', message: 'game/domain must take time as an explicit deltaMs parameter.' },
        { object: 'globalThis', property: 'fetch', message: 'game/domain performs no I/O.' },
      ],
    },
  },
  {
    // The wall clock, however it is spelled. `no-restricted-properties` sees
    // `Date.now()` but not `new Date()`, and both are ambient time.
    files: ['game/domain/**/*.{ts,mts,cts,js,mjs,cjs}'],
    rules: {
      'no-restricted-syntax': ['error',
        {
          selector: "ImportExpression > Literal[value=/(^phaser|[\\/]engine([\\/]|$)|[\\/]bridge([\\/]|$)|^#)/]",
          message: 'game/domain must not reach Phaser, the engine, the bridge or Nuxt through a dynamic import either.',
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'game/domain must take time as an explicit deltaMs parameter. `new Date()` is the wall clock too.',
        },
      ],
    },
  },
  {
    // The bridge adapts; it does not render and it does not decide. It sits in
    // the determinism path, so the domain's time and randomness rules apply here
    // too — they were absent, and the bridge could have called Date.now() freely.
    files: ['game/bridge/**/*.{ts,mts,cts,js,mjs,cjs}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['phaser', 'phaser/*'], message: 'game/bridge must not import Phaser. It is the boundary, not a renderer.' },
          { regex: '^#(app|imports|nuxt)', message: 'game/bridge must not import Nuxt virtual modules. They re-export the whole Vue runtime.' },
          { group: ['vue', 'vue/*', 'pinia'], message: 'game/bridge must not import Vue or Pinia. The app consumes it, not the other way round.' },
          { group: ['**/engine', '**/engine/**'], message: 'game/bridge must not import game/engine. The engine imports the bridge.' },
        ],
      }],
      'no-restricted-properties': ['error',
        { object: 'Math', property: 'random', message: 'game/bridge is in the determinism path. Use the seeded RNG carried in RunState.' },
        { object: 'Date', property: 'now', message: 'game/bridge is in the determinism path. Time enters as an explicit delta.' },
      ],
    },
  },
  {
    /*
     * The engine renders, and reaches the rules only through the bridge.
     *
     * The rule below is the one this block claimed to have and did not.
     * `layout.ts` and `input/pointer.ts` both imported `TUNING` straight from
     * the domain, so the engine was reading gameplay configuration directly
     * while three documents described the bridge as the only place the two
     * meet. What the engine legitimately needs is projected as `PLAYFIELD` and
     * `GESTURE` in `game/bridge/engine-config.ts`.
     */
    files: ['game/engine/**/*.{ts,mts,cts,js,mjs,cjs}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['vue', 'vue/*', 'pinia'], message: 'game/engine must not import Vue or Pinia. It talks to the app through run events.' },
          { regex: '^#(app|imports|nuxt)', message: 'game/engine must not import Nuxt virtual modules. They re-export the whole Vue runtime.' },
          { group: ['**/domain', '**/domain/**', '**/game/domain', '**/game/domain/**'], message: 'game/engine must not import game/domain. Take what a renderer needs from game/bridge (PLAYFIELD, GESTURE).' },
        ],
      }],
      'no-restricted-syntax': ['error', {
        selector: "ImportExpression > Literal[value=/[\\/]domain([\\/]|$)/]",
        message: 'game/engine must not reach game/domain through a dynamic import either.',
      }],
    },
  },
  {
    // Phaser must never enter a non-run bundle, and the app must not read the
    // rules directly.
    files: ['app/**/*.{ts,mts,cts,js,mjs,cjs,vue}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['phaser', 'phaser/*'], message: 'Phaser must not be imported from app/. It is lazily loaded on the run route only, through game/engine.' },
          // The app gets coarse run events and nothing else. A component that
          // imports the domain is a component that will eventually read — and
          // then write — gameplay state at 120 Hz.
          { group: ['~~/game/domain', '~~/game/domain/**', '**/game/domain', '**/game/domain/**'], message: 'app/ must not import game/domain. Use the coarse events from game/bridge.' },
        ],
      }],
      'no-restricted-syntax': ['error', {
        selector: "ImportExpression > Literal[value=/(^phaser([\\/]|$)|[\\/]game[\\/]domain([\\/]|$))/]",
        message: 'app/ must not reach Phaser or game/domain through a dynamic import. The engine owns the lazy Phaser import.',
      }],
    },
  },
  {
    // The BFF runs in Nitro. Phaser reads `window` at import time and the game
    // rules have no business on the server, so neither may be reached from here.
    files: ['server/**/*.{ts,mts,cts,js,mjs,cjs}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['phaser', 'phaser/*'], message: 'The server must not import Phaser. It reads `window` at import time.' },
          { regex: '^#(app|imports|nuxt)', message: 'server must not import Nuxt virtual modules. They re-export the whole Vue runtime.' },
          { group: ['**/game/domain', '**/game/domain/**', '**/game/engine', '**/game/engine/**'], message: 'The BFF does not run the game. Server-side validation is ADR-0006 and is not decided.' },
        ],
      }],
    },
  },
)
