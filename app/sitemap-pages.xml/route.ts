// GET /sitemap-pages.xml — static public page sitemap.
//
// Every URL in this file is a static (or ISR-cached) route registered
// in the project. We don't query the database — these routes either
// are static or read from the catalog queries (already covered by
// /sitemap-products.xml + /sitemap-collections.xml).
//
// `lastmod` is the build timestamp. These pages don't change between
// deploys unless the code that renders them changes; a build timestamp
// is a reasonable proxy for "content changed here" in the absence of
// per-page lastmod. Once we wire admin-editable legal pages (Phase 14),
// we'll switch to a per-page MDX frontmatter `lastmod` — for now the
// build timestamp is correct enough that search engines won't penalize
// us (they treat lastmod as a hint, not a contract).
//
// Why /bundles AND /browse are both here: /browse is the canonical
// all-courses grid (already in collections); /bundles is the bundles
// listing (P0.18). Both are public, both are indexable.
//
// Why no /search: search results are user-driven and excluded from
// the index per seo-url-migration.md.

import { NextResponse } from 'next/server'
import { getEnv } from '@foundations/env'

export const revalidate = 3600 // 1 hour

const FALLBACK_SITE_URL = 'https://uthena.com'

/**
 * Canonical public marketing + browse + legal surface. Order roughly
 * matches how a new visitor encounters the site (home → browse →
 * bundles → newsletter → contact → FAQ → legal pages), so the
 * `<lastmod>` crawl priority search engines infer from order is
 * sensible.
 *
 * Do NOT add authenticated, internal, or query-driven pages here.
 * The robots.txt spec at 01-specs/pages/robots.md lists the Disallow
 * paths — keep the two lists in sync.
 */
const PUBLIC_PATHS = [
  '/',
  '/browse',
  '/bundles',
  '/newsletter',
  '/contact',
  '/faq',
  '/terms',
  '/privacy',
  '/refund-policy',
  '/delivery',
  '/dmca',
  '/data-sharing-opt-out',
] as const

function buildPagesSitemap(siteUrl: string, now: string): string {
  const urls = PUBLIC_PATHS.map(
    (p) => `  <url>\n    <loc>${siteUrl}${p}</loc>\n    <lastmod>${now}</lastmod>\n  </url>`,
  ).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`
}

export function GET() {
  const env = getEnv()
  const siteUrl = (env.NEXT_PUBLIC_APP_URL || FALLBACK_SITE_URL).replace(/\/$/, '')
  const now = new Date().toISOString()
  const xml = buildPagesSitemap(siteUrl, now)

  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}