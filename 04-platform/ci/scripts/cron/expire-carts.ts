#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * expire-carts.ts — Daily cron job (P4.3).
 *
 * Flips `cart_items` rows from status='active' to status='expired'
 * once they have been idle for 30 days (i.e. `updated_at` is more
 * than 30 days in the past). Idempotent: re-runs only touch rows
 * that are still 'active' AND have `updated_at < now() - 30 days`.
 *
 * Matches the anon-cookie cart's natural 30-day TTL (also bumped
 * in P4.3) so both branches hit the same expiry window.
 *
 * Uses the existing `cart_items_active_updated_idx` (migration 0024)
 * for an O(active + old) index range scan. The scan is a single
 * UPDATE statement — no row-by-row Python loop, no separate SELECT
 * + UPDATE round-trip.
 *
 * Schedule via Coolify's scheduler (PH19 wires the generic cron
 * runner; until then, this script can also be run manually):
 *
 *   0 4 * * *  /usr/bin/node /app/04-platform/ci/scripts/cron/expire-carts.ts
 *
 * Reads env from the process environment (Coolify injects these
 * at runtime): NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *
 * Note on the RLS invariant: `cart_items` has self-write RLS for
 * `user_id = auth.uid()` and admin-all for `is_admin()`. The
 * service-role client bypasses RLS so this UPDATE is permitted
 * regardless of which user's rows are touched. RLS is unchanged.
 */

import { createClient } from '@supabase/supabase-js'

const env = process.env
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('[cron:expire-carts] missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const IDLE_DAYS = 30

async function main() {
  const now = new Date()
  const cutoffIso = new Date(now.getTime() - IDLE_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('cart_items')
    .update({ status: 'expired', updated_at: now.toISOString() })
    .eq('status', 'active')
    .lt('updated_at', cutoffIso)
    .select('id, user_id, product_id')

  if (error) {
    console.error('[cron:expire-carts] update failed:', error.message)
    process.exit(2)
  }
  const expired = data?.length ?? 0
  const distinctUsers = new Set((data ?? []).map((r) => r.user_id as string)).size
  console.log(
    `[cron:expire-carts] expired=${expired} affected_users=${distinctUsers} cutoff=${cutoffIso} at=${now.toISOString()}`,
  )
}

main().catch((err) => {
  console.error('[cron:expire-carts] unexpected error:', err)
  process.exit(99)
})