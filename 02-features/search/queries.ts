// Catalog instant-search — server-side only. Used by the ⌘K overlay
// (P0.4) via the /api/search route handler and, eventually, the
// /search?q= results page (P0.19). The query is intentionally
// narrow: ilike on title + short_description, published status only,
// RLS-aware (anon reads see published rows; partners see their own;
// admins see everything — same matrix as the rest of catalog/).
//
// Why server-side and not a PostgREST `or=(title.ilike.*X*,...)` from
// the browser: (1) the public anon client can't bypass RLS even on
// the published rows it would otherwise see, so we'd be relying on
// `category.slug.ilike` joins that require FK visibility, (2) putting
// the limit + ordering + RLS matrix in one place keeps the overlay,
// the future /search page, and any future "did you mean" surface in
// sync, (3) we get cheap request-deduped caching when the same query
// hits twice in one request lifecycle.

import 'server-only'
import { cache } from 'react'
import { getServerSupabase } from '@foundations/data/supabase'
import type { ProductListItem } from '@features/catalog/queries'

/**
 * Normalize a raw PostgREST row into the public `ProductListItem`
 * shape. Mirrors the helper in `02-features/catalog/queries.ts`
 * (which is intentionally not exported — it's a private detail of
 * the catalog query layer). Accepts `any` for the same reason the
 * catalog version does: Supabase's generated types model embedded
 * one-to-one relations as arrays, so a strict signature would lie
 * about the runtime shape. Runtime checks below coerce the actual
 * PostgREST shape (`category: { slug, name } | null` returned for
 * one-to-one) into the documented `ProductListItem`.
 */
function normalizeListItem(row: any): ProductListItem {
  const pricing = ((row.pricing ?? []) as Array<{
    license: 'plr' | 'mrr' | 'rr' | 'personal'
    price_cents: number
    compare_at_cents: number | null
    is_default: boolean
    is_active: boolean
  }>).filter((p) => p.is_active)
  const defaultTier = pricing.find((p) => p.is_default) ?? pricing[0]
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    short_description: row.short_description,
    thumbnail_url: row.thumbnail_url,
    kind: row.kind,
    published_at: row.published_at,
    total_lesson_count: row.total_lesson_count,
    total_duration_seconds: row.total_duration_seconds,
    avg_rating: row.avg_rating,
    review_count: row.review_count ?? 0,
    category: row.category ?? null,
    partner: row.partner ?? null,
    starting_price_cents: defaultTier?.price_cents ?? null,
    msrp_cents: defaultTier?.compare_at_cents ?? null,
    currency: 'USD',
    default_license: defaultTier?.license ?? null,
  }
}

/**
 * Search published products by free-text query.
 *
 * Strategy: tokenize on whitespace (max 6 tokens), and for each
 * token match `title` OR `short_description` (PostgREST's `.or()`
 * flattens these into one OR clause). Multiple tokens broaden the
 * match — searching "ai marketing" returns products that mention
 * either term. This is the standard instant-search feel (think
 * Algolia / Linear's cmd-k); strict-AND full-text can come later
 * via a `tsvector` column when catalog size justifies it.
 *
 * @param q          Trimmed user query. Empty / whitespace-only
 *                    returns an empty list — the overlay handles
 *                    "empty" via a Popular / Type-to-search state
 *                    instead of an unbounded "show everything" hit.
 * @param limit      Max results. Default 8 (overlay use). The
 *                    /search results page will pass a higher value.
 */
export const searchPublishedProducts = cache(
  async (q: string, limit: number = 8): Promise<ProductListItem[]> => {
    const trimmed = q.trim()
    if (trimmed.length === 0) return []

    const supabase = await getServerSupabase()
    // Tokenize + sanitize: strip SQL LIKE wildcards AND PostgREST
    // filter metacharacters (comma splits the .or() list; dot/paren/
    // colon can inject extra filter clauses). Drop empty tokens, cap
    // at 6 so a paste-bomb doesn't blow up the query.
    const tokens = trimmed
      .split(/\s+/)
      .map((t) => t.replace(/[%_\\,().:]/g, ''))
      .filter((t) => t.length > 0)
      .slice(0, 6)
    if (tokens.length === 0) return []

    // Build the OR filter: for each token, OR title.ilike + short_description.ilike.
    // PostgREST's `.or()` expects a comma-separated list of `col.op.value`
    // expressions. Each token contributes two clauses.
    const orClauses = tokens.flatMap((t) => {
      const pat = `%${t}%`
      return [`title.ilike.${pat}`, `short_description.ilike.${pat}`]
    })
    const orFilter = orClauses.join(',')

    const { data, error } = await supabase
      .from('products')
      .select(
        `
        id, slug, title, short_description, thumbnail_url, kind, published_at,
        total_lesson_count, total_duration_seconds,
        avg_rating, review_count,
        category:categories ( slug, name ),
        partner:partners ( public_slug, user_id ),
        pricing:product_pricing ( license, price_cents, compare_at_cents, is_default, is_active )
      `,
      )
      .eq('status', 'published')
      .or(orFilter)
      .order('published_at', { ascending: false })
      .limit(limit)

    if (error) {
      // eslint-disable-next-line no-console
      console.error('[search] searchPublishedProducts', error.message)
      return []
    }
    return (data ?? []).map(normalizeListItem)
  },
)