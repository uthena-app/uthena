// Product feature — barrel for the public surface.
// The product detail page is the single consumer (Phase 0,
// P0.12). Future phases (P12 partner course detail, P7 library
// product detail, P15 LMS course player) may adopt components
// from this barrel — the components are designed to be reusable
// across surfaces.

export { ProductGallery } from './ProductGallery'
export { ProductRatingRow } from './ProductRatingRow'
export { ProductPriceBlock } from './ProductPriceBlock'
export { LicenseSelector } from './LicenseSelector'
export { SubscriberOnlyUpgradeCard } from './SubscriberOnlyUpgradeCard'
export { ProductPerks } from './ProductPerks'
export { ProductCurriculum } from './ProductCurriculum'
export { ProductDescription } from './ProductDescription'
export { ProductInstructor } from './ProductInstructor'
export { ProductReviews } from './ProductReviews'
export { ProductTabs, type ProductTabId } from './ProductTabs'
export { ProductAtAGlance } from './ProductAtAGlance'
export {
  PreviewCurriculumButton,
  PRODUCT_TAB_SWITCH_EVENT,
} from './PreviewCurriculumButton'
export { formatDuration } from './formatDuration'
export { renderTipTap, type JSONContent } from './renderTipTap'