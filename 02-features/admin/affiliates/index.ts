// Public surface for the admin affiliates module (P14.6).
//
// Barrel re-export. Server-only modules stay in the `queries/` and
// `actions/` subfolders; the client-safe components live in
// `components/`. Page-level wiring imports from this barrel.

export { AffiliateStatsCards } from './components/AffiliateStatsCards'
export { AffiliateFilters } from './components/AffiliateFilters'
export { AffiliateTable } from './components/AffiliateTable'
export { AffiliatePagination } from './components/AffiliatePagination'

export {
  getAdminAffiliateStats,
  affiliateStatsChips,
} from './queries/getAdminAffiliateStats'

export { getAdminAffiliatesList } from './queries/getAdminAffiliatesList'

export { writeAffiliatesViewAuditLog } from './actions/writeAffiliatesViewAuditLog'

export {
  AFFILIATE_SORT_KEYS,
  AFFILIATE_STATUS_FILTERS,
  AFFILIATE_STATUS_LABEL,
  AFFILIATE_SORT_LABEL,
  DEFAULT_AFFILIATE_SORT,
  DEFAULT_AFFILIATE_PAGE_SIZE,
  MAX_AFFILIATE_PAGE_SIZE,
  EMPTY_AFFILIATE_STATS,
  affiliateFiltersToRpcPayload,
  formatConversionRate,
  parseAffiliateFilters,
} from './types'

export type {
  AffiliateRow,
  AffiliateSortKey,
  AffiliateStats,
  AffiliateStatus,
  AffiliateFiltersInput,
  ParsedAffiliateFilters,
} from './types'

export type { GetAdminAffiliatesListInput } from './queries/getAdminAffiliatesList'