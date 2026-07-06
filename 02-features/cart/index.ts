// Public surface of the cart feature. Consumers import from
// `@features/cart` (or `@features/cart/...` for nested paths).

export { getCart, type CartLine } from './queries/getCart'
export { getCartCount } from './queries/getCartCount'
export { getCartSubtotalCents } from './queries/getCartSubtotal'
export { getAuthCartLastActivity } from './queries/getCartLastActivity'
export { getAppliedCoupon, type AppliedCoupon } from './queries/getAppliedCoupon'

export {
  addToCartAction,
  type AddToCartResult,
} from './actions/addToCart'
export { updateLicenseAction, type UpdateLicenseResult } from './actions/updateLicense'
export { updateQuantityAction } from './actions/updateQuantity'
export { removeLineAction } from './actions/removeLine'
export { clearCartAction } from './actions/clearCart'
export { applyCouponAction, type ApplyCouponResult } from './actions/applyCoupon'
export { removeCouponAction, type RemoveCouponResult } from './actions/removeCoupon'
export { mergeAnonCartIntoAuth, type MergeResult } from './actions/mergeAnonCart'

export { AddToCartButton } from './components/AddToCartButton'
export { CartLineRow, type CartLineRowProps } from './components/CartLineRow'
export { CartLineControls } from './components/CartLineControls'
export { CartSummary } from './components/CartSummary'
export { CartDrawer } from './components/CartDrawer'
export { CartExpirationBanner } from './components/CartExpirationBanner'
export { CartTrigger } from './components/CartTrigger'
export { CouponForm } from './components/CouponForm'
export { ClearCartButton } from './components/ClearCartButton'
export { EmptyCartState } from './components/EmptyCartState'

export {
  CART_OPEN_EVENT,
  CART_CHANGED_EVENT,
  type CartChangedDetail,
} from './cartEvents'

export {
  CART_IDLE_DAYS_BEFORE_EXPIRY,
  CART_IDLE_DAYS_BEFORE_ABANDONMENT,
  CART_WARN_DAYS_BEFORE_EXPIRY,
  formatExpiryWarning,
  getAnonCartLastActivity,
  getCartExpirationStatus,
  isCartExpired,
  isInCartExpirationWarnWindow,
  isPastAbandonmentThreshold,
  type CartExpirationStatus,
} from './cartExpiration'

export {
  buildAbandonedEventProps,
  groupAbandonedRowsByUser,
  type AbandonedRow,
  type AbandonedAggregate,
} from './cartAbandonment'

export { LICENSE_LABELS, LICENSE_DESCRIPTIONS, cartCountLabel, usd } from './format'
