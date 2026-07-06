#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * detect-abandoned-carts.ts — Daily cron job (P4.6).
 *
 * Detects cart_items rows that have been idle for 25+ days (i.e.
 * `updated_at < now() - 25 days`) AND are still in
 * `status='active'`, flips them to `status='abandoned'`, and fires
 * a `cart_abandoned` PostHog event for each affected user (the
 * per-user event aggregates `line_count`, `subtotal_cents`, and
 * `days_idle_max` across the user's abandoned lines).
 *
 * Idempotency: the UPDATE filters on `status='active'`, so a
 * second run on the same day finds no rows to flip and the
 * PostHog events don't re-fire. No separate log table is needed
 * for Slice 1 (the natural state transition is the
 * idempotency boundary). The recovery-email log table for
 * STUB-048 (Phase 17) is a separate concern — the email needs
 * a per-user "already emailed" check, which the DB state alone
 * doesn't provide (a user could be re-abandoned after a
 * successful order, etc.).
 *
 * PostHog is fail-open: if `POSTHOG_PROJECT_API_KEY` (or
 * `NEXT_PUBLIC_POSTHOG_KEY` for dev parity) is empty, the events
 * are dropped silently. The DB state is still updated. This
 * matches the existing analytics seam (P2.9): analytics never
 * blocks a business path.
 *
 * The recovery email itself is NOT sent by this cron — that
 * half is deferred to Phase 17 (STUB-048) because it needs the
 * SES adapter + a React Email template. The cron logs a
 * `would_email=N` placeholder so the wire-up is a 1-line change
 * when P17 lands.
 *
 * Schedule via Coolify's scheduler (PH19 wires the generic cron
 * runner; until then, this script can also be run manually):
 *
 *   30 4 * * *  /usr/bin/node /app/04-platform/ci/scripts/cron/detect-abandoned-carts.ts
 *
 * Reads env from the process environment (Coolify injects these
 * at runtime): NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * + POSTHOG_PROJECT_API_KEY (or NEXT_PUBLIC_POSTHOG_KEY for dev).
 *
 * Note on the RLS invariant: `cart_items` has self-write RLS for
 * `user_id = auth.uid()` and admin-all for `is_admin()`. The
 * service-role client bypasses RLS so this UPDATE is permitted
 * regardless of which user's rows are touched. RLS is unchanged.
 */

import { createClient } from '@supabase/supabase-js'
import { CART_IDLE_DAYS_BEFORE_ABANDONMENT } from '@features/cart/cartExpiration'
import {
  type AbandonedRow,
  buildAbandonedEventProps,
  groupAbandonedRowsByUser,
} from '@features/cart/cartAbandonment'
import {
  hashIdentifierForPosthog,
  isPosthogServerConfigured,
  trackPosthogServer,
} from '@foundations/analytics/posthog-server'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'cron.detect-abandoned-carts' })

const env = process.env
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('[cron:detect-abandoned-carts] missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

type AbandonedRowWithTimestamp = {
  id: number
  user_id: string
  product_id: number
  license: 'plr' | 'mrr' | 'rr' | 'personal'
  quantity: number
  updated_at: string
}

type PricingRow = {
  product_id: number
  unit_price_cents: number
  license: 'plr' | 'mrr' | 'rr' | 'personal'
}

async function fetchAbandonedRows(cutoffIso: string): Promise<AbandonedRowWithTimestamp[]> {
  // Single UPDATE...RETURNING: flips status='active' rows to
  // 'abandoned' AND returns the affected rows in one round-trip.
  // The index `cart_items_active_updated_idx` (migration 0024)
  // matches the WHERE shape exactly, so the planner does an
  // index range scan with no separate SELECT.
  const { data, error } = await supabase
    .from('cart_items')
    .update({ status: 'abandoned' })
    .eq('status', 'active')
    .lt('updated_at', cutoffIso)
    .select('id, user_id, product_id, license, quantity, updated_at')

  if (error) {
    throw new Error(`[cron:detect-abandoned-carts] update failed: ${error.message}`)
  }
  return (data ?? []) as AbandonedRowWithTimestamp[]
}

async function fetchPricingByProduct(productIds: number[]): Promise<Map<number, number> | Map<number, number> & { __multi: true }> {
  // The cart_items row stores `license` per line; the cron needs
  // the per-(product, license) unit_price_cents to compute
  // subtotal_cents. The current schema has multiple pricing tiers
  // per product, so a flat `products.price_cents` lookup would
  // be wrong (PLR vs MRR vs RR vs Personal have different prices).
  //
  // For Slice 1, the cron falls back to the product's minimum
  // active unit_price_cents when the exact (product, license)
  // tier is unavailable. This is a conservative underestimate
  // (min-tier is always ≤ the actual tier) and matches the v1
  // pricing display: the user sees the tier they selected at
  // add-to-cart time, and we don't have a historical pricing
  // table to reconstruct the original subtotal. Future Phase 19
  // (P19.16 analytics dashboard) will need a historical pricing
  // table for accurate abandoned-cart revenue reporting; for
  // now, the undercount is acceptable and never NaN.
  if (productIds.length === 0) return new Map()
  const { data, error } = await supabase
    .from('product_pricing')
    .select('product_id, unit_price_cents, license')
    .eq('is_active', true)
    .in('product_id', productIds)

  if (error) {
    log.warn({ code: 'pricing_lookup_failed', msg: error.message }, 'pricing lookup failed; using zeros')
    return new Map()
  }
  const rows = (data ?? []) as PricingRow[]

  // Build a (product_id -> unit_price_cents) map. When multiple
  // tiers exist for the same product_id, use the minimum active
  // tier (defensive undercount, as above).
  const byProduct = new Map<number, number>()
  for (const row of rows) {
    const existing = byProduct.get(row.product_id)
    if (existing === undefined || row.unit_price_cents < existing) {
      byProduct.set(row.product_id, row.unit_price_cents)
    }
  }
  return byProduct
}

async function firePosthogEventsForUsers(
  perUser: Map<string, { line_count: number; subtotal_cents: number; days_idle_max: number }>,
): Promise<{ fired: number; failed: number }> {
  if (!isPosthogServerConfigured()) {
    log.info(
      { users: perUser.size },
      'posthog-server unconfigured; skipping cart_abandoned events (DB state still updated)',
    )
    return { fired: 0, failed: 0 }
  }

  let fired = 0
  let failed = 0
  const captures = Array.from(perUser.entries()).map(async ([userId, agg]) => {
    const userIdHash = hashIdentifierForPosthog(userId)
    const props = buildAbandonedEventProps(userId, agg, () => userIdHash)
    const res = await trackPosthogServer('cart_abandoned', props, userIdHash)
    if (res.ok) fired += 1
    else failed += 1
  })
  await Promise.all(captures)
  return { fired, failed }
}

async function main() {
  const now = new Date()
  const cutoffIso = new Date(
    now.getTime() - CART_IDLE_DAYS_BEFORE_ABANDONMENT * 24 * 60 * 60 * 1000,
  ).toISOString()

  log.info(
    { cutoff: cutoffIso, idle_days: CART_IDLE_DAYS_BEFORE_ABANDONMENT },
    'cron:detect-abandoned-carts starting',
  )

  const rows = await fetchAbandonedRows(cutoffIso)
  if (rows.length === 0) {
    console.log(
      `[cron:detect-abandoned-carts] abandoned=0 affected_users=0 cutoff=${cutoffIso} at=${now.toISOString()}`,
    )
    log.info({ cutoff: cutoffIso }, 'cron:detect-abandoned-carts done (no rows)')
    return
  }

  const productIds = Array.from(new Set(rows.map((r) => r.product_id)))
  const priceByProduct = await fetchPricingByProduct(productIds)
  const perUser = groupAbandonedRowsByUser(rows as AbandonedRow[], priceByProduct, now)
  const { fired, failed } = await firePosthogEventsForUsers(perUser)

  // STUB-048 placeholder — Phase 17 wires the SES recovery email.
  // The cron logs `would_email=N` here so the wire-up is a 1-line
  // change when the SES adapter + email template land. Per-user
  // count (not per-row) matches the "send one email per abandoned
  // user" intent.
  const wouldEmail = perUser.size

  console.log(
    `[cron:detect-abandoned-carts] abandoned=${rows.length} affected_users=${perUser.size} would_email=${wouldEmail} posthog_fired=${fired} posthog_failed=${failed} cutoff=${cutoffIso} at=${now.toISOString()}`,
  )
  log.info(
    {
      abandoned: rows.length,
      affected_users: perUser.size,
      would_email: wouldEmail,
      posthog_fired: fired,
      posthog_failed: failed,
      cutoff: cutoffIso,
    },
    'cron:detect-abandoned-carts done',
  )
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error('[cron:detect-abandoned-carts] unexpected error:', message)
  process.exit(99)
})
