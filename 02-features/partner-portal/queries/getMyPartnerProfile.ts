import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import { decryptPayoutMethod, type PartnerPayoutMethod } from './decryptPayoutMethod'

export type PartnerStatus = 'pending' | 'approved' | 'suspended'

/**
 * P12.17 — Public social handles for the partner profile (twitter /
 * linkedin / youtube / github / website). Each field is a string
 * (handle / slug / URL); null means "not set". The DB column is jsonb
 * (per migration 0044) but the typed surface is a flat object with
 * nullable keys — the form + the read path treat null and missing
 * identically.
 */
export type PartnerSocialLinks = {
  twitter: string | null
  linkedin: string | null
  youtube: string | null
  github: string | null
  website: string | null
}

export type PartnerProfile = {
  id: number
  user_id: string
  status: PartnerStatus
  public_slug: string | null
  bio: string | null
  website_url: string | null
  /**
   * Typed payout method shape (P6.5 Slice 1). Includes the decrypted
   * PayPal email (for the form's input value), a masked variant (for
   * read-only display), and the `payout_method_kind` discriminator
   * (forward-compat for Slice 2's `'bank'` value). The decryption
   * handles encrypted envelopes + legacy plaintext transparently;
   * see `decryptPayoutMethod` for the full contract.
   */
  payout_method: PartnerPayoutMethod
  tax_form_status: 'none' | 'pending' | 'submitted' | 'approved'
  tax_country?: never
  tax_id?: never
  /**
   * P12.17 — Public social handles (twitter / linkedin / youtube /
   * github / website). Always a fully-populated `PartnerSocialLinks`
   * shape with explicit `null` for unset fields; the form never has
   * to defend against undefined keys. Default `{}` from the DB →
   * mapped to all-nulls by the read path.
   */
  social_links: PartnerSocialLinks
  /**
   * P12.17 — Opt-in toggle for the partner's public profile
   * visibility. When `true` AND `status === 'approved'`, the
   * partner's profile (bio + website + social_links + headshot via
   * profiles.avatar_url) becomes queryable from the future
   * standalone /partner/[slug] page. Default `false`.
   */
  is_public: boolean
  created_at: string
  updated_at: string
  // Joined from profiles
  display_name: string
  email: string
}

/**
 * Shape of the raw partner row as it comes out of Supabase. Differs
 * from `PartnerProfile` only in `payout_method`: the DB column is
 * `jsonb` (so it can hold either an encrypted envelope, legacy
 * plaintext, or null), and the consumer-facing `PartnerProfile` has
 * the decrypted + masked `PartnerPayoutMethod` shape.
 */
type RawPartnerRow = Omit<PartnerProfile, 'display_name' | 'email' | 'payout_method'> & {
  payout_method: unknown
}

const PARTNER_COLS =
  'id, user_id, status, public_slug, bio, website_url, payout_method, tax_form_status, kyc_status, royalty_pct_bps, approved_at, social_links, is_public, created_at, updated_at'

/** Read the current user's partner row. Returns null if the
 *  user is not (yet) a partner. RLS on `partners` allows self-
 *  read on the user's own row. */
export async function getMyPartnerProfile(): Promise<PartnerProfile | null> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: partner, error: partnerErr } = await supabase
    .from('partners')
    .select(PARTNER_COLS)
    .eq('user_id', user.id)
    .maybeSingle()

  if (partnerErr || !partner) return null

  // Read the profile separately for the join info. The actual
  // display_name lives on `profiles.display_name`; the partner
  // row is a separate entity.
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, email')
    .eq('user_id', user.id)
    .maybeSingle()

  const partnerRow = partner as RawPartnerRow
  return {
    ...partnerRow,
    // P6.5 Slice 1 — decrypt + mask the payout_method JSONB. The
    // raw `paypal_email_encrypted` / `paypal_email` keys never
    // leave the helper — only the typed `PartnerPayoutMethod`
    // shape does. Legacy plaintext rows keep rendering correctly
    // via the `decryptStringOrPassThrough` path inside the helper
    // until STUB-052 backfills them.
    payout_method: decryptPayoutMethod(partnerRow.payout_method),
    // P12.17 — normalize the social_links jsonb into the typed
    // `PartnerSocialLinks` shape. Always a fully-populated object
    // with explicit `null` for unset fields so the form never has
    // to defend against undefined keys. Defends against (a) a
    // legacy row that predates the column (the SELECT would have
    // returned `null` for the column, but the DO-guard in the
    // migration means a freshly-applied DB always has the
    // `'{}'::jsonb` default), (b) a corrupted row with non-object
    // jsonb (string, array, number), (c) partial objects missing
    // some keys. Each field is read defensively — anything that
    // isn't a string is coerced to `null`.
    social_links: normalizeSocialLinks(partnerRow.social_links),
    is_public: partnerRow.is_public === true,
    display_name: (profile?.display_name as string | null) ?? user.email ?? 'Partner',
    email: (profile?.email as string | null) ?? user.email ?? '',
  }
}

/**
 * P12.17 — Normalize the raw `partners.social_links` jsonb into the
 * typed `PartnerSocialLinks` shape. Defensive against malformed jsonb
 * (non-object shapes, partial objects, non-string values). Each field
 * is coerced to `string | null`; anything that isn't a string is `null`.
 */
function normalizeSocialLinks(raw: unknown): PartnerSocialLinks {
  const out: PartnerSocialLinks = {
    twitter: null,
    linkedin: null,
    youtube: null,
    github: null,
    website: null,
  }
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return out
  const obj = raw as Record<string, unknown>
  const coerce = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)
  out.twitter = coerce(obj.twitter)
  out.linkedin = coerce(obj.linkedin)
  out.youtube = coerce(obj.youtube)
  out.github = coerce(obj.github)
  out.website = coerce(obj.website)
  return out
}

/** Lightweight summary for the dashboard. Returns null if not
 *  a partner. Aggregates sales + product counts.
 *
 *  P12.4 — added `monthSalesCents` (current calendar month, RPC
 *  get_partner_month_sales_cents from migration 0038). The lifetime
 *  figure keeps coming from get_partner_lifetime_sales_cents (0029)
 *  so the dashboard's two financial KPIs read from canonical
 *  sources and a single-source-of-truth per period. */
export type PartnerDashboardSummary = {
  partner: PartnerProfile
  productCount: number
  publishedProductCount: number
  pendingProductCount: number
  totalSalesCents: number
  /** P12.4 — gross sales for the current calendar month. Read from
   *  get_partner_month_sales_cents (migration 0038). Zero on RPC
   *  error (fail-soft). */
  monthSalesCents: number
  totalOrdersCount: number
  pendingReview: boolean
}

export async function getPartnerDashboardSummary(): Promise<PartnerDashboardSummary | null> {
  const supabase = await getServerSupabase()
  const partner = await getMyPartnerProfile()
  if (!partner) return null

  // Parallelize the 3 product-count reads + the lifetime-sales RPC
  // + the P12.4 month-sales RPC. All five are independent reads
  // against the partner's own rows (RLS-enforced via the user's
  // session). Promise.all keeps the dashboard render under the p95
  // < 250ms budget even when the partner has many products.
  //
  // P6.1 — `totalSalesCents` reads from
  // get_partner_lifetime_sales_cents(partner.id) (migration 0029).
  // The RPC is SECURITY DEFINER + checks `current_partner_id() =
  // p_partner_id or is_admin()` internally, so it always returns 0
  // for unauthorized callers and never leaks another partner's data.
  // Filtering on `kind = 'order_sale'` excludes subscriptions /
  // refunds / adjustments / payouts / clawbacks — the "Lifetime sales"
  // KPI shows gross order sales only (refunds + payout lifecycle
  // surface separately on P6.3's `/partner/payouts` page).
  //
  // P12.4 — `monthSalesCents` reads from
  // get_partner_month_sales_cents(partner.id) (migration 0038).
  // Same authorization model; same kind filter; adds a
  // `created_at >= month_start` predicate for the current calendar
  // month in the server's UTC timezone.
  const [
    { count: productCount },
    { count: publishedCount },
    { count: pendingCount },
    salesResult,
    monthSalesResult,
  ] = await Promise.all([
    supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('partner_id', partner.id),
    supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('partner_id', partner.id)
      .eq('status', 'published'),
    supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('partner_id', partner.id)
      .eq('status', 'in_review'),
    supabase.rpc('get_partner_lifetime_sales_cents', {
      p_partner_id: partner.id,
    }),
    supabase.rpc('get_partner_month_sales_cents', {
      p_partner_id: partner.id,
    }),
  ])

  // Fail-soft on every RPC — a transient DB error should never
  // break the dashboard. Log a warn so the failure is observable,
  // then surface $0 instead of an error UI. The KPI is a snapshot
  // read; a missed refresh is recoverable on the next page load.
  const dashboardLog = loggerFor({ component: 'partner.dashboard' })
  let totalSalesCents = 0
  if (salesResult.error) {
    dashboardLog.warn(
      { partner_id_hash: hashPartnerId(partner.id), code: salesResult.error.code ?? null },
      'lifetime sales RPC failed',
    )
  } else if (
    typeof salesResult.data === 'number' ||
    typeof salesResult.data === 'string'
  ) {
    // PostgREST returns numeric as string when the column is bigint —
    // coerce defensively. The RPC declares `returns bigint` but
    // PostgREST's wire format serializes bigint as a JSON string.
    const n =
      typeof salesResult.data === 'string'
        ? Number.parseInt(salesResult.data, 10)
        : salesResult.data
    totalSalesCents = Number.isFinite(n) ? n : 0
  }

  let monthSalesCents = 0
  if (monthSalesResult.error) {
    dashboardLog.warn(
      { partner_id_hash: hashPartnerId(partner.id), code: monthSalesResult.error.code ?? null },
      'month sales RPC failed',
    )
  } else if (
    typeof monthSalesResult.data === 'number' ||
    typeof monthSalesResult.data === 'string'
  ) {
    const n =
      typeof monthSalesResult.data === 'string'
        ? Number.parseInt(monthSalesResult.data, 10)
        : monthSalesResult.data
    monthSalesCents = Number.isFinite(n) ? n : 0
  }

  return {
    partner,
    productCount: productCount ?? 0,
    publishedProductCount: publishedCount ?? 0,
    pendingProductCount: pendingCount ?? 0,
    totalSalesCents,
    monthSalesCents,
    totalOrdersCount: 0, // not in P6.1 scope (lives on P6.3 /partner/payouts as a count ledger)
    pendingReview: partner.status === 'pending',
  }
}

/**
 * Hash a numeric partner_id for log redaction. We never want the raw
 * partner_id in logs — it's an internal-account identifier that could
 * be cross-referenced with other logs / tables. FNV-1a 32-bit is fast,
 * non-cryptographic, and sufficient for "is this the same partner
 * across log lines" correlation. NOT a security boundary; just a
 * redaction helper for the `check:pii` script.
 */
function hashPartnerId(partnerId: number): string {
  let hash = 0x811c9dc5
  for (const ch of String(partnerId)) {
    hash ^= ch.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  // Unsigned hex, 8 chars.
  return (hash >>> 0).toString(16).padStart(8, '0')
}
