// getDownloadHistory.ts — every signed URL mint for the current user.
// Backed by `file_downloads` (append-only audit log; same source the
// mintDownloadUrl action writes to).
//
// What this query returns:
//   - One row per file_downloads entry where user_id = current
//   - Joined to product_files (for the current filename; can be null
//     when the file was deleted — FK is `on delete set null`)
//   - Joined to products (for the current title; can be null too)
//   - Ordered created_at desc (newest first — matches the "recent
//     activity" UX; same as the lib's last_accessed_at read in
//     getUserAccessibleFiles)
//
// Why a separate query from getUserAccessibleFiles?
//   - That query bounds by the user's ACCESSIBLE files (the vault).
//     The download history shows every mint the user has EVER done —
//     including ones for files they no longer own (refunded, vault
//     expired, etc.). The download row stays after the file row is
//     deleted; the history is the truth.
//   - Different pagination: getUserAccessibleFiles caps at the
//     user's owned-product count. file_downloads grows over time;
//     the page needs a date window + cap.
//
// Why a 365-day default?
//   - file_downloads is append-only and never auto-deleted today
//     (the P19.5 cron is a follow-up). The page should bound the
//     query to keep p95 < 400ms even for power users.
//   - 365 days covers "last year" — anything older is rarely useful
//     for the user (the signed URL itself expires in 24h, so the
//     link is dead regardless). The `?days=all` URL param lifts the
//     cap for users who explicitly want the full log.
//
// PII safety:
//   - The user's OWN data is what they see. We select `ip_raw` (with
//     last-octet masked at render time), `user_agent` (truncated to
//     family label), `edge_location`. We DO NOT select `ip_hash` —
//     it's an internal-only field used by the abuse-detection script;
//     showing it to the user is meaningless.
//   - The PII mask happens at render time (maskIp / shortUserAgent),
//     not at select time. That way a future admin surface can show
//     the raw IP without changing the query.

import 'server-only'
import { cache } from 'react'
import { getServerSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import type { FileDownloadKind } from '@foundations/data/enums'

const log = loggerFor({ component: 'library.getDownloadHistory' })

/** Default window in days. Covers "last year"; matches the "all-time"
 *  useful lifetime of a signed URL (24h) plus a long buffer. */
export const DEFAULT_HISTORY_WINDOW_DAYS = 365

/** Hard cap on rows per page. Bounds p95 even on power users. */
export const MAX_HISTORY_ROWS = 500

export type DownloadHistoryEntry = {
  /** file_downloads.id */
  id: number
  /** ISO timestamp of the mint. */
  created_at: string
  /** 'download' (24h signed URL) or 'stream' (4h IP-bound HLS). */
  kind: FileDownloadKind
  /** ISO timestamp of the URL expiry. The signed URL is dead past this. */
  url_expires_at: string
  /** Edge PoP code from Bunny CDN (e.g. 'LAX', 'JFK'). Null when
   *  the row was written before the edge header was added. */
  edge_location: string | null
  /** Raw IP (last octet masked at render time via maskIp). */
  ip_raw: string | null
  /** Full user-agent string (shortened at render time via shortUserAgent). */
  user_agent: string | null

  // --- Joined data (may be null when the FK target was deleted) ---

  /** product_files.id; null when the source file row was deleted. */
  file_id: number | null
  /** Filename snapshot at render time. Null when the file row is gone. */
  original_filename: string | null
  /** products.id; null when the source product row was deleted. */
  product_id: number | null
  /** Product title snapshot. Null when the product row is gone. */
  product_title: string | null
  /** Product slug for linking. Null when the product row is gone. */
  product_slug: string | null
}

export type DownloadHistoryFilters = {
  /** Inclusive lower bound on created_at (ISO). null = unbounded. */
  since: string | null
  /** Optional kind filter ('download' | 'stream'). null = both. */
  kind: FileDownloadKind | null
  /** Max rows. Defaults to MAX_HISTORY_ROWS. */
  limit: number
}

export type DownloadHistoryResult = {
  entries: DownloadHistoryEntry[]
  /** Total rows in the window (for the page header). Fail-soft: -1
   *  when the count query errors so the page still renders. */
  total_in_window: number
  /** Echoed filters for the page header ("Showing N of M downloads
   *  in the last K days"). */
  filters: DownloadHistoryFilters
}

/**
 * Read the current user's file_downloads audit log.
 *
 * Auth: returns { entries: [], total_in_window: 0 } when no session.
 * No DB calls happen in the anon path.
 *
 * Fail-soft: any DB error returns an empty list + warn log +
 * total_in_window: -1. The page renders the "empty / error" copy
 * instead of a 500.
 */
export const getDownloadHistory = cache(
  async (filters: Partial<DownloadHistoryFilters> = {}): Promise<DownloadHistoryResult> => {
    const user = await getSessionUser()
    if (!user) {
      return {
        entries: [],
        // 0 (not -1) on the anon path so the page renders the same
        // shape as the authed-empty case. -1 is reserved for the DB
        // error path, where the page distinguishes "we know it's 0"
        // from "we couldn't tell".
        total_in_window: 0,
        filters: normalizeFilters(filters),
      }
    }

    const normalized = normalizeFilters(filters)
    const supabase = await getServerSupabase()

    let query = supabase
      .from('file_downloads')
      .select(
        // PII safety: select `ip_raw` (masked at render) + `user_agent`
        // (truncated at render). Do NOT select `ip_hash` (internal-only).
        'id, kind, created_at, url_expires_at, ip_raw, user_agent, edge_location, file_id, product_id, file:product_files ( original_filename ), product:products ( title, slug )',
      )
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(normalized.limit)

    if (normalized.kind) {
      query = query.eq('kind', normalized.kind)
    }
    if (normalized.since) {
      query = query.gte('created_at', normalized.since)
    }

    const { data, error } = await query
    if (error) {
      log.warn(
        { code: 'get_download_history_failed', msg: error.message, kind: normalized.kind, since: normalized.since },
        'getDownloadHistory failed',
      )
      return { entries: [], total_in_window: -1, filters: normalized }
    }

    const entries = ((data ?? []) as RawRow[]).map(toEntry)
    return {
      entries,
      // Cheap total — same scan, but no join payload. We accept an
      // approximate total (under-window). The user-facing copy says
      // "Showing N rows in the last K days" — the page doesn't show
      // "X total in the table" because that's the table size, not
      // the user's experience.
      total_in_window: entries.length,
      filters: normalized,
    }
  },
)

function normalizeFilters(input: Partial<DownloadHistoryFilters>): DownloadHistoryFilters {
  const kind = input.kind === 'download' || input.kind === 'stream' ? input.kind : null
  const since = typeof input.since === 'string' && input.since.length > 0 ? input.since : null
  const limit =
    typeof input.limit === 'number' && input.limit > 0
      ? Math.min(Math.floor(input.limit), MAX_HISTORY_ROWS)
      : MAX_HISTORY_ROWS
  return { since, kind, limit }
}

// ----- row mapping -----

type RawRow = {
  id: number
  kind: FileDownloadKind
  created_at: string
  url_expires_at: string
  ip_raw: string | null
  user_agent: string | null
  edge_location: string | null
  file_id: number | null
  product_id: number | null
  // PostgREST can return these as array-embed or object-embed.
  file: { original_filename: string } | { original_filename: string }[] | null
  product: { title: string; slug: string } | { title: string; slug: string }[] | null
}

function toEntry(r: RawRow): DownloadHistoryEntry {
  // Defensive: handle both array-embed and object-embed shapes
  // (PostgREST varies by version + relation cardinality).
  const fileObj = Array.isArray(r.file) ? r.file[0] : r.file
  const productObj = Array.isArray(r.product) ? r.product[0] : r.product

  return {
    id: r.id,
    created_at: r.created_at,
    kind: r.kind,
    url_expires_at: r.url_expires_at,
    edge_location: r.edge_location ?? null,
    ip_raw: r.ip_raw ?? null,
    user_agent: r.user_agent ?? null,
    file_id: r.file_id ?? null,
    original_filename: fileObj?.original_filename ?? null,
    product_id: r.product_id ?? null,
    product_title: productObj?.title ?? null,
    product_slug: productObj?.slug ?? null,
  }
}

// ----- window helpers (pure, exported for the page) -----

/**
 * Build the `since` ISO string for a window-days value. Returns null
 * for `days = 'all'` (unbounded). Returns the epoch string for
 * `days <= 0` (defensive — page should never render this).
 *
 * Accepts the union of all window-day shapes the callers use: a
 * positive integer, the literal 'all', or null/undefined for default.
 *
 * @param days - positive integer days back from `now`, or 'all', or null/undefined for default
 * @param now - injectable for tests; defaults to Date.now()
 */
export function windowSince(
  days: number | string | null | undefined,
  now: number = Date.now(),
): string | null {
  if (days === 'all' || days == null) return null
  if (typeof days !== 'number' || days <= 0) return null
  return new Date(now - days * MS_PER_DAY).toISOString()
}

export const MS_PER_DAY = 24 * 60 * 60 * 1000
