// GET /sitemap.xml — sitemap INDEX for uthena.com.
//
// Next.js routing note: this file lives at `app/sitemap/route.ts`.
// The `sitemap` segment is special — the metadata-route normalization
// (see node_modules/next/dist/lib/metadata/get-metadata-route.js) maps
// `app/sitemap/route.ts` to the URL `/sitemap.xml` automatically
// because the segment name ends with `/sitemap`. That's why we don't
// need `app/sitemap.xml/route.ts` for the index. The child sitemaps
// (sitemap-products.xml etc.) use literal dotted folder names so the
// URL ends with `.xml` verbatim.
//
// The INDEX references 3 children:
//   - /sitemap-products.xml    (every published product + bundle slug)
//   - /sitemap-collections.xml (/browse + every published collection +
//                                every active legacy category URL)
//   - /sitemap-pages.xml       (home + browse surface + bundles +
//                                newsletter + every legal page)
//
// We intentionally do NOT use the Next.js `app/sitemap.ts` metadata
// API for this — `MetadataRoute.Sitemap` only emits a flat `<urlset>`
// and the cross-cutting spec (01-specs/pages/seo-url-migration.md)
// requires a proper `<sitemapindex>`. See 01-specs/pages/sitemap.md
// for the full surface contract.

import { NextResponse } from 'next/server'
import { getEnv } from '@foundations/env'

export const revalidate = 3600 // 1 hour — matches the child sitemaps

const FALLBACK_SITE_URL = 'https://uthena.com'

/**
 * Build the sitemap INDEX XML body. Pure: no DB read, no auth, no
 * external fetch. The 3 children are static URLs — the child routes
 * are the ones that actually query the database.
 */
function buildSitemapIndex(siteUrl: string, now: string): string {
  const child = (path: string) =>
    `  <sitemap>\n    <loc>${siteUrl}${path}</loc>\n    <lastmod>${now}</lastmod>\n  </sitemap>`
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${child('/sitemap-products.xml')}
${child('/sitemap-collections.xml')}
${child('/sitemap-pages.xml')}
</sitemapindex>
`
}

export function GET() {
  const env = getEnv()
  // NEXT_PUBLIC_APP_URL is the runtime config; default to the
  // production canonical when unset (e.g. local dev still emits a
  // valid sitemap with absolute production URLs — useful for preview).
  const siteUrl = (env.NEXT_PUBLIC_APP_URL || FALLBACK_SITE_URL).replace(/\/$/, '')
  const now = new Date().toISOString()
  const xml = buildSitemapIndex(siteUrl, now)

  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}