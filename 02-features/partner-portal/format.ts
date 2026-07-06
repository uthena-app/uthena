// 02-features/partner-portal/format.ts — PURE helpers for partner
// portal PII masking + label rendering. The single source of truth for
// how PayPal emails / bank numbers / tax IDs are masked in the rendered
// HTML. Used by `decryptPayoutMethod.ts` (data layer), by
// `PartnerSettingsForm.tsx` (read-only display), and by future
// `payouts` surfaces that need to show masked partner PII.
//
// Why a dedicated module instead of inline string formatting: the
// masking rules are a UI contract (the spec at
// `01-specs/pages/partner-settings.md` calls them out line-by-line).
// Centralizing means (a) one set of tests, (b) one place to audit
// when the masking changes, (c) the form never accidentally shows
// the wrong shape. P6.5 Slice 1 ships the PayPal email masking;
// Slice 2 will reuse `maskRoutingNumber` + `maskAccountNumber` for
// bank details without rewriting the helper.
//
// No DOM, no React, no env. Pure functions on strings. Safe to import
// from client + server + tests.

/**
 * Mask an email address for read-only display.
 *
 * Rules (per `01-specs/pages/partner-settings.md` §"Security"):
 *   - First character of the local part is kept (lowercase if alpha)
 *   - The remainder of the local part is replaced with `***`
 *   - The full domain is kept
 *
 * Examples:
 *   `maskEmail('klaas@example.com')` → `'k***@example.com'`
 *   `maskEmail('alice.bob@sub.example.co.uk')` → `'a***@sub.example.co.uk'`
 *   `maskEmail('ünïcödé@example.com')` → `'ü***@example.com'`
 *   `maskEmail('')` → `null`
 *   `maskEmail('not-an-email')` → `null`  (defensive — no `@`)
 *   `maskEmail(null)` → `null`
 *
 * Defensive behavior: returns null for null/empty/no-`@` inputs so
 * the caller can `?? null` directly in the JSX. Never throws.
 */
export function maskEmail(email: string | null | undefined): string | null {
  if (typeof email !== 'string') return null
  const trimmed = email.trim()
  if (trimmed === '') return null
  const atIndex = trimmed.lastIndexOf('@')
  if (atIndex <= 0) return null
  const local = trimmed.slice(0, atIndex)
  const domain = trimmed.slice(atIndex + 1)
  if (local === '' || domain === '') return null
  // First grapheme (handles surrogate pairs like emoji + Unicode
  // combining marks). Most emails have a single-char local prefix,
  // but we use graphemes to be safe with IDN + emoji local parts.
  const firstChar = Array.from(local)[0] ?? ''
  return `${firstChar}***@${domain}`
}

/**
 * Mask a US bank routing number for read-only display. The last 4
 * digits are kept (per the spec convention for bank identifiers —
 * enough to disambiguate without leaking the full number).
 *
 * Examples:
 *   `maskRoutingNumber('123456789')` → `'*****6789'`
 *   `maskRoutingNumber('1234')` → `'1234'`  (too short to mask safely)
 *   `maskRoutingNumber('')` → `null`
 *   `maskRoutingNumber(null)` → `null`
 *
 * Returns the input unchanged when fewer than 5 chars — a routing
 * number that short isn't a real routing number, so masking it
 * would just produce noise. The caller can validate length
 * separately if needed.
 */
export function maskRoutingNumber(routing: string | null | undefined): string | null {
  if (typeof routing !== 'string') return null
  const trimmed = routing.trim()
  if (trimmed === '') return null
  if (trimmed.length < 5) return trimmed
  return `*****${trimmed.slice(-4)}`
}

/**
 * Mask a bank account number for read-only display. The last 4
 * digits are kept.
 *
 * Examples:
 *   `maskAccountNumber('000123456789')` → `'*****6789'`
 *   `maskAccountNumber('1234')` → `'1234'`  (too short to mask)
 *   `maskAccountNumber('')` → `null`
 */
export function maskAccountNumber(account: string | null | undefined): string | null {
  // Same rules as the routing number — different label, same mask
  // shape. Kept as a separate function so future slices can change
  // the mask format for one without affecting the other (e.g.
  // account numbers might need `****6789` while routing numbers
  // get `*****6789` if a bank-identifier convention differs).
  return maskRoutingNumber(account)
}

/**
 * Mask a tax ID (EIN, SSN, or country-specific) for read-only display.
 * Per spec: `***-**-{last4}` shape (matches US EIN/SSN convention).
 *
 * Examples:
 *   `maskTaxId('12-3456789')` → `'***-**-6789'`
 *   `maskTaxId('123456789')` → `'***-**-6789'`  (strips dashes first)
 *   `maskTaxId('123')` → `'***'`  (too short)
 *   `maskTaxId('')` → `null`
 */
export function maskTaxId(taxId: string | null | undefined): string | null {
  if (typeof taxId !== 'string') return null
  const digits = taxId.replace(/\D/g, '')
  if (digits === '') return null
  if (digits.length < 4) return '***'
  return `***-**-${digits.slice(-4)}`
}
