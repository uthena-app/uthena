// clearCart.ts — set every active cart line for the current user to
// status='abandoned' (or 'converted' if `reason='converted'`).
//
// We soft-delete via status rather than hard-delete so the rows stay
// around for analytics (abandoned-cart rate) and for the eventual
// `cart_items.status='abandoned'` cleanup cron (PH19).
//
// On order success the webhook sets the converted lines directly;
// this action is the user-facing "clear cart" button.
//
// P4.2 — anon-cookie branch writes an empty cart to the cookie.

'use server'

import { revalidatePath } from 'next/cache'
import { getServerSupabase } from '@foundations/data/supabase'
import { ClearCartInput } from '@foundations/data/schemas'
import { getSessionUser } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import {
  readAnonCart,
  writeAnonCart,
} from '@foundations/cookies/anon-cart'

const log = loggerFor({ component: 'cart.clearCart' })

export async function clearCartAction(
  raw: FormData | Record<string, unknown> = { reason: 'abandoned' },
): Promise<{ ok: true; cleared: number } | { ok: false; error: string }> {
  const obj = raw instanceof FormData ? Object.fromEntries(raw.entries()) : raw
  const reasonRaw = (obj as Record<string, unknown>).reason ?? 'abandoned'
  const parsed = ClearCartInput.safeParse({ reason: reasonRaw })
  if (!parsed.success) return { ok: false, error: 'Invalid request.' }

  const user = await getSessionUser()

  // P4.2 — anon-cookie branch.
  if (!user) {
    const cookie = await readAnonCart()
    if (!cookie) return { ok: true, cleared: 0 }
    const cleared = cookie.lines.length
    cookie.lines = []
    await writeAnonCart(cookie)
    revalidatePath('/cart')
    revalidatePath('/', 'layout')
    log.info({ anon: true, cleared, reason: parsed.data.reason }, 'clearCart anon ok')
    return { ok: true, cleared }
  }

  const supabase = await getServerSupabase()
  const { data, error } = await supabase
    .from('cart_items')
    .update({ status: parsed.data.reason })
    .eq('user_id', user.id)
    .eq('status', 'active')
    .select('id')
  if (error) {
    log.warn({ code: 'clear_cart_failed', msg: error.message }, 'clearCart failed')
    return { ok: false, error: 'Could not clear cart.' }
  }
  revalidatePath('/cart')
  revalidatePath('/', 'layout')
  log.info(
    { user_id: user.id, cleared: data?.length ?? 0, reason: parsed.data.reason },
    'clearCart ok',
  )
  return { ok: true, cleared: data?.length ?? 0 }
}
