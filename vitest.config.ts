import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Minimal vitest config — the existing tests use relative imports and
// work without one. This config adds path-alias resolution so tests
// that transitively import `@foundations/*` modules (e.g. via
// `../log/pino` → `@foundations/env`) can resolve them.
//
// Mirrors the `paths` block in `tsconfig.json`. If you add a new alias,
// add it here too — vitest doesn't auto-pick up tsconfig paths.
//
// `server-only` is a Next.js sentinel that throws on import in client
// bundles. It's bundled inside Next.js and not resolvable from vitest
// — we alias it to an empty module so tests can import server-only
// modules without throwing.

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '@foundations': path.resolve(__dirname, './00-foundations'),
      '@features': path.resolve(__dirname, './02-features'),
      '@platform': path.resolve(__dirname, './04-platform'),
      'server-only': path.resolve(__dirname, './test-shims/server-only.ts'),
    },
  },
  // esbuild is the default transformer. Set the JSX runtime to the
  // React 17+ automatic transform so `.tsx` test files (and the
  // components they import) don't need a manual `import React`.
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    environment: 'node',
    // .test.ts is the existing convention; .test.tsx is allowed for
    // component snapshots (Stepper, future wizard steps, etc.) —
    // JSX is unavoidable for those.
    include: ['**/*.test.ts', '**/*.test.tsx'],
  },
})