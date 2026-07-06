// /robots.txt — public crawl rules + sitemap pointer.
//
// Spec: 01-specs/pages/robots.md (P0.20). Cross-cutting launch
// contract: 01-specs/pages/seo-url-migration.md.
//
// Implementation uses the Next.js `app/robots.ts` metadata convention.
// Next.js auto-generates `/robots.txt` from this file's default
// export, serializing the `MetadataRoute.Robots` shape into the
// standard text/plain robots format.
//
// One rule set for v1 (no per-bot carve-outs) — see robots.md
// "Open questions for human" for the deferred GPTBot/CCBot
// decision that lands with Phase 18's consent posture.

import type { MetadataRoute } from 'next'

const SITE_URL = 'https://uthena.com'

/**
 * Path prefixes that should NOT be crawled. Synchronized with the
 * robots.txt spec's acceptance criteria; if you add a new
 * authenticated / private surface, add its path prefix here too.
 *
 * Order is not significant to crawlers — kept alphabetical for
 * reviewer sanity.
 */
const DISALLOWED_PREFIXES = [
  '/admin',
  '/account',
  '/api',
  '/affiliate',
  '/auth',
  '/cart',
  '/checkout',
  '/library',
  '/login',
  '/partner',
  '/reset-password',
  '/signup',
  '/update-password',
  '/verify-email',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: DISALLOWED_PREFIXES,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}