// Placeholder for the data types — real types come from
// `supabase gen types` once the Uthena Supabase project is reachable
// from `pnpm db:types`. For PH05 we declare just the columns we use
// from the catalog queries; the rest is filled in by PH21 (or
// whenever the type generator runs against a real project).
//
// =================================================================
// REGENERATION CONTRACT (P3.7 Slice 1)
// =================================================================
// The P3.7 acceptance criterion is "no hand-written DB types in the
// codebase." That contract has two halves:
//   1. CI regenerates types on every push to main (see
//      `.github/workflows/db-types.yml`).
//   2. Pull requests fail if the regenerated types differ from what's
//      committed (the `drift-check` job in the same workflow).
//
// This file is the **hand-written placeholder** that bridges the gap
// until the first CI run produces `types.generated.ts`. Once that
// happens, Slice 2 of P3.7 will:
//   - Replace the hand-written types below with
//     `export * from './types.generated'` (or equivalent re-export).
//   - Add a pre-commit hook that runs `pnpm db:types:check` and
//     refuses the commit if drift is detected.
//
// Until then, keep this file in sync with the schema on a best-effort
// basis (the existing `Tables<T>` exports cover the catalog surface).
// The CI drift check is the ground truth — if your migration changed
// a column and you forgot to update this file, the drift check (run
// locally via `pnpm db:types:check`) will tell you.
//
// Why keep the placeholder at all
// ------------------------------
// The placeholder lets `pnpm typecheck` pass in environments where
// `types.generated.ts` doesn't exist yet (most local dev machines,
// and this very repo before the first CI run). Without it, every PR
// before the first CI run would fail the typecheck.
//
// Why NOT just re-export from `types.generated.ts` today
// -----------------------------------------------------
// The generated file doesn't exist yet. A `export *` would make the
// typecheck fail with "cannot find module './types.generated'". The
// placeholder IS the bridge until the file lands.
// =================================================================

/**
 * One row in the `products.curriculum` JSONB column (migration 0014).
 * Matches the mockup's `.curric .row` columns (`.idx`, `.nm`, `.dur`)
 * one-for-one. Durations in seconds (canonical unit, same as
 * `products.total_duration_seconds`); the application layer (Slice 4
 * component) formats the display as "12m" / "1h 23m".
 *
 * Phase 15 LMS migration will normalize this to a proper `lessons`
 * table (with `lesson_progress` + `bookmarks` per the spec). The
 * field names match the planned lessons schema so the JSONB→lessons
 * backfill is a straight copy.
 */
type CurriculumEntry = {
  /** 1-based display order. Mockup shows "01", "02", ...; component
   *  zero-pads based on total count. */
  index: number
  /** Module / lesson name. The mockup has entries like
   *  "Module 1 — The class project & brand audit". */
  name: string
  /** Canonical duration in seconds. Application formats for display. */
  duration_seconds: number
}

type ProductRow = {
  id: number
  slug: string
  title: string
  short_description: string
  long_description: unknown
  kind: 'video_course' | 'ebook' | 'template_pack' | 'audio_course' | 'bundle' | 'asset_pack'
  status: 'draft' | 'in_review' | 'published' | 'unpublished' | 'archived'
  category_id: number
  partner_id: number
  thumbnail_url: string | null
  // Optional preview video URL. The product detail page (P0.12)
  // renders a "video" thumbnail slot when this is set. Bunny signed
  // stream URLs land in Phase 9 (P9.2).
  preview_video_url: string | null
  published_at: string | null
  total_lesson_count: number
  total_duration_seconds: number
  // Denormalized review aggregates (migration 0011). Maintained by
  // the reviews_aggregate_sync trigger; application code MUST NOT
  // write these directly.
  avg_rating: number | null
  review_count: number
  // Perks list (migration 0013). JSONB array of plain strings. The
  // product detail page (P0.14, P0.12 Slice 3) renders this as the
  // `.pinfo .perks` block at the bottom of the right column. Null
  // means "hasn't been set" → page uses the mockup-faithful 4-item
  // fallback. Empty array means "partner explicitly cleared the
  // list" → page renders nothing. Application caps each bullet at
  // 200 chars and the list at 8 items.
  bullets: string[] | null
  // Subscriber-only flag (migration 0032). When true, only active
  // Personal Access subscribers can purchase the product (server-side
  // gate in addToCartAction via the has_active_subscription RPC from
  // 0002_subscriptions.sql). Non-subscribers see an upgrade CTA on the
  // PDP instead of the Add-to-cart flow. Default false — opt-in flag
  // the partner or admin sets to gate the product to subscribers.
  subscriber_only: boolean
  // Curriculum (migration 0014). JSONB array of
  // {index, name, duration_seconds} objects. The product detail
  // page's Curriculum tab (P0.12 Slice 4) renders this as the
  // `.curric` block (mockup `mockups/product.html` lines 131–133,
  // CSS lines 307–311). Null means "hasn't been set" → Slice 4
  // component will use the mockup-faithful 12-item fallback.
  // Empty array means "partner explicitly cleared the list" →
  // Slice 4 renders nothing. Phase 15 LMS migration will normalize
  // this to a proper `lessons` table; the JSONB shape is a v1
  // placeholder.
  curriculum: CurriculumEntry[] | null
  created_at: string
  updated_at: string
}

type CategoryRow = {
  id: number
  slug: string
  name: string
  description: string | null
  display_order: number
  product_count_cache: number
}

type PartnerRow = {
  id: number
  user_id: string
  public_slug: string | null
  bio: string | null
  royalty_pct_bps: number | null
}

/**
 * Product gallery images (migration 0012). The product detail page
 * (P0.12) shows a 16:9 main image + up to 4 thumbnails; the first
 * non-video image by display_order is the gallery's "main" image.
 * Pairs with products.thumbnail_url (single cover for grids + cards)
 * and products.preview_video_url (optional video preview). The
 * product detail page renders a special video-thumb slot when one
 * row has kind='preview_video_thumb'.
 */
type ProductImageRow = {
  id: number
  product_id: number
  url: string
  alt: string
  kind: 'gallery' | 'preview_video_thumb'
  display_order: number
  created_at: string
}

/**
 * Profiles (1:1 with auth.users). Source of truth for the partner's
 * `display_name` + `avatar_url` (P0.12 Slice 4 Instructor tab) and
 * for the reviewer's `display_name` (P0.12 Slice 4 Reviews tab).
 */
type ProfileRow = {
  id: number
  user_id: string
  display_name: string
  avatar_url: string | null
}

/**
 * Reviews (PH01 0001_initial.sql). Read-only display on the product
 * detail page (P0.12 Slice 4). Phase 9 P9.14 wires the create /
 * edit / delete own flow.
 */
type ReviewRow = {
  id: number
  user_id: string
  product_id: number
  rating: number
  title: string | null
  body: string
  status: 'pending' | 'published' | 'hidden' | 'flagged'
  helpful_count: number
  created_at: string
  updated_at: string
}

/**
 * Collections (migration 0015). Team-curated groupings of products
 * distinct from categories (which are the partner-facing taxonomy).
 * The /collections index + /collections/[handle] detail (P0.17) read
 * this. Admin write only — collections are platform-owned.
 */
type CollectionRow = {
  id: number
  slug: string
  name: string
  description: string | null
  hero_image_url: string | null
  is_featured: boolean
  display_order: number
  status: 'draft' | 'published' | 'archived'
  published_at: string | null
  created_at: string
  updated_at: string
}

const TABLES = {
  products: {} as ProductRow,
  categories: {} as CategoryRow,
  partners: {} as PartnerRow,
  product_images: {} as ProductImageRow,
  profiles: {} as ProfileRow,
  reviews: {} as ReviewRow,
  collections: {} as CollectionRow,
} as const

export type Tables<T extends keyof typeof TABLES> = (typeof TABLES)[T]
