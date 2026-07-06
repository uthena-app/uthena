// cartAbandonment.ts — pure aggregation helpers for the cart-
// abandonment detection cron (P4.6).
//
// The cron in `04-platform/ci/scripts/cron/detect-abandoned-carts.ts`
// is a thin shell over these functions plus two side-effects:
//   1. `UPDATE cart_items SET status='abandoned' WHERE status='active'
//       AND updated_at < cutoff RETURNING ...` (Postgres).
//   2. `trackPosthogServer('cart_abandoned', props, distinctId)`
//       (PostHog HTTP capture).
//
// Lifting the aggregation here keeps the cron readable AND lets the
// unit-test suite lock the per-user math (line_count, subtotal_cents,
// days_idle_max) without faking Supabase or fetch.
//
// PII safety: the user_id never leaves this module as a raw UUID.
// The cron hashes it via `hashIdentifierForPosthog` (the same
// salt-applied sha256 used by `auth/rate-limit.ts`) and uses the
// hash as the PostHog `distinct_id` AND as the `user_id_hash` prop.
// No raw UUID ever appears in the PostHog request.

import type { CartAbandonedEventProps } from '@foundations/analytics/events'

/** A row returned by the cron's `UPDATE ... RETURNING` query.
 *  `updated_at` is the cart line's last-mutation timestamp; lines
 *  with `updated_at < now() - 25 days` are picked up by the cron. */
export type AbandonedRow = {
  user_id: string
  product_id: number
  license: 'plr' | 'mrr' | 'rr' | 'personal'
  quantity: number
  updated_at: string
}

/** Per-user aggregate of an abandoned cart. */
export type AbandonedAggregate = {
  line_count: number
  subtotal_cents: number
  days_idle_max: number
}

/** Group raw abandoned-cart rows by user_id, computing the
 *  per-user aggregate. The `priceByProduct` map provides the
 *  `unit_price_cents` for each product_id (looked up via a
 *  separate `product_pricing` read by the cron before calling
 *  this helper). Rows with a product_id absent from the map
 *  contribute 0 to the subtotal — a defensive default so a stale
 *  pricing row can't cause NaN or throw.
 *
 *  `days_idle_max` is computed as `Math.ceil((now - updated_at) / 1 day)`
 *  — the same boundary semantics as `isPastAbandonmentThreshold`
 *  in `cartExpiration.ts`. Ceil (not floor) means a row 25 days +
 *  1 hour idle reports 26, which matches the cron's "anything past
 *  the 25-day line" intent and gives dashboards a stable "the cart
 *  has been abandoned for at least N days" semantic.
 */
export function groupAbandonedRowsByUser(
  rows: AbandonedRow[],
  priceByProduct: Map<number, number>,
  now: Date = new Date(),
): Map<string, AbandonedAggregate> {
  const out = new Map<string, AbandonedAggregate>()
  const nowMs = now.getTime()
  const msPerDay = 24 * 60 * 60 * 1000

  for (const row of rows) {
    const existing = out.get(row.user_id) ?? {
      line_count: 0,
      subtotal_cents: 0,
      days_idle_max: 0,
    }
    const unitPriceCents = priceByProduct.get(row.product_id) ?? 0
    existing.line_count += row.quantity
    existing.subtotal_cents += unitPriceCents * row.quantity
    const updatedMs = Date.parse(row.updated_at)
    if (!Number.isNaN(updatedMs)) {
      const idleDays = Math.ceil((nowMs - updatedMs) / msPerDay)
      if (idleDays > existing.days_idle_max) existing.days_idle_max = idleDays
    }
    out.set(row.user_id, existing)
  }

  return out
}

/** Build the per-user PostHog event props. The `hashUserId`
 *  function is dependency-injected so the test suite can assert the
 *  shape without coupling to the salt-based hash implementation.
 *  In production the cron passes `hashIdentifierForPosthog` from
 *  `@foundations/analytics/posthog-server`. */
export function buildAbandonedEventProps(
  userId: string,
  agg: AbandonedAggregate,
  hashUserId: (raw: string) => string,
): CartAbandonedEventProps {
  return {
    user_id_hash: hashUserId(userId),
    line_count: agg.line_count,
    subtotal_cents: agg.subtotal_cents,
    days_idle_max: agg.days_idle_max,
  }
}
