// check-types-fresh.test.ts — Unit tests for the structured FreshnessResult shape.
//
// The actual drift check requires a live DB (it calls `supabase gen
// types` via the wrapper). That's integration-tested in CI, not here.
// What we CAN test in pure isolation is the result-type contract — the
// shape that callers (CI, future pre-commit hooks) consume.
//
// Run: `pnpm test check-types-fresh`.

import { describe, expect, it } from 'vitest'

// We don't import the runtime function (it would try to spawn the
// Supabase CLI). We assert the TYPE shape that callers depend on by
// importing `FreshnessResult` from the runtime module. If the real
// union drifts, the typecheck catches it here.

import type { FreshnessResult } from './check-types-fresh'

// Compile-time sanity check: the type module resolves.
const _typeImportSentinel: FreshnessResult | null = null
void _typeImportSentinel

describe('FreshnessResult shape', () => {
  it('accepts the `fresh` variant with bytes', () => {
    const r: FreshnessResult = { status: 'fresh', bytes: 12345 }
    expect(r.status).toBe('fresh')
    if (r.status === 'fresh') expect(r.bytes).toBe(12345)
  })

  it('accepts the `stale` variant with committedBytes + generatedBytes + diff', () => {
    const r: FreshnessResult = {
      status: 'stale',
      committedBytes: 100,
      generatedBytes: 150,
      diff: '100 committed lines vs 150 fresh lines',
    }
    expect(r.status).toBe('stale')
    if (r.status === 'stale') {
      expect(r.committedBytes).toBe(100)
      expect(r.generatedBytes).toBe(150)
      expect(r.diff).toContain('100 committed lines')
    }
  })

  it('accepts the `missing` variant with reason', () => {
    const r: FreshnessResult = {
      status: 'missing',
      reason: 'no committed types.generated.ts',
    }
    expect(r.status).toBe('missing')
    if (r.status === 'missing') expect(r.reason).toContain('no committed')
  })

  it('accepts the `generation-failed` variant with reason', () => {
    const r: FreshnessResult = {
      status: 'generation-failed',
      reason: 'supabase CLI not found',
    }
    expect(r.status).toBe('generation-failed')
    if (r.status === 'generation-failed') expect(r.reason).toContain('supabase CLI not found')
  })
})
