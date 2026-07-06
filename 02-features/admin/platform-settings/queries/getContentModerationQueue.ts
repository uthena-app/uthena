// getContentModerationQueue.ts — admin's view of flagged content
// for moderation. Aggregates from:
//   1. reviews where flagged_reason IS NOT NULL (set by partners in P12.6)
//   2. products where deleted_at is null and status='flagged' (admin-side flag)
//   3. profile reports (deferred — no schema yet, falls back to empty)
//
// RLS: service-role read; requireRole gate at the page.
// All queries use minimal select lists; never raw email / ip.

import 'server-only'
import { getServiceSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { requireRole } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'admin.getContentModerationQueue' })

export type FlaggedReview = {
  kind: 'review'
  id: number
  flaggedAt: string | null
  flaggedReason: string
  flaggedByUserId: string | null
  rating: number
  body: string | null
  productId: number
  productTitle: string
  productSlug: string
  authorDisplayName: string | null
  authorId: string | null
  status: string
  createdAt: string
  helpfulCount: number
}

export type FlaggedProduct = {
  kind: 'product'
  id: number
  title: string
  slug: string
  status: string
  partnerName: string | null
  partnerId: number | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export type ModerationItem = FlaggedReview | FlaggedProduct

export type ContentModerationResult = {
  items: ModerationItem[]
  counts: {
    flaggedReviews: number
    flaggedProducts: number
    total: number
  }
}

export async function getContentModerationQueue(limit: number = 50): Promise<ContentModerationResult> {
  const user = await getSessionUser()
  if (!user) return empty()
  try {
    await requireRole(['admin', 'super_admin'])
  } catch {
    return empty()
  }

  const service = getServiceSupabase()
  const cappedLimit = Math.max(1, Math.min(200, Math.floor(limit)))

  const [reviewsRes, reviewsCountRes, productsRes, productsCountRes] = await Promise.all([
    service
      .from('reviews')
      .select('id, rating, body, status, helpful_count, product_id, user_id, flagged_reason, flagged_by_user_id, created_at')
      .not('flagged_reason', 'is', null)
      .order('created_at', { ascending: false })
      .limit(cappedLimit),
    service
      .from('reviews')
      .select('*', { count: 'exact', head: true })
      .not('flagged_reason', 'is', null),
    service
      .from('products')
      .select('id, title, slug, status, partner_id, deleted_at, created_at, updated_at')
      .eq('status', 'flagged')
      .order('updated_at', { ascending: false })
      .limit(cappedLimit),
    service
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'flagged'),
  ])

  // Hydrate product titles + slugs for the flagged reviews
  const reviewProductIds = [
    ...new Set(((reviewsRes.data ?? []) as Array<{ product_id: number }>).map((r) => r.product_id)),
  ]
  const productMap = new Map<number, { title: string; slug: string }>()
  if (reviewProductIds.length > 0) {
    const { data: products } = await service
      .from('products')
      .select('id, title, slug')
      .in('id', reviewProductIds)
    for (const p of products ?? []) {
      productMap.set((p as { id: number }).id, {
        title: (p as { title: string }).title,
        slug: (p as { slug: string }).slug,
      })
    }
  }

  // Hydrate author display names for the flagged reviews
  const reviewUserIds = [
    ...new Set(((reviewsRes.data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)),
  ]
  const profileMap = new Map<string, string | null>()
  if (reviewUserIds.length > 0) {
    const { data: profiles } = await service
      .from('profiles')
      .select('user_id, display_name')
      .in('user_id', reviewUserIds)
    for (const p of profiles ?? []) {
      profileMap.set((p as { user_id: string }).user_id, (p as { display_name: string | null }).display_name)
    }
  }

  // Hydrate partner slugs for the flagged products
  const productPartnerIds = [
    ...new Set(
      ((productsRes.data ?? []) as Array<{ partner_id: number | null }>).map(
        (r) => r.partner_id,
      ),
    ),
  ]
  const partnerMap = new Map<number, string | null>()
  if (productPartnerIds.length > 0) {
    const { data: partners } = await service
      .from('partners')
      .select('id, public_slug')
      .in('id', productPartnerIds.filter((id): id is number => id != null))
    for (const p of partners ?? []) {
      partnerMap.set((p as { id: number }).id, (p as { public_slug: string | null }).public_slug)
    }
  }

  const flaggedReviews: FlaggedReview[] = ((reviewsRes.data ?? []) as Array<{
    id: number
    rating: number | null
    body: string | null
    status: string | null
    helpful_count: number | null
    product_id: number
    user_id: string
    flagged_reason: string | null
    flagged_by_user_id: string | null
    created_at: string
  }>)
    .filter((r) => r.flagged_reason != null)
    .map<FlaggedReview | null>((r) => {
      const product = productMap.get(r.product_id)
      if (!product) return null
      return {
        kind: 'review',
        id: r.id,
        flaggedAt: r.created_at,
        flaggedReason: r.flagged_reason ?? '',
        flaggedByUserId: r.flagged_by_user_id,
        rating: r.rating ?? 0,
        body: r.body,
        productId: r.product_id,
        productTitle: product.title,
        productSlug: product.slug,
        authorDisplayName: profileMap.get(r.user_id) ?? null,
        authorId: r.user_id,
        status: r.status ?? 'pending',
        createdAt: r.created_at,
        helpfulCount: r.helpful_count ?? 0,
      }
    })
    .filter((r): r is FlaggedReview => r !== null)

  const flaggedProducts: FlaggedProduct[] = ((productsRes.data ?? []) as Array<{
    id: number
    title: string
    slug: string
    status: string | null
    partner_id: number | null
    deleted_at: string | null
    created_at: string
    updated_at: string
  }>).map((p) => ({
    kind: 'product' as const,
    id: p.id,
    title: p.title,
    slug: p.slug,
    status: p.status ?? 'unknown',
    partnerName: p.partner_id != null ? partnerMap.get(p.partner_id) ?? null : null,
    partnerId: p.partner_id,
    deletedAt: p.deleted_at,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  }))

  // Merge by date (most recent first); clamp to limit.
  const items: ModerationItem[] = [...flaggedProducts, ...flaggedReviews]
    .sort((a, b) => {
      const aD = a.kind === 'product' ? a.updatedAt : a.createdAt
      const bD = b.kind === 'product' ? b.updatedAt : b.createdAt
      return bD.localeCompare(aD)
    })
    .slice(0, cappedLimit)

  return {
    items,
    counts: {
      flaggedReviews: reviewsCountRes.count ?? flaggedReviews.length,
      flaggedProducts: productsCountRes.count ?? flaggedProducts.length,
      total: items.length,
    },
  }
}

function empty(): ContentModerationResult {
  return {
    items: [],
    counts: { flaggedReviews: 0, flaggedProducts: 0, total: 0 },
  }
}
