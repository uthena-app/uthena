// ESLint flat config (eslint v9+). The legacy `eslint-config-next`
// package ships with rushstack/eslint-patch that is incompatible with
// ESLint 9. We use a minimal flat config; the full Next.js lint
// integration comes back in PH21 (ship hardening) once we pin a
// working combination. This is tracked in STUBS.md.
import js from '@eslint/js'

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'dist/**',
      'next-env.d.ts',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      '00-foundations/data/types.generated.ts',
      // Legacy static prototype — not our code, not linted.
      'demo/**',
      'mockups/**',
      // Local orchestration tooling (drives the local model). Not shipped app code.
      'qwen-runner/**',
      '.mavis/**',
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': 'off', // typescript-eslint handles it (when we wire it)
      'no-undef': 'off', // TypeScript handles it
    },
  },
]
