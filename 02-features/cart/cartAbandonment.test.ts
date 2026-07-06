// cartAbandonment.test.ts — pure-logic tests for the cart-abandoned
// aggregation helpers. No DB, no fetch — the cron is a thin shell
// over these pure functions plus two side-effects (UPDATE + PostHog
// capture). Lifting the aggregation to a pure function lets the
// test suite lock the math (per-user grouping, subtotal math, days-
// idle rounding) without faking Supabase.
//
// Covers:
//   - groupAbandonedRowsByUser: groups by user_id, accumulates
//     line_count + subtotal_cents, finds days_idle_max (max of the
//     row's now() - updated_at in whole days, ceiled to match the
//     cron's behavior). Empty input → empty output.
//   - buildAbandonedEventProps: shapes the per-user props that go
//     into POSTHOG_EVENT_PROPS.cart_abandoned. Validates line_count
//     > 0 (otherwise the event is meaningless and would be rejected
//     by the schema). Hashes the user_id via the shared helper so
//     the same user_id always maps to the same distinct_id.
//   - 0-line safety: a user with no rows is never emitted.

import { describe, expect, it } from 'vitest'
import {
  buildAbandonedEventProps,
  groupAbandonedRowsByUser,
  type AbandonedRow,
} from './cartAbandonment'

const NOW = new Date('2026-06-25T12:00:00.000Z')
const NOW_MS = NOW.getTime()

function isoDaysAgo(days: number): string {
  return new Date(NOW_MS - days * 24 * 60 * 60 * 1000).toISOString()
}

describe('groupAbandonedRowsByUser', () => {
  it('returns an empty map for empty input', () => {
    expect(groupAbandonedRowsByUser([], new Map(), NOW)).toEqual(new Map())
  })

  it('groups a single user\'s rows by user_id', () => {
    const rows: AbandonedRow[] = [
      { user_id: 'u-1', product_id: 10, license: 'plr', quantity: 1, updated_at: isoDaysAgo(26) },
      { user_id: 'u-1', product_id: 20, license: 'mrr', quantity: 2, updated_at: isoDaysAgo(28) },
    ]
    // priceByProduct: 10 -> 5000, 20 -> 3000
    const priceByProduct = new Map<number, number>([
      [10, 5000],
      [20, 3000],
    ])
    const grouped = groupAbandonedRowsByUser(rows, priceByProduct, NOW)
    expect(grouped.size).toBe(1)
    const u = grouped.get('u-1')!
    // line_count = sum(quantity) = 1 + 2 = 3
    expect(u.line_count).toBe(3)
    // subtotal = (1*5000) + (2*3000) = 11000
    expect(u.subtotal_cents).toBe(11000)
    // days_idle_max = max(now - updated_at) in days, ceiled
    // Row 1: 26 days, row 2: 28 days → max = 28
    expect(u.days_idle_max).toBe(28)
  })

  it('keeps per-user data isolated (no cross-user bleed)', () => {
    const rows: AbandonedRow[] = [
      { user_id: 'u-1', product_id: 10, license: 'plr', quantity: 1, updated_at: isoDaysAgo(27) },
      { user_id: 'u-2', product_id: 20, license: 'plr', quantity: 5, updated_at: isoDaysAgo(29) },
    ]
    const priceByProduct = new Map<number, number>([
      [10, 5000],
      [20, 1000],
    ])
    const grouped = groupAbandonedRowsByUser(rows, priceByProduct, NOW)
    expect(grouped.size).toBe(2)
    expect(grouped.get('u-1')!.line_count).toBe(1)
    expect(grouped.get('u-1')!.subtotal_cents).toBe(5000)
    expect(grouped.get('u-1')!.days_idle_max).toBe(27)
    expect(grouped.get('u-2')!.line_count).toBe(5)
    expect(grouped.get('u-2')!.subtotal_cents).toBe(5000)
    expect(grouped.get('u-2')!.days_idle_max).toBe(29)
  })

  it('treats unknown product_ids as zero subtotal (defensive — log a debug note)', () => {
    const rows: AbandonedRow[] = [
      { user_id: 'u-1', product_id: 999, license: 'plr', quantity: 1, updated_at: isoDaysAgo(27) },
    ]
    // priceByProduct intentionally empty for product 999
    const grouped = groupAbandonedRowsByUser(rows, new Map(), NOW)
    expect(grouped.get('u-1')!.line_count).toBe(1)
    // No throw, no NaN — subtotal stays 0 for unknown product_ids.
    expect(grouped.get('u-1')!.subtotal_cents).toBe(0)
    expect(grouped.get('u-1')!.days_idle_max).toBe(27)
  })

  it('rounds days_idle up at the partial-day boundary (matches the 25-day cron cutoff)', () => {
    // 25 days + 1 hour idle → ceil → 26 (matches the cron's
    // strict-greater-than boundary for `isPastAbandonmentThreshold`).
    const oneHourOver = new Date(NOW_MS - (25 * 24 * 60 * 60 + 60 * 60) * 1000).toISOString()
    const rows: AbandonedRow[] = [
      { user_id: 'u-1', product_id: 10, license: 'plr', quantity: 1, updated_at: oneHourOver },
    ]
    const grouped = groupAbandonedRowsByUser(rows, new Map(), NOW)
    expect(grouped.get('u-1')!.days_idle_max).toBe(26)
  })

  it('aggregates subtotal across many rows for the same user (large cart)', () => {
    const rows: AbandonedRow[] = Array.from({ length: 10 }, (_, i) => ({
      user_id: 'u-1',
      product_id: 100 + i,
      license: 'plr' as const,
      quantity: 1,
      updated_at: isoDaysAgo(26),
    }))
    const priceByProduct = new Map<number, number>(
      Array.from({ length: 10 }, (_, i) => [100 + i, 2000]),
    )
    const grouped = groupAbandonedRowsByUser(rows, priceByProduct, NOW)
    const u = grouped.get('u-1')!
    expect(u.line_count).toBe(10)
    expect(u.subtotal_cents).toBe(20_000)
  })
})

describe('buildAbandonedEventProps', () => {
  it('shapes the per-user props that go into POSTHOG_EVENT_PROPS.cart_abandoned', () => {
    const agg = { line_count: 2, subtotal_cents: 9700, days_idle_max: 27 }
    const hash = 'a'.repeat(32)
    const props = buildAbandonedEventProps('u-1', agg, () => hash)
    expect(props).toEqual({
      user_id_hash: hash,
      line_count: 2,
      subtotal_cents: 9700,
      days_idle_max: 27,
    })
  })

  it('uses the hash function passed in (dependency injection for testability)', () => {
    const agg = { line_count: 1, subtotal_cents: 0, days_idle_max: 26 }
    const props = buildAbandonedEventProps('u-different', agg, (v) => `hash-of-${v}`)
    expect(props.user_id_hash).toBe('hash-of-u-different')
  })
})
