// parseCustomerDetailId.ts — pure helper for validating the customer
// detail route param `/admin/customers/[id]`.
//
// The route param is the customer's `auth.users.id` (a uuid). The
// helper is intentionally strict — non-uuid strings are rejected so
// the page can 404 instead of calling the RPC with garbage.
//
// Pure function. No I/O. Easy to test.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Validates that a string is a well-formed UUID v1-v8 (loose match —
 * the hex-only regex accepts any 8-4-4-4-12 hex string regardless of
 * the version nibble). Returns the canonical lowercase form on
 * success, or null on rejection.
 *
 * Defensive checks:
 *   - empty / non-string → null
 *   - wrong length → null
 *   - non-hex characters → null
 *   - missing dashes → null
 *   - whitespace / CRLF → null
 *   - uppercase normalized to lowercase (returns canonical form)
 *
 * NOTE: we don't validate the version nibble (the 13th hex digit) —
 * Postgres will reject invalid UUIDs at the type layer; the regex
 * just guards shape. A user typing `not-a-uuid` gets a 404 instead
 * of a 500.
 */
export function parseCustomerDetailId(raw: string | null | undefined): string | null {
  if (!raw) return null
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length !== 36) return null
  if (!UUID_RE.test(trimmed)) return null
  return trimmed.toLowerCase()
}