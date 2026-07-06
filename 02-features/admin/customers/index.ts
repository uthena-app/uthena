// Public surface of the admin/customers feature (P14.1 + P14.2).
// The app/admin/customers route imports from `@features/admin/customers`.

export { getAdminCustomerStats } from './queries/getAdminCustomerStats'
export type { StatsChip } from './queries/getAdminCustomerStats'
export { getAdminCustomersList } from './queries/getAdminCustomersList'
export type { GetAdminCustomersListInput } from './queries/getAdminCustomersList'
export { getAdminCustomerDetail } from './queries/getAdminCustomerDetail'
export type { CustomerDetail } from './queries/getAdminCustomerDetail'
export { parseCustomerDetailId } from './queries/parseCustomerDetailId'
export {
  CUSTOMER_DETAIL_TABS,
  CUSTOMER_DETAIL_TAB_LABEL,
  DEFAULT_CUSTOMER_DETAIL_TAB,
  parseCustomerDetailTab,
} from './queries/parseCustomerDetailTab'
export type { CustomerDetailTab } from './queries/parseCustomerDetailTab'

export { CustomerStatsCards } from './components/CustomerStatsCards'
export { CustomerFilters } from './components/CustomerFilters'
export { CustomerTable } from './components/CustomerTable'
export { CustomerPagination } from './components/CustomerPagination'
export { RiskScoreBadge } from './components/RiskScoreBadge'
export { CustomerDetailTabs } from './components/CustomerDetailTabs'
export { CustomerDetailOverview } from './components/CustomerDetailOverview'
export { ComingSoonTab } from './components/ComingSoonTab'

export { writeCustomersViewAuditLog } from './actions/writeCustomersViewAuditLog'
export type { WriteCustomersViewAuditLogInput } from './actions/writeCustomersViewAuditLog'
export { writeCustomerDetailViewAuditLog } from './actions/writeCustomerDetailViewAuditLog'
export type { WriteCustomerDetailViewAuditLogInput } from './actions/writeCustomerDetailViewAuditLog'

export {
  CUSTOMER_ROLE_FILTERS,
  CUSTOMER_STATUS_FILTERS,
  CUSTOMER_SORT_KEYS,
  DEFAULT_CUSTOMER_SORT,
  DEFAULT_CUSTOMER_PAGE_SIZE,
  MAX_CUSTOMER_PAGE_SIZE,
  EMPTY_CUSTOMER_STATS,
  RISK_BAND_LABEL,
  parseCustomerFilters,
  filtersToRpcPayload,
  riskScoreBand,
} from './types'
export type {
  CustomerStats,
  CustomerRow,
  CustomerStatusFilter,
  CustomerRoleFilter,
  CustomerSortKey,
  CustomerFiltersInput,
  ParsedCustomerFilters,
  RiskScoreBand,
} from './types'