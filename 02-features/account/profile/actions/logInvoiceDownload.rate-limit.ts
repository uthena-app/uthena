// logInvoiceDownload.rate-limit.ts — rate-limit helpers for the
// invoice-redirect server action.
//
// Lives in its own file because Next.js's `'use server'` directive
// requires every export from a server-action file to be an `async`
// function. The test-escape hatch `_resetInvoiceDownloadRateLimitForTests`
// is synchronous, so it can't share a file with the async action.
//
// The shape mirrors the in-process sliding window used by the library
// download surface (`00-foundations/files/rate-limit.ts`), scoped per
// user. Per-user buckets reset across server restarts — this is
// defense-in-depth, not the only gate (the shared library rate-limit
// also caps the invoice redirects).

// Per-user rate limit: 60 invoice redirects per hour. Defense-in-depth
// against a stuck client. The page only fires this once per click, so
// the limit only triggers under genuine abuse.
const RATE_LIMIT_MAX = 60
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

// In-process sliding window keyed by user id.
const recentInvoiceDownloadsByUser = new Map<string, number[]>()

export function rateLimitVerdict(userId: string, now: number): {
  allowed: boolean
  remaining: number
  retryAfterMs: number
} {
  const cutoff = now - RATE_LIMIT_WINDOW_MS
  const prior = (recentInvoiceDownloadsByUser.get(userId) ?? []).filter((t) => t > cutoff)
  if (prior.length >= RATE_LIMIT_MAX) {
    // `prior` is non-empty here (length >= RATE_LIMIT_MAX which is 60),
    // but TypeScript can't track that — guard with `?? now` so the
    // expression stays well-typed without a non-null assertion.
    const oldest = prior[0] ?? now
    const retryAfterMs = Math.max(1000, oldest + RATE_LIMIT_WINDOW_MS - now)
    recentInvoiceDownloadsByUser.set(userId, prior)
    return { allowed: false, remaining: 0, retryAfterMs }
  }
  prior.push(now)
  recentInvoiceDownloadsByUser.set(userId, prior)
  return { allowed: true, remaining: RATE_LIMIT_MAX - prior.length, retryAfterMs: 0 }
}

// Test escape hatch — clears the in-process rate-limit bucket for a
// given user so a vitest test can fire multiple calls back-to-back
// without hitting the ceiling. Not exported through index barrel.
export function _resetInvoiceDownloadRateLimitForTests(userId?: string): void {
  if (userId) recentInvoiceDownloadsByUser.delete(userId)
  else recentInvoiceDownloadsByUser.clear()
}

export const INVOICE_DOWNLOAD_RATE_LIMIT_MAX = RATE_LIMIT_MAX