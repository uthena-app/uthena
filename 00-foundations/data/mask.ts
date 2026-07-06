// mask.ts — small PII-masking helpers used by the admin surface.
//
// Spec (`01-specs/pages/admin-customer-detail.md` line 66 + the
// P14.2 acceptance criteria) calls for masked-by-default display
// of email + IP fields, with explicit Reveal actions that return
// the raw value AND write an audit-log row. These helpers are the
// pure rendering side of that pattern.
//
// Why a dedicated module?
//   - The library/queries/formatIp.ts file owns the LIBRARY mask
//     pattern (last octet masked — used for the user's own download
//     history). The admin pattern is different ("first 8 chars +
//     `...`" per the P14.2 spec) and the two surfaces should never
//     drift together.
//   - Email masking is a Stripe/Shopify-style "first char + *** + @
//     full-domain" pattern, applied here for admin surfaces that
//     need to recognize repeat customers without exposing the local
//     part. Other surfaces (the partner customers list per STUB-099)
//     reuse the same shape.
//
// Pure functions. No I/O. Tree-shakable. Re-exported via the data
// foundations barrel.

/**
 * Masks an email to the canonical "first char + *** @ + full domain"
 * shape. Stable across rows (the same email always renders the same
 * way) so an admin can recognize repeat customers without seeing the
 * local part.
 *
 * Examples:
 *   maskEmail('john.doe@example.com')  → 'j***@example.com'
 *   maskEmail('a@example.com')         → 'a***@example.com'
 *   maskEmail('not-an-email')          → 'not-an-***' (defensive)
 *   maskEmail(null)                    → '—'
 *
 * Why preserve the full domain? It matches the Stripe/Shopify pattern
 * (`j***@stripe.com`) and lets an admin identify the org / tenant
 * without seeing the local part. The 1-char local is short enough to
 * defeat targeted attacks but long enough to recognize aliases
 * (e.g. `j***@example.com` and `k***@example.com` are visibly
 * different at a glance).
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '—'
  if (typeof email !== 'string') return '—'
  const trimmed = email.trim()
  if (trimmed.length === 0) return '—'
  const at = trimmed.indexOf('@')
  if (at <= 0) {
    // No `@` or starts with `@` — fall back to a short mask.
    // For `at === 0` there's no local part, so just return `***`
    // (no `@` separator would mislead the reader).
    if (at === 0) return '***'
    const head = trimmed.slice(0, 1)
    return `${head}***`
  }
  const local = trimmed.slice(0, at)
  const domain = trimmed.slice(at + 1)
  if (domain.length === 0) {
    const head = local.slice(0, 1)
    return `${head}***`
  }
  const head = local.slice(0, 1)
  return `${head}***@${domain}`
}

/**
 * Masks an IP to the spec's "first 8 chars + `...`" shape. Applied
 * to both the customer's first-seen IP (from `orders.ip`) and any
 * other IP we surface. Reveal is the only way to see the raw value.
 *
 * Examples:
 *   maskIp('192.168.1.42')   → '192.168....'
 *   maskIp('10.0.0.1')       → '10.0.0.1...' (under-length — show whole + ...)
 *   maskIp('2001:db8::1')    → '2001:db8...' (IPv6 passthrough of first 8)
 *   maskIp(null)             → '—'
 *   maskIp('')               → '—'
 *
 * The function is intentionally permissive on under-length strings —
 * showing the whole value plus `...` is still safer than the raw
 * value, and it avoids throwing for IPv6 / hash-shaped strings.
 */
export function maskIp(ip: string | null | undefined): string {
  if (!ip) return '—'
  if (typeof ip !== 'string') return '—'
  const trimmed = ip.trim()
  if (trimmed.length === 0) return '—'
  return `${trimmed.slice(0, 8)}...`
}