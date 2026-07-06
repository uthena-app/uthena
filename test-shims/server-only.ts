// Test shim for `import 'server-only'`. Next.js bundles the real
// `server-only` package and uses it as a build-time marker that
// throws if a server-only module leaks into a client bundle. Vitest
// runs outside Next.js so the real sentinel isn't resolvable — this
// empty stub lets `import 'server-only'` resolve cleanly during
// tests. Production behavior is unchanged (Next.js's own sentinel
// still throws in client builds via the production bundler).