// filter-options.ts — pure types + constants for the partner ledger
// filters. Lives outside getPartnerLedger.ts so client components
// (LedgerFilters.tsx) can import the type union + value arrays
// without pulling in the server-only query module.
//
// Pattern mirrors P0.5's mobile-nav barrel split: anything that
// mixes client components + server queries needs to keep the
// client-safe types/constants in a separate file. Re-imported
// by both getPartnerLedger.ts (server) and LedgerFilters.tsx
// (client).

export const LEDGER_STATUS_VALUES = [
  'accruing',
  'pending_payout',
  'locked',
  'available',
  'paid',
  'void',
] as const

export const LEDGER_KIND_VALUES = [
  'order_sale',
  'subscription',
  'refund',
  'adjustment',
  'payout',
  'clawback',
] as const

export const LEDGER_SORT_VALUES = ['date', 'amount', 'kind'] as const
export type LedgerSort = (typeof LEDGER_SORT_VALUES)[number]
export type LedgerStatus = (typeof LEDGER_STATUS_VALUES)[number]
export type LedgerKind = (typeof LEDGER_KIND_VALUES)[number]