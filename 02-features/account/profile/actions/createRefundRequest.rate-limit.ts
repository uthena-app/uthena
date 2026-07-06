// createRefundRequest.rate-limit.ts — PURE module holding the
// refund-rate-limit in-process state + a test-only reset helper.
//
// Why a sibling file (not co-located with the action)?
//   Next.js `'use server'` files require every export to be an
//   async function. The test suite needs a SYNCHRONOUS reset to
//   call from `beforeEach` — so the reset lives in this non-`use
//   server` module and is re-exported from the action file.
//
// The Map itself is the single source of truth — the action reads
// + writes it, this module owns it. The action does NOT export the
// Map directly; that's intentional — every read/write goes through
// the action's typed helpers so a future migration to Supabase-
// backed rate-limiting is a one-file change.

/**
 * The in-process rate-limit bucket. Keyed by user id (uuid); value
 * is the monotonic timestamps of each accepted refund request in
 * the last 24h. The bucket is module-level so it persists across
 * requests within the same Node process. The P18.8 follow-up
 * migrates this to a Supabase-backed table; until then, the
 * in-process Map is the single source of truth.
 *
 * NB: in a multi-instance deploy, the bucket is per-instance — a
 * user could submit 5 requests × N instances. v1 accepts this; P18.8
 * resolves it.
 */
export const _refundTimestamps = new Map<string, number[]>()

/** Test-only — wipe the entire bucket. Called from
 *  `createRefundRequest.test.ts`'s `beforeEach` so each test starts
 *  with a clean slate (the cron test suite runs many tests in the
 *  same Node process and the rate-limit pollution would otherwise
 *  leak across test boundaries). Production code never calls this. */
export function _resetRefundRateLimitForTests(): void {
  _refundTimestamps.clear()
}