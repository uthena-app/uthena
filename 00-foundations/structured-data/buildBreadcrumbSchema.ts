// buildBreadcrumbSchema — per-page BreadcrumbList JSON-LD.
//
// Renders a `BreadcrumbList` entity that crawlers use to show a
// breadcrumb trail under the SERP result. Google's docs require:
//   - `itemListElement` is an array of `ListItem` objects
//   - Each `ListItem` has `position` (1-indexed), `name`, `item`
//   - `item` is an absolute URL (NOT an app-relative path)
//
// The last item IS the current page; including its `item` is
// recommended so crawlers can map URL → title directly. The
// page's own canonical URL is what we pass there.
//
// Example:
//   buildBreadcrumbSchema([
//     { name: 'Home', path: '/' },
//     { name: 'Browse', path: '/browse' },
//     { name: 'AI courses', path: '/collections/ai-courses' },
//   ])
//   →
//   {
//     '@context': 'https://schema.org',
//     '@type': 'BreadcrumbList',
//     itemListElement: [
//       { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://uthena.com/' },
//       { '@type': 'ListItem', position: 2, name: 'Browse', item: 'https://uthena.com/browse' },
//       { '@type': 'ListItem', position: 3, name: 'AI courses', item: 'https://uthena.com/collections/ai-courses' },
//     ],
//   }

import { SITE_ORIGIN } from '@foundations/metadata'

/** One breadcrumb crumb. `name` is the link text (or the
 *  current page title for the last item); `path` is the
 *  app-relative path (with leading slash). */
export type BreadcrumbItem = {
  /** Display text. Used as the `<a>` text in the breadcrumb UI
   *  and the `name` field in the JSON-LD. ≤ 80 chars is the
   *  Google recommendation; the builder doesn't enforce this
   *  (callers should keep page titles sensible). */
  name: string
  /** App-relative path (leading slash, no trailing slash).
   *  Example: `/products/ai-personal-branding`. Joined with
   *  `SITE_ORIGIN` to produce the absolute URL. */
  path: string
}

/** Normalize the path to always be a leading-slash, no-trailing-
 *  slash absolute path. `/browse/` → `/browse`; `browse` → `/browse`. */
function normalizePath(path: string): string {
  const withSlash = path.startsWith('/') ? path : `/${path}`
  return withSlash.replace(/\/+$/, '') || '/'
}

export type BreadcrumbListSchema = {
  '@context': 'https://schema.org'
  '@type': 'BreadcrumbList'
  itemListElement: Array<{
    '@type': 'ListItem'
    position: number
    name: string
    item: string
  }>
}

/** Build a `BreadcrumbList` JSON-LD object from an ordered array
 *  of `{ name, path }` items. The first item is the top of the
 *  trail (typically Home); the last is the current page.
 *
 *  Throws when called with an empty array — every page that
 *  emits breadcrumbs has at least one crumb (the current page),
 *  so an empty array is a programmer error worth catching at
 *  build time. */
export function buildBreadcrumbSchema(items: BreadcrumbItem[]): BreadcrumbListSchema {
  if (items.length === 0) {
    throw new Error(
      '[buildBreadcrumbSchema] items array is empty. Every BreadcrumbList must have at least one crumb (the current page).',
    )
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, idx) => ({
      '@type': 'ListItem',
      // 1-indexed (Google's docs require this).
      position: idx + 1,
      name: item.name,
      item: `${SITE_ORIGIN}${normalizePath(item.path)}`,
    })),
  }
}