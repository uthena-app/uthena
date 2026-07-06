// getLibraryProduct.ts — composes everything the /library/[slug] page
// needs in one server-side read. Slice 1 of P7.2 (Product detail in
// library). The shape is intentionally flat: one RPC for access, one
// product fetch (via getProductBySlug), one files fetch (scoped to
// this product only), and one concurrent-stream count for the sharing-
// prevention UI. The page is RSC so the cost is paid once per render.
//
// P7.2 Slice 1 is intentionally thin — it lands the route + access
// gate + product header + file vault + sharing UI + lesson/certificate
// placeholders. The lesson + certificate placeholders are wired to the
// Phase 15 dependencies; when the lessons table + lesson_progress +
// certificates table ship, the placeholders swap to the real surfaces
// (see STUB-066).
//
// Why we don't reuse getUserAccessibleFiles here:
//   - That function returns ALL the user's accessible files in one
//     batch, deduped per product, with the file_downloads hydration
//     done in a single query. The library landing page needs the
//     cross-product view.
//   - This page needs ONE product's files, with the last-accessed
//     hydration scoped to those file ids. Different shape — the in-line
//     fetch is cheaper (one product_files query) and avoids loading
//     the full library's audit log.
//
// Why we don't reuse getProductBySlug directly:
//   - The page needs a thinner product shape than the public PDP.
//     Pricing + images + reviews are not rendered here (the library
//     product page is for the owner, not a buyer). We use a custom
//     select to keep the read narrow.
//   - The access check (user_accessible_products) gates whether the
//     page renders at all — when the product isn't in the user's
//     accessible set, this function returns null and the page renders
//     a 404 (defense in depth: never leak product existence to
//     non-owners).
//
// Fail-soft: any DB error returns null and the page falls through to
// notFound(). The library-watch/demo route + /products/[slug] still
// render for the public PDP path.

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import { countActiveStreams } from './countActiveStreams'
import type { VaultFile } from './getUserAccessibleFiles'

const log = loggerFor({ component: 'library.getLibraryProduct' })

/** Slug-only product identity used by the page header. Narrower than
 *  the public PDP's `ProductDetail` — the library page doesn't render
 *  pricing, gallery, reviews, or curriculum. */
export type LibraryProductSummary = {
  id: number
  slug: string
  title: string
  short_description: string
  thumbnail_url: string | null
  kind: 'video_course' | 'ebook' | 'template_pack' | 'audio_course' | 'bundle' | 'asset_pack'
  partner_id: number
  partner_slug: string | null
  partner_display_name: string | null
  total_lesson_count: number
  total_duration_seconds: number
}

/** How the user got access. Drives the source pill on the header. */
export type AccessSource = 'purchase' | 'admin_grant' | 'free_promo' | 'subscription'

export type LibraryProductAccess = {
  /** When the grant was first created (or the subscription started
   *  including this product via the catalog-wide subscription tier). */
  granted_at: string
  source: AccessSource
}

/** Files the user can access for this one product, with
 *  last-accessed hydrated from file_downloads. Mirrors `VaultFile`'s
 *  shape so the existing `<VaultItem>` renders without changes. */
export type LibraryProductFile = VaultFile

/** The composed page payload. `null` = product is not in the user's
 *  accessible set, or the user is anon, or any DB read failed. The
 *  page treats null as 404 (don't leak product existence to
 *  non-owners). */
export type LibraryProductPageData = {
  product: LibraryProductSummary
  access: LibraryProductAccess
  files: LibraryProductFile[]
  /** Current unexpired stream URLs for this user. Drives the sharing
   *  prevention UI ("3 / 3 streams active — close one before
   *  starting another"). */
  activeStreams: number
}

const FILE_SELECT =
  'id, product_id, kind, original_filename, size_bytes, duration_seconds, hls_manifest_url, created_at, product:products ( title, slug )'

/**
 * Read the page payload for `/library/[slug]`.
 *
 * Returns null when:
 *   - the user is anon (the page redirects to /login before this is
 *     called in practice — defense in depth),
 *   - the product isn't in the user's accessible set,
 *   - the product exists but is unpublished (we filter at the public
 *     PDP level too; the library surface should never show drafts),
 *   - any DB read fails.
 */
export async function getLibraryProduct(
  slug: string,
): Promise<LibraryProductPageData | null> {
  const user = await getSessionUser()
  if (!user) return null

  const supabase = await getServerSupabase()

  // ----- Step 1: access check via user_accessible_products RPC ------
  // Returns every product the user can access (purchase grant +
  // subscription tier + admin grant + free promo) with the source
  // discriminator. We filter to the requested slug in JS to keep the
  // access decision in one place (the RPC is the canonical surface
  // for "what can this user access?").
  const { data: accessible, error: accessErr } = await supabase.rpc(
    'user_accessible_products',
    { p_user_id: user.id },
  )
  if (accessErr) {
    log.warn(
      { code: 'get_accessible_failed', msg: accessErr.message },
      'getLibraryProduct access check failed',
    )
    return null
  }
  const owned = ((accessible ?? []) as Array<{
    product_id: number
    slug: string
    access_source: AccessSource
    granted_at: string
  }>).find((row) => row.slug === slug)
  if (!owned) return null

  // ----- Step 2: product detail (thin shape) -------------------------
  const { data: productRow, error: productErr } = await supabase
    .from('products')
    .select(
      `
      id, slug, title, short_description, kind, status,
      thumbnail_url, total_lesson_count, total_duration_seconds, partner_id,
      partner:partners ( public_slug, profile:profiles!partners_user_id_fkey ( display_name ) )
    `,
    )
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle()
  if (productErr) {
    log.warn(
      { code: 'get_product_failed', msg: productErr.message },
      'getLibraryProduct product fetch failed',
    )
    return null
  }
  if (!productRow) return null

  // ----- Step 3: files scoped to this product + last-accessed --------
  const files = await fetchFilesForProduct(supabase, productRow.id, user.id)

  // ----- Step 4: concurrent-stream count -----------------------------
  const activeStreams = await countActiveStreams()

  return {
    product: mapProductRow(productRow),
    access: {
      granted_at: owned.granted_at,
      source: owned.access_source,
    },
    files,
    activeStreams,
  }
}

// ----- Helpers -----------------------------------------------------------

/** Fetch the product's files (clean + ready) + the user's per-file
 *  last_accessed_at. Mirrors `getUserAccessibleFiles`'s hydration
 *  pattern but scoped to one product (so the file_downloads query is
 *  tiny — at most a few dozen rows). */
async function fetchFilesForProduct(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  productId: number,
  userId: string,
): Promise<LibraryProductFile[]> {
  const { data: rows, error } = await supabase
    .from('product_files')
    .select(FILE_SELECT)
    .eq('product_id', productId)
    .eq('scan_status', 'clean')
    .eq('encoding_status', 'ready')
    .order('created_at', { ascending: false })
  if (error) {
    log.warn(
      { code: 'get_files_failed', msg: error.message },
      'getLibraryProduct files fetch failed — vault falls back to empty',
    )
    return []
  }

  const files = (rows ?? []).map((f) => {
    const raw = (f as { product: unknown }).product
    let product: { title: string; slug: string } | null = null
    if (Array.isArray(raw) && raw[0]) {
      product = raw[0] as { title: string; slug: string }
    } else if (raw && typeof raw === 'object') {
      product = raw as { title: string; slug: string }
    }
    return {
      id: f.id,
      product_id: f.product_id,
      product_title: product?.title ?? 'Unknown',
      product_slug: product?.slug ?? '',
      kind: f.kind,
      original_filename: f.original_filename,
      size_bytes: f.size_bytes,
      duration_seconds: f.duration_seconds,
      hls_manifest_url: f.hls_manifest_url,
      created_at: (f as { created_at?: string | null }).created_at ?? null,
      last_accessed_at: null as string | null,
    }
  })

  if (files.length === 0) return files

  // Hydrate last_accessed_at — fail-soft on read errors (matches the
  // /library page's behavior; "Never accessed" is the safe default).
  const fileIds = files.map((r) => r.id)
  const { data: downloads, error: dlErr } = await supabase
    .from('file_downloads')
    .select('file_id, created_at')
    .eq('user_id', userId)
    .in('file_id', fileIds)
    .order('created_at', { ascending: false })
  if (dlErr) {
    log.warn(
      { code: 'get_downloads_failed', msg: dlErr.message },
      'getLibraryProduct file_downloads hydration failed — vault falls back to "Never accessed"',
    )
    return files
  }
  const seen = new Map<number, string>()
  for (const row of (downloads ?? []) as Array<{
    file_id: number | null
    created_at: string
  }>) {
    if (row.file_id == null) continue
    if (!seen.has(row.file_id)) seen.set(row.file_id, row.created_at)
  }
  for (const file of files) {
    const ts = seen.get(file.id)
    if (ts) file.last_accessed_at = ts
  }
  return files
}

/** Map the raw DB row to the slim product shape the page header uses.
 *  Defensive on the partner join (PostgREST can return an array or a
 *  single object depending on the relationship cardinality). */
function mapProductRow(
  row: Record<string, unknown>,
): LibraryProductSummary {
  const partner = (row.partner as
    | {
        public_slug: string | null
        profile:
          | { display_name: string | null }
          | { display_name: string | null }[]
          | null
      }
    | Array<{
        public_slug: string | null
        profile:
          | { display_name: string | null }
          | { display_name: string | null }[]
          | null
      }>
    | null) ?? null
  let partnerRow: {
    public_slug: string | null
    profile: { display_name: string | null } | null
  } | null = null
  const partnerCandidate = Array.isArray(partner) ? partner[0] : partner
  if (partnerCandidate && typeof partnerCandidate === 'object') {
    const profileRaw = partnerCandidate.profile
    const profileCandidate = Array.isArray(profileRaw)
      ? profileRaw[0]
      : profileRaw
    partnerRow = {
      public_slug: partnerCandidate.public_slug ?? null,
      profile:
        profileCandidate && typeof profileCandidate === 'object'
          ? { display_name: (profileCandidate as { display_name: string | null }).display_name ?? null }
          : null,
    }
  }

  return {
    id: row.id as number,
    slug: row.slug as string,
    title: row.title as string,
    short_description: (row.short_description as string) ?? '',
    thumbnail_url: (row.thumbnail_url as string | null) ?? null,
    kind: row.kind as LibraryProductSummary['kind'],
    partner_id: row.partner_id as number,
    partner_slug: partnerRow?.public_slug ?? null,
    partner_display_name: partnerRow?.profile?.display_name ?? null,
    total_lesson_count: (row.total_lesson_count as number) ?? 0,
    total_duration_seconds: (row.total_duration_seconds as number) ?? 0,
  }
}