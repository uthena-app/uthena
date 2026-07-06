// Cart display formatters. Server-safe.

import { formatMoney } from '@foundations/money/cents'

/** Human label for the license enum. */
export const LICENSE_LABELS: Record<string, string> = {
  plr: 'PLR',
  mrr: 'MRR',
  rr: 'Resale Rights',
  personal: 'Personal Use',
}

export const LICENSE_DESCRIPTIONS: Record<string, string> = {
  plr: 'Rebrand, edit, resell. Keep 100% of the profit.',
  mrr: 'PLR + Master Resell Rights. Resell the course AND the resell rights.',
  rr: 'Resell Rights. Resell the course, but not the rights to resell.',
  personal: 'Personal use only. No reselling.',
}

/** "PLR + 1 more" style summary for nav badge. */
export function cartCountLabel(count: number): string {
  if (count <= 0) return ''
  if (count === 1) return '1 item'
  return `${count} items`
}

/** Render a cents value as USD. Thin wrapper for terseness in this feature. */
export function usd(cents: number): string {
  return formatMoney(cents, 'USD')
}
