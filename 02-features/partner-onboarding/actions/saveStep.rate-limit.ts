// saveStep.rate-limit.ts — in-process rate limiter for the partner
// onboarding saveStep server action (P12.2).
//
// Spec contract: `01-specs/pages/partner-onboarding.md` §Security
// line 112 — "saveStep is rate-limited to 60 requests/minute per
// user (prevents a misbehaving client from spamming)".
//
// Why a separate module: Next.js `'use server'` files can only
// export async functions. The Map + the test reset helper are
// non-async + non-isolated to the action, so they live here.
// Matches the same pattern as `exportLedgerCsv.rate-limit.ts`
// (P6.3 Slice 2).
//
// Why per-user, not per-IP: the durable anti-abuse signal is the
// user's UUID (stable, never changes). An IP key would fail-soft
// for users sharing an office NAT; a user moving IPs shouldn't
// multiply their quota.
//
// STUB-012 covers the move to a Supabase-backed `rate_limit_events`
// table in PH18. v1 is single-instance; this in-process Map is
// correct + simple.

const STEP_SAVE_WINDOW_MS = 60_000 // 60 seconds per spec
const STEP_SAVE_MAX_PER_USER = 60 // 60/min per user per spec

/** In-process per-user step-save counter. Single-instance v1; STUB-012
 *  covers the multi-instance move to a Supabase-backed table. */
const stepSaveTimestamps = new Map<string, number[]>()

/** Pure sliding-window verdict for a single user at a given moment.
 *  Records the attempt when allowed so the next call sees the
 *  updated count. Returns the retry-after seconds when denied. */
export function rateLimitVerdict(
  userId: string,
  nowMs: number,
): {
  allowed: boolean
  retryAfterSeconds: number
  count: number
} {
  const recent = (stepSaveTimestamps.get(userId) ?? []).filter(
    (t) => nowMs - t < STEP_SAVE_WINDOW_MS,
  )
  if (recent.length >= STEP_SAVE_MAX_PER_USER) {
    stepSaveTimestamps.set(userId, recent)
    const oldest = recent[0]!
    const retryAfterMs = STEP_SAVE_WINDOW_MS - (nowMs - oldest)
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      count: recent.length,
    }
  }
  recent.push(nowMs)
  stepSaveTimestamps.set(userId, recent)
  return { allowed: true, retryAfterSeconds: 0, count: recent.length }
}

/** Test-only. Reset the in-process counters between tests. */
export function _resetStepSaveRateLimitForTests(): void {
  stepSaveTimestamps.clear()
}

/** Test-only constants — exported for unit tests + future surfaces
 *  that want the same limits. */
export const STEP_SAVE_RATE_LIMIT_MAX_PER_USER = STEP_SAVE_MAX_PER_USER
export const STEP_SAVE_RATE_LIMIT_WINDOW_MS = STEP_SAVE_WINDOW_MS