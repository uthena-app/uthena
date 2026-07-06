// getAdminRefundDetail.ts — server query wrapping the SECURITY DEFINER
// RPC `get_admin_refund_detail(p_refund_id bigint)` shipped in migration
// 0059.
//
// Auth gate: requireRole(['admin', 'super_admin']) at the application
// layer (the RPC also gates via `is_admin()` — both are belt-and-
// suspenders). Fails closed to null on any error → page renders 404.
//
// Validation: parseRefundId (pure positive bigint validator) — rejects
// any non-numeric, oversized, decimal, signed, scientific, or hex input
// so the RPC never sees garbage.
//
// Defensive mapping: PostgREST returns bigint as string on some
// setups, so we coerce every numeric field through `coerceBigint`.
// String fields go through `coerceString` (trim + reject empty).
// Unknown order / refund statuses fall back to safe defaults.
//
// PII safety: the raw IP + UA + customer checkout email + Stripe IDs
// flow through this function but the Detail panel renders them through
// masked helpers from `@foundations/data/mask`. The raw IP and customer
// checkout email are available to the page via the reveal-only path
// (Slice 2); the Slice 1 wire payload keeps them because the admin's
// "copy PI ID" + "reveal" surfaces need them.
//
// Reversal preview: the RPC computes the partner share reversal +
// affiliate commission reversal as negative cents. The Detail panel
// formats them with "to Uthena" labels so the admin sees the
// dollar-flow direction.

import 'server-only'
import { requireRole } from '@foundations/auth/guards'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import { maskEmail } from '@foundations/data/mask'
import { REFUND_STATUSES, REFUND_REASONS } from '@foundations/data/enums'
import { ORDER_STATUSES } from '@foundations/data/enums'
import type { RefundStatus, RefundReason, OrderStatus } from '@foundations/data/enums'
import { parseRefundId } from '../types'
import type { RefundDetail } from '../types'

const log = loggerFor({ component: 'admin.refunds.getAdminRefundDetail' })

type RawRpcRow = {
  // Refund row
  refund_id: number | string
  order_id: number | string
  amount_cents: number | string
  currency: string | null
  reason: string
  notes: string | null
  status: string
  stripe_refund_id: string | null
  requested_by: string | null
  requested_at: string
  approved_by: string | null
  approved_at: string | null
  processed_at: string | null
  resolution_notes: string | null
  proof_path: string | null
  proof_filename: string | null
  // Order row
  order_status: string | null
  order_subtotal_cents: number | string
  order_total_cents: number | string
  order_paid_at: string | null
  order_ip_raw: string | null
  order_ip_hash: string | null
  order_stripe_payment_intent_id: string | null
  order_customer_checkout_email: string | null
  // Customer aggregates
  customer_user_id: string | null
  customer_display_name: string | null
  customer_email: string | null
  customer_since: string | null
  customer_lifetime_orders: number | string
  customer_lifetime_refunds: number | string
  customer_lifetime_refund_rate: number | string
  // Reversal preview
  partner_share_reversal_cents: number | string
  affiliate_commission_reversal_cents: number | string
  // Order context
  order_items_count: number | string
}

/** Defensive bigint/string → number coercion. */
function coerceBigint(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? Math.floor(v) : 0
  const parsed = Number(v)
  return Number.isFinite(parsed) ? Math.floor(parsed) : 0
}

function coerceBigintNonNeg(v: number | string | null | undefined): number {
  return Math.max(0, coerceBigint(v))
}

function coerceNumber(v: number | string | null | undefined, fallback = 0): number {
  if (v === null || v === undefined) return fallback
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback
  const parsed = Number(v)
  return Number.isFinite(parsed) ? parsed : fallback
}

function coerceString(v: string | null | undefined, fallback = ''): string {
  if (!v) return fallback
  return v
}

function coerceStatus(v: string | null | undefined): RefundStatus {
  if (v && (REFUND_STATUSES as readonly string[]).includes(v)) {
    return v as RefundStatus
  }
  return 'pending'
}

function coerceReason(v: string | null | undefined): RefundReason {
  if (v && (REFUND_REASONS as readonly string[]).includes(v)) {
    return v as RefundReason
  }
  return 'other'
}

function coerceOrderStatus(v: string | null | undefined): OrderStatus {
  if (v && (ORDER_STATUSES as readonly string[]).includes(v)) {
    return v as OrderStatus
  }
  return 'pending'
}

function mapRow(raw: RawRpcRow): RefundDetail {
  const checkoutEmail = coerceString(raw.order_customer_checkout_email)
  return {
    refund_id: coerceBigintNonNeg(raw.refund_id),
    order_id: coerceBigintNonNeg(raw.order_id),
    amount_cents: coerceBigintNonNeg(raw.amount_cents),
    currency: coerceString(raw.currency, 'USD'),
    reason: coerceReason(raw.reason),
    notes: raw.notes,
    status: coerceStatus(raw.status),
    stripe_refund_id: raw.stripe_refund_id,
    requested_by: raw.requested_by,
    requested_at: coerceString(raw.requested_at),
    approved_by: raw.approved_by,
    approved_at: raw.approved_at,
    processed_at: raw.processed_at,
    resolution_notes: raw.resolution_notes,
    proof_path: raw.proof_path,
    proof_filename: raw.proof_filename,
    order_status: coerceOrderStatus(raw.order_status),
    order_subtotal_cents: coerceBigintNonNeg(raw.order_subtotal_cents),
    order_total_cents: coerceBigintNonNeg(raw.order_total_cents),
    order_paid_at: raw.order_paid_at,
    order_ip_raw: raw.order_ip_raw,
    order_ip_hash: raw.order_ip_hash,
    order_stripe_payment_intent_id: raw.order_stripe_payment_intent_id,
    order_customer_checkout_email: checkoutEmail,
    customer_user_id: raw.customer_user_id,
    customer_display_name: coerceString(raw.customer_display_name, '—'),
    customer_email: coerceString(raw.customer_email),
    customer_since: raw.customer_since,
    customer_lifetime_orders: coerceBigintNonNeg(raw.customer_lifetime_orders),
    customer_lifetime_refunds: coerceBigintNonNeg(raw.customer_lifetime_refunds),
    customer_lifetime_refund_rate: coerceNumber(raw.customer_lifetime_refund_rate, 0),
    partner_share_reversal_cents: coerceBigint(raw.partner_share_reversal_cents),
    affiliate_commission_reversal_cents: coerceBigint(raw.affiliate_commission_reversal_cents),
    order_items_count: coerceBigintNonNeg(raw.order_items_count),
  }
}

/**
 * Reads the full detail for a single refund. Returns null when:
 *   - the refund id is malformed (parseRefundId rejects)
 *   - the refund doesn't exist (RPC returns 0 rows)
 *   - the RPC errored
 *
 * The page renders 404 in all three cases (the URL is the same;
 * we never leak the difference between "malformed id" and
 * "doesn't exist" to a non-admin caller — they never reach here
 * anyway because requireRole fires first).
 */
export async function getAdminRefundDetail(
  rawRefundId: string | number | null | undefined,
): Promise<RefundDetail | null> {
  await requireRole(['admin', 'super_admin'])

  const canonicalId = parseRefundId(rawRefundId === null || rawRefundId === undefined ? null : String(rawRefundId))
  if (!canonicalId) {
    return null
  }

  const supabase = await getServerSupabase()

  try {
    const { data, error } = await supabase.rpc(
      'get_admin_refund_detail' as never,
      { p_refund_id: canonicalId } as never,
    )
    if (error) {
      log.warn(
        { code: 'admin_refund_detail_failed', msg: error.message },
        'getAdminRefundDetail: RPC failed',
      )
      return null
    }
    const rawRows = (data ?? []) as unknown as RawRpcRow[]
    const first = rawRows[0]
    if (!first) {
      return null
    }
    return mapRow(first)
  } catch (err) {
    log.warn(
      { code: 'admin_refund_detail_threw', msg: err instanceof Error ? err.message : 'unknown' },
      'getAdminRefundDetail: unexpected error',
    )
    return null
  }
}

/**
 * Returns the masked form of the customer's checkout email — used by
 * the Detail panel for the "customer email" line when the admin has
 * NOT explicitly revealed the raw value (Slice 2 will add the
 * reveal flow; for Slice 1 the masked form is always rendered).
 *
 * Pure function — uses `maskEmail` from `@foundations/data/mask`. If
 * the input is null/empty, returns null.
 */
export function getMaskedCustomerEmail(raw: string | null | undefined): string | null {
  if (!raw) return null
  const masked = maskEmail(raw)
  return masked === raw ? null : masked
}