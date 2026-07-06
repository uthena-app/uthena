// Shared in-process sliding-window rate limiter.
//
// SEC-3 / D3 (see TODO-HARDENING.md, DECISIONS-NEEDED.md D3, STUB-013):
// the app has 8+ independent re-implementations of the same
// "sliding-window Map<key, timestamp[]>" logic (QLT-7). This module is
// the ONE shared implementation for NEW call sites — it does not replace
// the 8 existing ones in this pass (other in-flight work may be touching
// those files; ripping them out is a separate, larger change).
//
// ponytail: this is still an in-process Map — correct for a single Node
// instance, wrong once the app runs on 2+ instances behind a load
// balancer (a caller gets N x ceiling throughput, one per instance).
// The durable fix is `rate_limit_events` (04-platform/migrations/
// 0067_rate_limit_events.sql, service-role-only, RLS enabled) — swap
// `checkAndRecordSlidingWindow`'s storage for a read/increment against
// that table (upsert on (key, window_start), compare count) when a
// second instance is provisioned. The function signature below is
// already the seam: callers pass a `key` + `limit` + `windowMs` and get
// back an allow/deny verdict, so swapping the body from Map to Supabase
// is a one-function change with no call-site changes required.
//
// Used today by:
//   - app/api/errors/report/route.ts — 30/min/hashed-IP (SEC-3 interim)
//   - app/api/search/route.ts — 60/min/hashed-IP (SEC-3 interim)

const buckets = new Map<string, number[]>()

export interface SlidingWindowVerdict {
  /** True when the call is allowed and has been recorded. */
  allowed: boolean
  /** Hits in the current window AFTER this call (if allowed). */
  count: number
  /** The ceiling passed in by the caller. */
  limit: number
  /** Seconds until the oldest hit in the window expires. 0 when allowed. */
  retryAfterSeconds: number
}

/**
 * Atomically check + record a hit for `key` against a sliding window of
 * `windowMs` capped at `limit`. Mirrors the pattern in
 * `00-foundations/files/rate-limit.ts` (checkAndRecordSignedUrlMint) but
 * generalized over an arbitrary key/limit/window instead of being
 * hard-coded to the signed-URL use case.
 *
 * `now` is injectable for deterministic tests.
 */
export function checkAndRecordSlidingWindow(
  key: string,
  limit: number,
  windowMs: number,
  nowMs?: number,
): SlidingWindowVerdict {
  const now = nowMs ?? Date.now()
  const bucket = buckets.get(key) ?? []
  const recent = bucket.filter((t) => now - t < windowMs)
  if (recent.length >= limit) {
    buckets.set(key, recent)
    const oldest = recent[0]!
    const retryAfterMs = windowMs - (now - oldest)
    return {
      allowed: false,
      count: recent.length,
      limit,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    }
  }
  recent.push(now)
  buckets.set(key, recent)
  return {
    allowed: true,
    count: recent.length,
    limit,
    retryAfterSeconds: 0,
  }
}

/** Test-only. Resets every in-process bucket. */
export function _resetSlidingWindowRateLimitForTests(): void {
  buckets.clear()
}

/** Test-only. Number of distinct keys currently tracked. */
export function _slidingWindowRateLimitSize(): number {
  return buckets.size
}
