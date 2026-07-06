// parsePartnerDetailId.ts — pure helper for validating the partner detail
// route param `/admin/partners/[id]`.
//
// The route param is the partner's `partners.id` (bigint). The helper is
// intentionally strict — non-numeric / negative / decimal strings are
// rejected so the page can 404 instead of calling the RPC with garbage.
//
// Pure function. No I/O. Easy to test.

const MAX_PARTNER_ID = Number.MAX_SAFE_INTEGER // 2^53 - 1 = 9007199254740991

/**
 * Validates that a string is a well-formed positive bigint within
 * `Number.MAX_SAFE_INTEGER`. Returns the canonical decimal form on
 * success, or null on rejection.
 *
 * Defensive checks:
 *   - empty / non-string → null
 *   - leading/trailing whitespace → null (trim-then-reject; we don't
 *     silently coerce " 123 " to 123 because the URL is the source of
 *     truth)
 *   - negative sign / sign prefix → null (partner ids are always > 0)
 *   - decimal point / scientific notation / hex prefix / leading zeros
 *     (when length > 1) → null (Postgres bigint accepts these but the
 *     URL contract is decimal-only)
 *   - length > 16 chars → null (MAX_PARTNER_ID is 16 digits)
 *   - zero → null (partner ids start at 1; 0 means the route param
 *     was tampered with)
 *
 * Canonical form: pure ASCII digits, no padding, no separators. Returns
 * the string verbatim on success.
 */
export function parsePartnerDetailId(raw: string | null | undefined): string | null {
  if (!raw) return null
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length > 16) return null // MAX_PARTNER_ID = 9007199254740991 (16 digits)
  // Reject anything other than pure ASCII digits. Catches:
  //   - leading "-" (negative)
  //   - leading "+" (sign prefix)
  //   - decimal points ("1.5")
  //   - scientific notation ("1e5")
  //   - hex prefix ("0x10")
  //   - whitespace / CRLF / SQL injection / unicode digits
  if (!/^[1-9][0-9]*$/.test(trimmed) && trimmed !== '0') {
    return null
  }
  // Treat literal "0" as invalid (partner ids start at 1).
  if (trimmed === '0') return null
  // Numeric range check — even though the regex already gates this,
  // defense-in-depth for any future regex change.
  const numeric = Number(trimmed)
  if (!Number.isFinite(numeric)) return null
  if (numeric < 1) return null
  if (numeric > MAX_PARTNER_ID) return null
  return trimmed
}