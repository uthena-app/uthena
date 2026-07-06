// getOrderForConfirmation.ts — read a single order for the success page.
// Auth-gated. RLS is the primary gate; we add a defense-in-depth
// customer_id === auth.uid() check and redirect to /account/orders on
// mismatch (no information leak).

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'checkout.getOrderForConfirmation' })

export type OrderForConfirmation = {
  id: number
  status: 'pending' | 'awaiting_payment' | 'paid' | 'fulfilled' | 'refunded' | 'partially_refunded' | 'failed' | 'canceled' | 'fraudulent'
  subtotal_cents: number
  discount_cents: number
  tax_cents: number
  total_cents: number
  currency: string
  email: string
  paid_at: string | null
  created_at: string
  items: Array<{
    id: number
    product_id: number
    license: 'plr' | 'mrr' | 'rr' | 'personal'
    quantity: number
    unit_price_cents: number
    line_total_cents: number
    title: string
    thumbnail_url: string | null
    slug: string
  }>
  grant_count: number
}

export async function getOrderForConfirmation(
  orderId: number,
): Promise<OrderForConfirmation | null> {
  const user = await getSessionUser()
  if (!user) return null

  const supabase = await getServerSupabase()
  const { data, error } = await supabase
    .from('orders')
    .select(
      `
      id, user_id, status, subtotal_cents, discount_cents, tax_cents, total_cents,
      currency, email, paid_at, created_at,
      items:order_items (
        id, product_id, license, quantity, unit_price_cents, line_total_cents,
        product:products ( slug, title, thumbnail_url )
      ),
      grants:library_grants ( id )
    `,
    )
    .eq('id', orderId)
    .maybeSingle()

  if (error || !data) {
    log.warn({ code: 'get_order_failed', msg: error?.message, order_id: orderId }, 'getOrderForConfirmation failed')
    return null
  }

  // Defense-in-depth: RLS should already prevent this row from loading, but
  // we add an explicit ownership check.
  if ((data as any).user_id !== user.id) {
    log.warn({ code: 'order_owner_mismatch', order_id: orderId, user_id: user.id }, 'order owner mismatch')
    return null
  }

  return {
    id: data.id,
    status: data.status,
    subtotal_cents: data.subtotal_cents,
    discount_cents: data.discount_cents,
    tax_cents: data.tax_cents,
    total_cents: data.total_cents,
    currency: data.currency,
    email: data.email,
    paid_at: data.paid_at,
    created_at: data.created_at,
    items: ((data as any).items ?? []).map((it: any) => ({
      id: it.id,
      product_id: it.product_id,
      license: it.license,
      quantity: it.quantity,
      unit_price_cents: it.unit_price_cents,
      line_total_cents: it.line_total_cents,
      title: it.product?.title ?? '',
      thumbnail_url: it.product?.thumbnail_url ?? null,
      slug: it.product?.slug ?? '',
    })),
    grant_count: ((data as any).grants ?? []).length,
  }
}
