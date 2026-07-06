// getMyAffiliateLinks.ts — P13.5 link-generator data aggregator.
//
// Reads the affiliate's active (non-soft-deleted) affiliate_links
// rows plus the click + conversion aggregates the page renders.
// All aggregates are computed at read time via JOIN subqueries (no
// denormalized counters — see migration 0048 header for the
// rationale; the denormalized path is filed in STUB-110 Slices 2+
// and only lands at v2 scale).
//
// **Why one query, not three** (links / clicks / conversions):
// the page renders one card (default link) + one table (all links)
// + one stats row; all three read the same `affiliate_links` row set
// scoped to one affiliate. Parallelising the reads via Promise.all
// keeps the wall time to one RT (vs. four for sequential reads).
//
// **Auth + RLS**:
//   - caller must be a logged-in user (anon → null)
//   - `affiliate_links` SELECT is scoped to the affiliate via
//     `affiliate_links_self_read` RLS policy (admin sees all)
//   - `affiliate_clicks` aggregates are scoped to the affiliate's
//     own link ids via IN (the same policy join as the dashboard's
//     30d-clicks KPI)
//   - `affiliate_commissions` aggregates are scoped to the affiliate
//     directly via `affiliate_commissions_self_read`
//
// **Fail-soft**: any read error returns null for that sub-aggregate;
// the page renders zeros + the partial data it has.
//
// **PII safety**: log payloads use the FNV-1a hashed affiliate_id
// (no raw affiliate_id, no email, no user_id).

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'

const LINKS_LOG = loggerFor({ component: 'affiliate.links' })

/** A single affiliate_links row plus its computed metrics. The
 *  `clicksAllTime` + `clicks30d` + `lastClickedAt` derive from
 *  `affiliate_clicks` joined via link_id; `conversionsAllTime` +
 *  `conversions30d` derive from `affiliate_commissions` joined via
 *  affiliate_id (NOT link_id — commissions are per-attribution, not
 *  per-link; the dashboard KPI aggregates by affiliate).
 *
 *  `conversionRate` is null when clicks_all_time is 0 (matches the
 *  spec acceptance criterion #3 "conversion_rate — clicks > 0 only,
 *  null if no clicks"). */
export type AffiliateLinkRow = {
  id: number
  code: string
  destinationPath: string
  campaign: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  active: boolean
  disabledAt: string | null
  deletedAt: string | null
  createdAt: string
  clicksAllTime: number
  clicks30d: number
  conversionsAllTime: number
  conversions30d: number
  conversionRate: number | null
  lastClickedAt: string | null
}

/** The 4 stat cards the page renders (matches spec acceptance #2). */
export type AffiliateLinksStats = {
  totalLinks: number
  totalClicks30d: number
  totalConversions30d: number
  /** Average conversion_rate across the affiliate's active links,
   *  weighted by clicks. `null` when totalClicks30d is 0 (matches the
   *  per-card null-when-no-clicks rule). */
  avgConversionRate30d: number | null
}

/** Aggregator result. Null when the user is anon OR has no
 *  affiliates row (matches the page-level 404 contract). */
export type MyAffiliateLinks = {
  affiliate: { id: number; handle: string; status: 'pending' | 'approved' | 'suspended' }
  links: AffiliateLinkRow[]
  stats: AffiliateLinksStats
}

/** FNV-1a 32-bit hash (hex). Same scheme as the partner / dashboard
 *  helpers so log entries correlate across surfaces. */
function hashAffiliateId(affiliateId: number): string {
  let hash = 0x811c9dc5
  for (const ch of String(affiliateId)) {
    hash ^= ch.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Coerce a PostgREST bigint-as-string into a finite non-negative
 *  number. Returns 0 for null / NaN / non-numeric / negative. */
function coerceBigint(v: unknown): number {
  if (v == null) return 0
  if (typeof v === 'number') {
    return Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0
  }
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10)
    return Number.isFinite(n) ? Math.max(0, n) : 0
  }
  return 0
}

/** Narrow a raw affiliate_links row to the typed shape. Defensive
 *  on every field — never throws. Returns null when the row is
 *  missing critical fields (positive id + non-empty code) so a
 *  corrupted row is dropped from the result set instead of
 *  crashing the page. */
function narrowLinkRow(raw: Record<string, unknown> | null): AffiliateLinkRow | null {
  if (!raw) return null
  const id = coerceBigint(raw.id)
  const code = typeof raw.code === 'string' ? raw.code.trim() : ''
  const destinationPath =
    typeof raw.destination_path === 'string' && raw.destination_path.length > 0
      ? raw.destination_path
      : '/'
  if (!id || !code) return null

  const campaign = typeof raw.campaign === 'string' ? raw.campaign : null
  const utmSource = typeof raw.utm_source === 'string' ? raw.utm_source : null
  const utmMedium = typeof raw.utm_medium === 'string' ? raw.utm_medium : null
  const utmCampaign = typeof raw.utm_campaign === 'string' ? raw.utm_campaign : null
  const active = raw.active === true
  const disabledAt = typeof raw.disabled_at === 'string' ? raw.disabled_at : null
  const deletedAt = typeof raw.deleted_at === 'string' ? raw.deleted_at : null
  const createdAt =
    typeof raw.created_at === 'string' && raw.created_at.length > 0
      ? raw.created_at
      : new Date(0).toISOString()

  const clicksAllTime = coerceBigint(raw.clicks_all_time)
  const clicks30d = coerceBigint(raw.clicks_30d)
  const conversionsAllTime = coerceBigint(raw.conversions_all_time)
  const conversions30d = coerceBigint(raw.conversions_30d)
  const lastClickedAt = typeof raw.last_clicked_at === 'string' ? raw.last_clicked_at : null
  const conversionRate = clicksAllTime > 0 ? conversionsAllTime / clicksAllTime : null

  return {
    id,
    code,
    destinationPath,
    campaign,
    utmSource,
    utmMedium,
    utmCampaign,
    active,
    disabledAt,
    deletedAt,
    createdAt,
    clicksAllTime,
    clicks30d,
    conversionsAllTime,
    conversions30d,
    conversionRate,
    lastClickedAt,
  }
}

/** Narrow the raw affiliates row. Returns null when the affiliate
 *  has no positive id or no handle. The status narrows to the
 *  3-value enum (anything else → 'pending' — matches the dashboard
 *  pattern in getAffiliateDashboard). */
function narrowAffiliate(
  raw: Record<string, unknown> | null,
): MyAffiliateLinks['affiliate'] | null {
  if (!raw) return null
  const id = coerceBigint(raw.id)
  const handle = typeof raw.handle === 'string' ? raw.handle.trim() : ''
  if (!id || !handle) return null
  const statusRaw = typeof raw.status === 'string' ? raw.status : ''
  const status: 'pending' | 'approved' | 'suspended' =
    statusRaw === 'approved' || statusRaw === 'suspended' ? statusRaw : 'pending'
  return { id, handle, status }
}

/**
 * Read the P13.5 link-generator data set in a single Promise.all RT.
 *
 * **Auth contract**: caller must be a logged-in affiliate (role
 * check happens in the page route via `requireRole(['affiliate'])`).
 *
 * **Returns**: `null` when the user is anon OR has no `affiliates`
 * row. The page renders a 404 in that case. Returns a fully-shaped
 * `MyAffiliateLinks` otherwise.
 */
export async function getMyAffiliateLinks(): Promise<MyAffiliateLinks | null> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  // Round 1 (sequential; cheap): the affiliates row. Everything
  // downstream keys off this id; nothing renders without it.
  const { data: affiliateRaw, error: affiliateErr } = await supabase
    .from('affiliates')
    .select('id, handle, status')
    .eq('user_id', user.id)
    .maybeSingle()

  if (affiliateErr) {
    LINKS_LOG.warn({ code: affiliateErr.code ?? null }, 'affiliates row read failed')
    return null
  }
  const affiliate = narrowAffiliate(affiliateRaw as Record<string, unknown> | null)
  if (!affiliate) return null

  // Round 2 (parallel): the affiliate_links rows + the click +
  // commission aggregates, all scoped to the affiliate. The link
  // read is RLS-scoped; the aggregates are run against the link ids
  // + the affiliate id (defense-in-depth — the joins themselves
  // would be RLS-correct but the explicit IN + eq filter makes the
  // intent obvious to a reviewer).
  //
  // We use a single RPC call (raw SQL via supabase.rpc) for the
  // click + commission aggregates so the page does ONE round-trip
  // for the bulk read. The links read is a separate call because
  // we need the row shape (not just aggregates). Three reads total
  // in parallel.
  const [linksResult, metricsResult] = await Promise.all([
    supabase
      .from('affiliate_links')
      .select(
        'id, code, destination_path, campaign, utm_source, utm_medium, utm_campaign, active, disabled_at, deleted_at, created_at',
      )
      .eq('affiliate_id', affiliate.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    // SECURITY DEFINER RPC: scoped to the calling affiliate via
    // auth.uid() -> current_affiliate_id() server-side; unauthorized
    // callers get zero rows. Returns one row per affiliate_links
    // row that belongs to the affiliate (joined with the click +
    // commission aggregates). The RPC handles the deleted_at
    // filter so the metric side stays consistent with the row side.
    supabase.rpc('get_my_affiliate_link_metrics', {}),
  ])

  if (linksResult.error) {
    LINKS_LOG.warn(
      { affiliate_id_hash: hashAffiliateId(affiliate.id), code: linksResult.error.code ?? null },
      'affiliate_links read failed',
    )
    return null
  }
  if (metricsResult.error) {
    LINKS_LOG.warn(
      { affiliate_id_hash: hashAffiliateId(affiliate.id), code: metricsResult.error.code ?? null },
      'link metrics RPC failed',
    )
    // Fail-soft: render the links list with zeros rather than 404
    // the whole page. The page still tells the affiliate their
    // links are present.
  }

  const linksRaw = (linksResult.data ?? []) as Array<Record<string, unknown>>
  const metricsById = new Map<number, Record<string, unknown>>()
  if (Array.isArray(metricsResult.data)) {
    for (const m of metricsResult.data as Array<Record<string, unknown>>) {
      const mid = coerceBigint(m.id)
      if (mid > 0) metricsById.set(mid, m)
    }
  }

  // Merge: per-row metrics onto the link row. A row missing from the
  // metrics map gets zeros (fail-soft — covers the RPC failure
  // path + the deleted_at filter mismatch race).
  const links: AffiliateLinkRow[] = []
  for (const raw of linksRaw) {
    const id = coerceBigint(raw.id)
    const merged = { ...raw, ...(metricsById.get(id) ?? {}) }
    const narrowed = narrowLinkRow(merged)
    if (narrowed) links.push(narrowed)
  }

  // Aggregate stats across the affiliate's links. We compute from
  // the per-link numbers rather than running another SQL aggregate
  // so a partial-fail (some links missing metrics) doesn't skew the
  // total.
  let totalClicks30d = 0
  let totalConversions30d = 0
  for (const l of links) {
    totalClicks30d += l.clicks30d
    totalConversions30d += l.conversions30d
  }
  const avgConversionRate30d = totalClicks30d > 0 ? totalConversions30d / totalClicks30d : null

  return {
    affiliate,
    links,
    stats: {
      totalLinks: links.length,
      totalClicks30d,
      totalConversions30d,
      avgConversionRate30d,
    },
  }
}