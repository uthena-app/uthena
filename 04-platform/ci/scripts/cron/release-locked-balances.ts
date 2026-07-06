#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * release-locked-balances.ts — Daily cron job.
 *
 * Flips payout_ledger rows from status='locked' to status='available'
 * once the 14-day refund window has passed. Idempotent: re-runs only
 * touch rows that are still 'locked' AND have locked_until < now().
 *
 * Schedule via Coolify's scheduler (PH19 wires the generic cron
 * runner; until then, this script can also be run manually):
 *
 *   0 3 * * *  /usr/bin/node /app/04-platform/ci/scripts/cron/release-locked-balances.ts
 *
 * Reads env from .env.local (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
 */

import { createClient } from '@supabase/supabase-js'

const env = process.env
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('[cron:release-locked-balances] missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function main() {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('payout_ledger')
    .update({ status: 'available', updated_at: now })
    .eq('status', 'locked')
    .lte('locked_until', now)
    .select('id, partner_id, amount_cents, order_id')

  if (error) {
    console.error('[cron:release-locked-balances] update failed:', error.message)
    process.exit(2)
  }
  const released = data?.length ?? 0
  const totalCents = (data ?? []).reduce((sum, r) => sum + (r.amount_cents ?? 0), 0)
  console.log(
    `[cron:release-locked-balances] released=${released} total_cents=${totalCents} at=${now}`,
  )
}

main().catch((err) => {
  console.error('[cron:release-locked-balances] unexpected error:', err)
  process.exit(99)
})
