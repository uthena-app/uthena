// saveUploadDraft.rate-limit.ts — in-process rate limiter for the
// partner upload wizard's `saveUploadDraftAction` server action (P12.7).
//
// Spec contract: `01-specs/pages/instructor-upload.md` §"Save draft"
// user action line 32 — "automatic, debounced 1s after any field change".
// The client-side debounce caps the natural cadence at ~1 req/sec under
// heavy typing; the server-side cap is the floor under that — a
// misbehaving or compromised client shouldn't be able to amplify into
// thousands of writes per minute per user.
//
// Why a separate module: Next.js `'use server'` files can only export
// async functions. The Map + the test reset helper are non-async +
// non-isolated to the action, so they live here. Mirrors the
// `saveStep.rate-limit.ts` (P12.2) + `exportLedgerCsv.rate-limit.ts`
// (P6.3) pattern.
//
// Why per-user, not per-IP: the durable anti-abuse signal is the user's
// UUID (stable, never changes). An IP key would fail-soft for users
// sharing an office NAT; a user moving IPs shouldn't multiply their
// quota.
//
// STUB-012 covers the move to a Supabase-backed `rate_limit_events`
// table in PH18. v1 is single-instance; this in-process Map is correct
// + simple. The same future migration lifts both this limiter and the
// partner-onboarding one.

const SAVE_WINDOW_MS = 60_000 // 60 seconds per spec
const SAVE_MAX_PER_USER = 60 // 60/min per user per spec (mirrors onboarding)

/** In-process per-user save counter. Single-instance v1; STUB-012
 *  covers the multi-instance move to a Supabase-backed table. */
const saveTimestamps = new Map<string, number[]>()

/** Pure sliding-window verdict for a single user at a given moment.
 *  Records the attempt when allowed so the next call sees the updated
 *  count. Returns the retry-after seconds when denied. */
export function rateLimitVerdict(
  userId: string,
  nowMs: number,
): {
  allowed: boolean
  retryAfterSeconds: number
  count: number
} {
  const recent = (saveTimestamps.get(userId) ?? []).filter(
    (t) => nowMs - t < SAVE_WINDOW_MS,
  )
  if (recent.length >= SAVE_MAX_PER_USER) {
    saveTimestamps.set(userId, recent)
    const oldest = recent[0]!
    const retryAfterMs = SAVE_WINDOW_MS - (nowMs - oldest)
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      count: recent.length,
    }
  }
  recent.push(nowMs)
  saveTimestamps.set(userId, recent)
  return { allowed: true, retryAfterSeconds: 0, count: recent.length }
}

/** Test-only. Reset the in-process counters between tests. */
export function _resetSaveUploadDraftRateLimitForTests(): void {
  saveTimestamps.clear()
}

/** Test-only constants — exported for unit tests + future surfaces
 *  that want the same limits. */
export const SAVE_UPLOAD_DRAFT_RATE_LIMIT_MAX_PER_USER = SAVE_MAX_PER_USER
export const SAVE_UPLOAD_DRAFT_RATE_LIMIT_WINDOW_MS = SAVE_WINDOW_MS
