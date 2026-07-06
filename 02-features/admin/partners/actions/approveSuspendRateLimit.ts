// approveSuspendRateLimit.ts — in-process sliding-window rate limiter
// for the right-rail approve / suspend / unsuspend server actions
// (P14.5) on /admin/partners/[id].
//
// Spec contract (admin-partner-detail.md line 99):
//   - "suspend/unsuspend 20/hr/admin"
//   - "reveal 100/hr/admin" (deferred to Slice 2 — STUB-118)
//   - "profile edit 60/hr/admin" (deferred to Slice 2 — STUB-118)
//
// We treat approve + suspend + unsuspend as a SINGLE bucket —
// 20/hr/admin covers all three transitions. The rationale: a single
// admin shouldn't be flipping partner status faster than a human
// reviewer can reasonably review, regardless of direction. Three
// separate buckets would let an admin click 20 approves + 20
// suspends + 20 unsuspends in an hour, which defeats the intent.
//
// Why per-admin, not per-partner: the spec is explicit. Per-partner
// would let a single admin click "approve" on 1000 partners in an
// hour; per-admin caps the total state-changing actions per
// operator, which is the durable anti-abuse signal.
//
// Why a separate module: Next.js `'use server'` files can only
// export async functions. The Map + the test reset helper are
// non-async + non-isolated to the action, so they live here.
// Mirrors the `exportLedgerCsv.rate-limit.ts` (P6.3) + the
// `saveUploadDraft.rate-limit.ts` (P12.7) pattern.
//
// STUB-012 covers the move to a Supabase-backed `rate_limit_events`
// table in PH18. v1 is single-instance; this in-process Map is
// correct + simple. The same future migration lifts all in-process
// limiters across the app.

const APPROVE_SUSPEND_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const APPROVE_SUSPEND_MAX_PER_ADMIN = 20 // 20/hr per spec

/** In-process per-admin counter. Single-instance v1; STUB-012
 *  covers the multi-instance move to a Supabase-backed table. */
const actionTimestamps = new Map<string, number[]>()

/** Pure sliding-window verdict for a single admin at a given
 *  moment. Records the attempt when allowed so the next call sees
 *  the updated count. Returns the retry-after seconds when denied. */
export function rateLimitVerdict(
  adminId: string,
  nowMs: number,
): {
  allowed: boolean
  retryAfterSeconds: number
  count: number
} {
  const recent = (actionTimestamps.get(adminId) ?? []).filter(
    (t) => nowMs - t < APPROVE_SUSPEND_WINDOW_MS,
  )
  if (recent.length >= APPROVE_SUSPEND_MAX_PER_ADMIN) {
    actionTimestamps.set(adminId, recent)
    const oldest = recent[0]!
    const retryAfterMs = APPROVE_SUSPEND_WINDOW_MS - (nowMs - oldest)
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      count: recent.length,
    }
  }
  recent.push(nowMs)
  actionTimestamps.set(adminId, recent)
  return { allowed: true, retryAfterSeconds: 0, count: recent.length }
}

/** Test-only. Reset the in-process counters between tests. */
export function _resetApproveSuspendRateLimitForTests(): void {
  actionTimestamps.clear()
}

/** Test-only constants — exported for unit tests + future surfaces
 *  that want the same limits. */
export const APPROVE_SUSPEND_RATE_LIMIT_MAX_PER_ADMIN = APPROVE_SUSPEND_MAX_PER_ADMIN
export const APPROVE_SUSPEND_RATE_LIMIT_WINDOW_MS = APPROVE_SUSPEND_WINDOW_MS