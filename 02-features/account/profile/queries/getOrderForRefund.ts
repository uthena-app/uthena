import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { REFUND_WINDOW_DAYS } from '@foundations/money/refund-window'
import type { OrderStatus } from './getMyOrders'

export type RefundEligibility = {
  eligible: true
  order: {
    id: number
    created_at: string
    total_cents: number
    currency: string
    status: OrderStatus
    items: Array<{
      id: number
      product_title: string
      product_slug: string | null
      license: string
      unit_price_cents: number
      quantity: number
      line_total_cents: number
    }>
  }
  alreadyRefundedCents: number
  remainingRefundableCents: number
  windowEndAt: string
  daysRemaining: number
}

export async function getOrderForRefund(orderId: number): Promise<RefundEligibility | null> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: order } = await supabase
    .from('orders')
    .select('id, created_at, total_cents, currency, status, refunded_cents')
    .eq('id', orderId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!order) return null
  if (order.status !== 'paid') return null

  const createdAt = new Date(order.created_at as string)
  const windowEnd = new Date(createdAt.getTime() + REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  if (Date.now() >= windowEnd.getTime()) return null

  const { count: existingRefunds } = await supabase
    .from('refunds')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', orderId)
    .in('status', ['pending', 'succeeded'])

  if ((existingRefunds ?? 0) > 0) return null

  const { data: items } = await supabase
    .from('order_items')
    .select('id, license, unit_price_cents, quantity, line_total_cents, products(title, slug)')
    .eq('order_id', orderId)
    .order('id', { ascending: true })

  const totalCents = order.total_cents as number
  const refundedCents = (order.refunded_cents as number) ?? 0
  const remaining = Math.max(0, totalCents - refundedCents)

  return {
    eligible: true,
    order: {
      id: order.id as number,
      created_at: order.created_at as string,
      total_cents: totalCents,
      currency: order.currency as string,
      status: order.status as OrderStatus,
      items: (items ?? []).map((it) => {
        const p = (it as unknown as { products: { title: string; slug: string } | null }).products
        return {
          id: it.id as number,
          product_title: p?.title ?? '(removed product)',
          product_slug: p?.slug ?? null,
          license: it.license as string,
          unit_price_cents: it.unit_price_cents as number,
          quantity: it.quantity as number,
          line_total_cents: it.line_total_cents as number,
        }
      }),
    },
    alreadyRefundedCents: refundedCents,
    remainingRefundableCents: remaining,
    windowEndAt: windowEnd.toISOString(),
    daysRemaining: Math.max(0, Math.ceil((windowEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000))),
  }
}
