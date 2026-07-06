// getUserAccessibleFiles.ts — list the product_files that the user
// can access, joined to the product. Used by the /library page's
// "File vault" section.
//
// v1: pulls the user's accessible products in one RPC, then a
// second query for the files. The list is bounded by the user's
// owned products (rarely > 50) so the second query is O(owned) not
// O(catalog). At 500+ products in the catalog and a typical user
// owning 5, this is 5 product_files lookups in a single roundtrip
// using `.in('product_id', ownedProductIds)`.
//
// P7.3: third query for the user's most-recent file_downloads.
// The audit log is append-only (`file_downloads`), so we fetch
// rows where user_id=X AND file_id IN (owned file ids), sorted
// created_at desc, then dedupe to the latest per file in JS.
// The dedupe is a single pass over the (bounded) result set;
// no extra index needed — the existing
// `file_downloads_user_created_idx (user_id, created_at desc)`
// is index-only for the filter, and the `file_id IN (...)` filter
// runs against the in-memory page. Per the PHASES.md spec, this
// is the "last accessed" data point shown on every VaultItem
// ("Last accessed: 3 days ago" / "Never accessed").

import 'server-only'
import { cache } from 'react'
import { getServerSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'library.getUserAccessibleFiles' })

export type VaultFile = {
  id: number
  product_id: number
  product_title: string
  product_slug: string
  kind: 'video' | 'slides' | 'transcript' | 'graphics' | 'audio' | 'document' | 'archive' | 'other'
  original_filename: string
  size_bytes: number
  duration_seconds: number | null
  hls_manifest_url: string | null
  // ISO timestamp (timestamptz) of when the file was uploaded to the
  // product. The query sorts by created_at desc but didn't return the
  // column until P7.9 — the date filter on the file vault (P7.9) needs
  // it client-side to compute "Last 30 days" / "Last year" windows.
  // The type stays ISO-string so it's serializable across the RSC
  // boundary (no Date objects in client props). null is defensive —
  // the column is NOT NULL in the schema, so this only fires if the
  // defensive mapper drops a row with no timestamp.
  created_at: string | null
  // ISO timestamp (timestamptz) of the user's most-recent
  // download/stream of this file. null = never accessed. The
  // type stays ISO-string so it's serializable across the
  // RSC boundary (no Date objects in client props).
  last_accessed_at: string | null
}

export const getUserAccessibleFiles = cache(async (): Promise<VaultFile[]> => {
  const user = await getSessionUser()
  if (!user) return []
  const supabase = await getServerSupabase()
  const { data: accessible } = await supabase.rpc('user_accessible_products', { p_user_id: user.id })
  const ownedIds = ((accessible ?? []) as { product_id: number }[]).map((p) => p.product_id)
  if (ownedIds.length === 0) return []
  const { data: files, error } = await supabase
    .from('product_files')
    .select('id, product_id, kind, original_filename, size_bytes, duration_seconds, hls_manifest_url, created_at, product:products ( title, slug )')
    .in('product_id', ownedIds)
    .eq('scan_status', 'clean')
    .eq('encoding_status', 'ready')
    .order('created_at', { ascending: false })
  if (error) {
    log.warn({ code: 'get_files_failed', msg: error.message }, 'getUserAccessibleFiles failed')
    return []
  }
  const rows = (files ?? []).map((f) => {
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

  // P7.3: hydrate last_accessed_at from file_downloads. We skip the
  // query when there are no rows to look up — a user with no files
  // in the vault can't have downloads of them. Also fail-soft: an
  // audit-log read error must NOT take down the vault page; the
  // "Never accessed" fallback is the safe default.
  const fileIds = rows.map((r) => r.id)
  const lastSeen = await fetchLastAccessed(supabase, user.id, fileIds)
  for (const row of rows) {
    const ts = lastSeen.get(row.id)
    if (ts) row.last_accessed_at = ts
  }
  return rows
})

// fetchLastAccessed — pulls the user's file_downloads audit rows
// for the given file ids and returns a Map<file_id, latest ISO
// timestamp>. Pure data shape — no DB calls leak into the return.
//
// Query shape:
//   - `.select('file_id, created_at')` (minimal — no PII columns)
//   - `.in('file_id', ids)` (file id allow-list from the vault rows)
//   - `.eq('user_id', userId)` (RLS already enforces this; the
//     explicit predicate is for the index plan)
//   - `.order('created_at', { ascending: false })` (newest first;
//     dedupe in JS keeps the first sighting per file_id, which IS
//     the latest because of the order)
//
// The select intentionally omits `ip_hash`, `ip_raw`, `user_agent`,
// `range_start`, `range_end`, `bytes_served`, `edge_location`,
// `url_expires_at` — the vault page has no use for them and shipping
// PII into RSC payloads is forbidden by AGENTS.md.
async function fetchLastAccessed(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  userId: string,
  fileIds: number[],
): Promise<Map<number, string>> {
  if (fileIds.length === 0) return new Map()
  const { data, error } = await supabase
    .from('file_downloads')
    .select('file_id, created_at')
    .eq('user_id', userId)
    .in('file_id', fileIds)
    .order('created_at', { ascending: false })
  if (error) {
    log.warn({ code: 'get_last_accessed_failed', msg: error.message }, 'fetchLastAccessed failed — vault falls back to "Never accessed"')
    return new Map()
  }
  const map = new Map<number, string>()
  for (const row of (data ?? []) as { file_id: number | null; created_at: string }[]) {
    // file_id can be null when the source product_files row was
    // deleted (the FK is `on delete set null`). Skip those — they
    // don't correspond to any current vault file.
    if (row.file_id == null) continue
    // First sighting wins because the result is newest-first.
    if (!map.has(row.file_id)) map.set(row.file_id, row.created_at)
  }
  return map
}
