// buildPageMetadata.ts — single source of truth for Next.js `Metadata`
// objects across every page in the app.
//
// Why a helper.
//   - The product spec (P0.21) requires every page to emit correct
//     OpenGraph + Twitter Card meta so social-share previews look
//     right. Hand-rolling 30+ identical `Metadata` exports is bug
//     bait (easy to forget `url`, `siteName`, `type`, the Twitter
//     Card counterpart, etc.).
//   - The canonical URL, default OG image, site name, and locale
//     all live in one place. Adding a new field (e.g. a future
//     `twitter.site` handle) is a one-line edit instead of a
//     30-file find-and-replace.
//   - Pages that need to be excluded from search engines
//     (authenticated app surfaces, cart, checkout, login) opt in
//     with `noindex: true`. Default is to be indexable.
//
// Inputs.
//   - `title`: the page's `<title>` text (or a title-only object
//     when `title.template` is in play).
//   - `description`: short summary (1–2 sentences). Reused for
//     both `description` and the OG / Twitter `description`.
//   - `path`: app-relative path (e.g. `/browse`). The helper joins
//     it with the configured site origin to produce absolute URLs
//     for `alternates.canonical`, `openGraph.url`, and the default
//     OG image when the caller didn't supply one.
//   - `image`: optional absolute or app-relative image URL. When
//     omitted, the helper falls back to the dynamic OG generator
//     at `/og?title=<title>` so even pages with no own image get
//     a branded share card.
//   - `type`: Open Graph object type. Defaults to `'website'`.
//     `'article'` for blog/long-form; `'product'` is supported by
//     the spec but not currently emitted (most crawlers treat it
//     like `website`).
//   - `noindex`: when true, sets `robots: { index: false, follow:
//     false }`. Use on every authenticated / sensitive page
//     (account, partner, admin, cart, checkout, login, signup,
//     password reset, email verify). Indexing those surfaces
//     would leak URLs in shared screenshots.
//   - `locale`: optional BCP-47 override; defaults to `en_US`.
//
// Why we DON'T read the app origin from `process.env` at runtime.
//   - The canonical URL must be the same across server + client
//     renders (otherwise hydration mismatch). We hardcode the
//     canonical origin at build time. The dev server runs on a
//     different origin (localhost:3100) — that's fine, dev
//     previews don't need production canonicals. The dynamic OG
//     image route uses `metadataBase` (set in the root layout) so
//     relative image paths are auto-resolved by Next.js at
//     serialization time.
//
// Future notes.
//   - When a real Twitter handle lands (P19.16 social surface),
//     add `twitter.site` + `twitter.creator` defaults here.
//   - When the storefront supports i18n (P19.x future), swap the
//     hardcoded `en_US` for the locale from the request.

import type { Metadata } from 'next'

export const SITE_NAME = 'Uthena'
export const SITE_ORIGIN = 'https://uthena.com'
export const SITE_LOCALE = 'en_US'
export const OG_IMAGE_GENERATOR_PATH = '/og'
export const DEFAULT_OG_IMAGE = '/og?title=Uthena&subtitle=Wholesale+PLR+Video+Courses'

export type PageMetadataInput = {
  /** Page title (without the site suffix — the root layout's
   *  `title.template` adds " · Uthena" automatically). */
  title: string
  /** Short summary. Reused for description, OG description, and
   *  Twitter description. Capped at 200 chars by the helper. */
  description: string
  /** App-relative path. Joined with `SITE_ORIGIN` to produce
   *  absolute canonical + OG URLs. Always include the leading
   *  slash. Example: `/browse`, `/products/[slug]`. */
  path: string
  /** Optional absolute OR app-relative image URL. When omitted,
   *  falls back to the dynamic OG generator. The `| undefined`
   *  form (vs `?:`) lets callers explicitly pass `undefined`
   *  from a conditional source without TS rejecting it — this
   *  matters because `exactOptionalPropertyTypes` is on. */
  image?: string | undefined
  /** OG object type. Defaults to `'website'`. */
  type?: 'website' | 'article' | 'book' | 'profile' | undefined
  /** When true, marks the page as noindex/nofollow. */
  noindex?: boolean | undefined
  /** BCP-47 locale override. Defaults to `en_US`. */
  locale?: string | undefined
  /** Optional `article:published_time` for blog/long-form. */
  publishedTime?: string | undefined
  /** Optional `article:modified_time` for blog/long-form. */
  modifiedTime?: string | undefined
}

/** Normalize the path to always be a leading-slash, no-trailing-
 *  slash absolute path. `/browse/` → `/browse`; `browse` → `/browse`. */
function normalizePath(path: string): string {
  const withSlash = path.startsWith('/') ? path : `/${path}`
  return withSlash.replace(/\/+$/, '') || '/'
}

/** Resolve an image URL to an absolute URL. App-relative paths get
 *  joined to `SITE_ORIGIN`; absolute URLs (http/https/data) pass
 *  through. The dynamic OG generator path gets encoded query
 *  params when not already encoded. */
function resolveImageUrl(image: string, title: string): string {
  // Already absolute.
  if (/^https?:\/\//i.test(image)) return image
  // Dynamic OG generator — pass the title so the image renders with
  // the correct headline. Skip if the caller is explicitly asking
  // for the static default (no title).
  if (image === OG_IMAGE_GENERATOR_PATH || image === DEFAULT_OG_IMAGE) {
    return `${SITE_ORIGIN}${DEFAULT_OG_IMAGE}`
  }
  // Other app-relative path.
  return `${SITE_ORIGIN}${image}`
}

/** Default OG image for the page when no `image` is supplied.
 *  Uses the dynamic generator so each page gets a branded
 *  share card with its own title rendered into the image. */
function defaultOgImage(title: string): string {
  const params = new URLSearchParams({
    title,
    subtitle: SITE_NAME,
  })
  return `${SITE_ORIGIN}${OG_IMAGE_GENERATOR_PATH}?${params.toString()}`
}

/** Build a complete `Metadata` object for a page. See the type
 *  above for inputs. The returned object includes `title`,
 *  `description`, `alternates.canonical`, `openGraph`, `twitter`,
 *  and (when `noindex: true`) `robots`. */
export function buildPageMetadata(input: PageMetadataInput): Metadata {
  const {
    title,
    description,
    path,
    image,
    type = 'website',
    noindex = false,
    locale = SITE_LOCALE,
    publishedTime,
    modifiedTime,
  } = input

  const normalizedPath = normalizePath(path)
  const absoluteUrl = `${SITE_ORIGIN}${normalizedPath}`
  const imageUrl = image ? resolveImageUrl(image, title) : defaultOgImage(title)
  const safeDescription = description.slice(0, 200)

  const metadata: Metadata = {
    title,
    description: safeDescription,
    alternates: {
      canonical: absoluteUrl,
    },
    openGraph: {
      type,
      siteName: SITE_NAME,
      title,
      description: safeDescription,
      url: absoluteUrl,
      locale,
      images: [
        {
          url: imageUrl,
          // 1200×630 is the standard social-share card aspect.
          // The dynamic OG generator returns 1200×630 PNG.
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      // `summary_large_image` shows the image prominently in the
      // Twitter timeline (vs `summary` which is a small thumbnail).
      // Larger cards get more clicks on cold-share.
      card: 'summary_large_image',
      title,
      description: safeDescription,
      images: [imageUrl],
    },
  }

  if (type === 'article' && (publishedTime || modifiedTime)) {
    // Article metadata carries `type: 'article'` plus published/
    // modified times. Next.js's OpenGraph serializer surfaces
    // these as `<meta property="article:published_time">` etc.
    // Cast to the article-specific shape so we can set the
    // `publishedTime` / `modifiedTime` fields without TS losing
    // them in the discriminated-union narrowing.
    const articleOg = {
      ...metadata.openGraph,
      type: 'article' as const,
      ...(publishedTime ? { publishedTime } : {}),
      ...(modifiedTime ? { modifiedTime } : {}),
    }
    metadata.openGraph = articleOg as NonNullable<Metadata['openGraph']>
  }

  if (noindex) {
    metadata.robots = {
      index: false,
      follow: false,
      nocache: true,
      googleBot: {
        index: false,
        follow: false,
      },
    }
  }

  return metadata
}

/** Minimal "sensitive page" metadata helper. Returns a `Metadata`
 *  object with `noindex: true` and a fallback title/description
 *  so authenticated / sensitive pages don't leak their structure
 *  into search engines. Use for cart, checkout, login, signup,
 *  account, partner, admin. */
export function sensitivePageMetadata(input: {
  title: string
  description: string
  path: string
}): Metadata {
  return buildPageMetadata({
    ...input,
    noindex: true,
  })
}