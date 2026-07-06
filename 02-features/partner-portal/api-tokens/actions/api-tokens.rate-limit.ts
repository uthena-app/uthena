// 02-features/partner-portal/api-tokens/actions/api-tokens.rate-limit.ts
//
// In-process sliding-window rate limiter for the partner API tokens
// surface (P12.19).
//
// Two scopes (per `01-specs/pages/partner-settings-api.md` §"Acceptance
// criteria"):
//   - Create: max 5 per partner per hour (defense against token-spam)
//   - List:   max 100 per partner per hour (cheap defense against
//             page-load amplification)
//
// The actual counting is the same Map<string, number[]> shape used
// by `saveUploadDraft.rate-limit.ts` (P12.7) +
// `exportLedgerCsv.rate-limit.ts` (P6.3) + `saveStep.rate-limit.ts`
// (P12.2) — same pattern, different buckets. Each tuple is keyed by
// the user id + the bucket ("create" / "list") so the two counters
// are isolated.
//
// Why a separate file: Next.js `'use server'` files can only export
// async functions. The Map + the test reset helper are sync, so they
// live here and the actions re-import the verdict function.
//
// Why per-user: the durable anti-abuse signal is the user's UUID
// (stable, never changes). Per-IP would fail-soft for shared NATs
// and would multiply quota when a user switches networks.
//
// Why per-user AND per-bucket (create vs list): the create action's
// ceiling (5/hr) is far below the list action's ceiling (100/hr);
// sharing a single counter would let a list loop starve the create
// budget (or vice versa). Two independent Map keys per user keeps
// the contracts honest.
//
// STUB-012 covers the move to a Supabase-backed `rate_limit_events`
// table in PH18. v1 is single-instance; this in-process Map is
// correct + simple. The same future migration lifts all of the
// existing per-feature rate limiters + this one.

import {
  API_TOKEN_CREATE_RATE_LIMIT_MAX_PER_PARTNER,
  API_TOKEN_CREATE_RATE_LIMIT_WINDOW_MS,
  API_TOKEN_LIST_RATE_LIMIT_MAX_PER_PARTNER,
  API_TOKEN_LIST_RATE_LIMIT_WINDOW_MS,
} from '../constants'

/** Tuple of (userId, bucket) → ascending timestamp list. */
type BucketKey = `${string}::${'create' | 'list'}`

const buckets = new Map<BucketKey, number[]>()

/** Pure sliding-window verdict for one (user, bucket) at `nowMs`. */
function verdictFor(
  userId: string,
  bucket: 'create' | 'list',
  nowMs: number,
  max: number,
  windowMs: number,
): { allowed: boolean; retryAfterSeconds: number; count: number } {
  const key: BucketKey = `${userId}::${bucket}`
  const recent = (buckets.get(key) ?? []).filter((t) => nowMs - t < windowMs)
  if (recent.length >= max) {
    buckets.set(key, recent)
    const oldest = recent[0]!
    const retryAfterMs = windowMs - (nowMs - oldest)
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      count: recent.length,
    }
  }
  recent.push(nowMs)
  buckets.set(key, recent)
  return { allowed: true, retryAfterSeconds: 0, count: recent.length }
}

/** Verdict for the CREATE bucket. */
export function createRateLimitVerdict(
  userId: string,
  nowMs: number = Date.now(),
): { allowed: boolean; retryAfterSeconds: number; count: number } {
  return verdictFor(
    userId,
    'create',
    nowMs,
    API_TOKEN_CREATE_RATE_LIMIT_MAX_PER_PARTNER,
    API_TOKEN_CREATE_RATE_LIMIT_WINDOW_MS,
  )
}

/** Verdict for the LIST bucket. */
export function listRateLimitVerdict(
  userId: string,
  nowMs: number = Date.now(),
): { allowed: boolean; retryAfterSeconds: number; count: number } {
  return verdictFor(
    userId,
    'list',
    nowMs,
    API_TOKEN_LIST_RATE_LIMIT_MAX_PER_PARTNER,
    API_TOKEN_LIST_RATE_LIMIT_WINDOW_MS,
  )
}

/** Test-only. Reset both buckets between tests. */
export function _resetApiTokensRateLimitForTests(): void {
  buckets.clear()
}