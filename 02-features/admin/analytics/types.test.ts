// parseAnalyticsRange.test.ts — pure-function tests for the URL-param
// parser. No DB / Supabase mocks needed — the parser is a pure
// function with an injectable `now` for time-bucketing the
// "last N days" math.

import { describe, expect, it } from 'vitest'
import {
  ANALYTICS_RANGE_DAYS,
  DEFAULT_ANALYTICS_RANGE_PRESET,
  MAX_ANALYTICS_RANGE_DAYS,
  parseAnalyticsRange,
  type AnalyticsRange,
} from './types'

// Pin "now" to a stable UTC timestamp so the assertions are deterministic.
const NOW_MS = Date.UTC(2026, 6, 1, 12, 0, 0) // 2026-07-01 12:00:00 UTC

describe('parseAnalyticsRange', () => {
  it('returns the default 30d preset for empty / missing input', () => {
    const out = parseAnalyticsRange({}, NOW_MS)
    expect(out.kind).toBe('preset')
    if (out.kind === 'preset') {
      expect(out.preset).toBe(DEFAULT_ANALYTICS_RANGE_PRESET)
    }
    expect(out.days).toBe(ANALYTICS_RANGE_DAYS['30d'])
  })

  it('returns the default for null / undefined / non-object input', () => {
    expect(parseAnalyticsRange(null, NOW_MS).days).toBe(30)
    expect(parseAnalyticsRange(undefined, NOW_MS).days).toBe(30)
    expect(parseAnalyticsRange('not-an-object', NOW_MS).days).toBe(30)
    expect(parseAnalyticsRange(42, NOW_MS).days).toBe(30)
    expect(parseAnalyticsRange(true, NOW_MS).days).toBe(30)
  })

  it('accepts each preset and applies the correct day count', () => {
    for (const preset of ['30d', '60d', '90d', '365d'] as const) {
      const out = parseAnalyticsRange({ preset }, NOW_MS)
      expect(out.kind).toBe('preset')
      if (out.kind === 'preset') {
        expect(out.preset).toBe(preset)
      }
      expect(out.days).toBe(ANALYTICS_RANGE_DAYS[preset])
    }
  })

  it('rejects unknown preset values (fail-soft to default)', () => {
    const out = parseAnalyticsRange({ preset: '7d' }, NOW_MS)
    expect(out.days).toBe(30)
  })

  it('rejects non-enum preset values (SQLi / arbitrary strings)', () => {
    expect(parseAnalyticsRange({ preset: "30d'; drop" }, NOW_MS).days).toBe(30)
    expect(parseAnalyticsRange({ preset: '<script>' }, NOW_MS).days).toBe(30)
    expect(parseAnalyticsRange({ preset: '' }, NOW_MS).days).toBe(30)
  })

  it('parses valid custom from + to range', () => {
    const out = parseAnalyticsRange(
      { from: '2026-06-01', to: '2026-06-15' },
      NOW_MS,
    )
    expect(out.kind).toBe('custom')
    if (out.kind === 'custom') {
      expect(out.fromIso).toBe('2026-06-01')
      expect(out.toIso).toBe('2026-06-15')
      expect(out.days).toBe(15)
    }
  })

  it('rejects malformed from / to (non-ISO, non-calendar)', () => {
    expect(parseAnalyticsRange({ from: '2026-13-01', to: '2026-12-01' }, NOW_MS).days).toBe(30)
    expect(parseAnalyticsRange({ from: '2026-02-30', to: '2026-03-01' }, NOW_MS).days).toBe(30)
    expect(parseAnalyticsRange({ from: 'not-a-date', to: '2026-12-01' }, NOW_MS).days).toBe(30)
    expect(parseAnalyticsRange({ from: '2026-06-01', to: 'oops' }, NOW_MS).days).toBe(30)
  })

  it('rejects from > to (fail-soft to default)', () => {
    expect(
      parseAnalyticsRange({ from: '2026-06-15', to: '2026-06-01' }, NOW_MS).days,
    ).toBe(30)
  })

  it('rejects range > 365 days (per spec max)', () => {
    const out = parseAnalyticsRange(
      { from: '2025-01-01', to: '2026-12-31' },
      NOW_MS,
    )
    expect(out.days).toBe(MAX_ANALYTICS_RANGE_DAYS === 365 ? 30 : out.days)
  })

  it('rejects unknown extra keys (.strict() enforcement)', () => {
    const out = parseAnalyticsRange(
      { preset: '60d', email: 'admin@uthena.com' },
      NOW_MS,
    )
    // .strict() rejects unknown keys → falls back to default
    expect(out.days).toBe(30)
  })

  it('preset wins over from/to when both present', () => {
    const out = parseAnalyticsRange(
      { preset: '60d', from: '2026-06-01', to: '2026-06-15' },
      NOW_MS,
    )
    expect(out.kind).toBe('preset')
    if (out.kind === 'preset') {
      expect(out.preset).toBe('60d')
    }
  })

  it('computes the correct from/to isos for the default 30d preset', () => {
    const out = parseAnalyticsRange({}, NOW_MS)
    expect(out.kind).toBe('preset')
    if (out.kind === 'preset') {
      // 30 days back from 2026-07-01 → 2026-06-02
      expect(out.fromIso).toBe('2026-06-02')
      expect(out.toIso).toBe('2026-07-01')
    }
  })

  it('returns a valid from/to for the 365d preset (one full year)', () => {
    const out = parseAnalyticsRange({ preset: '365d' }, NOW_MS)
    expect(out.days).toBe(365)
    expect(out.kind).toBe('preset')
    if (out.kind === 'preset') {
      expect(out.fromIso).toBe('2025-07-02')
      expect(out.toIso).toBe('2026-07-01')
    }
  })

  it('handles Date.now() default when no now is injected', () => {
    // Smoke test — the result must have a sensible day count regardless
    // of wall-clock. We don't pin the exact dates here.
    const out = parseAnalyticsRange({ preset: '30d' })
    expect(out.days).toBe(30)
  })

  it('PII safety: parser never echoes the input email / name back', () => {
    const out: AnalyticsRange = parseAnalyticsRange(
      { q: 'admin@uthena.com', name: 'Admin' },
      NOW_MS,
    )
    // The strict schema drops the unknown keys + we never include the
    // input shape in the output. The output is a flat AnalyticsRange.
    const serialized = JSON.stringify(out)
    expect(serialized).not.toContain('admin@uthena.com')
    expect(serialized).not.toContain('Admin')
  })
})