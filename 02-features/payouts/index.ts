// Public surface of the payouts feature.
//
// Client-safe constants/types are re-exported from `filter-options`
// (no `server-only` import). Server-only modules (queries, admin
// actions) are imported under the same paths as before — the
// barrel split keeps client consumers from accidentally pulling
// server-only modules into the browser bundle.

export {
  LEDGER_STATUS_VALUES,
  LEDGER_KIND_VALUES,
  LEDGER_SORT_VALUES,
  type LedgerSort,
  type LedgerStatus,
  type LedgerKind,
} from './filter-options'

export {
  getPartnerLedger,
  type PartnerLedgerResult,
  type LedgerEntry,
  type LedgerSummary,
  type LedgerFilterOptions,
} from './queries/getPartnerLedger'

export {
  getAdminLedger,
  type AdminLedgerResult,
  type AdminLedgerEntry,
} from './queries/getAdminLedger'

// P6.4 — single ledger entry detail with source order + refund join.
export {
  getPartnerLedgerEntry,
  type PartnerLedgerEntryDetail,
  type SourceOrder,
  type SourceRefund,
} from './queries/getPartnerLedgerEntry'

// P6.6 — partner's most-recent pending payout request.
export {
  getPendingPayoutRequest,
  type PendingPayoutRequest,
} from './queries/getPendingPayoutRequest'

// P12.14 — partner payouts history: one row per PayPal Mass Payout
// batch. Reads from the SECURITY DEFINER RPC shipped in migration 0043.
export {
  getPartnerPayoutsHistory,
  DEFAULT_PAYOUT_HISTORY_LIMIT,
  MAX_PAYOUT_HISTORY_LIMIT,
  type PayoutBatch,
} from './queries/getPartnerPayoutsHistory'

// P6.7 Slice 1 — admin's full payout_requests queue (read-only).
export {
  getAdminPayoutRequests,
  AdminPayoutRequestsOptionsSchema,
  type AdminPayoutRequestsOptions,
  type AdminPayoutRequest,
  type AdminPayoutRequestsResult,
} from './queries/getAdminPayoutRequests'

// P14.10 — admin detail page + approve / deny / mark-paid actions.
export {
  getAdminPayoutRequestDetail,
  type AdminPayoutRequestDetail,
} from './queries/getAdminPayoutRequestDetail'

export {
  approvePayoutRequestAction,
  denyPayoutRequestAction,
  markPayoutRequestPaidAction,
  type ApprovePayoutInput,
  type DenyPayoutInput,
  type MarkPaidInput,
  type ApprovePayoutResult,
  type ApproveErrorCode,
} from './actions/approvePayoutRequest'

// P6.8 Slice 1 — admin's per-partner payouts view (full ledger +
// payout requests for ONE partner). Read-only; Slice 2+ (force-
// adjust / clawback) deferred to STUB-058.
export {
  getAdminPartnerPayouts,
  GetAdminPartnerPayoutsOptionsSchema,
  type GetAdminPartnerPayoutsOptions,
  type AdminPartnerInfo,
  type AdminPartnerPayoutsResult,
} from './queries/getAdminPartnerPayouts'

// P7.10 — storage quota display. Pure formatter + server query
// for a single partner's storage usage, broken down per product.
// Admin-only for now (the partner-side self-service surface ships
// with Phase 12 P12.4 — see STUB-068).
export { formatStorageSize } from './lib/formatStorageSize'
export {
  getPartnerStorageUsage,
  GetPartnerStorageUsageOptionsSchema,
  type GetPartnerStorageUsageOptions,
  type PartnerStorageUsage,
  type ProductStorageBreakdown,
} from './queries/getPartnerStorageUsage'

// P6.6 — explicit "request payout" server action + result type + options.
export {
  MIN_PAYOUT_REQUEST_CENTS,
  PAYOUT_TIER_COPY,
  PAYOUT_REQUEST_STATUS_VALUES,
  PAYOUT_METHOD_KIND_VALUES,
  REQUEST_PAYOUT_ERROR_CODES,
  type PayoutRequestStatus,
  type PayoutMethodKind,
  type RequestPayoutErrorCode,
} from './request-options'

export { LedgerRow } from './components/LedgerRow'
export { LedgerSummary as LedgerSummaryCards } from './components/LedgerSummary'
export { LedgerFilters } from './components/LedgerFilters'
export { ExportCsvButton } from './components/ExportCsvButton'
export { RequestPayoutButton } from './components/RequestPayoutButton'
export { LedgerTimeline } from './components/LedgerTimeline'
export { LedgerSourceOrder } from './components/LedgerSourceOrder'
export { LedgerSourceRefund } from './components/LedgerSourceRefund'
export { PayoutRequestQueue } from './components/PayoutRequestQueue'

// P12.14 — partner payouts history table (one row per PayPal Mass
// Payout batch). RSC; no client JS shipped.
export { PayoutsHistoryTable } from './components/PayoutsHistoryTable'

// P6.8 Slice 1 — admin's per-partner detail page RSC. Composes
// the existing primitives (hero + summary cards + ledger list +
// payout requests list). No client JS shipped.
export { AdminPartnerPayouts } from './components/AdminPartnerPayouts'

export {
  LEDGER_KIND_LABEL,
  LEDGER_KIND_CHIP_LABEL,
  LEDGER_STATUS_LABEL,
  LEDGER_STATUS_CHIP_LABEL,
  LEDGER_STATUS_COLOR,
  ORDER_STATUS_LABEL,
  REFUND_REASON_LABEL,
  PAYOUT_REQUEST_STATUS_LABEL,
  PAYOUT_REQUEST_STATUS_COLOR,
  money,
  formatDate,
  formatDateTime,
} from './format'
