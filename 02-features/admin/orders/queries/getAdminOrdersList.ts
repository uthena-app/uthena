// getAdminOrdersList.ts — paginated, filterable list of orders for
// /admin/orders (P14.7).
//
// Calls the SECURITY DEFINER RPC `get_admin_orders_list(p_filters,
// p_page, p_per_page)`. Auth-gated at the application layer (requireRole)
// — the RPC also enforces via `is_admin()` (per migration 0057). Fails
// soft to `{ rows: [], total: 0 }` on any read error.
//
// Sort: created_at desc ONLY in v1 (spec OQ line 49 — column-header
// sort is v2). p_per_page hard-capped at 200, default 50.

import 'server-only'
import { requireRole } from '@foundations/auth/guards'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import type { OrderStatus } from '@foundations/data/enums'
import {
  ORDER_FILTER_STATUSES,
  orderFiltersToRpcPayload,
  type OrderRow,
  type ParsedOrderFilters,
} from '../types'

const log = loggerFor({ component: 'admin.orders.getAdminOrdersList' })

/** Per-page defaults — match the spec line 20 (50 default). */
export const DEFAULT_ORDERS_PAGE_SIZE = 50
export const MAX_ORDERS_PAGE_SIZE = 200

type RawRpcRow = {
  order_id: number | string
  created_at: string
  customer_user_id: string
  customer_display_name: string
  customer_email: string
  status: string
  total_cents: number | string
  subtotal_cents: number | string
  tax_cents: number | string
  currency: string
  items_count: number | string
  partner_share_cents: number | string
  affiliate_handle: string | null
  paid_at: string | null
  total_count: number | string
}

type ListRpcResult = {
  rows: OrderRow[]
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
function coerceStatus(v: string | null | undefined): OrderStatus {
  if (v && (ORDER_FILTER_STATUSES as readonly string[]).includes(v)) {
    return v as OrderStatus
  }
  return 'pending'
}

function clampPage(v: number | null | undefined): number {
  if (!v || !Number.isFinite(v)) return 1
  return Math.max(1, Math.floor(v))
}

function clampPerPage(v: number | null | undefined): number {
  if (!v || !Number.isFinite(v)) return DEFAULT_ORDERS_PAGE_SIZE
  return Math.max(1, Math.min(MAX_ORDERS_PAGE_SIZE, Math.floor(v)))
}

function coerceOrderId(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
  const parsed = Number(v)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

function mapRow(raw: RawRpcRow): OrderRow {
  return {
    order_id: coerceOrderId(raw.order_id),
    created_at: raw.created_at,
    customer_user_id: raw.customer_user_id,
    customer_display_name: raw.customer_display_name ?? '',
    customer_email: raw.customer_email ?? '',
    status: coerceStatus(raw.status),
    total_cents: coerceBigint(raw.total_cents),
    subtotal_cents: coerceBigint(raw.subtotal_cents),
    tax_cents: coerceBigint(raw.tax_cents),
    currency: raw.currency ?? 'USD',
    items_count: coerceBigint(raw.items_count),
    partner_share_cents: coerceBigint(raw.partner_share_cents),
    affiliate_handle: raw.affiliate_handle,
    paid_at: raw.paid_at,
    total_count: coerceBigint(raw.total_count),
  }
}

export type GetAdminOrdersListInput = {
  filters: ParsedOrderFilters
  page?: number | null
  perPage?: number | null
}

export async function getAdminOrdersList(
  input: GetAdminOrdersListInput,
): Promise<ListRpcResult> {
  await requireRole(['admin', 'super_admin'])
  const supabase = await getServerSupabase()

  const page = clampPage(input.page ?? null)
  const perPage = clampPerPage(input.perPage ?? null)

  const payload = orderFiltersToRpcPayload(input.filters)

  const { data, error } = await supabase.rpc('get_admin_orders_list' as never, {
    p_filters: payload,
    p_page: page,
    p_per_page: perPage,
  } as never)

  if (error) {
    log.warn(
      { code: 'admin_orders_list_failed', msg: error.message },
      'getAdminOrdersList: RPC failed',
    )
    return { rows: [], total: 0, page, perPage }
  }

  const rawRows = (data ?? []) as unknown as RawRpcRow[]
  const rows = rawRows.map(mapRow)

  // `total_count` is the same value for every row (the RPC populates
  // it per row); pick the first or default to length if absent.
  const total = rows.length > 0 ? (rows[0]?.total_count ?? 0) : 0

  return { rows, total, page, perPage }
}
