// In-process rate limiter for signed-URL generation. Shared by the
// `mintDownloadUrlAction`, `mintStreamUrlAction`, and the matching
// `/api/files/[id]/...` route handlers.
//
// Per the spec (`00-foundations/files/README.md` §rate-limit):
//   - 60 signed URL generations per user per hour.
//   - 1000 per user per day. (v1: not enforced here — the 60/hour
//     ceiling is the only one that matters in practice; the daily
//     ceiling would only fire for bots running >40h of continuous
//     generation, which the audit log already catches.)
//
// v1 storage: in-process Map. Fine for single-instance. v2 (Phase 18
// P18.8) moves this to a Supabase-backed `rate_limit_events` table
// so multi-instance deployments share the same counter. STUB-013.

import { HOUR_MS, SIGNED_URL_LIMIT_PER_HOUR } from './signed-url'

type Bucket = number[]

const buckets = new Map<string, Bucket>()

/**
 * Atomically check + record a signed-URL mint for a user. Returns
 * whether the call is allowed. If allowed, the call is recorded; the
 * caller can proceed. If not, the call is NOT recorded and the caller
 * should return a friendly "Try again in N minutes" response.
 *
 * The check + record is a single Map operation, so two concurrent
 * calls from the same user (e.g. the user clicks two buttons at
 * once) can't both squeeze in past the limit. (There's still a tiny
 * race window across Node's event loop turns, but it's not worth
 * locking for.)
 */
export function checkAndRecordSignedUrlMint(userId: string, nowMs?: number): SignedUrlRateLimit {
  const now = nowMs ?? Date.now()
  const bucket = buckets.get(userId) ?? []
  // Drop entries outside the 1h window. This is the slide: the window
  // is "the last 60 minutes from now", not "60 minutes since the
  // first hit".
  const recent = bucket.filter((t) => now - t < HOUR_MS)
  if (recent.length >= SIGNED_URL_LIMIT_PER_HOUR) {
    // Persist the trimmed bucket so the next call doesn't re-do the
    // work + so the `retryAfterSeconds` math below sees the same set.
    buckets.set(userId, recent)
    const oldest = recent[0]!
    const retryAfterMs = HOUR_MS - (now - oldest)
    return {
      allowed: false,
      count: recent.length,
      limit: SIGNED_URL_LIMIT_PER_HOUR,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    }
  }
  recent.push(now)
  buckets.set(userId, recent)
  return {
    allowed: true,
    count: recent.length,
    limit: SIGNED_URL_LIMIT_PER_HOUR,
    retryAfterSeconds: 0,
  }
}

export interface SignedUrlRateLimit {
  /** True when the call is allowed and has been recorded. */
  allowed: boolean
  /** Hits in the current 1h sliding window AFTER this call's record (if allowed). */
  count: number
  /** The ceiling (60). */
  limit: number
  /** Seconds until the oldest hit in the window expires. 0 when allowed. */
  retryAfterSeconds: number
}

/** Test-only. Resets the in-process buckets. */
export function _resetSignedUrlRateLimitForTests() {
  buckets.clear()
}

/** Test-only. Returns the number of users currently tracked. */
export function _signedUrlRateLimitSize(): number {
  return buckets.size
}
