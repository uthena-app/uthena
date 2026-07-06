// getAdminCustomersList.ts — paginated, sortable, filterable list of
// non-admin profiles for /admin/customers.
//
// Calls the SECURITY DEFINER RPC `get_admin_customers_list(p_filters,
// p_sort, p_page, p_per_page)`. Auth-gated at the application layer
// (requireRole) — the RPC also enforces via `is_admin()`. Fails soft
// to `{ rows: [], total: 0 }` on any read error.

import 'server-only'
import { requireRole } from '@foundations/auth/guards'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import {
  CUSTOMER_ROLE_FILTERS,
  CUSTOMER_STATUS_FILTERS,
  CUSTOMER_SORT_KEYS,
  DEFAULT_CUSTOMER_PAGE_SIZE,
  DEFAULT_CUSTOMER_SORT,
  MAX_CUSTOMER_PAGE_SIZE,
  filtersToRpcPayload,
  type CustomerRow,
  type CustomerRoleFilter,
  type CustomerSortKey,
  type CustomerStatusFilter,
  type ParsedCustomerFilters,
} from '../types'

const log = loggerFor({ component: 'admin.customers.getAdminCustomersList' })

type RawRpcRow = {
  user_id: string
  display_name: string
  email: string
  role: string
  status: string
  signup_date: string
  lifetime_spend_cents: number | string
  order_count: number | string
  library_size: number | string
  last_active_at: string
  risk_score: number
  risk_refund_count: number | string
  risk_dispute_count: number | string
  risk_signal_severity_sum: number | string
  total_count: number | string
}

type ListRpcResult = {
  rows: CustomerRow[]
  total: number
  page: number
  perPage: number
  sort: CustomerSortKey
}

/** Defensive bigint/string → number coercion. */
function coerceBigint(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
  const parsed = Number(v)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

/** Defensive enum coercion with safe fallback. */
function coerceRole(v: string | null | undefined): CustomerRoleFilter {
  if (v && (CUSTOMER_ROLE_FILTERS as readonly string[]).includes(v)) {
    return v as CustomerRoleFilter
  }
  return 'customer'
}

function coerceStatus(v: string | null | undefined): CustomerStatusFilter {
  if (v && (CUSTOMER_STATUS_FILTERS as readonly string[]).includes(v)) {
    return v as CustomerStatusFilter
  }
  return 'active'
}

function coerceSort(v: string | null | undefined): CustomerSortKey {
  if (v && (CUSTOMER_SORT_KEYS as readonly string[]).includes(v)) {
    return v as CustomerSortKey
  }
  return DEFAULT_CUSTOMER_SORT
}

function clampPage(v: number | null | undefined): number {
  if (!v || !Number.isFinite(v)) return 1
  return Math.max(1, Math.floor(v))
}

function clampPerPage(v: number | null | undefined): number {
  if (!v || !Number.isFinite(v)) return DEFAULT_CUSTOMER_PAGE_SIZE
  return Math.max(1, Math.min(MAX_CUSTOMER_PAGE_SIZE, Math.floor(v)))
}

function mapRow(raw: RawRpcRow): CustomerRow {
  return {
    user_id: raw.user_id,
    display_name: raw.display_name ?? '',
    email: raw.email ?? '',
    role: coerceRole(raw.role),
    status: coerceStatus(raw.status),
    signup_date: raw.signup_date,
    lifetime_spend_cents: coerceBigint(raw.lifetime_spend_cents),
    order_count: coerceBigint(raw.order_count),
    library_size: coerceBigint(raw.library_size),
    last_active_at: raw.last_active_at,
    risk_score: typeof raw.risk_score === 'number' ? raw.risk_score : 0,
    risk_refund_count: coerceBigint(raw.risk_refund_count),
    risk_dispute_count: coerceBigint(raw.risk_dispute_count),
    risk_signal_severity_sum: coerceBigint(raw.risk_signal_severity_sum),
    total_count: coerceBigint(raw.total_count),
  }
}

export type GetAdminCustomersListInput = {
  filters: ParsedCustomerFilters
  sort?: CustomerSortKey | null
  page?: number | null
  perPage?: number | null
}

export async function getAdminCustomersList(
  input: GetAdminCustomersListInput,
): Promise<ListRpcResult> {
  await requireRole(['admin', 'super_admin'])
  const supabase = await getServerSupabase()

  const sort = coerceSort(input.sort ?? null)
  const page = clampPage(input.page ?? null)
  const perPage = clampPerPage(input.perPage ?? null)

  const payload = filtersToRpcPayload(input.filters)

  const { data, error } = await supabase.rpc('get_admin_customers_list' as never, {
    p_filters: payload,
    p_sort: sort,
    p_page: page,
    p_per_page: perPage,
  } as never)

  if (error) {
    log.warn(
      { code: 'admin_customers_list_failed', msg: error.message },
      'getAdminCustomersList: RPC failed',
    )
    return { rows: [], total: 0, page, perPage, sort }
  }

  const rawRows = (data ?? []) as unknown as RawRpcRow[]
  const rows = rawRows.map(mapRow)

  // `total_count` is the same value for every row (the RPC populates
  // it per row); pick the first or default to length if absent.
  const total = rows.length > 0 ? (rows[0]?.total_count ?? 0) : 0

  return { rows, total, page, perPage, sort }
}