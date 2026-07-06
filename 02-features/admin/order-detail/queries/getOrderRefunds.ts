// getOrderRefunds.ts — server query wrapping the SECURITY DEFINER RPC
// `get_order_refunds(p_order_id bigint, p_limit int)` shipped in
// migration 0058.
//
// Auth gate: requireAdmin() at the application layer (the RPC also
// gates via is_admin() — belt-and-suspenders).
//
// Validation: parseOrderDetailId (pure bigint validator).
//
// Defensive mapping: each row passes through `coerceBigint` for cents
// + `coerceStatus` for the refund_status enum (unknown → 'pending').
// Notes are clipped at 500 chars to bound the audit-log-friendly UI
// display (the refund_detail table surface ships in P14.9 territory).

import 'server-only'
import { requireAdmin } from '@foundations/auth/guards'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import { REFUND_STATUSES, type RefundStatus } from '@foundations/data/enums'
import { parseOrderDetailId } from './parseOrderDetailId'

const log = loggerFor({ component: 'admin.order-detail.getOrderRefunds' })

export const DEFAULT_ORDER_REFUNDS_LIMIT = 50
export const MAX_ORDER_REFUNDS_LIMIT = 200

export type OrderRefundRow = {
  refund_id: number
  amount_cents: number
  reason: string
  notes: string | null
  status: RefundStatus
  stripe_refund_id: string | null
  requested_by: string | null
  requested_by_display_name: string | null
  approved_by: string | null
  approved_by_display_name: string | null
  approved_at: string | null
  processed_at: string | null
  created_at: string
  updated_at: string
}

type RawRpcRow = {
  refund_id: number | string
  amount_cents: number | string
  reason: string
  notes: string | null
  status: string
  stripe_refund_id: string | null
  requested_by: string | null
  requested_by_display_name: string | null
  approved_by: string | null
  approved_by_display_name: string | null
  approved_at: string | null
  processed_at: string | null
  created_at: string
  updated_at: string
}

function coerceBigint(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
  const parsed = Number(v)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

function coerceString(v: string | null | undefined, maxLen = 1000): string | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (trimmed.length === 0) return null
  return trimmed.slice(0, maxLen)
}

function coerceStatus(v: string | null | undefined): RefundStatus {
  if (v && (REFUND_STATUSES as readonly string[]).includes(v)) {
    return v as RefundStatus
  }
  return 'pending'
}

function clampLimit(v: number | null | undefined): number {
  if (v === null || v === undefined) return DEFAULT_ORDER_REFUNDS_LIMIT
  if (!Number.isFinite(v)) return DEFAULT_ORDER_REFUNDS_LIMIT
  return Math.max(1, Math.min(MAX_ORDER_REFUNDS_LIMIT, Math.floor(v)))
}

function mapRow(raw: RawRpcRow): OrderRefundRow {
  return {
    refund_id: coerceBigint(raw.refund_id),
    amount_cents: coerceBigint(raw.amount_cents),
    reason: raw.reason?.trim() || 'other',
    notes: coerceString(raw.notes, 500),
    status: coerceStatus(raw.status),
    stripe_refund_id: coerceString(raw.stripe_refund_id, 100),
    requested_by: raw.requested_by,
    requested_by_display_name: coerceString(raw.requested_by_display_name, 200),
    approved_by: raw.approved_by,
    approved_by_display_name: coerceString(raw.approved_by_display_name, 200),
    approved_at: coerceString(raw.approved_at, 100),
    processed_at: coerceString(raw.processed_at, 100),
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  }
}

export type GetOrderRefundsInput = {
  rawOrderId: string | null | undefined
  limit?: number | null
}

export async function getOrderRefunds(
  input: GetOrderRefundsInput,
): Promise<OrderRefundRow[]> {
  await requireAdmin()

  const orderId = parseOrderDetailId(input.rawOrderId)
  if (!orderId) return []

  const limit = clampLimit(input.limit ?? null)

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('get_order_refunds' as never, {
    p_order_id: orderId,
    p_limit: limit,
  } as never)

  if (error) {
    log.warn(
      { code: 'order_refunds_rpc_failed', msg: error.message },
      'getOrderRefunds: RPC error',
    )
    return []
  }

  const rawRows = (data ?? []) as unknown as RawRpcRow[]
  return rawRows.map(mapRow)
}
