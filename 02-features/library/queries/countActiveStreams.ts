// countActiveStreams.ts — P7.8 (sharing prevention, Slice 1).
//
// Counts the user's currently-unexpired stream URLs (rows in
// `file_downloads` with `kind='stream'` and `url_expires_at > now()`).
// Used by the stream-mint path to enforce `MAX_CONCURRENT_STREAMS`:
// a user can't mint a new stream URL when they already have N
// unexpired ones outstanding.
//
// Why count `url_expires_at` (a derived "active" window) instead of a
// dedicated `is_active` boolean on `file_downloads`?
//   - The signed URL itself has a 4h TTL (`SIGNED_URL_TTL_SECONDS.stream`).
//     `url_expires_at` is the source of truth — it's what's actually
//     enforced at the CDN. A dedicated boolean would drift.
//   - The query is indexable on `(user_id, url_expires_at)` — the
//     existing `file_downloads_user_created_idx` covers the
//     `user_id = $1` predicate and the planner falls back to a
//     sequential scan for the `kind` and `url_expires_at` filters.
//     Volume per user is bounded by the in-process rate limit
//     (60/hour) so the scan is small in practice. A partial index
//     `WHERE kind='stream'` would be a v2 optimization if the
//     scan ever shows up in p95 profiles.
//
// Why fail-soft to 0 on error?
//   - The concurrent-stream limit is a courtesy, not a security
//     boundary. A failed read should NOT block the legitimate user
//     from watching their videos. The user gets a successful mint
//     instead of a confusing 500.
//   - The same shape as `getDownloadHistory` (returns the empty
//     result + warn log). Consistent failure mode across the lib.
//
// PII safety:
//   - The query selects only `id` (via `head: true`) — no PII fields
//     cross the wire. The user can only see their own rows (RLS
//     `file_downloads_self_read`).

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'library.countActiveStreams' })

/**
 * Count the user's unexpired stream URLs. Returns 0 for anon users
 * (no DB call) and on read errors (fail-soft — see file header).
 *
 * `now` is injectable for tests so the boundary cases (just-expired,
 * just-not-expired) can be asserted without a clock dependency.
 */
export async function countActiveStreams(
  now: Date = new Date(),
): Promise<number> {
  const user = await getSessionUser()
  if (!user) return 0

  const supabase = await getServerSupabase()
  // `head: true` returns just the count, no row payload — the cheapest
  // possible query for "how many rows match". PostgREST returns
  // `{ count: <number> }` and we read it from the header on the
  // response; the Supabase client surfaces it as `count` on the
  // resolved value when you pass `{ count: 'exact', head: true }`.
  const { count, error } = await supabase
    .from('file_downloads')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('kind', 'stream')
    .gt('url_expires_at', now.toISOString())

  if (error) {
    // Fail-soft: the concurrent-stream limit is a courtesy, not a
    // security boundary. A failed read should NOT block the
    // legitimate user from watching their videos.
    log.warn(
      { code: 'count_active_streams_failed', msg: error.message },
      'countActiveStreams query failed (failing soft to 0)',
    )
    return 0
  }
  // PostgREST bigint-as-string defensiveness: the count may come back
  // as a string in some configurations. Coerce to number when safe.
  if (typeof count === 'number') return Math.max(0, Math.floor(count))
  if (typeof count === 'string') {
    const n = Number.parseInt(count, 10)
    return Number.isFinite(n) ? Math.max(0, n) : 0
  }
  return 0
}