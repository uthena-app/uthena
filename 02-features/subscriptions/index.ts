// Public surface of the subscriptions feature.

export { getSubscriptionForUser, getCurrentSubscription, type SubscriptionRow } from './queries/getSubscriptionForUser'
export { getSubscriberDiscountContext, type DiscountContext } from './queries/getSubscriberDiscountContext'
export {
  calculateCartSubscriberDiscount,
  resolveLineSubscriberBps,
  type CartSubscriberDiscountLine,
  type CartSubscriberDiscountResult,
} from './lib/calculateCartSubscriberDiscount'
export { getRecentInvoices, type RecentInvoice } from './queries/getRecentInvoices'

export { startSubscriptionAction, type StartSubscriptionResult } from './actions/startSubscription'
export { cancelAtPeriodEndAction, type CancelResult } from './actions/cancelAtPeriodEnd'
export { resumeSubscriptionAction, type ResumeResult } from './actions/resumeSubscription'
export { openBillingPortalAction, type PortalResult } from './actions/openBillingPortal'

export {
  onSubscriptionCreated,
  onSubscriptionUpdated,
  onSubscriptionDeleted,
  onInvoiceEvent,
} from './actions/onSubscriptionEvent'

export { SubscriptionStatusCard } from './components/SubscriptionStatusCard'
export { StartSubscriptionCard } from './components/StartSubscriptionCard'
export { RecentInvoices } from './components/RecentInvoices'
export { CancelButton } from './components/CancelButton'
export { ResumeButton } from './components/ResumeButton'
export { ManageInStripeButton } from './components/ManageInStripeButton'
export { StartSubscriptionButton } from './components/StartSubscriptionButton'
export { PastDueBanner } from './components/PastDueBanner'

export { statusLabel, statusColor, formatDate, formatMoney, PLAN_NAME } from './format'
export { PRICING_FEATURES, PRICING_FAQ } from './copy'
export type { PricingFeature, FaqItem } from './copy'
