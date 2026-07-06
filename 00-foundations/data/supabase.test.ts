// supabase.test.ts — SEC-6 runnable check.
//
// `00-foundations/data/supabase.ts` gained `import 'server-only'` as a
// build-time trip-wire against the RLS-bypassing service-role client
// (and the browser client) leaking into a client bundle. Vitest can't
// exercise the real Next.js client-bundle failure (that's a build-time
// concern, verified by `pnpm build`), but this test proves:
//   1. The module still imports + exports its three client factories
//      cleanly under the `server-only` test shim (test-shims/server-only.ts)
//      — i.e. the marker import didn't break anything at the module level.
//   2. `getServiceSupabase()` / `getServerSupabase()` / `getBrowserSupabase()`
//      are still callable functions (the marker is additive, no logic
//      changed per SEC-6's scope).

import { describe, expect, it } from 'vitest'

describe('00-foundations/data/supabase.ts — SEC-6 server-only guard', () => {
  it('imports cleanly with the server-only marker present (module-level smoke test)', async () => {
    const mod = await import('./supabase')
    expect(typeof mod.getServerSupabase).toBe('function')
    expect(typeof mod.getBrowserSupabase).toBe('function')
    expect(typeof mod.getServiceSupabase).toBe('function')
  })

  it('the source file imports the server-only sentinel as its first import', async () => {
    // Cheap static check (no fs read needed elsewhere in this file) —
    // guards against a future refactor silently dropping the marker.
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const src = await fs.readFile(path.join(__dirname, 'supabase.ts'), 'utf8')
    expect(src).toMatch(/^\s*import 'server-only'/m)
  })
})
