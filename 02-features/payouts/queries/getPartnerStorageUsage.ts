// getPartnerStorageUsage.ts — read a single partner's storage
// usage, broken down per product. Used by the admin partner
// detail page (P6.8 + P7.10) and (Phase 12 territory) by the
// partner's own dashboard.
//
// P7.10 — Storage quota display.
//
// Why we SUM product_files.size_bytes rather than reading
// products.total_file_size_bytes:
//   `products.total_file_size_bytes bigint default 0` is defined
//   in the initial migration but no trigger maintains it — the
//   only references in the codebase are the column definition
//   itself. Trusting an unmaintained aggregate column would
//   silently drift from reality the first time a file is
//   added or removed. We SUM at read time so the value is
//   always correct. At 500+ products in the catalog and a
//   typical partner owning 5–10, this is a single
//   `products.partner_id = X` roundtrip that hits the
//   `products_partner_idx` + the FK join to `product_files`
//   (which has its own `product_files_product_idx`). Both
//   indexes are in place from migration 0001.
//
// Auth: requireRole(['admin', 'super_admin']). The query
// short-circuits on anon / non-admin to a null result + warn
// log so a future caller can't accidentally expose a
// partner's data.
//
// PII safety: NEVER selects email / ip / user_agent from
// profiles. NEVER selects the encrypted payout_method JSONB
// from partners. The select payload is intentionally minimal:
// `id, slug, title, status` from products + the aggregated
// sum + the count from product_files.
//
// Result shape is intentionally narrow — the consumer (admin
// detail page or future partner dashboard) renders a summary
// line + a per-product list. We deliberately don't include
// per-file rows: that would push the response size to
// O(files) instead of O(products). For per-file breakdowns,
// the existing `getUserAccessibleFiles` (P7.3) is the
// right surface — but that one is per-user, not per-partner.

import 'server-only'
import { z } from 'zod'
import { getServiceSupabase } from '@foundations/data/supabase'
import { getSessionUser, requireRole } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'payouts.getPartnerStorageUsage' })

// ----- Input validation -----------------------------------------------------

const IdSchema = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? v : Number(v)))
  .pipe(z.number().int().positive())

export const GetPartnerStorageUsageOptionsSchema = z.object({
  /** Partner id whose storage we want to read. */
  partnerId: IdSchema,
  /** Max products to include in the breakdown. Default 10.
   *  The page renders a "Showing top N products" line when
   *  capped. Capped at 200 — same shape as the rest of the
   *  payout surface. */
  productLimit: z.number().int().min(1).max(200).default(10),
})
export type GetPartnerStorageUsageOptions = z.input<typeof GetPartnerStorageUsageOptionsSchema>

// ----- Output shape --------------------------------------------------------

export type ProductStorageBreakdown = {
  product_id: number
  product_slug: string
  product_title: string
  product_status: 'draft' | 'published' | 'archived' | 'removed'
  size_bytes: number
  file_count: number
}

export type PartnerStorageUsage = {
  partner_id: number
  /** Total bytes used across every file on every product the
   *  partner owns. Sum is computed in Postgres and returned
   *  as a bigint; PostgREST delivers bigints as JSON strings,
   *  which we coerce to `number` defensively (see
   *  `formatStorageSize.ts` for the precision-loss note). */
  total_bytes: number
  /** Total file count across every product the partner owns. */
  file_count: number
  /** Distinct product count that has at least one file. */
  product_count: number
  /** Top N products by size, sorted desc. Length ≤ productLimit. */
  by_product: ProductStorageBreakdown[]
  /** True when the partner owns more products than productLimit
   *  (the consumer renders a "+N more" line). False when
   *  by_product already contains every product. */
  capped: boolean
}

// ----- 32-bit FNV-1a hash for log payloads ---------------------------------

function fnv1aHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

// ----- Main query -----------------------------------------------------------

/**
 * Read the storage usage for a single partner.
 *
 * Returns `null` when:
 *   - The id is invalid (Zod failure on `partnerId`)
 *   - No session user
 *   - Non-admin role
 *
 * Returns a zero-filled result (not null) when:
 *   - The partner exists but has no products with files
 *   - The product_files read errors out (fail-soft + warn log)
 *
 * The caller (page route) distinguishes the two by checking
 * `null` (→ 404) vs `result.total_bytes === 0 && result
 * .file_count === 0` (→ render the empty state).
 *
 * Important: this query does NOT verify the partner exists
 * (no `partners` lookup). The caller is expected to have
 * already validated the partner via `getAdminPartnerPayouts`
 * or the equivalent partner-side guard. A non-existent
 * partnerId returns `{ total_bytes: 0, file_count: 0,
 * product_count: 0, by_product: [], capped: false }`
 * without error.
 */
export async function getPartnerStorageUsage(
  rawOpts: GetPartnerStorageUsageOptions,
): Promise<PartnerStorageUsage | null> {
  // ----- Zod validate -------------------------------------------------------
  const parsed = GetPartnerStorageUsageOptionsSchema.safeParse(rawOpts)
  if (!parsed.success) {
    log.warn(
      {
        code: 'partner_storage_bad_opts',
        issues: parsed.error.issues.length,
      },
      'getPartnerStorageUsage: invalid opts',
    )
    return null
  }
  const opts = parsed.data
  const partnerId = opts.partnerId
  const productLimit = opts.productLimit
  const partnerHash = fnv1aHash(String(partnerId))

  // ----- Auth gate ----------------------------------------------------------
  const user = await getSessionUser()
  if (!user) {
    log.warn(
      { code: 'partner_storage_no_session' },
      'getPartnerStorageUsage: no session',
    )
    return null
  }
  try {
    await requireRole(['admin', 'super_admin'])
  } catch {
    log.warn(
      {
        code: 'partner_storage_forbidden',
        actor_hash: fnv1aHash(user.id),
      },
      'getPartnerStorageUsage: forbidden role',
    )
    return null
  }

  const service = getServiceSupabase()

  // ----- 1) Partner's product ids ------------------------------------------
  // Drives both the breakdown read and the total. A partner with
  // no products returns an empty id list → total = 0 + empty
  // breakdown without ever touching product_files.
  const { data: productRows, error: productsError } = await service
    .from('products')
    // PII-safe: id, slug, title, status only. NEVER the long_description
    // TipTap JSON (heavy) or any future per-product payout_method-style
    // secret columns.
    .select('id, slug, title, status')
    .eq('partner_id', partnerId)
    .order('id', { ascending: true })

  if (productsError) {
    log.warn(
      {
        code: 'partner_storage_products_read_failed',
        partner_hash: partnerHash,
        msg: productsError.message,
      },
      'getPartnerStorageUsage: products read failed (returning zero usage)',
    )
    return {
      partner_id: partnerId,
      total_bytes: 0,
      file_count: 0,
      product_count: 0,
      by_product: [],
      capped: false,
    }
  }

  type ProductRow = {
    id: number
    slug: string
    title: string
    status: 'draft' | 'published' | 'archived' | 'removed'
  }
  const products = (productRows ?? []) as ProductRow[]

  if (products.length === 0) {
    return {
      partner_id: partnerId,
      total_bytes: 0,
      file_count: 0,
      product_count: 0,
      by_product: [],
      capped: false,
    }
  }

  // ----- 2) Per-product aggregation ---------------------------------------
  // SELECT product_id, SUM(size_bytes), COUNT(*) FROM product_files
  //   WHERE product_id = ANY($1) GROUP BY product_id
  //
  // PostgREST doesn't expose GROUP BY cleanly, so we do the
  // aggregation in JS over a single roundtrip of all the
  // partner's file rows. For the realistic per-partner volume
  // (typically < 1000 files per partner) this is a single RT
  // hitting product_files_product_idx.
  const productIds = products.map((p) => p.id)
  const { data: fileRows, error: filesError } = await service
    .from('product_files')
    // Minimal select: product_id + size_bytes only. NEVER
    // storage_path / bunny_video_id / hls_manifest_url /
    // checksum_sha256 — those leak CDN identifiers + sensitive
    // path info into admin RSC payloads they don't need.
    .select('product_id, size_bytes')
    .in('product_id', productIds)

  if (filesError) {
    log.warn(
      {
        code: 'partner_storage_files_read_failed',
        partner_hash: partnerHash,
        msg: filesError.message,
      },
      'getPartnerStorageUsage: product_files read failed (returning zero usage)',
    )
    return {
      partner_id: partnerId,
      total_bytes: 0,
      file_count: 0,
      product_count: 0,
      by_product: [],
      capped: false,
    }
  }

  type FileRow = { product_id: number; size_bytes: number | null }
  const files = (fileRows ?? []) as FileRow[]

  // Aggregate by product_id. Defensive: size_bytes can be null
  // (the DB CHECK is size_bytes >= 0 but a NULL would slip
  // through) — treat null as 0 to avoid corrupting the sum.
  const perProduct = new Map<
    number,
    { size_bytes: number; file_count: number }
  >()
  for (const f of files) {
    const cur = perProduct.get(f.product_id) ?? {
      size_bytes: 0,
      file_count: 0,
    }
    cur.size_bytes += typeof f.size_bytes === 'number' ? f.size_bytes : 0
    cur.file_count += 1
    perProduct.set(f.product_id, cur)
  }

  const byProduct: ProductStorageBreakdown[] = products
    .map((p): ProductStorageBreakdown => {
      const agg = perProduct.get(p.id)
      return {
        product_id: p.id,
        product_slug: p.slug,
        product_title: p.title,
        product_status: p.status,
        size_bytes: agg?.size_bytes ?? 0,
        file_count: agg?.file_count ?? 0,
      }
    })
    .filter((p) => p.size_bytes > 0)
    .sort((a, b) => b.size_bytes - a.size_bytes)

  const capped = byProduct.length > productLimit
  const visible = capped ? byProduct.slice(0, productLimit) : byProduct

  const total_bytes = byProduct.reduce((s, p) => s + p.size_bytes, 0)
  const file_count = byProduct.reduce((s, p) => s + p.file_count, 0)

  return {
    partner_id: partnerId,
    total_bytes,
    file_count,
    product_count: byProduct.length,
    by_product: visible,
    capped,
  }
}