// getAdminAffiliatesList.ts — paginated, sortable, filterable list of
// affiliates for /admin/affiliates.
//
// Calls the SECURITY DEFINER RPC `get_admin_affiliates_list(p_filters,
// p_sort, p_page, p_per_page)`. Auth-gated at the application layer
// (requireRole) — the RPC also enforces via `is_admin()`. Fails soft
// to `{ rows: [], total: 0 }` on any read error.

import 'server-only'
import { requireRole } from '@foundations/auth/guards'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import {
  AFFILIATE_SORT_KEYS,
  AFFILIATE_STATUS_FILTERS,
  DEFAULT_AFFILIATE_PAGE_SIZE,
  DEFAULT_AFFILIATE_SORT,
  MAX_AFFILIATE_PAGE_SIZE,
  affiliateFiltersToRpcPayload,
  type AffiliateRow,
  type AffiliateSortKey,
  type AffiliateStatus,
  type ParsedAffiliateFilters,
} from '../types'

const log = loggerFor({ component: 'admin.affiliates.getAdminAffiliatesList' })

type RawRpcRow = {
  affiliate_id: number | string
  user_id: string
  handle: string
  display_name: string
  email: string
  status: string
  lifetime_earned_cents: number | string
  pending_balance_cents: number | string
  available_balance_cents: number | string
  clicks_30d: number | string
  conversions_30d: number | string
  joined_at: string
  approved_at: string | null
  last_activity_at: string
  total_count: number | string
}

type ListRpcResult = {
  rows: AffiliateRow[]
  total: number
  page: number
  perPage: number
  sort: AffiliateSortKey
}

/** Defensive bigint/string → number coercion. */
function coerceBigint(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
  const parsed = Number(v)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

/** Defensive enum coercion with safe fallback. */
function coerceStatus(v: string | null | undefined): AffiliateStatus {
  if (v && (AFFILIATE_STATUS_FILTERS as readonly string[]).includes(v)) {
    return v as AffiliateStatus
  }
  return 'pending'
}

function coerceSort(v: string | null | undefined): AffiliateSortKey {
  if (v && (AFFILIATE_SORT_KEYS as readonly string[]).includes(v)) {
    return v as AffiliateSortKey
  }
  return DEFAULT_AFFILIATE_SORT
}

function clampPage(v: number | null | undefined): number {
  if (!v || !Number.isFinite(v)) return 1
  return Math.max(1, Math.floor(v))
}

function clampPerPage(v: number | null | undefined): number {
  if (!v || !Number.isFinite(v)) return DEFAULT_AFFILIATE_PAGE_SIZE
  return Math.max(1, Math.min(MAX_AFFILIATE_PAGE_SIZE, Math.floor(v)))
}

function coerceAffiliateId(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
  const parsed = Number(v)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

function mapRow(raw: RawRpcRow): AffiliateRow {
  return {
    affiliate_id: coerceAffiliateId(raw.affiliate_id),
    user_id: raw.user_id,
    handle: raw.handle ?? '',
    display_name: raw.display_name ?? '',
    email: raw.email ?? '',
    status: coerceStatus(raw.status),
    lifetime_earned_cents: coerceBigint(raw.lifetime_earned_cents),
    pending_balance_cents: coerceBigint(raw.pending_balance_cents),
    available_balance_cents: coerceBigint(raw.available_balance_cents),
    clicks_30d: coerceBigint(raw.clicks_30d),
    conversions_30d: coerceBigint(raw.conversions_30d),
    joined_at: raw.joined_at,
    approved_at: raw.approved_at,
    last_activity_at: raw.last_activity_at,
    total_count: coerceBigint(raw.total_count),
  }
}

export type GetAdminAffiliatesListInput = {
  filters: ParsedAffiliateFilters
  sort?: AffiliateSortKey | null
  page?: number | null
  perPage?: number | null
}

export async function getAdminAffiliatesList(
  input: GetAdminAffiliatesListInput,
): Promise<ListRpcResult> {
  await requireRole(['admin', 'super_admin'])
  const supabase = await getServerSupabase()

  const sort = coerceSort(input.sort ?? null)
  const page = clampPage(input.page ?? null)
  const perPage = clampPerPage(input.perPage ?? null)

  const payload = affiliateFiltersToRpcPayload(input.filters)

  const { data, error } = await supabase.rpc('get_admin_affiliates_list' as never, {
    p_filters: payload,
    p_sort: sort,
    p_page: page,
    p_per_page: perPage,
  } as never)

  if (error) {
    log.warn(
      { code: 'admin_affiliates_list_failed', msg: error.message },
      'getAdminAffiliatesList: RPC failed',
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