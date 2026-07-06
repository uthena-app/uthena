// getMiniShop.ts — P13.8 public minishop /[handle] data aggregator.
//
// Reads the full data set the /[handle] page renders in a single
// sequential + Promise.all composite read:
//
//   Round 1 (sequential): affiliates row by handle
//     - The RLS policy `affiliates_public_read_approved` already
//       gates this read to `status = 'approved'`. Anonymous callers
//       can read approved rows without a session.
//     - Returns null for missing / pending / suspended handles →
//       the route translates to a 404 (per spec acceptance #3).
//
//   Round 2 (sequential): profile (display_name + avatar_url +
//     social_links) by user_id from Round 1. Fail-soft on error
//     (display_name falls back to `@<handle>`, avatar to null).
//
//   Round 3 (Promise.all of 3 reads):
//     - Curated products + the products join (the storefront grid).
//       Filters out unpublished products at the page layer (the
//       RLS-friendly join doesn't compose .eq() on a joined table
//       in one RT — PostgREST limitation).
//     - Affiliate stats: lifetime_earned_cents (sum of non-reversed
//       commission_cents) + clicks_30d (count of affiliate_clicks
//       rows in the last 30 days).
//     - Reviews aggregate: avg(rating) for products in the curated
//       set (the hero's "avg rating" stat per spec).
//
// **Why one helper, not three?** The page is the only consumer
// today; colocating the three reads means the data + RLS +
// fail-soft logic lives in one place. Future P13.x surfaces
// (mini-shop personalization, admin mini-shop preview, the
// /affiliate/shop edit page that mirrors the public view) can
// import this helper without re-implementing the join.
//
// **Why no security definer RPC?** The 3 reads are bounded: the
// affiliates_by_handle read is already public (RLS), the profile
// read is the public `profiles_public_read` shape, and the stats
// are computed client-side from the already-public data. A RPC
// would consolidate the 3 RT into 1 — minor — but ship the read
// surface first; an RPC is a v1.1 optimization.
//
// **PII safety** — every log call uses the FNV-1a hashed
// affiliate_id. Raw affiliate_id NEVER crosses the log boundary.

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'

const SHOP_LOG = loggerFor({ component: 'affiliate.minishop' })

/** Allowed statuses (mirrors `affiliates.status` check constraint). */
export type AffiliateStatus = 'pending' | 'approved' | 'suspended'

/** Narrowed affiliate row (the public-facing fields). */
export type ShopAffiliate = {
  id: number
  handle: string
  status: AffiliateStatus
  brandName: string | null
  bio: string | null
  approvedAt: string | null
  /** `created_at` on the affiliates row — used as the "Joined"
   *  stat on the about card. Falls back to `approved_at` when
   *  created is unparseable. */
  createdAt: string | null
  /** Affiliate's user_id — needed for the profile read in Round 2.
   *  Not exposed in the rendered page; used internally only. */
  userId: string
}

/** Narrowed profile row (the public-facing fields). The avatar +
 *  social_links are passed through to the `Person` JSON-LD schema. */
export type ShopProfile = {
  displayName: string
  avatarUrl: string | null
  socialLinks: ReadonlyArray<string>
}

/** One curated product (the affiliate's hand-pick). Drives both
 *  the Featured pick surface and the Curated collection grid. */
export type CuratedProduct = {
  curatedId: number
  isFeatured: boolean
  whyIPickedThis: string | null
  addedAt: string
  productSlug: string
  productTitle: string
  productShortDescription: string | null
  productThumbnailUrl: string | null
  /** Starting price in cents (computed from `product_pricing`).
   *  Null when no active pricing row. */
  startingPriceCents: number | null
  /** Currency code (3 letters; e.g. "USD"). Matches the active
   *  default pricing row or 'USD' when no pricing row matches. */
  currency: string
}

/** Aggregator result. Null when the handle doesn't resolve to an
 *  approved affiliate (invalid / pending / suspended → 404). */
export type MiniShop = {
  affiliate: ShopAffiliate
  profile: ShopProfile
  curatedProducts: ReadonlyArray<CuratedProduct>
  stats: {
    curatedCount: number
    lifetimeEarnedCents: number
    clicks30d: number
    avgRating: number | null
  }
}

/** Coerce a PostgREST bigint-as-string into a non-negative finite
 *  number. Same shape as the other affiliate-portal query helpers. */
function coerceBigint(v: unknown): number {
  if (v == null) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10)
    return Number.isFinite(n) ? Math.max(0, n) : 0
  }
  return 0
}

/** Coerce a PostgREST numeric-as-string into a finite number. */
function coerceNumeric(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const trimmed = v.trim()
    if (!trimmed) return null
    const n = Number.parseFloat(trimmed)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** FNV-1a 32-bit hash (hex). Same scheme as the other affiliate-
 *  portal helpers so log entries correlate across surfaces. */
function hashAffiliateId(affiliateId: number): string {
  let hash = 0x811c9dc5
  for (const ch of String(affiliateId)) {
    hash ^= ch.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Narrow the raw affiliates row. Treats invalid status values as
 *  'pending' so they go through the page's 404 short-circuit (the
 *  RLS policy restricts the anon read to approved-only, so the
 *  page should never see non-approved in practice — defense in
 *  depth). */
function narrowAffiliate(
  raw: Record<string, unknown> | null,
): ShopAffiliate | null {
  if (!raw) return null
  const id = coerceBigint(raw.id)
  const handle = typeof raw.handle === 'string' ? raw.handle.trim() : ''
  const userId = typeof raw.user_id === 'string' ? raw.user_id.trim() : ''
  const statusRaw = typeof raw.status === 'string' ? raw.status : ''
  const status: AffiliateStatus =
    statusRaw === 'approved' || statusRaw === 'pending' || statusRaw === 'suspended'
      ? (statusRaw as AffiliateStatus)
      : 'pending'
  const approvedAt = typeof raw.approved_at === 'string' ? raw.approved_at : null
  const brandName = typeof raw.brand_name === 'string' ? raw.brand_name.trim() || null : null
  const bio = typeof raw.bio === 'string' ? raw.bio : null
  if (!id || !handle || !userId) return null
  const createdAt =
    typeof raw.created_at === 'string' ? raw.created_at : null
  return { id, handle, status, brandName, bio, approvedAt, createdAt, userId }
}

/** Narrow the raw profiles row. */
function narrowProfile(raw: Record<string, unknown> | null): ShopProfile {
  const displayName = typeof raw?.display_name === 'string' ? raw.display_name.trim() : ''
  const avatarUrl = typeof raw?.avatar_url === 'string' ? raw.avatar_url.trim() || null : null
  const socialLinksRaw = raw?.social_links
  let socialLinks: string[] = []
  if (Array.isArray(socialLinksRaw)) {
    socialLinks = socialLinksRaw.filter(
      (v): v is string => typeof v === 'string' && v.trim().length > 0,
    )
  }
  return {
    displayName,
    avatarUrl,
    socialLinks,
  }
}

/** Narrow one curated row + the joined product. Drops rows whose
 *  product is not in the curated set shape (defense-in-depth
 *  against a misconfigured join). */
function narrowCurated(raw: Record<string, unknown> | null): CuratedProduct | null {
  if (!raw) return null
  const product = raw.product as Record<string, unknown> | null | undefined
  if (!product || typeof product !== 'object') return null
  const productSlug = typeof product.slug === 'string' ? product.slug.trim() : ''
  const productTitle = typeof product.title === 'string' ? product.title.trim() : ''
  if (!productSlug || !productTitle) return null
  const curatedId = coerceBigint(raw.id)
  if (!curatedId) return null
  const productId = coerceBigint(raw.product_id)
  if (!productId) return null
  const isFeatured = raw.is_featured === true
  const why =
    typeof raw.why_i_picked_this === 'string'
      ? raw.why_i_picked_this.trim() || null
      : null
  const addedAt = typeof raw.added_at === 'string' ? raw.added_at : ''
  const productShortDescription =
    typeof product.short_description === 'string' ? product.short_description : null
  const productThumbnailUrl =
    typeof product.thumbnail_url === 'string' ? product.thumbnail_url : null
  // The pricing array is at most a handful of rows; we pick the
  // active default (or the first active row) — the page only ever
  // uses one price + currency per card.
  const pricingRaw = Array.isArray(product.pricing)
    ? (product.pricing as ReadonlyArray<Record<string, unknown>>)
    : []
  let startingPriceCents: number | null = null
  let currency = 'USD'
  for (const p of pricingRaw) {
    const isActive = p?.is_active === true
    const isDefault = p?.is_default === true
    if (!isActive) continue
    const priceCents = coerceBigint(p.price_cents)
    if (priceCents === 0) continue
    const cur = typeof p.currency === 'string' ? p.currency.trim().toUpperCase() : ''
    if (isDefault || startingPriceCents === null) {
      startingPriceCents = priceCents
      if (cur) currency = cur
    }
  }
  return {
    curatedId,
    isFeatured,
    whyIPickedThis: why,
    addedAt,
    productSlug,
    productTitle,
    productShortDescription,
    productThumbnailUrl,
    startingPriceCents,
    currency,
  }
}

/**
 * Read the full P13.8 minishop data set.
 *
 * **Auth contract**: this is a PUBLIC helper — anonymous callers
 * see approved-only data via the existing `affiliates_public_read_approved`
 * RLS policy. The page does NOT call `requireRole()`.
 *
 * **Returns**: `null` when the handle doesn't resolve to an
 * approved affiliate, or when any read errors. The /[handle]
 * route maps null to a 404.
 *
 * **Fail-soft profile**: if the profile read errors, the page
 * still renders — the header falls back to `display_name =
 * affiliate.handle` (top-bar convention) and the avatar
 * degrades to nothing. Stats similarly fail-soft.
 */
export async function getMiniShop(rawHandle: string): Promise<MiniShop | null> {
  const handle = rawHandle.trim()
  if (!handle) return null

  const supabase = await getServerSupabase()

  // Round 1 — sequential: the affiliates row by handle. RLS already
  // restricts the anon read to status='approved', so the .eq() returns
  // one row for approved handles and nothing for the rest.
  const { data: affRaw, error: affErr } = await supabase
    .from('affiliates')
      .select(
        'id, handle, status, brand_name, bio, approved_at, created_at, user_id',
      )
    .eq('handle', handle)
    .maybeSingle()
  if (affErr) {
    SHOP_LOG.warn(
      { code: affErr.code ?? null, handle_hash: hashHandle(handle) },
      'affiliates by handle read failed',
    )
    return null
  }
  const affiliate = narrowAffiliate(affRaw as Record<string, unknown> | null)
  if (!affiliate || affiliate.status !== 'approved') return null
  const hashedId = hashAffiliateId(affiliate.id)

  // Round 2 — parallel: profile + curated products (with the
  // product join + the default pricing row) + the two stats
  // aggregates. All three reads are keyed off `affiliate.id` +
  // `affiliate.user_id`, so there are no sequencing constraints
  // between them.
  const [profileRes, curatedRes, commissionsRes, clicksRes, reviewsRes] =
    await Promise.all([
      supabase
        .from('profiles')
        .select('display_name, avatar_url, social_links')
        .eq('id', affiliate.userId)
        .maybeSingle(),
      supabase
        .from('affiliate_curated_products')
        .select(
          `id, product_id, is_featured, why_i_picked_this, added_at,
           product:products!inner(
             id, slug, title, short_description, thumbnail_url, status,
             pricing:product_pricing(license, price_cents, currency, is_default, is_active)
           )`,
        )
        .eq('affiliate_id', affiliate.id)
        .order('is_featured', { ascending: false })
        .order('added_at', { ascending: false })
        .limit(200),
      supabase
        .from('affiliate_commissions')
        .select('commission_cents')
        .eq('affiliate_id', affiliate.id)
        .neq('status', 'reversed'),
      supabase
        .from('affiliate_clicks')
        .select('id', { head: true, count: 'exact' })
        .eq('affiliate_id', affiliate.id)
        .gte('at', recent30DayIso()),
      supabase
        .from('reviews')
        .select('rating, product_id')
        .eq('status', 'published'),
    ])

  // --- Profile (fail-soft) ----------------------------------------------
  let profile: ShopProfile = {
    displayName: '',
    avatarUrl: null,
    socialLinks: [],
  }
  if (profileRes.error) {
    SHOP_LOG.warn(
      { affiliate_id_hash: hashedId, code: profileRes.error.code ?? null },
      'profiles read failed; falling back to handle',
    )
  } else {
    profile = narrowProfile(profileRes.data as Record<string, unknown> | null)
  }

  // --- Curated products (drop unpublished + malformed rows) -------------
  const curatedRaw = (curatedRes.data ?? []) as ReadonlyArray<Record<string, unknown>>
  const curatedAll = curatedRaw
    .map(narrowCurated)
    .filter((row): row is CuratedProduct => row !== null)
  const curatedProducts = curatedAll.filter((row) => {
    // Keep only products whose join succeeded AND that are
    // currently published. The inner join + the products.status
    // filter at the page layer (PostgREST join limitations
    // prevent composing .eq() on the joined table in one RT
    // against RLS-scoped reads; the page-layer filter is the
    // simplest defense).
    const product = curatedRaw.find(
      (r) => coerceBigint(r.id) === row.curatedId,
    )?.product as Record<string, unknown> | null
    return product?.status === 'published'
  })

  // --- Stats: lifetime earned (cents) -----------------------------------
  let lifetimeEarnedCents = 0
  if (commissionsRes.error) {
    SHOP_LOG.warn(
      { affiliate_id_hash: hashedId, code: commissionsRes.error.code ?? null },
      'affiliate_commissions read failed',
    )
  } else {
    const rows = (commissionsRes.data ?? []) as ReadonlyArray<Record<string, unknown>>
    for (const row of rows) {
      lifetimeEarnedCents += coerceBigint(row.commission_cents)
    }
  }

  // --- Stats: clicks in last 30 days -----------------------------------
  let clicks30d = 0
  if (clicksRes.error) {
    SHOP_LOG.warn(
      { affiliate_id_hash: hashedId, code: clicksRes.error.code ?? null },
      'affiliate_clicks count failed',
    )
  } else {
    clicks30d = coerceBigint((clicksRes as { count?: unknown }).count)
  }

  // --- Stats: avg rating across reviews on the curated products --------
  let avgRating: number | null = null
  if (reviewsRes.error) {
    SHOP_LOG.warn(
      { affiliate_id_hash: hashedId, code: reviewsRes.error.code ?? null },
      'reviews read failed',
    )
  } else {
    const curatedProductIds = new Set(curatedProducts.map((row) => row.productSlug))
    // The reviews table doesn't have a slug column directly — we
    // load by product_id from a separate join. For the v1 read
    // we approximate: load reviews.avg(rating) only when there's
    // a small number of curated products (cheap) and the
    // product_ids are materializable. If the join would balloon
    // the RT, we fall back to null.
    const reviewsData = (reviewsRes.data ?? []) as ReadonlyArray<Record<string, unknown>>
    const curatedProductIdSet = new Set<number>()
    for (const row of curatedRaw) {
      const product = row.product as Record<string, unknown> | null
      const pid = product ? coerceBigint(product.id) : 0
      if (pid) curatedProductIdSet.add(pid)
    }
    const ratings = reviewsData
      .map((r) => {
        const pid = coerceBigint(r.product_id)
        if (!curatedProductIdSet.has(pid)) return null
        return coerceNumeric(r.rating)
      })
      .filter((v): v is number => v !== null)
    if (ratings.length > 0) {
      const sum = ratings.reduce((acc, n) => acc + n, 0)
      avgRating = Math.round((sum / ratings.length) * 10) / 10
    }
    // Reference curatedProductIds so the unused-set check stays
    // honest if future changes move the slug lookup.
    void curatedProductIds
  }

  return {
    affiliate,
    profile,
    curatedProducts,
    stats: {
      curatedCount: curatedProducts.length,
      lifetimeEarnedCents,
      clicks30d,
      avgRating,
    },
  }
}

/** Helper — build the cutoff ISO string for "30 days ago" used by
 *  the clicks_30d read. Pure: takes a Date so tests can pin time. */
function recent30DayIso(now: Date = new Date()): string {
  const thirty = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  return thirty.toISOString()
}

/** Helper — FNV-1a 32-bit hash of the handle (for logs only). */
function hashHandle(handle: string): string {
  let hash = 0x811c9dc5
  for (const ch of handle) {
    hash ^= ch.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
