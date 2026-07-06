// Home feature — barrel for the server-facing public API.
// Server components + the server-only queries live here.
//
// Note: the NewsletterBand used to live in this folder and was
// re-exported here. P0.11 moved it to its own module
// (`@features/newsletter`) so it can be reused on the dedicated
// `/newsletter` route without coupling to the home feature.
// The home page now imports NewsletterBand directly from
// `@features/newsletter` (see `app/page.tsx`).

export { Hero } from './Hero'
export { TrustStrip } from './TrustStrip'
export { FeaturedSection } from './FeaturedSection'
export { ReviewsSection } from './ReviewsSection'
export { CategoriesSection } from './CategoriesSection'
export { FaqSection } from './FaqSection'

export { getPublicProductStats, getHomeHeroCells, getActiveCategories } from './queries'
export type { PublicProductStats, HeroArtCell } from './queries'
