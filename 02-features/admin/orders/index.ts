// Public surface for the admin orders module (P14.7).
//
// Barrel re-export. Server-only modules stay in the `queries/` and
// `actions/` subfolders; the client-safe components live in
// `components/`. Page-level wiring imports from this barrel.

export { OrderStatsCards } from './components/OrderStatsCards'
export { OrderFilters } from './components/OrderFilters'
export { OrderTable } from './components/OrderTable'
export { OrderPagination } from './components/OrderPagination'

export {
  getAdminOrderStats,
  orderStatsChips,
} from './queries/getAdminOrderStats'
export { getAdminOrdersList, DEFAULT_ORDERS_PAGE_SIZE, MAX_ORDERS_PAGE_SIZE } from './queries/getAdminOrdersList'

export { writeOrdersViewAuditLog } from './actions/writeOrdersViewAuditLog'

export {
  ORDER_FILTER_STATUSES,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_KIND,
  EMPTY_ORDER_STATS,
  orderFiltersToRpcPayload,
  parseOrderFilters,
} from './types'

export type {
  OrderRow,
  OrderStats,
  OrderFiltersInput,
  ParsedOrderFilters,
} from './types'

export type { OrderStatus } from '@foundations/data/enums'

export type { GetAdminOrdersListInput } from './queries/getAdminOrdersList'
