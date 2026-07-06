// getCartLastActivity.ts — P4.3 last-activity query for the auth cart.
//
// Returns the ISO timestamp of the most recent `cart_items.updated_at`
// for the current user's active rows, or `null` when the cart is
// empty. The anon branch uses `getAnonCartLastActivity()` from
// `cartExpiration.ts` instead — the cookie IS the source of truth
// for anon and we never touch the DB for that branch.
//
// The query uses `MAX(updated_at)` on the existing
// `cart_items_active_updated_idx` (added in migration 0024 to back
// the cart-abandonment cron). The `status='active'` filter restricts
// the scan to live rows — expired / abandoned / converted rows are
// excluded so a stale row from a prior session can't push the
// "last activity" date forward.
//
// On error, we return `null` (rather than throw) so the /cart page
// and CartDrawer degrade to "no banner" — the same fail-soft pattern
// as `getCart()`. The warning banner is a nice-to-have; a DB blip
// shouldn't break the cart surface.

import 'server-only'
import { cache } from 'react'
import { getServerSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'cart.getCartLastActivity' })

export const getAuthCartLastActivity = cache(async (): Promise<string | null> => {
  const user = await getSessionUser()
  if (!user) return null
  const supabase = await getServerSupabase()
  // We need an aggregate (MAX), not row data — PostgREST exposes it
  // via the `head` flag (we don't need the rows themselves, only the
  // count for the warning UI).
  const { data, error } = await supabase
    .from('cart_items')
    .select('updated_at', { head: false, count: 'exact' })
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(1)

  if (error) {
    log.warn(
      { code: 'get_cart_last_activity_failed', msg: error.message },
      'getAuthCartLastActivity failed',
    )
    return null
  }
  if (!data || data.length === 0) return null
  return (data[0] as { updated_at: string }).updated_at
})