// exportLedgerCsv.rate-limit.ts — in-process rate limiter for the
// partner CSV export (P6.3 Slice 2). Spec contract: 10/hour/partner
// (`01-specs/pages/instructor-payouts.md` §CSV export rate limiting).
//
// Why a separate module: `'use server'` files in Next.js can only
// export async functions. The Map + the test reset helper are
// non-async + non-isolated to the action, so they live here.
//
// Why per-partner, not per-IP: the durable anti-abuse signal is the
// partner id (numeric, never changes). An IP key would fail-soft
// for partners sharing an office NAT; a partner moving IPs shouldn't
// multiply their quota.
//
// STUB-012 covers the move to a Supabase-backed `rate_limit_events`
// table in PH19 for multi-instance deployments. v1 is single-instance;
// this in-process Map is correct + simple.

import {
  EXPORT_RATE_LIMIT_MAX_PER_PARTNER,
  EXPORT_RATE_LIMIT_WINDOW_MS,
} from './exportLedgerCsv.format'

/** In-process per-partner export counter. Same pattern as
 *  `startImpersonation.ts` — single-instance v1; STUB-012 covers
 *  the multi-instance move. */
const exportTimestamps = new Map<number, number[]>()

export function rateLimitVerdict(
  partnerId: number,
  nowMs: number,
): {
  allowed: boolean
  retryAfterSeconds: number
  count: number
} {
  const recent = (exportTimestamps.get(partnerId) ?? []).filter(
    (t) => nowMs - t < EXPORT_RATE_LIMIT_WINDOW_MS,
  )
  if (recent.length >= EXPORT_RATE_LIMIT_MAX_PER_PARTNER) {
    exportTimestamps.set(partnerId, recent)
    const oldest = recent[0]!
    const retryAfterMs = EXPORT_RATE_LIMIT_WINDOW_MS - (nowMs - oldest)
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      count: recent.length,
    }
  }
  recent.push(nowMs)
  exportTimestamps.set(partnerId, recent)
  return { allowed: true, retryAfterSeconds: 0, count: recent.length }
}

/** Test-only. Reset the in-process counters between tests. */
export function _resetLedgerExportRateLimitForTests(): void {
  exportTimestamps.clear()
}