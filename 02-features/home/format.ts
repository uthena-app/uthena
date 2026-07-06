// Home page formatting helpers — pure functions, no DB / IO.
// These are exported because some surfaces (e.g. trust strip, footer)
// may want the same number shorteners in a future tick.

/**
 * Paid-out amount in cents → "$2.4M" / "$340K" / "$0" style label.
 *
 * Rules:
 *   < $1,000          → "$X" (whole dollars, no fractional cents)
 *   $1,000–$999,999   → "$X.XK"  (one decimal, e.g. "$12.3K")
 *   $1,000,000+       → "$X.XM"  (one decimal, e.g. "$2.4M")
 *
 * Defensive: returns "$0" for negative or non-finite inputs (the spec
 * guarantees payout_ledger.amount_cents is non-negative, but a typo
 * upstream shouldn't crash the homepage).
 */
export function formatPaidOutShort(amountCents: number): string {
  if (!Number.isFinite(amountCents) || amountCents <= 0) return '$0'
  const dollars = amountCents / 100
  if (dollars < 1000) {
    return `$${Math.round(dollars).toLocaleString('en-US')}`
  }
  if (dollars < 1_000_000) {
    const k = dollars / 1000
    return `$${k.toFixed(1)}K`
  }
  const m = dollars / 1_000_000
  return `$${m.toFixed(1)}M`
}

/**
 * Partner / reseller count → display label.
 *
 * Rules:
 *   0             → "0" (real empty; never masks with a placeholder)
 *   1–99          → "N" (whole number)
 *   100–9,999     → "N.Nk" (one decimal in thousands, e.g. "14.2k")
 *   10,000+       → "Nk" (whole thousands, e.g. "100k", "250k")
 *
 * The label never invents growth: an empty partners table says "0",
 * not "100+". Spec rule: public stats are dynamic, never hard-coded.
 */
export function formatPartnerCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '0'
  if (count < 100) return String(count)
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`
  return `${Math.round(count / 1000)}k`
}

/**
 * Star row — 0..5 → 5 unicode stars with whole-star granularity.
 * Returns '' for nullish / 0 ratings so the parent can `&&` the result.
 */
export function formatStarRow(rating: number | null | undefined): string {
  if (rating == null || !Number.isFinite(rating) || rating <= 0) return ''
  const fullStars = Math.max(0, Math.min(5, Math.round(rating)))
  return '★'.repeat(fullStars) + '☆'.repeat(5 - fullStars)
}
