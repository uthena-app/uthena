// getAdminCustomerDetail.ts — the server query for /admin/customers/[id].
//
// Wraps the SECURITY DEFINER RPC `get_admin_customer_detail(p_user_id)`
// shipped in migration 0053. The query layer:
//   1. Validates input via the canonical parser (`parseCustomerDetailId`).
//   2. Calls requireAdmin() — the RPC also gates via is_admin(), but the
//      query-level guard means we never even call RPC for an anon /
//      wrong-role caller.
//   3. Defensive coercion: PostgREST may return bigint as string, so we
//      coerce everything through `coerceBigint` / `coerceNumber` /
//      `coerceInt` / `coerceString` helpers.
//   4. Fails closed: returns null on any error (no exception propagation).
//
// PII safety: the raw email value is returned ONLY when the caller
// explicitly invokes the reveal RPC (`revealAdminCustomerEmailAction`).
// The masked-by-default email hash lives on the Overview card via
// `maskEmail()` from `@foundations/data/mask` (added in this tick).
// IP rendering goes through `maskIp()` from the same module.

import 'server-only'
import { requireAdmin } from '@foundations/auth/guards'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import { maskEmail, maskIp } from '@foundations/data/mask'
import { CUSTOMER_STATUS_FILTERS, type CustomerStatusFilter, type CustomerRoleFilter, CUSTOMER_ROLE_FILTERS } from '../types'
import { parseCustomerDetailId } from './parseCustomerDetailId'

const log = loggerFor({ component: 'admin.customers.getAdminCustomerDetail' })

export type CustomerDetail = {
  user_id: string
  display_name: string
  avatar_url: string | null
  bio: string | null
  locale: string | null
  timezone: string | null
  role: CustomerRoleFilter
  status: CustomerStatusFilter
  suspended_at: string | null
  suspended_until: string | null
  suspended_reason: string | null
  banned_at: string | null
  banned_reason: string | null
  banned_by: string | null
  warnings_count: number
  signup_date: string
  profile_updated_at: string
  /** Raw email — present in the payload but NEVER rendered masked-or-otherwise
   *  without going through `revealAdminCustomerEmailAction`. The Overview
   *  card displays `email_masked` by default; the raw value is exposed
   *  here only so the reveal action can return it (and only after a
   *  user-initiated click on the page). */
  email_raw: string | null
  /** Pre-computed masked display: `j***@example.com`. Safe to render directly. */
  email_masked: string | null
  last_sign_in_at: string | null
  /** Pre-computed masked display of the first-seen IP (first 8 chars + `...`).
   *  Safe to render directly; the raw value lives in `first_seen_ip_raw` and
   *  is only returned by `revealAdminCustomerFirstSeenIpAction`. */
  first_seen_ip_raw: string | null
  first_seen_ip_masked: string | null
  lifetime_spend_cents: number
  order_count: number
  library_size: number
  last_active_at: string | null
  refund_count: number
  refund_rate: number
  risk_score: number
  risk_refund_count: number
  risk_dispute_count: number
  risk_signal_severity_sum: number
  risk_refund_contribution: number
  risk_dispute_contribution: number
  risk_activity_contribution: number
}

type RawRpcRow = {
  user_id: string
  display_name: string
  avatar_url: string | null
  bio: string | null
  locale: string | null
  timezone: string | null
  role: string
  status: string
  suspended_at: string | null
  suspended_until: string | null
  suspended_reason: string | null
  banned_at: string | null
  banned_reason: string | null
  banned_by: string | null
  warnings_count: number | string
  signup_date: string
  profile_updated_at: string
  email: string | null
  last_sign_in_at: string | null
  lifetime_spend_cents: number | string
  order_count: number | string
  library_size: number | string
  last_active_at: string | null
  refund_count: number | string
  refund_rate: number | string
  risk_refund_count: number | string
  risk_dispute_count: number | string
  risk_signal_severity_sum: number | string
  risk_refund_contribution: number | string
  risk_dispute_contribution: number | string
  risk_activity_contribution: number | string
  risk_total_score: number | string
}

// ----- coercion helpers (defensive — PostgREST bigint-as-string) -----

function coerceBigint(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
  const parsed = Number(v)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

function coerceInt(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
  const parsed = Number(v)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

function coerceNumeric(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const parsed = Number(v)
  return Number.isFinite(parsed) ? parsed : 0
}

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

function coerceString(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Pulls the first-seen IP out of the masked raw field. The RPC doesn't
 *  return the raw IP — that's behind `reveal_admin_customer_first_seen_ip`.
 *  For the masked-by-default view, we ask the orders table separately. */
async function fetchFirstSeenIp(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  userId: string,
): Promise<{ raw: string | null; masked: string | null }> {
  // PII-safe narrow select: ip + nothing else from the order row.
  // We deliberately do NOT select user_id / total_cents / email /
  // user_agent — the masked-by-default display needs nothing else.
  const { data, error } = await supabase
    .from('orders')
    .select('ip')
    .eq('user_id', userId)
    .not('ip', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error || !data) {
    // Fail-soft: render `—` (the UI fallback). Don't fail the whole
    // detail page just because the IP lookup had a hiccup.
    return { raw: null, masked: null }
  }
  const raw = coerceString((data as { ip: string | null }).ip)
  return {
    raw,
    masked: raw ? maskIp(raw) : null,
  }
}

/**
 * Returns the full read-only customer payload for the Overview tab, or
 * null when the user_id is invalid / doesn't exist / is an admin row.
 *
 * Fails closed on any RPC error (returns null + warn log — the caller
 * decides between 404 and a "we could not load this customer" surface;
 * the page renders the 404 in practice).
 */
export async function getAdminCustomerDetail(
  userId: string,
): Promise<CustomerDetail | null> {
  // Auth gate: never invoke the RPC for an anon / wrong-role caller.
  await requireAdmin()

  // Validate the param shape before the RPC call.
  const canonical = parseCustomerDetailId(userId)
  if (!canonical) return null

  const supabase = await getServerSupabase()

  // Round 1: RPC + first-seen IP lookup (parallel).
  const [rpcResult, ipResult] = await Promise.all([
    supabase.rpc('get_admin_customer_detail', { p_user_id: canonical }),
    fetchFirstSeenIp(supabase, canonical),
  ])

  const { data, error } = rpcResult
  if (error || !data || !Array.isArray(data) || data.length === 0) {
    // Empty array means the RPC refused (admin row / nonexistent) —
    // either way, the page should 404.
    if (error) {
      log.warn(
        { code: 'customer_detail_rpc_failed' },
        'getAdminCustomerDetail: RPC error',
      )
    }
    return null
  }

  const raw = data[0] as RawRpcRow

  // Defensive role/status coercion — the RPC's CHECK constraint
  // ensures the values are valid, but the wire shape is `text` and
  // we want narrow TS types.
  const emailRaw = coerceString(raw.email)
  const emailMasked = emailRaw ? maskEmail(emailRaw) : null

  return {
    user_id: raw.user_id,
    display_name: raw.display_name ?? 'Unknown user',
    avatar_url: coerceString(raw.avatar_url),
    bio: coerceString(raw.bio),
    locale: coerceString(raw.locale),
    timezone: coerceString(raw.timezone),
    role: coerceRole(raw.role),
    status: coerceStatus(raw.status),
    suspended_at: coerceString(raw.suspended_at),
    suspended_until: coerceString(raw.suspended_until),
    suspended_reason: coerceString(raw.suspended_reason),
    banned_at: coerceString(raw.banned_at),
    banned_reason: coerceString(raw.banned_reason),
    banned_by: coerceString(raw.banned_by),
    warnings_count: coerceInt(raw.warnings_count),
    signup_date: raw.signup_date,
    profile_updated_at: raw.profile_updated_at,
    email_raw: emailRaw,
    email_masked: emailMasked,
    last_sign_in_at: coerceString(raw.last_sign_in_at),
    first_seen_ip_raw: ipResult.raw,
    first_seen_ip_masked: ipResult.masked,
    lifetime_spend_cents: coerceBigint(raw.lifetime_spend_cents),
    order_count: coerceBigint(raw.order_count),
    library_size: coerceBigint(raw.library_size),
    last_active_at: coerceString(raw.last_active_at),
    refund_count: coerceBigint(raw.refund_count),
    refund_rate: coerceNumeric(raw.refund_rate),
    risk_score: coerceInt(raw.risk_total_score),
    risk_refund_count: coerceBigint(raw.risk_refund_count),
    risk_dispute_count: coerceBigint(raw.risk_dispute_count),
    risk_signal_severity_sum: coerceBigint(raw.risk_signal_severity_sum),
    risk_refund_contribution: coerceInt(raw.risk_refund_contribution),
    risk_dispute_contribution: coerceInt(raw.risk_dispute_contribution),
    risk_activity_contribution: coerceInt(raw.risk_activity_contribution),
  }
}