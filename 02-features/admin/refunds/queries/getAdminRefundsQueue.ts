// getAdminRefundsQueue.ts — paginated, filterable list of refunds for
// /admin/refunds (P14.9).
//
// Calls the SECURITY DEFINER RPC `get_admin_refunds_queue(p_filters,
// p_page, p_per_page)` shipped in migration 0059. Auth-gated at the
// application layer (requireRole) — the RPC also enforces via
// `is_admin()` (per migration 0059). Fails soft to `{ rows: [], total:
// 0 }` on any read error.
//
// Sort: FIFO by `requested_at asc` (spec line 64: "SLA pressure
// demands this"). p_per_page hard-capped at 200, default 25.

import 'server-only'
import { requireRole } from '@foundations/auth/guards'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import { REFUND_STATUSES, REFUND_REASONS } from '@foundations/data/enums'
import type { RefundStatus, RefundReason } from '@foundations/data/enums'
import {
  DEFAULT_REFUNDS_PAGE_SIZE,
  MAX_REFUNDS_PAGE_SIZE,
  refundFiltersToRpcPayload,
  type ParsedRefundFilters,
  type RefundQueueRow,
} from '../types'

const log = loggerFor({ component: 'admin.refunds.getAdminRefundsQueue' })

/** Per-page defaults — match the spec line 28 (25 default). */
export { DEFAULT_REFUNDS_PAGE_SIZE, MAX_REFUNDS_PAGE_SIZE }

type RawRpcRow = {
  refund_id: number | string
  order_id: number | string
  amount_cents: number | string
  currency: string | null
  reason: string
  status: string
  requested_at: string
  requested_by: string | null
  customer_user_id: string | null
  customer_display_name: string | null
  customer_email: string | null
  proof_path: string | null
  proof_filename: string | null
  total_count: number | string
}

type QueueRpcResult = {
  rows: RefundQueueRow[]
  total: number
  page: number
  perPage: number
}

/** Defensive bigint/string → number coercion. */
function coerceBigint(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
  const parsed = Number(v)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

/** Defensive enum coercion with safe fallback to `pending`. */
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

function clampPage(v: number | null | undefined): number {
  if (!v || !Number.isFinite(v)) return 1
  return Math.max(1, Math.floor(v))
}

function clampPerPage(v: number | null | undefined): number {
  if (v === null || v === undefined) return DEFAULT_REFUNDS_PAGE_SIZE
  if (!Number.isFinite(v)) return DEFAULT_REFUNDS_PAGE_SIZE
  // A finite value (including 0 / negative) is always clamped to the
  // valid range — never silently substituted with the default. An
  // explicit `perPage: 0` is a caller bug; clamp to 1, don't mask it.
  return Math.max(1, Math.min(MAX_REFUNDS_PAGE_SIZE, Math.floor(v)))
}

function mapRow(raw: RawRpcRow): RefundQueueRow {
  return {
    refund_id: coerceBigint(raw.refund_id),
    order_id: coerceBigint(raw.order_id),
    amount_cents: coerceBigint(raw.amount_cents),
    currency: raw.currency ?? 'USD',
    reason: coerceReason(raw.reason),
    status: coerceStatus(raw.status),
    requested_at: raw.requested_at,
    requested_by: raw.requested_by,
    customer_user_id: raw.customer_user_id,
    customer_display_name: raw.customer_display_name ?? '',
    customer_email: raw.customer_email ?? '',
    proof_path: raw.proof_path,
    proof_filename: raw.proof_filename,
    total_count: coerceBigint(raw.total_count),
  }
}

export type GetAdminRefundsQueueInput = {
  filters: ParsedRefundFilters
  page?: number | null
  perPage?: number | null
}

/**
 * Reads the paginated, filterable queue list. The RPC always
 * returns rows in FIFO order (requested_at asc); the queue list UI
 * highlights SLA-overdue rows (>24h) without a second query.
 */
export async function getAdminRefundsQueue(
  input: GetAdminRefundsQueueInput,
): Promise<QueueRpcResult> {
  await requireRole(['admin', 'super_admin'])
  const supabase = await getServerSupabase()

  const page = clampPage(input.page ?? null)
  const perPage = clampPerPage(input.perPage ?? null)

  const payload = refundFiltersToRpcPayload(input.filters)

  try {
    const { data, error } = await supabase.rpc(
      'get_admin_refunds_queue' as never,
      {
        p_filters: payload,
        p_page: page,
        p_per_page: perPage,
      } as never,
    )
    if (error) {
      log.warn(
        { code: 'admin_refunds_queue_failed', msg: error.message },
        'getAdminRefundsQueue: RPC failed',
      )
      return { rows: [], total: 0, page, perPage }
    }

    const rawRows = (data ?? []) as unknown as RawRpcRow[]
    const rows = rawRows.map(mapRow)

    // `total_count` is the same value for every row (the RPC populates
    // it per row); pick the first or default to length if absent.
    const total = rows.length > 0 ? (rows[0]?.total_count ?? 0) : 0

    return { rows, total, page, perPage }
  } catch (err) {
    log.warn(
      { code: 'admin_refunds_queue_threw', msg: err instanceof Error ? err.message : 'unknown' },
      'getAdminRefundsQueue: unexpected error',
    )
    return { rows: [], total: 0, page, perPage }
  }
}