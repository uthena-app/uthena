// BundleCard — used in the `/bundles` listing and (future) bundle
// recommendation rails. Server component. Renders a bundle product with
// a "N courses included" line + a 3-thumb preview strip of the
// included products, plus the standard price row.
//
// Visual shape: a ProductCard-shaped card (same dimensions, same hover
// + focus states) with an extra preview strip at the bottom. The card
// root is a single `<Link>` to `/products/[slug]`; the included-thumbs
// are decorative (no inner links — clicking them navigates to the
// bundle, not to the included product, which matches the mockup's
// "bundle" affordance semantics where the bundle is the unit of sale).

import Link from 'next/link'
import { formatMoneyShort } from '@foundations/money/cents'
import { formatStarRow, formatSavePct } from '@features/catalog/format'
import type { BundleListItem, LicenseTier } from '@features/catalog/queries'
import styles from './BundleCard.module.css'

/** Map a license tier slug to the user-visible pill label. */
const LICENSE_LABELS: Record<LicenseTier, string> = {
  plr: 'PLR',
  mrr: 'MRR',
  rr: 'RR',
  personal: 'Personal',
}

export function BundleCard({
  bundle,
  subscriptionIncluded = false,
}: {
  bundle: BundleListItem
  /**
   * True when the current user gets this bundle via their active
   * Personal Access subscription (P8.2). Drives the teal
   * "Included with Personal Access" pill rendered between the
   * meta row and the title. Mirrors `ProductCard.subscriptionIncluded`.
   */
  subscriptionIncluded?: boolean
}) {
  const savePct = formatSavePct(bundle.starting_price_cents, bundle.msrp_cents)
  const starRow = bundle.review_count > 0 ? formatStarRow(bundle.avg_rating) : ''
  const licenseLabel = bundle.default_license
    ? LICENSE_LABELS[bundle.default_license]
    : null
  const extraCount = Math.max(0, bundle.included_product_count - bundle.included_preview.length)

  return (
    <Link
      href={`/products/${bundle.slug}`}
      className={styles.card}
      aria-label={
        subscriptionIncluded
          ? `View ${bundle.title} — included with Personal Access`
          : `View ${bundle.title}`
      }
    >
      <div className={styles.cover}>
        {bundle.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bundle.thumbnail_url}
            alt=""
            className={styles.thumb}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className={styles.thumbPlaceholder} aria-hidden />
        )}
        {/* "BUNDLE" pill — distinguishes bundle cards from regular
            product cards on the same grid. Teal accent matches the
            "PLR" / "Personal" identity treatment in the design DNA. */}
        <span className={styles.bundlePill}>Bundle</span>
        {licenseLabel && (
          <span
            className={`${styles.lic} ${
              bundle.default_license === 'mrr' ? styles.licMrr : ''
            }`.trim()}
          >
            {licenseLabel}
          </span>
        )}
      </div>
      <div className={styles.body}>
        <div className={styles.metaRow}>
          {bundle.category && <span>{bundle.category.name}</span>}
          <span>{bundle.included_product_count} courses</span>
        </div>
        {subscriptionIncluded && (
          <span
            className={styles.includedBadge}
            aria-label="Included with Personal Access subscription"
          >
            <span className={styles.includedCheck} aria-hidden>
              ✓
            </span>
            Included with Personal Access
          </span>
        )}
        <div className={styles.title}>{bundle.title}</div>
        {starRow && (
          <div className={styles.stars}>
            <span aria-hidden>{starRow}</span>
            <span className={styles.starsCt}>({bundle.review_count})</span>
            <span className={styles.srOnly}>
              {bundle.avg_rating?.toFixed(1) ?? '0'} out of 5 stars from{' '}
              {bundle.review_count} reviews
            </span>
          </div>
        )}
        {/* Included-courses preview strip. 3 thumbs + a "+N more"
            badge when there are more. Hidden entirely when the bundle
            has zero included products (an edge case the page-side
            empty state handles separately). */}
        {bundle.included_preview.length > 0 && (
          <div
            className={styles.preview}
            aria-label={`Includes ${bundle.included_product_count} ${
              bundle.included_product_count === 1 ? 'course' : 'courses'
            }`}
          >
            {bundle.included_preview.map((p) => (
              <div key={p.id} className={styles.previewItem} title={p.title}>
                {p.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.thumbnail_url}
                    alt=""
                    className={styles.previewThumb}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className={styles.previewPlaceholder} aria-hidden />
                )}
              </div>
            ))}
            {extraCount > 0 && (
              <div
                className={styles.previewMore}
                aria-label={`${extraCount} more included ${
                  extraCount === 1 ? 'course' : 'courses'
                }`}
              >
                +{extraCount}
              </div>
            )}
          </div>
        )}
        {bundle.starting_price_cents != null && (
          <div className={styles.price}>
            <b className={styles.priceNow}>
              {formatMoneyShort(bundle.starting_price_cents, bundle.currency)}
            </b>
            {bundle.msrp_cents != null &&
              bundle.msrp_cents > bundle.starting_price_cents && (
                <s className={styles.priceWas}>
                  {formatMoneyShort(bundle.msrp_cents, bundle.currency)}
                </s>
              )}
            {savePct != null && <span className={styles.save}>-{savePct}%</span>}
          </div>
        )}
      </div>
    </Link>
  )
}
