// buildOrganizationSchema — site-wide Organization JSON-LD.
//
// Renders a single `Organization` entity that Google's Knowledge
// Graph and Bing's entity index use to anchor the brand. Rendered
// once per page via `app/layout.tsx`; the same script tag is
// served on every route.
//
// Why a builder (vs a constant).
//   - Future social handles (`sameAs`) and a support contact
//     (`contactPoint`) will land as env-driven constants; the
//     builder gives them a place to slot in without touching
//     every page that renders the schema.
//   - The `description` field is reused from the root layout's
//     metadata so the brand description stays in sync with what
//     `buildPageMetadata` emits for the OG description.
//
// Returns the plain JSON-LD object — `<JsonLd>` handles the
// `<script type="application/ld+json">` rendering + the
// `</script>` escape.

import { DEFAULT_OG_IMAGE, SITE_NAME, SITE_ORIGIN } from '@foundations/metadata'

/** Logo URL used by the Organization schema. Matches the default
 *  OG image so the brand identity stays consistent across
 *  crawlers + social-share previews. The dynamic OG generator
 *  renders the Uthena wordmark + chrome; crawlers treat it as
 *  a logo asset. */
const ORG_LOGO_URL = `${SITE_ORIGIN}${DEFAULT_OG_IMAGE}`

/** Default brand description. Mirrors the root layout's
 *  `metadata.description` so the Organization schema stays in
 *  sync with the site's primary OG description. Keep these in
 *  sync when updating either side. */
const ORG_DESCRIPTION =
  'Wholesale PLR video courses and digital assets. Resell, rebrand, keep the profits.'

export type OrganizationSchema = {
  '@context': 'https://schema.org'
  '@type': 'Organization'
  name: string
  url: string
  logo: string
  description: string
  sameAs: string[]
  contactPoint: never[]
}

/** Build the site-wide `Organization` JSON-LD object. Returns a
 *  plain object; pass it to `<JsonLd>` to render the script tag.
 *
 *  - `sameAs` is intentionally empty today (Uthena has no
 *    canonical social URLs defined — P19.16 social surface).
 *  - `contactPoint` is intentionally empty (no support inbox
 *    routing system yet). When those land, add fields here. */
export function buildOrganizationSchema(): OrganizationSchema {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_ORIGIN,
    logo: ORG_LOGO_URL,
    description: ORG_DESCRIPTION,
    // Populated when P19.16 wires the brand's social handles.
    sameAs: [],
    // Populated when the support inbox routing system lands.
    contactPoint: [],
  }
}