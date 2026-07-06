// 02-features/account/profile — the user's self-edit profile, settings,
// orders, refunds surface. The "profile" module name is a legacy
// from PH10a; the whole account-area feature lives here.
//
// Owner: Mavis.
// Touch points:
//   - 03-app/account/profile/page.tsx
//   - 03-app/account/settings/page.tsx
//   - 03-app/account/orders/page.tsx + [id] + [id]/refund + [id]/refund/sent
//   - 04-platform/migrations/0010_delete_my_account_rpc.sql
export * from './components/ProfileForm'
export * from './components/DeleteAccountModal'
export * from './components/EmailVerifyBadge'
export * from './components/AvatarUploader'
export * from './components/RefundProofUploader'
export * from './components/AuditStrip'
export * from './components/SettingsForm'
export * from './components/SessionsSection'
export * from './components/OrdersList'
export * from './components/OrderDetail'
export * from './components/StatusBadge'
export * from './components/RefundForm'
export * from './components/ReviewsSection'
export { getMyProfile } from './queries/getMyProfile'
export { getMemberSince } from './queries/getMemberSince'
export { getMySettings } from './queries/getMySettings'
export { getMySessions } from './queries/getMySessions'
export { getMyOrders } from './queries/getMyOrders'
export { getMyOrderDetail } from './queries/getMyOrderDetail'
export { getOrderForRefund } from './queries/getOrderForRefund'
export { getRefundConfirmation } from './queries/getRefundConfirmation'
export { formatRefundReference, parseOrderId, parseRefundId } from './lib/formatRefundUrlParams'
export { getMyReviews, getReviewableProducts } from './queries/getMyReviews'
export { formatTimeAgo } from './queries/formatTimeAgo'
export { updateProfileAction } from './actions/updateProfile'
export { requestAvatarUploadAction } from './actions/requestAvatarUpload'
export { deleteMyAccountAction } from './actions/deleteMyAccount'
export { resendVerificationEmailAction } from './actions/resendVerificationEmail'
export {
  updateNotificationPrefsAction,
  updateLocaleAndTimezoneAction,
} from './actions/updateSettings'
export {
  signOutCurrentSessionAction,
  signOutEverywhereAction,
  signOutSessionByIdAction,
} from './actions/sessionActions'
export { createRefundRequestAction } from './actions/createRefundRequest'
export { requestRefundProofUploadAction } from './actions/requestRefundProofUpload'
export {
  createReviewAction,
  updateReviewAction,
  deleteReviewAction,
} from './actions/reviewActions'
export { writeSelfAuditLog } from './actions/writeSelfAuditLog'
export { useBlocker } from './lib/hooks/useBlockerShim'
export type { ProfileEditable, ProfileWithEmail } from './types'
export type { MySettings } from './queries/getMySettings'
export type { SessionInfo, MySessions } from './queries/getMySessions'
export type { OrderListResult, OrderListFilters, OrderRow, OrderStatus } from './queries/getMyOrders'
export type { OrderDetail } from './queries/getMyOrderDetail'
export type { RefundEligibility } from './queries/getOrderForRefund'
export type { RefundConfirmation } from './queries/getRefundConfirmation'
export type { RefundProofUploadResult } from './components/RefundProofUploader'
export type { MyReview, ReviewableProduct } from './queries/getMyReviews'
