// Product rating row — the inline metadata strip that appears
// directly under the product title. Mockup-faithful to
// `mockups/product.html` lines 62–69:
//   ★★★★★  5.00 · 12 reviews  ·  by [Instructor]  ·  ID #PLR-1284
//
// The row is purely a server component (no interactivity) — it reads
// the product's `avg_rating` + `review_count` (denormalized aggregates
// maintained by the reviews_aggregate_sync trigger) and the partner's
// `public_slug` for the instructor link. The "ID #PLR-1284" badge is
// a synthetic identifier from the product id + default license
// tier (the live system doesn't have a SKU column; this gives the
// row a unique reference the partner / support team can quote).

import Link from 'next/link'
import { formatStarRow } from '@features/catalog/format'
import type { LicenseTier, ProductDetail } from '@features/catalog/queries'
import styles from './ProductRatingRow.module.css'

/** Map a license tier slug to the 3-letter code on the ID badge. */
const LICENSE_CODE: Record<LicenseTier, string> = {
  plr: 'PLR',
  mrr: 'MRR',
  rr: 'RR',
  personal: 'PSN',
}

type Props = Pick<
  ProductDetail,
  'id' | 'avg_rating' | 'review_count' | 'partner'
> & {
  /** The product's default license tier, used for the ID badge. */
  defaultLicense: LicenseTier | null
}

export function ProductRatingRow({
  id,
  avg_rating,
  review_count,
  partner,
  defaultLicense,
}: Props) {
  const hasRating = review_count > 0
  const starRow = hasRating ? formatStarRow(avg_rating) : ''
  const ratingLabel = avg_rating != null ? avg_rating.toFixed(2) : ''
  const code = defaultLicense ? LICENSE_CODE[defaultLicense] : 'PRD'
  const idBadge = `${code}-${id}`

  return (
    <div className={styles.row} aria-label="Product metadata">
      {hasRating && (
        <span className={styles.stars} aria-hidden>
          {starRow}
        </span>
      )}
      {hasRating && (
        <span className={styles.rating}>
          <b>{ratingLabel}</b>
          <span className={styles.dim}> · {review_count} reviews</span>
        </span>
      )}
      {hasRating && partner?.public_slug && <span className={styles.sep} aria-hidden>·</span>}
      {partner?.public_slug && (
        <span className={styles.byline}>
          by{' '}
          <Link
            href={`/partners/${partner.public_slug}`}
            className={styles.partnerLink}
          >
            {partner.public_slug}
          </Link>
        </span>
      )}
      <span className={styles.sep} aria-hidden>·</span>
      <span className={styles.idBadge}>ID #{idBadge}</span>
    </div>
  )
}
