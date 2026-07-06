// buildPersonSchema — P13.8 public minishop /[handle] JSON-LD.
//
// Renders a schema.org `Person` entity for the affiliate whose
// mini-shop the visitor is on. The schema gives Google's Knowledge
// Graph + Bing's entity index a way to anchor the affiliate as a
// real person (their name + bio + social links + the canonical URL
// of their shop), which improves the affiliate's discoverability
// when the page is shared on social.
//
// Why a Person + not an Organization.
//   - Per the spec at 01-specs/pages/affiliate-minishop.md:67
//     ("Schema.org `Person` markup for the curator").
//   - The affiliate is an individual promoter, not a brand
//     entity. `Organization` would be inaccurate.
//
// Why a builder (vs. a per-page constant).
//   - Each /[handle] page renders one Person entity with the
//     affiliate's name + bio + avatar + social links + shop URL.
//     Per-page object literals would drift (the schema fields
//     evolve); a single builder keeps the wire shape locked.
//   - `sameAs` (social profiles) reuses the canonical
//     `profiles.social_links` shape so the affiliate-portal
//     settings page (P13.x follow-up) writes the data once and
//     it appears here automatically.
//
// Returns the plain JSON-LD object — `<JsonLd>` handles the
// `<script type="application/ld+json">` rendering + the
// `</script>` escape.

import { SITE_ORIGIN } from '@foundations/metadata'

export type PersonSchemaInput = {
  /** The affiliate's chosen handle (lowercase slug). Drives the
   *  canonical URL for their mini-shop. */
  handle: string
  /** The affiliate's display name (or `profiles.display_name`).
   *  Falls back to the handle when not set. */
  name: string
  /** The longer bio (max 280 chars; matches the affiliate's
   *  `bio` column). Optional — the bio card on /affiliate/shop
   *  may be empty for newly onboarded affiliates. */
  bio?: string | null | undefined
  /** Absolute URL to the affiliate's avatar image. Optional —
   *  omitted when the affiliate hasn't uploaded one. The OG
   *  image generator falls back to the brand-default avatar
   *  in that case. */
  avatarUrl?: string | null | undefined
  /** The affiliate's verified social profiles (e.g. Twitter,
   *  LinkedIn). Reused from the canonical
   *  `profiles.social_links` shape (P12.17 + P13.x follow-up). */
  socialLinks?: ReadonlyArray<string> | null | undefined
}

export type PersonSchema = {
  '@context': 'https://schema.org'
  '@type': 'Person'
  name: string
  url: string
  description?: string
  image?: string
  sameAs: string[]
}

/** Strip the schema-incompatible fields from the social-links
 *  list. Schema.org `sameAs` accepts URL strings only. Anything
 *  that doesn't look like a URL is dropped (defense-in-depth
 *  against future writers of `profiles.social_links` storing
 *  arbitrary text). */
function sanitizeSameAs(
  links: ReadonlyArray<string> | null | undefined,
): string[] {
  if (!links || links.length === 0) return []
  const out: string[] = []
  for (const raw of links) {
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (!trimmed) continue
    try {
      const u = new URL(trimmed)
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        out.push(u.toString())
      }
    } catch {
      // Invalid URL — drop silently. The page handles a missing
      // social-link with a fallback chip ("Add social link" CTA
      // only when editing), so a dropped item here never breaks
      // the page.
    }
  }
  return out
}

/** Build the affiliate's `Person` JSON-LD. Returns a plain object;
 *  pass it to `<JsonLd>` to render the script tag.
 *
 *  - `url` is the canonical URL of the mini-shop (so search engines
 *    link the Person entity to the shop, not to /affiliate dashboard).
 *  - `description` is omitted when the bio is empty (schema.org
 *    doesn't accept empty strings; the field is just absent).
 *  - `image` is omitted when no avatar is set (the OG image generator
 *    at /og handles the preview-image fallback on social shares).
 *  - `sameAs` is normalized to absolute https URLs only — invalid
 *    entries are dropped silently (validated per schema.org spec). */
export function buildPersonSchema(input: PersonSchemaInput): PersonSchema {
  const canonicalHandle = encodeURIComponent(input.handle)
  const schema: PersonSchema = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: input.name || input.handle,
    url: `${SITE_ORIGIN}/${canonicalHandle}`,
    sameAs: sanitizeSameAs(input.socialLinks),
  }
  const trimmedBio = input.bio?.trim()
  if (trimmedBio) {
    schema.description = trimmedBio
  }
  const trimmedAvatar = input.avatarUrl?.trim()
  if (trimmedAvatar) {
    schema.image = trimmedAvatar
  }
  return schema
}
