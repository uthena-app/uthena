// ensureDefaultLinkAction.rate-limit.ts — pure per-user sliding-
// window rate limit for `ensureDefaultLinkAction`.
//
// Separated from the action file because Next.js `'use server'`
// files may only export async functions — the verdict helper is
// pure + synchronous, so it lives here.
//
// **Why per-user, not per-IP or per-affiliate-id**: the spec says
// `ensureDefaultLink — idempotent, 5/min/user`. The user-id scope
// matches (1) the `requireRole(['affiliate'])` gate, (2) the
// audit-log identity shape, and (3) the existing in-process
// rate-limit pattern used by `exportLedgerCsv.rate-limit.ts` and
// `saveStep.rate-limit.ts`.
//
// **Why not Supabase-backed**: this is the same canonical helper
// shape as the per-user rate-limit used in P6.3 + P12.2 + P13.1.
// All three are in-process by design (single-server local dev +
// single-region Coolify deploy). STUB-110 Slice 5 file the
// migration if/when v2 multi-link flow forces the rate-limit to
// cross-region scope.

type RateLimitInput = {
  userId: string
  /** Window length in ms. */
  windowMs: number
  /** Max hits permitted inside the window. */
  max: number
  /** Test-only injection point. Defaults to Date.now(). */
  now?: number
}

export type RateLimitVerdict = { allowed: boolean; retryAfterMs: number }

/** Per-user sliding-window store. Module-scoped so the state
 *  survives across calls in the same process. A weakmap keyed by
 *  user id holds a list of hit timestamps; `verdict` prunes hits
 *  older than `windowMs` and decides allowed/denied based on the
 *  remaining hit count. */
const HITS = new Map<string, number[]>()

/** Pure verdict — `HITS.set/has` mutations are the only side
 *  effects; verdict-time has no I/O. */
export function rateLimitVerdict(input: RateLimitInput): RateLimitVerdict {
  const now = input.now ?? Date.now()
  const cutoff = now - input.windowMs
  const userKey = input.userId
  const existing = HITS.get(userKey) ?? []
  // Prune hits older than the sliding window.
  const fresh = existing.filter((t) => t > cutoff)
  if (fresh.length >= input.max) {
    const oldest = fresh[0] ?? now
    const retryAfterMs = Math.max(0, oldest + input.windowMs - now)
    // Persist the pruned state so the next call sees the
    // post-prune window.
    HITS.set(userKey, fresh)
    return { allowed: false, retryAfterMs }
  }
  fresh.push(now)
  HITS.set(userKey, fresh)
  return { allowed: true, retryAfterMs: 0 }
}

/** Test-only reset hook. Wipes ALL per-user state. Used by
 *  `ensureDefaultLinkAction.test.ts` between test cases so each
 *  case starts from a clean window. Not exported from the
 *  barrel. */
export function _resetEnsureDefaultLinkRateLimitForTests(): void {
  HITS.clear()
}
