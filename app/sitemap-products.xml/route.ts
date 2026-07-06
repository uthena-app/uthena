// GET /sitemap-products.xml — products + bundles child sitemap.
//
// One <url> per published product. Bundles are products with
// `kind = 'bundle'` and use the same `/products/[slug]` route (see
// 02-features/catalog/queries.ts "Bundles — P0.18" + the migration
// 0016_bundles.sql header), so a single read covers both surfaces.
//
// Why a dedicated thin query (not the shared `getPublishedProducts`):
//   - The shared query joins pricing + partner + category — heavy
//     for a list that only needs slug + updated_at + published_at.
//   - Sitemaps run on a 1h cache; keeping them light means re-runs
//     during a launch are fast.
//   - Direct Supabase read keeps the catalog module focused on
//     display-shape queries.
//
// RLS handles visibility: anon sees only `status = 'published'` rows
// (the same `products_public_read_published` policy that powers
// /browse, /search, /collections).

import { NextResponse } from 'next/server'
import { getServerSupabase } from '@foundations/data/supabase'
import { getEnv } from '@foundations/env'

export const revalidate = 3600 // 1 hour

const FALLBACK_SITE_URL = 'https://uthena.com'

// Sitemap protocol allows 50,000 <url> per file. We cap well below
// that — uthena.com's launch catalog is ~465 products; 5,000 leaves
// 10× headroom for growth without any future rework.
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

function buildUrlXml(siteUrl: string, slug: string, lastmod: string | null): string {
  const loc = `${siteUrl}/products/${xmlEscape(slug)}`
  const lastmodTag = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''
  return `  <url>\n    <loc>${loc}</loc>${lastmodTag}\n  </url>`
}

export async function GET() {
  const env = getEnv()
  const siteUrl = (env.NEXT_PUBLIC_APP_URL || FALLBACK_SITE_URL).replace(/\/$/, '')

  const supabase = await getServerSupabase()
  const { data, error } = await supabase
    .from('products')
    .select('slug, updated_at, published_at')
    .eq('status', 'published')
    // Newest first — search engines don't care about the order, but a
    // stable order makes incremental diffs in crawlers' caches easier.
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(SITEMAP_URL_CAP)

  if (error) {
    // eslint-disable-next-line no-console
    console.error('[sitemap-products] supabase', error.message)
    // Non-fatal: emit an empty <urlset> so crawlers don't choke on a
    // 500. The 1h cache will retry on the next tick.
    const empty = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
</urlset>
`
    return new NextResponse(empty, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    })
  }

  const rows = data ?? []
  const urls = rows
    .map((r) => buildUrlXml(siteUrl, r.slug, r.updated_at ?? r.published_at))
    .join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
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