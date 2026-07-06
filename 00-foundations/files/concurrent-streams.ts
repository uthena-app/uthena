// Concurrent-stream limiter for the sharing-prevention surface (P7.8).
//
// Splits the stream-mint path into two layers so each can be tested
// without the other:
//
//   - This file is the pure decision layer. It takes a count of the
//     user's currently-active stream URLs (rows in `file_downloads`
//     with `kind='stream'` and `url_expires_at > now()`) and decides
//     whether a new mint is allowed. No DB, no env, no clock — all
//     injected.
//
//   - The DB query lives in
//     `02-features/library/queries/countActiveStreams.ts` and fetches
//     the count via the user's RLS-gated row set. It returns a plain
//     number; the policy decision lives here.
//
// Why a separate file from `rate-limit.ts`:
//
//   - `rate-limit.ts` is an in-process sliding window (60/hour/user).
//     It bounds the mint volume; it's deliberately cheap and works
//     without a DB roundtrip.
//
//   - This module is a per-user "how many are currently unexpired"
//     check. It needs a DB roundtrip because the answer depends on
//     what's in `file_downloads`. It bounds concurrent bandwidth
//     usage, not mint volume.
//
// The two limits stack: a user can't mint 60 streams/hour and hold
// 3 unexpired ones at once. They complement each other.

/**
 * Per-user cap on concurrent unexpired stream URLs. A user minting
 * `MAX_CONCURRENT_STREAMS + 1` URLs in the 4h TTL window gets blocked
 * at the boundary with a friendly "Too many concurrent streams"
 * message.
 *
 * Picked at 3 because:
 *   - Most legitimate use is 1 player at a time on 1 device.
 *   - 3 covers "laptop on the couch + phone for a quick reference +
 *     tablet in the kitchen" — the realistic multi-device ceiling.
 *   - Higher than 3 invites abuse (one user farming 10+ streams
 *     simultaneously, eating bandwidth at the CDN's expense).
 *
 * Stored as a const so the limit is a single source of truth. Future
 * per-tier overrides (e.g. subscribers get 5) would replace this
 * with a small lookup; the helper signature stays the same.
 */
export const MAX_CONCURRENT_STREAMS = 3

/**
 * Pure decision: should we mint another stream URL given the current
 * count of this user's unexpired stream URLs?
 *
 * Returns a verdict shaped like the other limit helpers in this
 * module (`checkAndRecordSignedUrlMint`) so callers can branch on
 * `allowed` + surface a friendly message from the same shape.
 *
 * The `limit` is parameterised rather than reading the module
 * constant so tests can drive the boundary with a different cap (e.g.
 * 1 for unit tests, 3 for production). `MAX_CONCURRENT_STREAMS` is
 * the production default — callers pass it explicitly.
 */
export interface ConcurrentStreamLimitVerdict {
  /** True when the call is allowed (count < limit). */
  allowed: boolean
  /** The count AFTER this call would be recorded (count + 1). */
  current: number
  /** The ceiling that was compared against. */
  limit: number
  /** When not allowed, the smallest `count` value that would be allowed. Always 0 when allowed. */
  retryAfterActiveCount: number
}

export function evaluateConcurrentStreamLimit(
  activeCount: number,
  limit: number = MAX_CONCURRENT_STREAMS,
): ConcurrentStreamLimitVerdict {
  // Defensive: a malformed count (negative, NaN) is treated as 0.
  // The DB query never returns these, but the helper stays safe if
  // called from a future admin tool or test with bad input.
  const safe = Number.isFinite(activeCount) && activeCount >= 0 ? Math.floor(activeCount) : 0
  const next = safe + 1
  if (next <= limit) {
    return { allowed: true, current: next, limit, retryAfterActiveCount: 0 }
  }
  return {
    allowed: false,
    current: safe,
    limit,
    // The smallest count value that would be allowed is `limit` (the
    // user must wait for one stream to expire). Surface that as a
    // diagnostic; the caller doesn't currently render it but it's
    // available for a future admin / debug surface.
    retryAfterActiveCount: limit,
  }
}

/** Test-only. Resets nothing (this module is pure). Exists so the test
 * harness can import it for symmetry with `rate-limit.ts`. */
export function _resetConcurrentStreamLimitForTests(): void {
  // no-op: the helper is pure. Kept for test-harness symmetry with
  // the in-process rate limiter.
}