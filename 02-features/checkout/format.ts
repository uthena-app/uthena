// Checkout formatters. Server-safe.

/** Format a YYYY-MM-DD timestamp for the success page header. */
export function formatOrderDate(iso: string, locale = 'en-US'): string {
  try {
    return new Date(iso).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return iso
  }
}

/** Map a license to a short label used in the success page order summary. */
export const LICENSE_SHORT: Record<string, string> = {
  plr: 'PLR',
  mrr: 'MRR',
  rr: 'Resale Rights',
  personal: 'Personal',
}
