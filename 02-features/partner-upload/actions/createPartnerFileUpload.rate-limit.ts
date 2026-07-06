// createPartnerFileUpload.rate-limit.ts — sliding-window per-partner
// rate limiter for the createPartnerFileUpload server action.
//
// P12.8 Slice 1 ships the row-create action. Each call inserts a
// partner_uploads row + may mint a Bunny session + writes an audit
// log row. The limit (60/min/partner) is intentionally generous —
// partners uploading a 30-GB video course legitimately need a
// dozen or more creates per minute when they queue multiple files
// in parallel — but it's bounded so a misbehaving client can't
// spam the partner_uploads table.
//
// Slice 1 uses an in-process Map. Slice 2/3 will lift this to the
// Supabase-backed rate-limit table the P18.8 cron maintains (the
// same table P1.2, P9.2, and P11 use).

import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'partner-upload.pipeline' })

/** Hard ceiling — a partner can't create more than this many
 *  partner_uploads rows in a 60-second window. */
export const CREATE_UPLOAD_RATE_LIMIT_MAX_PER_PARTNER = 60
export const CREATE_UPLOAD_RATE_LIMIT_WINDOW_MS = 60_000

const _rateBuckets = new Map<string, number[]>()

export type CreateUploadRateLimitVerdict =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSeconds: number }

/** Pure-of-side-effects verifier — caller is responsible for the
 *  recording step after a successful create (the verify-then-record
 *  order prevents denied requests from being tallied). */
export function rateLimitCheck(opts: {
  partnerId: string
  nowMs?: number
}): CreateUploadRateLimitVerdict {
  const now = opts.nowMs ?? Date.now()
  const bucket = _rateBuckets.get(opts.partnerId) ?? []
  // Evict entries older than the window.
  const recent = bucket.filter((ts) => now - ts < CREATE_UPLOAD_RATE_LIMIT_WINDOW_MS)
  if (recent.length >= CREATE_UPLOAD_RATE_LIMIT_MAX_PER_PARTNER) {
    const oldest = recent[0]!
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((CREATE_UPLOAD_RATE_LIMIT_WINDOW_MS - (now - oldest)) / 1000),
    )
    return { ok: false, retryAfterSeconds }
  }
  // Don't record yet — the caller records after the create succeeds.
  return { ok: true, remaining: CREATE_UPLOAD_RATE_LIMIT_MAX_PER_PARTNER - recent.length }
}

/** Record a successful create against the bucket. Call ONLY after the
 *  create succeeded — denied requests must not consume budget (the
 *  same pattern as the other rate-limit helpers in this codebase). */
export function rateLimitRecord(opts: { partnerId: string; nowMs?: number }): void {
  const now = opts.nowMs ?? Date.now()
  const bucket = _rateBuckets.get(opts.partnerId) ?? []
  const recent = bucket.filter((ts) => now - ts < CREATE_UPLOAD_RATE_LIMIT_WINDOW_MS)
  recent.push(now)
  _rateBuckets.set(opts.partnerId, recent)
}

/** Test-only — wipe the in-process map. Exposed for the suite's
 *  `beforeEach`. */
export function _resetCreateUploadRateLimitForTests(): void {
  _rateBuckets.clear()
}

/** Diagnostic summary for the partner-upload ops dashboard (future
 *  P12.x territory). PII-safe: only the partner_id hash + counts;
 *  never the partner's email or filename. */
export function rateLimitBucketSnapshot(partnerId: string): { count: number } {
  log.debug({ code: 'rate_limit_snapshot', partner_id_hash: 'computed-later' }, 'snapshot')
  const bucket = _rateBuckets.get(partnerId) ?? []
  const now = Date.now()
  const recent = bucket.filter((ts) => now - ts < CREATE_UPLOAD_RATE_LIMIT_WINDOW_MS)
  return { count: recent.length }
}
