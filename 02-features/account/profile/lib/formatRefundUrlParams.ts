// parseRefundUrlParams — pure helpers for the /account/orders/[id]/refund/sent
// confirmation page. The page receives `params.id` (the order id) and
// `searchParams.refundId` (the refund id) as raw strings. Both must be
// validated to positive finite integers before the server query runs.
//
// The helpers are pure (no `import 'server-only'`, no I/O) so they're
// trivially unit-testable and the page is a thin composition layer.
//
// Spec: 01-specs/pages/account-refund.md §P9.13 (Refund sent confirmation).
// Companion test: formatRefundUrlParams.test.ts.

/**
 * Parse an `orders.id`-shaped path segment. Returns `null` for any
 * non-finite, non-positive, or non-integer value (defensive against
 * `parseInt('12.5')` → 12, `parseInt('abc')` → NaN, `parseInt('-1')`
 * → -1, `parseInt('0')` → 0, `parseInt('1e3')` → 1, etc.).
 *
 * `parseInt` itself is a leaky abstraction: it returns the integer
 * prefix of the string. We tighten the contract by:
 *   1. Requiring the string to match `/^\d+$/` exactly (digits only,
 *      no leading zeros, no sign, no decimal, no scientific notation).
 *   2. Coercing to `Number()` and re-checking `Number.isInteger`
 *      defensively (a string like `'9007199254740993'` parses fine
 *      but is past `Number.MAX_SAFE_INTEGER` — refuse rather than
 *      silently truncate).
 *   3. Requiring `>= 1` (a refund/order id of 0 is meaningless).
 */
export function parseOrderId(raw: string | undefined | null): number | null {
  return parsePositiveInt(raw)
}

/** Same contract as `parseOrderId` but for `refunds.id`. */
export function parseRefundId(raw: string | undefined | null): number | null {
  return parsePositiveInt(raw)
}

/**
 * Format a refund id as the human-facing reference string rendered
 * on the confirmation page and quoted in support emails: `R-12345`.
 *
 * Defensive: non-finite / non-positive ids collapse to `'R-?'` rather
 * than `'R-NaN'` (which would be embarrassing in a support thread).
 */
export function formatRefundReference(id: number | null | undefined): string {
  if (typeof id !== 'number' || !Number.isFinite(id) || id < 1 || !Number.isInteger(id)) {
    return 'R-?'
  }
  return `R-${id}`
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function parsePositiveInt(raw: string | undefined | null): number | null {
  if (raw == null) return null
  // The strict regex is the first gate. `parseInt('12abc')` returns
  // 12 — we'd rather refuse and force a 404 than accept a tampered
  // URL that happens to start with a digit.
  if (!/^\d+$/.test(raw)) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return null
  // Reject anything past MAX_SAFE_INTEGER. The order/refund ids are
  // bigint in the DB but PostgREST + JS always cross as numbers, so
  // we accept up to 2^53 - 1. Beyond that, a tampered URL could
  // silently collapse two distinct ids into the same number.
  if (n > Number.MAX_SAFE_INTEGER) return null
  return n
}
