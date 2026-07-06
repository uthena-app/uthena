import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import type { PartnerProfile } from './getMyPartnerProfile'

export type PartnerProductRow = {
  id: number
  slug: string
  title: string
  short_description: string
  status: 'draft' | 'in_review' | 'published' | 'unpublished' | 'archived'
  kind: string
  category_id: number
  thumbnail_url: string | null
  created_at: string
  updated_at: string
  // Per-product aggregates (P6.2 — resolves STUB-035).
  // Source: get_partner_product_aggregates(partner_id) RPC
  // (migration 0030). Returns 0/0 for products with no paid sales
  // OR when the RPC fails (fail-soft).
  total_sales_cents: number
  units_sold: number
}

/** Coerce a PostgREST bigint-as-string value back to a number.
 *  RPCs that declare `returns bigint` / `returns table(... bigint)`
 *  are serialized as JSON strings on the wire; the JS client sees
 *  `'1234'` instead of `1234`. Used by the P6.2 aggregation merge. */
function coerceBigint(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/** Read the partner's products (any status) + their per-product
 *  aggregates (P6.2). RLS on `products` allows the partner to read
 *  their own rows (via the `partners.id` join). The aggregates RPC
 *  is SECURITY DEFINER and re-checks authorization internally. */
export async function getMyPartnerProducts(): Promise<PartnerProductRow[]> {
  const supabase = await getServerSupabase()
  const partner: PartnerProfile | null = await (async () => {
    // Inline the partner query to avoid a circular import.
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null
    const { data } = await supabase
      .from('partners')
      .select('id, user_id, status, public_slug, bio, website_url, payout_method, tax_form_status, tax_country, tax_id, created_at, updated_at')
      .eq('user_id', user.id)
      .maybeSingle()
    if (!data) return null
    return { ...(data as PartnerProfile), display_name: '', email: '' }
  })()
  if (!partner) return []

  // P6.2 — Read the products list first, then the aggregates RPC.
  // Sequential reads: clearer error semantics, easier to mock/test,
  // and the latency cost is negligible (one extra round-trip vs
  // parallel — typically < 10ms in our Supabase region). Both reads
  // are RLS-enforced for the partner's own rows; the RPC is
  // SECURITY DEFINER + checks `current_partner_id() = p_partner_id or
  // is_admin()` internally.
  const productsResult = await supabase
    .from('products')
    .select(
      'id, slug, title, short_description, status, kind, category_id, thumbnail_url, created_at, updated_at',
    )
    .eq('partner_id', partner.id)
    .order('updated_at', { ascending: false })

  const aggregatesResult = await supabase.rpc('get_partner_product_aggregates', {
    p_partner_id: partner.id,
  })

  if (productsResult.error || !productsResult.data) return []

  // P6.2 — Build a Map<product_id, { units_sold, revenue_cents }>
  // from the RPC result. PostgREST returns `returns table(...)` as
  // an array of row objects. Fail-soft on RPC error: log a warn
  // and surface every product as 0/0 (the courses list still
  // renders — the aggregates are a secondary KPI).
  const aggregates = new Map<number, { units_sold: number; revenue_cents: number }>()
  const dashboardLog = loggerFor({ component: 'partner.courses' })
  if (aggregatesResult.error) {
    dashboardLog.warn(
      { partner_id_hash: hashPartnerId(partner.id), code: aggregatesResult.error.code ?? null },
      'product aggregates RPC failed',
    )
    // Fall through with an empty map — every row maps to 0/0 below.
  } else if (Array.isArray(aggregatesResult.data)) {
    for (const row of aggregatesResult.data as Array<{
      product_id: number | string
      units_sold: number | string
      revenue_cents: number | string
    }>) {
      const productId = coerceBigint(row.product_id)
      if (productId <= 0) continue
      aggregates.set(productId, {
        units_sold: coerceBigint(row.units_sold),
        revenue_cents: coerceBigint(row.revenue_cents),
      })
    }
  }

  return (productsResult.data as Array<Omit<PartnerProductRow, 'total_sales_cents' | 'units_sold'>>).map((p) => {
    const agg = aggregates.get(p.id as number)
    return {
      id: p.id as number,
      slug: p.slug as string,
      title: p.title as string,
      short_description: p.short_description as string,
      status: p.status as PartnerProductRow['status'],
      kind: p.kind as string,
      category_id: p.category_id as number,
      thumbnail_url: (p.thumbnail_url as string | null) ?? null,
      created_at: p.created_at as string,
      updated_at: p.updated_at as string,
      // P6.2 — merged from get_partner_product_aggregates.
      total_sales_cents: agg?.revenue_cents ?? 0,
      units_sold: agg?.units_sold ?? 0,
    }
  })
}

/**
 * Hash a numeric partner_id for log redaction. We never want the raw
 * partner_id in logs — it's an internal-account identifier that could
 * be cross-referenced with other logs / tables. FNV-1a 32-bit is fast,
 * non-cryptographic, and sufficient for "is this the same partner
 * across log lines" correlation. NOT a security boundary; just a
 * redaction helper for the `check:pii` script. (Duplicated from
 * `getMyPartnerProfile.ts` to keep this query file standalone —
 * both functions log the hash and the duplication is cheaper than
 * a circular import.)
 */
function hashPartnerId(partnerId: number): string {
  let hash = 0x811c9dc5
  for (const ch of String(partnerId)) {
    hash ^= ch.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  // Unsigned hex, 8 chars.
  return (hash >>> 0).toString(16).padStart(8, '0')
}