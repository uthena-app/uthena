// page-rate-limit.ts — in-process per-user page rate limiter for the
// affiliate onboarding wizard.
//
// P13.1 Slice 1 — used by `/affiliate/onboarding` (and the future
// /welcome / /thanks) to satisfy the page-level rate-limit
// requirement (60 req/min/user, matching the partner onboarding
// surface pattern).
//
// Why a separate module: Next.js `'use server'` files can only
// export async functions, and the page-level rate-limit is invoked
// from the RSC page loader (not a server action). The Map + the
// test reset helper are non-async + non-isolated to the call site,
// so they live here. Mirrors `02-features/partner-onboarding/lib/
// page-rate-limit.ts` (P12.3).
//
// Why per-user, not per-IP: the durable anti-abuse signal is the
// user's UUID (stable, never changes). An IP key would fail-soft for
// users sharing an office NAT; a user moving IPs shouldn't multiply
// their quota.
//
// STUB-012 covers the move to a Supabase-backed `rate_limit_events`
// table in PH18. v1 is single-instance; this in-process Map is
// correct + simple.
//
// What this is NOT:
//   - A general-purpose per-action rate limiter. Use
//     `checkRateLimit` in `00-foundations/auth/rate-limit.ts` for
//     authenticated actions that need cross-instance durability.
//   - An auth-failure rate limiter. The auth foundation owns that
//     pattern (per-email + per-IP buckets).

const PAGE_VIEW_WINDOW_MS = 60_000 // 60 seconds per spec
const PAGE_VIEW_MAX_PER_USER = 60 // 60/min per user per spec

/** In-process per-user page-view counter. Single-instance v1; STUB-012
 *  covers the multi-instance move to a Supabase-backed table. */
const pageViewTimestamps = new Map<string, number[]>()

/** Pure sliding-window verdict for a single user at a given moment.
 *  Records the attempt when allowed so the next call sees the
 *  updated count. Returns the retry-after seconds when denied. */
export function pageRateLimitVerdict(
  userId: string,
  nowMs: number,
): {
  allowed: boolean
  retryAfterSeconds: number
  count: number
} {
  const recent = (pageViewTimestamps.get(userId) ?? []).filter(
    (t) => nowMs - t < PAGE_VIEW_WINDOW_MS,
  )
  if (recent.length >= PAGE_VIEW_MAX_PER_USER) {
    pageViewTimestamps.set(userId, recent)
    const oldest = recent[0]!
    const retryAfterMs = PAGE_VIEW_WINDOW_MS - (nowMs - oldest)
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      count: recent.length,
    }
  }
  recent.push(nowMs)
  pageViewTimestamps.set(userId, recent)
  return { allowed: true, retryAfterSeconds: 0, count: recent.length }
}

/** Test-only. Reset the in-process counters between tests. */
export function _resetPageRateLimitForTests(): void {
  pageViewTimestamps.clear()
}

/** Test-only constants — exported for unit tests + future surfaces
 *  that want the same limits. */
export const PAGE_VIEW_RATE_LIMIT_MAX_PER_USER = PAGE_VIEW_MAX_PER_USER
export const PAGE_VIEW_RATE_LIMIT_WINDOW_MS = PAGE_VIEW_WINDOW_MS