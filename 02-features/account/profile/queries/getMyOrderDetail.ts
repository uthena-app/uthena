import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { REFUND_WINDOW_DAYS } from '@foundations/money/refund-window'
import type { OrderStatus } from './getMyOrders'

// Minimal billing-address shape we render. Stripe Checkout populates
// this when billing_address_collection is enabled; the field is
// `jsonb` so the schema accepts any shape — we narrow to the fields
// the template actually reads and ignore the rest.
export type BillingAddress = {
  name?: string | null
  line1?: string | null
  line2?: string | null
  city?: string | null
  state?: string | null
  postal_code?: string | null
  country?: string | null
}

export type OrderDetail = {
  id: number
  created_at: string
  email: string
  status: OrderStatus
  subtotal_cents: number
  discount_cents: number
  tax_cents: number
  total_cents: number
  refunded_cents: number
  currency: string
  // Coupon code surfaced in the discount row. Null when no coupon was used.
  coupon_code: string | null
  // First 8 chars of the Stripe PaymentIntent id. Useful in support
  // conversations ("send us the pi_xxxxxxxx"). Truncated — never the
  // full id, never logged.
  stripe_payment_intent_short: string | null
  // Billing address (Stripe Checkout). Null when address collection
  // wasn't enabled at checkout time.
  billing_address: BillingAddress | null
  // Refund-window display helpers.
  days_remaining: number // 0 when the window has closed
  window_end_at: string // ISO; for "Refundable until <date>" copy
  // True when a `refunds` row exists with status='pending' or
  // 'succeeded' for this order — used to disable the request-refund
  // button (per spec acceptance criterion #3).
  has_active_refund: boolean
  items: Array<{
    id: number
    product_id: number | null
    product_title: string
    product_slug: string | null
    product_thumbnail_url: string | null
    license: string
    unit_price_cents: number
    quantity: number
    line_total_cents: number
    subscriber_discount_cents: number
  }>
}

/**
 * Read the signed-in user's order detail. Returns null when the order
 * doesn't exist OR doesn't belong to the user (the page treats both
 * cases as 404 — we don't distinguish "not yours" from "missing" for
 * security).
 */
export async function getMyOrderDetail(orderId: number): Promise<OrderDetail | null> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select(
      'id, created_at, email, status, subtotal_cents, discount_cents, tax_cents, total_cents, refunded_cents, currency, stripe_payment_intent_id, billing_address, coupons(code)',
    )
    .eq('id', orderId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (orderErr || !order) return null

  const { data: itemsData } = await supabase
    .from('order_items')
    .select(
      'id, product_id, license, unit_price_cents, quantity, line_total_cents, subscriber_discount_cents, products(title, slug, thumbnail_url)',
    )
    .eq('order_id', orderId)
    .order('id', { ascending: true })

  const items = (itemsData ?? []).map((it) => {
    const p = (it as unknown as {
      products: { title: string; slug: string; thumbnail_url: string | null } | null
    }).products
    return {
      id: it.id as number,
      product_id: (it.product_id as number | null) ?? null,
      product_title: p?.title ?? '(removed product)',
      product_slug: p?.slug ?? null,
      product_thumbnail_url: p?.thumbnail_url ?? null,
      license: it.license as string,
      unit_price_cents: it.unit_price_cents as number,
      quantity: it.quantity as number,
      line_total_cents: it.line_total_cents as number,
      subscriber_discount_cents: (it.subscriber_discount_cents as number) ?? 0,
    }
  })

  // Refund-window math (server-clock). The window is 14 days from
  // order creation. `days_remaining` is clamped to 0 so the UI shows
  // "Refund window closed" rather than a negative count.
  const createdAt = new Date(order.created_at as string)
  const windowEnd = new Date(createdAt.getTime() + REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const msRemaining = windowEnd.getTime() - Date.now()
  const daysRemaining = msRemaining > 0 ? Math.ceil(msRemaining / (24 * 60 * 60 * 1000)) : 0

  // Active refund = pending or succeeded (matches the schema enum
  // values; the spec's `requested` / `approved` wording was off).
  // We don't count `failed` / `canceled` — those refunds are no-ops.
  const { count: activeRefundCount } = await supabase
    .from('refunds')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', orderId)
    .in('status', ['pending', 'succeeded'])

  // Coupon code is read via the FK join — PostgREST returns the
  // joined row as either a single object (one FK) or array (multi).
  const couponJoin = (order as unknown as {
    coupons: { code: string } | { code: string }[] | null
  }).coupons
  const couponCode =
    couponJoin == null
      ? null
      : Array.isArray(couponJoin)
        ? couponJoin[0]?.code ?? null
        : couponJoin.code

  // Payment-intent short form: first 7 chars + ellipsis. The spec
  // example "pi_3OAB…" is 7 chars + ellipsis — short enough for a
  // support conversation ("send us the pi_xxxxxxx…") but still unique
  // enough for a Stripe lookup. Never the full id (per PCI scope
  // discipline — even though PI ids are not cardholder data, we keep
  // them out of logs / DOM where possible).
  const piShort =
    typeof order.stripe_payment_intent_id === 'string' && order.stripe_payment_intent_id.length > 0
      ? order.stripe_payment_intent_id.slice(0, 7) + '…'
      : null

  return {
    id: order.id as number,
    created_at: order.created_at as string,
    email: order.email as string,
    status: order.status as OrderStatus,
    subtotal_cents: order.subtotal_cents as number,
    discount_cents: order.discount_cents as number,
    tax_cents: order.tax_cents as number,
    total_cents: order.total_cents as number,
    refunded_cents: order.refunded_cents as number,
    currency: order.currency as string,
    coupon_code: couponCode,
    stripe_payment_intent_short: piShort,
    billing_address:
      order.billing_address && typeof order.billing_address === 'object'
        ? (order.billing_address as BillingAddress)
        : null,
    days_remaining: daysRemaining,
    window_end_at: windowEnd.toISOString(),
    has_active_refund: (activeRefundCount ?? 0) > 0,
    items,
  }
}