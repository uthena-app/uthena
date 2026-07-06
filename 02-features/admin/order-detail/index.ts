// Public surface of the admin/order-detail feature (P14.8).
//
// The /admin/orders/[id] route imports from `@features/admin/order-detail`.
// Pattern mirrors the customer + partner + payout-history admin barrels.

export { getAdminOrderDetail } from './queries/getAdminOrderDetail'
export type { OrderDetail } from './queries/getAdminOrderDetail'

export { getOrderRefunds } from './queries/getOrderRefunds'
export type {
  OrderRefundRow,
  GetOrderRefundsInput,
} from './queries/getOrderRefunds'

export { getOrderEvents } from './queries/getOrderEvents'
export type {
  OrderEventRow,
  GetOrderEventsInput,
} from './queries/getOrderEvents'

export { parseOrderDetailId } from './queries/parseOrderDetailId'
export {
  ORDER_DETAIL_TABS,
  ORDER_DETAIL_TAB_LABEL,
  DEFAULT_ORDER_DETAIL_TAB,
  parseOrderDetailTab,
} from './queries/parseOrderDetailTab'
export type { OrderDetailTab } from './queries/parseOrderDetailTab'

export { OrderDetailTabs } from './components/OrderDetailTabs'
export { OrderDetailOverview } from './components/OrderDetailOverview'

export { writeOrderDetailViewAuditLog } from './actions/writeOrderDetailViewAuditLog'
export type {
  WriteOrderDetailViewAuditLogInput,
} from './actions/writeOrderDetailViewAuditLog'
