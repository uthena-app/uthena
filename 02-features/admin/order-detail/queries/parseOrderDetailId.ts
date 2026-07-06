// parseOrderDetailId.ts — pure helper for validating the route param
// on `/admin/orders/[id]`.
//
// The route param is `orders.id` (a bigint from `bigserial`). The
// helper is intentionally strict — non-numeric strings are rejected so
// the page can 404 instead of calling the RPC with garbage.
//
// Pure function. No I/O. Easy to unit-test.

/**
 * Validates that a string is a well-formed positive bigint in the
 * canonical short-decimal form. Returns the canonical bigint-as-string
 * on success, or null on any rejection.
 *
 * Defensive checks:
 *   - empty / non-string → null
 *   - whitespace / CRLF → null (trim before checking)
 *   - decimal (`.5`, `1.0`) → null
 *   - signed (`+`, `-`) → null (orders are positive bigserial)
 *   - leading zeros (`007`) → null (Postgres accepts them but we
 *     canonicalize to the bare form)
 *   - scientific notation (`1e3`) → null
 *   - hex / unicode-digit confusables → null
 *   - oversized (> 18 digits, > Number.MAX_SAFE_INTEGER) → null
 *   - exceeds Postgres bigint max (9223372036854775807) → null
 *
 * NOTE: Postgres will reject invalid bigints at the type layer; the
 * regex + parser here just guard shape so the caller can 404 cleanly
 * on `/admin/orders/foo` instead of crashing inside the RPC.
 */
export function parseOrderDetailId(raw: string | null | undefined): string | null {
  if (!raw) return null
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  // Postgres bigint max is 9223372036854775807 (19 digits); reject
  // anything longer outright so we don't pay the BigInt() cost.
  if (trimmed.length > 19) return null
  if (trimmed.length > 1 && trimmed.startsWith('0')) return null
  // Bare-decimal positive integer, optionally 1-19 digits. Values
  // within 1-18 digits always fit in Postgres bigint; the 19-digit
  // case (only the Postgres-max value itself) passes the regex and
  // gets accepted/rejected by the BigInt range check below.
  if (!/^[1-9][0-9]{0,18}$/.test(trimmed)) return null
  // Range check — Postgres bigint max is 9223372036854775807.
  // We compare as bigint via BigInt so values above MAX_SAFE_INTEGER
  // (which Number can't precisely represent) are still rejected.
  try {
    const n = BigInt(trimmed)
    if (n <= 0n) return null
    if (n > BigInt('9223372036854775807')) return null
  } catch {
    return null
  }
  return trimmed
}
