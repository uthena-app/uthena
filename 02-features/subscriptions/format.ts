// Subscription display formatters. Server-safe.
//
// `formatMoney` here is a thin adapter over the canonical
// `00-foundations/money/cents.ts` helper. The wrapper handles two
// things the canonical one doesn't:
//
//   1. Stripe invoices return currency as a lowercase ISO 4217 code
//      (e.g. 'usd', 'eur'). The canonical helper takes the strict
//      `Currency = 'USD' | 'EUR' | 'GBP'` union; we uppercase + fall
//      back to USD if Stripe ever returns an unsupported code.
//   2. Nullish `currency` defaults to 'usd' (Stripe's convention),
//      not the canonical helper's 'USD' default — preserving the
//      existing call-site shape so callers don't break.
//
// Don't add more helpers here. If you find yourself reaching for
// another formatter, put it in `00-foundations/money/cents.ts` and
// re-export it from here if subscriptions needs it.

import { formatMoney as formatMoneyCents } from '@foundations/money/cents'
import type { Currency } from '@foundations/money/cents'

const SUPPORTED_CURRENCIES: ReadonlySet<string> = new Set(['USD', 'EUR', 'GBP'])

const STATUS_LABELS: Record<string, string> = {
  incomplete: 'Incomplete',
  incomplete_expired: 'Expired',
  trialing: 'Trialing',
  active: 'Active',
  past_due: 'Past due',
  canceled: 'Canceled',
  unpaid: 'Unpaid',
  paused: 'Paused',
}

const STATUS_COLORS: Record<string, 'success' | 'warn' | 'danger' | 'mute'> = {
  incomplete: 'warn',
  incomplete_expired: 'mute',
  trialing: 'success',
  active: 'success',
  past_due: 'warn',
  canceled: 'mute',
  unpaid: 'danger',
  paused: 'warn',
}

export function statusLabel(status: string | null | undefined): string {
  if (!status) return 'None'
  return STATUS_LABELS[status] ?? status
}

export function statusColor(
  status: string | null | undefined,
): 'success' | 'warn' | 'danger' | 'mute' {
  if (!status) return 'mute'
  return STATUS_COLORS[status] ?? 'mute'
}

export function formatDate(iso: string | null | undefined, locale = 'en-US'): string {
  if (!iso) return '—'
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

/**
 * Thin adapter over the canonical money helper. See file header for why
 * this wrapper exists instead of re-exporting directly.
 */
export function formatMoney(
  cents: number,
  currency: string = 'usd',
  locale: string = 'en-US',
): string {
  const upper = (currency ?? 'usd').toUpperCase()
  const safe: Currency = SUPPORTED_CURRENCIES.has(upper) ? (upper as Currency) : 'USD'
  return formatMoneyCents(cents, safe, locale)
}

export const PLAN_NAME = 'Personal Access'