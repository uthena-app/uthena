// Product detail page. RSC. Reads the product + pricing + partner
// + gallery + category + reviews. Renders the mockup-faithful top
// section (P0.12 Slices 1+2+3: gallery + rating row + price block
// + license radio + Add to cart + perks list) AND the new tabbed
// below-the-fold (Slice 4: Description / Curriculum / Instructor /
// Reviews). The tabs UI itself is a small client island
// (`ProductTabs`); the four tab panels are RSC.
//
// **Add to cart.** The CTA in `LicenseSelector` calls the existing
// `addToCartAction` server action. The action is fully wired
// (Zod-validated, RLS-aware, idempotent on (user, product, license))
// — Slice 2 surfaces the UI affordance, not the action itself.
//
// **Perks list.** `ProductPerks` reads `products.bullets` (JSONB,
// migration 0013). Null = mockup-faithful 4-item fallback.
// Empty array = render nothing (partner explicitly cleared).
// Array = render up to 8 items, each capped at 200 chars.
//
// **Tabs (Slice 4).** `ProductTabs` is the only client component
// below the fold (it's the tabs UI). The four panel components
// (Description / Curriculum / Instructor / Reviews) are pure
// RSC, server-rendered, with zero client JS. The Description tab
// renders `products.long_description` (TipTap JSON, JSONB) via
// the pure-JSX `renderTipTap` renderer — no DOMPurify, no
// `dangerouslySetInnerHTML`. The Curriculum tab renders
// `products.curriculum` (JSONB) via `ProductCurriculum`. The
// Instructor tab renders `product.partner` (joined with profile)
// via `ProductInstructor`. The Reviews tab renders the top 5
// published reviews via `ProductReviews`.
//
// **At a glance (Slice 5).** The page wraps the `ProductTabs` in
// a 2-column grid (`1fr 320px`) and adds a sticky right-rail
// `ProductAtAGlance` sidebar. The sidebar renders the mockup's
// `.brief` block (Format / Modules / License / Instructor /
// Updated + Add to cart + Preview curriculum). The Preview
// curriculum button is a tiny client island
// (`PreviewCurriculumButton`) that fires a window event to
// switch the tabs to Curriculum — same RSC↔client bridge
// pattern as the global search overlay (P0.4) + mobile nav
// drawer (P0.5).

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getProductBySlug } from '@features/catalog/queries'
import { getSubscriptionCatalogAccess } from '@features/library/queries/getSubscriptionCatalogAccess'
import {
  LicenseSelector,
  ProductAtAGlance,
  ProductCurriculum,
  ProductDescription,
  ProductGallery,
  ProductInstructor,
  ProductPerks,
  ProductPriceBlock,
  ProductRatingRow,
  ProductReviews,
  ProductTabs,
  SubscriberOnlyUpgradeCard,
} from '@features/product'
import { getSessionUser } from '@foundations/auth/guards'
import { buildPageMetadata } from '@foundations/metadata'
import {
  JsonLd,
  buildBreadcrumbSchema,
  buildProductSchema,
} from '@foundations/structured-data'
import styles from './product.module.css'

export const revalidate = 60

type Params = Promise<{ slug: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params
  const product = await getProductBySlug(slug)
  if (!product) return { title: 'Product not found' }
  // P0.21 — full OG + Twitter Card via the shared helper. The
  // OG image is the product's own thumbnail (when set), so
  // shared links show the course cover instead of the brand
  // default. Falls back to the dynamic generator when the
  // product has no thumbnail yet (defensive for products in
  // draft / pre-publish).
  return buildPageMetadata({
    title: product.title,
    description: product.short_description,
    path: `/products/${slug}`,
    image: product.thumbnail_url ?? undefined,
  })
}

export default async function ProductDetailPage({ params }: { params: Params }) {
  const { slug } = await params
  const [product, subscriptionAccess, sessionUser] = await Promise.all([
    getProductBySlug(slug),
    getSubscriptionCatalogAccess(),
    getSessionUser(),
  ])
  if (!product) notFound()
  const subscriptionIncluded = subscriptionAccess.productIds.has(product.id)
  // P8.3 — when the product is subscriber-only AND the user is not a
  // subscriber, hide the LicenseSelector (no purchase path) and show
  // the upgrade CTA instead. The "Included with Personal Access"
  // banner above (subscriptionIncluded) still wins when the user IS a
  // subscriber; the subscriber-only + non-subscriber path is the new
  // branch. `isAnonymous` is the canonical session check (the
  // getSubscriptionCatalogAccess result returns empty for both anon and
  // authed-with-no-access, so it can't distinguish the two — we need
  // the real session check here).
  const subscriberOnlyGated =
    product.subscriber_only === true && !subscriptionIncluded
  const isAnonymous = sessionUser === null

  // The default pricing tier drives the visible price. When no tier
  // is marked default, the first active tier wins (mirrors the
  // product card's `normalizeListItem` pattern).
  const activePricing = product.pricing.filter((p) => p.is_active)
  const defaultTier = activePricing.find((p) => p.is_default) ?? activePricing[0] ?? null

  // Curriculum badge count — for the tabs row's "X modules" label.
  // Use the JSONB length when set, fall back to nothing when null
  // (the fallback prose doesn't have a real count). The component
  // itself renders 12 fallback rows when curriculum is null.
  const curriculumCount = Array.isArray(product.curriculum) ? product.curriculum.length : 0

  // P0.22 — JSON-LD structured data. Two schemas:
  //   1. `BreadcrumbList` — Home > Category > Product, mirroring the
  //      visible breadcrumb nav above. Crawlers use this to show a
  //      breadcrumb trail under the SERP result.
  //   2. `Product` — name, description, image, sku, brand, offers
  //      (price + currency + availability), and (when reviews exist)
  //      aggregateRating. Crawlers use this to render a product card
  //      with price + stars in the SERP.
  // Both are emitted as separate `<script>` tags via the shared
  // `<JsonLd>` server component. `<JsonLd>` escapes `</` sequences
  // before injecting the payload (defense in depth).
  const breadcrumbSchema = buildBreadcrumbSchema([
    { name: 'Home', path: '/' },
    ...(product.category
      ? [
          {
            name: product.category.name,
            path: `/collections/${product.category.slug}`,
          },
        ]
      : []),
    { name: product.title, path: `/products/${slug}` },
  ])
  const productSchema = buildProductSchema({
    id: product.id,
    title: product.title,
    short_description: product.short_description,
    thumbnail_url: product.thumbnail_url,
    category: product.category,
    default_license: product.default_license,
    pricing: product.pricing,
    avg_rating: product.avg_rating,
    review_count: product.review_count,
    slug,
  })

  return (
    <>
      {/* P0.22 — JSON-LD structured data (Product + BreadcrumbList).
          The `<JsonLd>` server component renders one `<script
          type="application/ld+json">` per schema in the array.
          No client JS shipped. */}
      <JsonLd data={[breadcrumbSchema, productSchema]} />
      <main id="main" className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href="/">Home</Link>
        {product.category && (
          <>
            <span className={styles.bcSep}>/</span>
            <Link href={`/collections/${product.category.slug}`}>{product.category.name}</Link>
          </>
        )}
        <span className={styles.bcSep}>/</span>
        <span className={styles.bcCurrent}>{product.title}</span>
      </nav>

      {/* ===== P0.12 Slice 1+2+3 — Top section (gallery + pinfo) ===== */}
      <div className={styles.pdpTop}>
        <ProductGallery
          fallbackUrl={product.thumbnail_url}
          fallbackAlt={product.title}
          images={product.images}
          hasPreviewVideo={Boolean(product.preview_video_url)}
        />

        <div className={styles.pinfo}>
          <header className={styles.header}>
            {product.category && <p className={styles.eyebrow}>{product.category.name}</p>}
            <h1 className={styles.h1}>{product.title}</h1>
            <ProductRatingRow
              id={product.id}
              avg_rating={product.avg_rating}
              review_count={product.review_count}
              partner={product.partner}
              defaultLicense={product.default_license}
            />
            <p className={styles.lede}>{product.short_description}</p>
          </header>

          {subscriptionIncluded ? (
            <aside className={styles.includedBanner} role="status" aria-label="Included with your Personal Access subscription">
              <span className={styles.includedBannerIcon} aria-hidden>
                ✓
              </span>
              <div className={styles.includedBannerBody}>
                <span className={styles.includedBannerTitle}>
                  Included with Personal Access
                </span>
                <span className={styles.includedBannerText}>
                  You already have access to this course via your subscription.{' '}
                  <Link href="/library" className={styles.includedBannerLink}>
                    Open your library
                  </Link>{' '}
                  to start watching.
                </span>
              </div>
            </aside>
          ) : null}

          {defaultTier ? (
            <ProductPriceBlock tier={defaultTier} currency="USD" />
          ) : (
            <p className={styles.noPricing} role="status">
              No pricing available right now.
            </p>
          )}

          {subscriberOnlyGated ? (
            <SubscriberOnlyUpgradeCard productSlug={slug} isAnonymous={isAnonymous} />
          ) : (
            <LicenseSelector
              productId={product.id}
              tiers={product.pricing}
              defaultLicense={product.default_license}
              currency="USD"
            />
          )}

          {/* P0.14 / P0.12 Slice 3 — perks list (mockup `.pinfo .perks`,
           *  lines 101–106 of mockups/product.html). Reads
           *  products.bullets JSONB; falls back to the 4 mockup-
           *  faithful items when the partner hasn't set any yet. */}
          <ProductPerks bullets={product.bullets} />
        </div>
      </div>

      {/* ===== P0.12 Slice 4+5 — Below-the-fold (tabs + At a glance) =====
       *  2-column grid: tabs on the left (`1fr`), sticky At a glance
       *  sidebar on the right (`320px`). The sidebar is RSC except for
       *  the small "Preview curriculum" client island that fires a
       *  window event to switch the active tab. The tabs UI is the
       *  only other client component on the page; the four panel
       *  components (Description / Curriculum / Instructor / Reviews)
       *  are RSC. */}
      <section className={styles.pdpBelow} aria-label="Product details">
        <div className={styles.pdpTabs}>
          <ProductTabs
            instanceId={`product-${product.id}`}
            curriculumCount={curriculumCount}
            reviewCount={product.review_count}
            panels={{
              description: <ProductDescription longDescription={product.long_description} />,
              curriculum: <ProductCurriculum curriculum={product.curriculum} />,
              instructor: <ProductInstructor partner={product.partner} />,
              reviews: (
                <ProductReviews
                  avgRating={product.avg_rating}
                  reviewCount={product.review_count}
                  reviews={product.recent_reviews}
                />
              ),
            }}
          />
        </div>
        <ProductAtAGlance
          id={product.id}
          kind={product.kind}
          total_lesson_count={product.total_lesson_count}
          total_duration_seconds={product.total_duration_seconds}
          default_license={product.default_license}
          partner={product.partner}
          updated_at={product.updated_at}
          pricing={product.pricing}
          subscriberOnlyGated={subscriberOnlyGated}
        />
      </section>
    </main>
    </>
  )
}