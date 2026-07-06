// getAdminOrderDetail.ts — server query wrapping the SECURITY DEFINER
// RPC `get_admin_order_detail(p_order_id bigint)` shipped in migration
// 0058.
//
// Auth gate: requireAdmin() at the application layer (the RPC also
// gates via is_admin() — both are belt-and-suspenders).
//
// Validation: parseOrderDetailId (pure bigint validator) — rejects any
// non-numeric, oversized, decimal, signed, scientific, hex, or
// CRLF-injected input so the RPC never sees garbage.
//
// Defensive mapping: PostgREST returns bigint as string on some
// setups, so we coerce every numeric field through `coerceBigint`.
// String fields go through `coerceString` (trim + reject empty).
// Unknown order statuses fall back to 'pending' (the schema's
// explicit default).
//
// PII safety: the raw IP + UA + customer checkout email + Stripe IDs
// flow through this function but the Overview component renders them
// through masked helpers from `@foundations/data/mask`. The raw IP
// and customer checkout email are available to the page via the
// reveal-only path (Slice 2); the slice 1 wire payload keeps them
// because the admin's "copy PI ID" + "reveal" surfaces need them.
//
// Fails closed: returns null on any RPC error → page renders 404.

import 'server-only'
import { requireAdmin } from '@foundations/auth/guards'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import { maskEmail, maskIp } from '@foundations/data/mask'
import type { OrderStatus } from '@foundations/data/enums'
import { ORDER_FILTER_STATUSES } from '@features/admin/orders/types'
import { parseOrderDetailId } from './parseOrderDetailId'

const log = loggerFor({ component: 'admin.order-detail.getAdminOrderDetail' })

export type OrderDetail = {
  order_id: number
  user_id: string
  customer_checkout_email_raw: string | null
  customer_checkout_email_masked: string | null
  status: OrderStatus
  subtotal_cents: number
  discount_cents: number
  tax_cents: number
  total_cents: number
  currency: string
  refunded_cents: number
  billing_address: Record<string, unknown> | null
  ip_raw: string | null
  ip_masked: string | null
  user_agent: string | null
  stripe_checkout_session_id: string | null
  stripe_payment_intent_id: string | null
  stripe_charge_id: string | null
  stripe_customer_id: string | null
  subscription_id: string | null
  coupon_id: number | null
  paid_at: string | null
  fulfilled_at: string | null
  created_at: string
  updated_at: string
  customer_display_name: string
  customer_avatar_url: string | null
  customer_since: string | null
  customer_lifetime_orders: number
  customer_lifetime_spend_cents: number
  customer_last_login_at: string | null
  partner_id: number | null
  partner_display_name: string | null
  partner_status: string | null
  partner_public_slug: string | null
  affiliate_id: number | null
  affiliate_display_name: string | null
  affiliate_handle: string | null
  items_count: number
}

type RawRpcRow = {
  order_id: number | string
  user_id: string
  customer_checkout_email: string | null
  status: string
  subtotal_cents: number | string
  discount_cents: number | string
  tax_cents: number | string
  total_cents: number | string
  currency: string | null
  refunded_cents: number | string
  billing_address_jsonb: Record<string, unknown> | null
  ip_raw: string | null
  ip_hash: string | null
  user_agent: string | null
  stripe_checkout_session_id: string | null
  stripe_payment_intent_id: string | null
  stripe_charge_id: string | null
  stripe_customer_id: string | null
  subscription_id: string | null
  coupon_id: number | string | null
  paid_at: string | null
  fulfilled_at: string | null
  created_at: string
  updated_at: string
  customer_display_name: string | null
  customer_avatar_url: string | null
  customer_since: string | null
  customer_lifetime_orders: number | string
  customer_lifetime_spend_cents: number | string
  customer_last_login_at: string | null
  partner_id: number | string | null
  partner_display_name: string | null
  partner_status: string | null
  partner_public_slug: string | null
  affiliate_id: number | string | null
  affiliate_display_name: string | null
  affiliate_handle: string | null
  items_count: number | string
}

// ----- coercion helpers (defensive — PostgREST bigint-as-string) -----

function coerceBigint(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
  const parsed = Number(v)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

function coerceBigintOrNull(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : null
  const parsed = Number(v)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null
}

function coerceString(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : null
}

function coerceStatus(v: string | null | undefined): OrderStatus {
  if (v && (ORDER_FILTER_STATUSES as readonly string[]).includes(v)) {
    return v as OrderStatus
  }
  return 'pending'
}

/**
 * Returns the full read-only order payload, or null when the id is
 * invalid / doesn't exist / the RPC failed.
 *
 * Fails closed: the caller treats null as 404 (matches the P14.2 +
 * P14.4 customer/partner detail pages).
 */
export async function getAdminOrderDetail(
  rawOrderId: string | null | undefined,
): Promise<OrderDetail | null> {
  // Auth gate — never invoke the RPC for anon / wrong-role callers.
  await requireAdmin()

  const orderId = parseOrderDetailId(rawOrderId)
  if (!orderId) return null

  const supabase = await getServerSupabase()

  const { data, error } = await supabase.rpc('get_admin_order_detail' as never, {
    p_order_id: orderId,
  } as never)

  if (error || !data || !Array.isArray(data) || data.length === 0) {
    if (error) {
      log.warn(
        { code: 'order_detail_rpc_failed', msg: error.message },
        'getAdminOrderDetail: RPC error',
      )
    }
    return null
  }

  const raw = data[0] as RawRpcRow

  // Compose the masked variants up-front so the Overview component
  // doesn't need to call back into the mask helpers for each render
  // (the masks are pure + cheap but the indirection adds noise).
  const emailRaw = coerceString(raw.customer_checkout_email)
  const ipRaw = coerceString(raw.ip_raw)

  return {
    order_id: coerceBigint(raw.order_id),
    user_id: raw.user_id,
    customer_checkout_email_raw: emailRaw,
    customer_checkout_email_masked: emailRaw ? maskEmail(emailRaw) : null,
    status: coerceStatus(raw.status),
    subtotal_cents: coerceBigint(raw.subtotal_cents),
    discount_cents: coerceBigint(raw.discount_cents),
    tax_cents: coerceBigint(raw.tax_cents),
    total_cents: coerceBigint(raw.total_cents),
    currency: raw.currency?.trim() || 'USD',
    refunded_cents: coerceBigint(raw.refunded_cents),
    billing_address: raw.billing_address_jsonb ?? null,
    ip_raw: ipRaw,
    ip_masked: ipRaw ? maskIp(ipRaw) : null,
    user_agent: coerceString(raw.user_agent),
    stripe_checkout_session_id: coerceString(raw.stripe_checkout_session_id),
    stripe_payment_intent_id: coerceString(raw.stripe_payment_intent_id),
    stripe_charge_id: coerceString(raw.stripe_charge_id),
    stripe_customer_id: coerceString(raw.stripe_customer_id),
    subscription_id: coerceString(raw.subscription_id),
    coupon_id: coerceBigintOrNull(raw.coupon_id),
    paid_at: coerceString(raw.paid_at),
    fulfilled_at: coerceString(raw.fulfilled_at),
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    customer_display_name: (raw.customer_display_name ?? '').trim() || 'Unknown customer',
    customer_avatar_url: coerceString(raw.customer_avatar_url),
    customer_since: coerceString(raw.customer_since),
    customer_lifetime_orders: coerceBigint(raw.customer_lifetime_orders),
    customer_lifetime_spend_cents: coerceBigint(raw.customer_lifetime_spend_cents),
    customer_last_login_at: coerceString(raw.customer_last_login_at),
    partner_id: coerceBigintOrNull(raw.partner_id),
    partner_display_name: coerceString(raw.partner_display_name),
    partner_status: coerceString(raw.partner_status),
    partner_public_slug: coerceString(raw.partner_public_slug),
    affiliate_id: coerceBigintOrNull(raw.affiliate_id),
    affiliate_display_name: coerceString(raw.affiliate_display_name),
    affiliate_handle: coerceString(raw.affiliate_handle),
    items_count: coerceBigint(raw.items_count),
  }
}
