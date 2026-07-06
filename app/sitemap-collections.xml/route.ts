// GET /sitemap-collections.xml — /browse + curated collections + legacy
// category URLs.
//
// Sources:
//   - /browse: always emitted (the canonical all-courses route).
//   - /collections/[slug] for every PUBLISHED curated collection
//     (table: collections, filtered by status='published').
//   - /collections/[slug] for every ACTIVE category (i.e. a category
//     with at least one published product). The /collections/[handle]
//     page (P0.17) tries the collections table first, then falls back
//     to a category lookup — that's how legacy Shopify URLs like
//     `/collections/ai-courses` keep resolving. See
//     01-specs/pages/seo-url-migration.md for the redirect map.
//
// Why dedupe: the curated collections table and the categories table
// share the URL namespace (`/collections/[slug]`). If both rows share
// a slug, we emit one entry (the curated collection wins, since it
// renders the curated grid when present).

import { NextResponse } from 'next/server'
import { getServerSupabase } from '@foundations/data/supabase'
import { getEnv } from '@foundations/env'

export const revalidate = 3600 // 1 hour

const FALLBACK_SITE_URL = 'https://uthena.com'
const SITEMAP_URL_CAP = 5000

/** Defensive XML escape for any field that could carry a quote. */
function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case "'":
        return '&apos;'
      default:
        return c
    }
  })
}

/**
 * Emit one `<url>` element for `/collections/[slug]` (or `/browse`).
 * Sitemap protocol requires absolute URLs (sitemaps.org).
 */
function collectionUrlXml(siteUrl: string, slug: string, isBrowse: boolean): string {
  const path = isBrowse ? '/browse' : `/collections/${xmlEscape(slug)}`
  return `  <url>\n    <loc>${siteUrl}${path}</loc>\n  </url>`
}

export async function GET() {
  const env = getEnv()
  const siteUrl = (env.NEXT_PUBLIC_APP_URL || FALLBACK_SITE_URL).replace(/\/$/, '')

  const supabase = await getServerSupabase()

  // Two parallel reads. Both are RLS-aware: `collections_public_read`
  // restricts anon reads to status='published' (see 0015_collections.sql);
  // `categories_public_read` is fully public (taxonomy is open).
  //
  // For categories, we do a LIVE count of published products per
  // category to decide which categories to emit. We don't trust
  // `product_count_cache` alone — the cache is denormalized +
  // trigger-maintained, and the trigger placeholder hasn't shipped
  // in a migration yet (per `02-features/catalog/queries.ts`
  // `getActiveCategories`). Falling back to a live count keeps the
  // sitemap correct in local dev (where the cache is always 0) and
  // in production (where the cache may be stale between trigger
  // runs). Two reads, same as `getActiveCategories`.
  const [{ data: collections, error: colErr }, { data: cats, error: catErr }, { data: products, error: prodErr }] =
    await Promise.all([
      supabase
        .from('collections')
        .select('slug')
        .eq('status', 'published')
        // featured first, then display_order, then name — matches the
        // /collections index page so sitemap ordering is predictable.
        .order('is_featured', { ascending: false })
        .order('display_order', { ascending: true })
        .order('name', { ascending: true })
        .limit(SITEMAP_URL_CAP),
      supabase
        .from('categories')
        .select('id, slug, display_order')
        .order('display_order', { ascending: true })
        .limit(SITEMAP_URL_CAP),
      supabase
        .from('products')
        .select('category_id')
        .eq('status', 'published'),
    ])

  if (colErr) {
    // eslint-disable-next-line no-console
    console.error('[sitemap-collections] collections', colErr.message)
  }
  if (catErr) {
    // eslint-disable-next-line no-console
    console.error('[sitemap-collections] categories', catErr.message)
  }
  if (prodErr) {
    // eslint-disable-next-line no-console
    console.error('[sitemap-collections] products', prodErr.message)
  }

  // Build the live count map: category_id -> published product count.
  const liveCounts = new Map<number, number>()
  for (const p of products ?? []) {
    if (p.category_id == null) continue
    liveCounts.set(p.category_id, (liveCounts.get(p.category_id) ?? 0) + 1)
  }
  // Filter to categories with at least one published product.
  const categories = (cats ?? []).filter((c) => (liveCounts.get(c.id) ?? 0) > 0)

  // Build URL list, deduped by slug (collections + categories share
  // the namespace). Collections win — they render the curated grid.
  const seen = new Set<string>()
  const entries: Array<{ slug: string; isBrowse: boolean }> = [
    { slug: '', isBrowse: true },
  ]
  for (const c of collections ?? []) {
    if (!seen.has(c.slug)) {
      seen.add(c.slug)
      entries.push({ slug: c.slug, isBrowse: false })
    }
  }
  for (const c of categories ?? []) {
    if (!seen.has(c.slug)) {
      seen.add(c.slug)
      entries.push({ slug: c.slug, isBrowse: false })
    }
  }

  // Build the <urlset> body. Each <loc> is absolute (sitemaps.org
  // requires this — relative URLs are explicitly disallowed).
  const body = entries.map((e) => collectionUrlXml(siteUrl, e.slug, e.isBrowse)).join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`

  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}