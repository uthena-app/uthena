// parseCheckoutStep.ts — pure URL-param parser for the checkout wizard.
//
// The wizard is URL-driven (P4.7): `?step=email|review|payment|confirmation`.
// Anything else falls back to the first step (email) so a stale URL
// or a typed garbage param lands the user on a sensible screen instead
// of an empty page. The parser is a pure function — no I/O, no DB —
// so it's trivially unit-testable.

export const CHECKOUT_STEPS = ['email', 'review', 'payment', 'confirmation'] as const

export type CheckoutStepId = (typeof CHECKOUT_STEPS)[number]

export type ParsedCheckoutStep = {
  /** The canonical step id (always one of CHECKOUT_STEPS). */
  id: CheckoutStepId
  /** Zero-based index in CHECKOUT_STEPS. */
  index: number
  /** True when the input was missing/garbage; we routed to a fallback. */
  fallback: boolean
}

/**
 * Parse a raw `?step=` value into a canonical `CheckoutStepId`.
 * - `null`, `undefined`, empty string → falls back to 'email'.
 * - Any unknown value → falls back to 'email'.
 * - A canonical id (case-insensitive) → returns it normalized.
 */
export function parseCheckoutStep(raw: string | string[] | undefined): ParsedCheckoutStep {
  const fallbackId: CheckoutStepId = 'email'
  const fallbackIndex = CHECKOUT_STEPS.indexOf(fallbackId)
  if (!raw) {
    return { id: fallbackId, index: fallbackIndex, fallback: true }
  }
  const value = (Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')).toString().trim().toLowerCase()
  if (!value) {
    return { id: fallbackId, index: fallbackIndex, fallback: true }
  }
  const idx = CHECKOUT_STEPS.indexOf(value as CheckoutStepId)
  if (idx < 0) {
    return { id: fallbackId, index: fallbackIndex, fallback: true }
  }
  return { id: value as CheckoutStepId, index: idx, fallback: false }
}

/**
 * URL builder for the next step. Pure helper — keeps the wizard
 * navigation consistent in one place. Returns a relative path with
 * the `?step=` query string already encoded.
 */
export function checkoutStepHref(id: CheckoutStepId): string {
  return `/checkout?step=${encodeURIComponent(id)}`
}