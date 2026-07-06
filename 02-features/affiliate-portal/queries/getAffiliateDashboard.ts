// getAffiliateDashboard.ts — P13.3 affiliate dashboard data aggregator.
//
// Reads the four data slices the P13.3 dashboard renders in parallel:
//   1. The affiliate row (status, handle, approved_at, payout_method present)
//   2. The profile (display_name + email for the header greeting)
//   3. The ensure_default_affiliate_link RPC (creates the default link
//      idempotently on first visit; returns the row to the dashboard so
//      the affiliate-link hero card can render the code)
//   4. The get_affiliate_summary RPC (returns the 4 KPI aggregates)
//
// All four are independent reads → single Promise.all RT. Fails soft
// to a typed `null` so the page renders the empty/loading states
// without throwing.
//
// **Why one query, not four?** The page is the only consumer today;
// colocating the four reads in one helper means future P13.x slices
// (link-generator, tools grid, top-products) can reuse this query
// without re-implementing the auth + ownership + fail-soft logic.
//
// **PII safety** — every log call uses the FNV-1a hashed affiliate_id.
// Raw affiliate_id NEVER crosses the log boundary.

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'

const DASHBOARD_LOG = loggerFor({ component: 'affiliate.dashboard' })

/** Affiliate row, narrowed to the dashboard's needs. The RLS policy
 *  `affiliates_self_read` ensures only the calling user's row is
 *  returned. */
export type AffiliateRow = {
  id: number
  handle: string
  status: 'pending' | 'approved' | 'suspended'
  approvedAt: string | null
  payoutMethodPresent: boolean
}

/** Profile row, narrowed to the header's needs (display_name + email).
 *  RLS: profiles_self_read policy. */
export type AffiliateProfile = {
  displayName: string
  email: string
}

/** The affiliate's default link (returned by ensure_default_affiliate_link).
 *  Always present after first dashboard visit; the dashboard falls back
 *  to a synthesized "loading…" state if the helper returned NULL. */
export type AffiliateDefaultLink = {
  id: number
  code: string
  destinationPath: string
  affiliateId: number
}

/** The 4 KPIs the dashboard renders. */
export type AffiliateSummary = {
  /** Sum of all non-reversed commission_cents. */
  lifetimeEarnedCents: number
  /** Sum of non-reversed commission_cents since start of current month. */
  monthEarnedCents: number
  /** Count of clicks on the affiliate's links in the last 30 days. */
  clicks30d: number
  /** Count of non-reversed commission rows created in the last 30 days. */
  conversions30d: number
}

/** Aggregator result. Null when the user is not a logged-in affiliate,
 *  so the page can render a single "Not an affiliate" state instead
 *  of compositing 4 separate `null` checks. */
export type AffiliateDashboard = {
  affiliate: AffiliateRow
  profile: AffiliateProfile
  defaultLink: AffiliateDefaultLink | null
  summary: AffiliateSummary
}

/** Coerce a PostgREST bigint-as-string into a finite non-negative
 *  number. Used for `lifetime_earned_cents` etc. */
function coerceBigint(v: unknown): number {
  if (v == null) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10)
    return Number.isFinite(n) ? Math.max(0, n) : 0
  }
  return 0
}

/** FNV-1a 32-bit hash (hex). Same scheme as the partner-side helpers
 *  so log entries correlate across surfaces. */
function hashAffiliateId(affiliateId: number): string {
  let hash = 0x811c9dc5
  for (const ch of String(affiliateId)) {
    hash ^= ch.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Narrow the raw affiliates row to the dashboard's minimal shape. */
function narrowAffiliateRow(
  raw: Record<string, unknown> | null,
): AffiliateRow | null {
  if (!raw) return null
  const id = coerceBigint(raw.id)
  const handle = typeof raw.handle === 'string' ? raw.handle.trim() : ''
  const statusRaw = typeof raw.status === 'string' ? raw.status : ''
  const status: AffiliateRow['status'] =
    statusRaw === 'approved' || statusRaw === 'suspended' ? statusRaw : 'pending'
  const approvedAt = typeof raw.approved_at === 'string' ? raw.approved_at : null
  const payoutMethod = raw.payout_method
  // A valid affiliates row has a positive id + a non-empty handle. Rows
  // missing either field are treated as "no row" — the page renders
  // the "Setup incomplete" state.
  if (!id || !handle) return null
  return {
    id,
    handle,
    status,
    approvedAt,
    payoutMethodPresent: payoutMethod != null,
  }
}

/** Narrow the raw profiles row to the dashboard's minimal shape. */
function narrowProfileRow(raw: Record<string, unknown> | null): AffiliateProfile {
  return {
    displayName: typeof raw?.display_name === 'string' ? raw.display_name : '',
    email: typeof raw?.email === 'string' ? raw.email : '',
  }
}

/** Narrow the ensure_default_affiliate_link RPC result to the typed
 *  shape. The RPC returns JSONB; defensive on every field. */
function narrowDefaultLink(raw: unknown): AffiliateDefaultLink | null {
  if (raw == null) return null
  const row = raw as Record<string, unknown> | null
  if (!row) return null
  const id = coerceBigint(row.id)
  const code = typeof row.code === 'string' ? row.code : ''
  const destinationPath =
    typeof row.destination_path === 'string' ? row.destination_path : '/'
  const affiliateId = coerceBigint(row.affiliate_id)
  if (!id || !code) return null
  return { id, code, destinationPath: destinationPath || '/', affiliateId }
}

/** Narrow the get_affiliate_summary RPC result to the typed shape. */
function narrowSummary(raw: unknown): AffiliateSummary {
  const row = (raw as Array<Record<string, unknown>> | null)?.[0] ?? null
  if (!row) {
    return {
      lifetimeEarnedCents: 0,
      monthEarnedCents: 0,
      clicks30d: 0,
      conversions30d: 0,
    }
  }
  return {
    lifetimeEarnedCents: coerceBigint(row.lifetime_earned_cents),
    monthEarnedCents: coerceBigint(row.month_earned_cents),
    clicks30d: coerceBigint(row.clicks_30d_count),
    conversions30d: coerceBigint(row.conversions_30d_count),
  }
}

/**
 * Read the full P13.3 dashboard data set in a single Promise.all RT.
 *
 * **Auth contract**: caller must be a logged-in affiliate (role
 * check happens in the page route via `requireRole(['affiliate'])`
 * — the helper itself only requires `getUser()` to return a user).
 *
 * **Returns**: `null` when the user has no `affiliates` row (non-
 * affiliate user, or post-delete). The page renders a 404 in that
 * case. Returns a fully-shaped `AffiliateDashboard` otherwise.
 */
export async function getAffiliateDashboard(): Promise<AffiliateDashboard | null> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  // Round 1 (sequential; cheap): the affiliates row + the profile.
  // The affiliates row is the page's primary key; nothing renders
  // without it. The profile is the only "secondary" data needed for
  // the greeting.
  const { data: affiliateRaw, error: affiliateErr } = await supabase
    .from('affiliates')
    .select('id, handle, status, approved_at, payout_method')
    .eq('user_id', user.id)
    .maybeSingle()

  if (affiliateErr) {
    DASHBOARD_LOG.warn(
      { code: affiliateErr.code ?? null },
      'affiliates row read failed',
    )
    return null
  }
  const affiliate = narrowAffiliateRow(affiliateRaw as Record<string, unknown> | null)
  if (!affiliate) return null

  // Round 2 (parallel): profile + default link + summary RPC.
  // All three are independent reads keyed by the affiliate id we
  // just looked up.
  const [profileResult, defaultLinkResult, summaryResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('display_name, email')
      .eq('id', user.id)
      .maybeSingle(),
    supabase.rpc('ensure_default_affiliate_link', {
      p_affiliate_id: affiliate.id,
    }),
    supabase.rpc('get_affiliate_summary', {
      p_affiliate_id: affiliate.id,
    }),
  ])

  if (profileResult.error) {
    DASHBOARD_LOG.warn(
      { affiliate_id_hash: hashAffiliateId(affiliate.id), code: profileResult.error.code ?? null },
      'profiles row read failed',
    )
    // Fail-soft: header renders email-only when display_name is missing.
  }

  return {
    affiliate,
    profile: narrowProfileRow(profileResult.data as Record<string, unknown> | null),
    defaultLink: narrowDefaultLink(defaultLinkResult.data),
    summary: narrowSummary(summaryResult.data),
  }
}
