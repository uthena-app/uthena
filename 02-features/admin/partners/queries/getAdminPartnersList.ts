// getAdminPartnersList.ts — paginated, sortable, filterable list of
// partners for /admin/partners.
//
// Calls the SECURITY DEFINER RPC `get_admin_partners_list(p_filters,
// p_sort, p_page, p_per_page)`. Auth-gated at the application layer
// (requireRole) — the RPC also enforces via `is_admin()`. Fails soft
// to `{ rows: [], total: 0 }` on any read error.

import 'server-only'
import { requireRole } from '@foundations/auth/guards'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import {
  DEFAULT_PARTNER_PAGE_SIZE,
  DEFAULT_PARTNER_SORT,
  MAX_PARTNER_PAGE_SIZE,
  PARTNER_KYC_FILTERS,
  PARTNER_STATUS_FILTERS,
  PARTNER_TAX_FORM_FILTERS,
  PARTNER_SORT_KEYS,
  partnerFiltersToRpcPayload,
  type PartnerKycStatus,
  type PartnerRow,
  type PartnerSortKey,
  type PartnerStatus,
  type PartnerTaxFormStatus,
  type ParsedPartnerFilters,
} from '../types'

const log = loggerFor({ component: 'admin.partners.getAdminPartnersList' })

type RawRpcRow = {
  partner_id: number | string
  user_id: string
  display_name: string
  email: string
  status: string
  kyc_status: string
  tax_form_status: string
  courses_count: number | string
  lifetime_revenue_cents: number | string
  lifetime_paid_out_cents: number | string
  applied_at: string
  approved_at: string | null
  last_active_at: string
  total_count: number | string
}

type ListRpcResult = {
  rows: PartnerRow[]
  total: number
  page: number
  perPage: number
  sort: PartnerSortKey
}

/** Defensive bigint/string → number coercion. */
function coerceBigint(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
  const parsed = Number(v)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

/** Defensive enum coercion with safe fallback. */
function coerceStatus(v: string | null | undefined): PartnerStatus {
  if (v && (PARTNER_STATUS_FILTERS as readonly string[]).includes(v)) {
    return v as PartnerStatus
  }
  return 'pending'
}

function coerceKyc(v: string | null | undefined): PartnerKycStatus {
  if (v && (PARTNER_KYC_FILTERS as readonly string[]).includes(v)) {
    return v as PartnerKycStatus
  }
  return 'none'
}

function coerceTaxForm(v: string | null | undefined): PartnerTaxFormStatus {
  if (v && (PARTNER_TAX_FORM_FILTERS as readonly string[]).includes(v)) {
    return v as PartnerTaxFormStatus
  }
  return 'none'
}

function coerceSort(v: string | null | undefined): PartnerSortKey {
  if (v && (PARTNER_SORT_KEYS as readonly string[]).includes(v)) {
    return v as PartnerSortKey
  }
  return DEFAULT_PARTNER_SORT
}

function clampPage(v: number | null | undefined): number {
  if (!v || !Number.isFinite(v)) return 1
  return Math.max(1, Math.floor(v))
}

function clampPerPage(v: number | null | undefined): number {
  if (!v || !Number.isFinite(v)) return DEFAULT_PARTNER_PAGE_SIZE
  return Math.max(1, Math.min(MAX_PARTNER_PAGE_SIZE, Math.floor(v)))
}

function coercePartnerId(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
  const parsed = Number(v)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

function mapRow(raw: RawRpcRow): PartnerRow {
  return {
    partner_id: coercePartnerId(raw.partner_id),
    user_id: raw.user_id,
    display_name: raw.display_name ?? '',
    email: raw.email ?? '',
    status: coerceStatus(raw.status),
    kyc_status: coerceKyc(raw.kyc_status),
    tax_form_status: coerceTaxForm(raw.tax_form_status),
    courses_count: coerceBigint(raw.courses_count),
    lifetime_revenue_cents: coerceBigint(raw.lifetime_revenue_cents),
    lifetime_paid_out_cents: coerceBigint(raw.lifetime_paid_out_cents),
    applied_at: raw.applied_at,
    approved_at: raw.approved_at,
    last_active_at: raw.last_active_at,
    total_count: coerceBigint(raw.total_count),
  }
}

export type GetAdminPartnersListInput = {
  filters: ParsedPartnerFilters
  sort?: PartnerSortKey | null
  page?: number | null
  perPage?: number | null
}

export async function getAdminPartnersList(
  input: GetAdminPartnersListInput,
): Promise<ListRpcResult> {
  await requireRole(['admin', 'super_admin'])
  const supabase = await getServerSupabase()

  const sort = coerceSort(input.sort ?? null)
  const page = clampPage(input.page ?? null)
  const perPage = clampPerPage(input.perPage ?? null)

  const payload = partnerFiltersToRpcPayload(input.filters)

  const { data, error } = await supabase.rpc('get_admin_partners_list' as never, {
    p_filters: payload,
    p_sort: sort,
    p_page: page,
    p_per_page: perPage,
  } as never)

  if (error) {
    log.warn(
      { code: 'admin_partners_list_failed', msg: error.message },
      'getAdminPartnersList: RPC failed',
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