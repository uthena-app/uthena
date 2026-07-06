// Public surface of the admin/partners feature (P14.3 + P14.4).
// The app/admin/partners routes import from `@features/admin/partners`.

export { getAdminPartnerStats } from './queries/getAdminPartnerStats'
export type { PartnerStatsChip } from './queries/getAdminPartnerStats'
export { getAdminPartnersList } from './queries/getAdminPartnersList'
export type { GetAdminPartnersListInput } from './queries/getAdminPartnersList'
export { getAdminPartnerDetail } from './queries/getAdminPartnerDetail'
export type { PartnerDetail } from './queries/getAdminPartnerDetail'
export { parsePartnerDetailId } from './queries/parsePartnerDetailId'
export {
  PARTNER_DETAIL_TABS,
  PARTNER_DETAIL_TAB_LABEL,
  DEFAULT_PARTNER_DETAIL_TAB,
  parsePartnerDetailTab,
} from './queries/parsePartnerDetailTab'
export type { PartnerDetailTab } from './queries/parsePartnerDetailTab'

export { PartnerStatsCards } from './components/PartnerStatsCards'
export { PartnerFilters } from './components/PartnerFilters'
export { PartnerTable } from './components/PartnerTable'
export { PartnerPagination } from './components/PartnerPagination'
export { PartnerDetailTabs } from './components/PartnerDetailTabs'
export { PartnerDetailOverview } from './components/PartnerDetailOverview'
export { ComingSoonTab } from './components/ComingSoonTab'
export { PartnerActionRail } from './components/PartnerActionRail'

export { writePartnersViewAuditLog } from './actions/writePartnersViewAuditLog'
export type { WritePartnersViewAuditLogInput } from './actions/writePartnersViewAuditLog'
export { writePartnerDetailViewAuditLog } from './actions/writePartnerDetailViewAuditLog'
export type { WritePartnerDetailViewAuditLogInput } from './actions/writePartnerDetailViewAuditLog'
export { approvePartnerAction } from './actions/approvePartner'
export type { ApprovePartnerResult } from './actions/approvePartner'
export { suspendPartnerAction } from './actions/suspendPartner'
export type { SuspendPartnerResult } from './actions/suspendPartner'
export { unsuspendPartnerAction } from './actions/unsuspendPartner'
export type { UnsuspendPartnerResult } from './actions/unsuspendPartner'

export {
  PARTNER_STATUS_FILTERS,
  PARTNER_KYC_FILTERS,
  PARTNER_TAX_FORM_FILTERS,
  PARTNER_SORT_KEYS,
  DEFAULT_PARTNER_SORT,
  DEFAULT_PARTNER_PAGE_SIZE,
  MAX_PARTNER_PAGE_SIZE,
  EMPTY_PARTNER_STATS,
  PARTNER_SORT_LABEL,
  PARTNER_STATUS_LABEL,
  PARTNER_KYC_LABEL,
  PARTNER_TAX_FORM_LABEL,
  parsePartnerFilters,
  partnerFiltersToRpcPayload,
} from './types'
export type {
  PartnerStats,
  PartnerRow,
  PartnerSortKey,
  PartnerFiltersInput,
  ParsedPartnerFilters,
  PartnerStatus,
  PartnerKycStatus,
  PartnerTaxFormStatus,
} from './types'