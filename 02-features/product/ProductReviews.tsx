// ProductReviews — the Reviews tab content. Read-only display of
// the product's review aggregate + top 5 published reviews.
//
// **What ships today (Slice 4)**: aggregate (avg + count + star
// row) + the top 5 published reviews with reviewer display_name,
// star row, title, body, helpful count, and date. Capped body
// length to keep the layout sane. Empty state when there are no
// published reviews ("Be the first to review" — Phase 9 P9.14
// wires the actual write flow + reviews list page).
//
// **What ships later**:
//   - P9.14 — Reviews: create / edit / delete own + star picker + status pills.
//     Today the tab is read-only; a logged-in buyer hits a
//     "Coming soon" message in the empty state, not a write CTA.
//   - P15.15 — Course reviews: public on product page + instructor reply.
//     Instructor replies (a new column on the reviews table) ship
//     with P15.15. Until then we display reviews without replies.
//
// **Why pure RSC**: zero interactivity. The Reviews tab is a
// display-only list. The data comes from `product.recent_reviews`
// (populated by `getProductBySlug`).

import type { ProductReviewItem } from '@features/catalog/queries'
import { formatStarRow } from '@features/catalog/format'
import styles from './ProductReviews.module.css'

/** Hard cap on a review's body length — defensive against a reviewer
 *  pasting an essay. Matches the database CHECK constraint
 *  (length(body) <= 5000). */
const MAX_BODY_LENGTH = 2000

/** Hard cap on a review's title — defensive against runaway input.
 *  The DB allows nullable titles (no length cap); we cap at 200. */
const MAX_TITLE_LENGTH = 200

/** Hard cap on the display name — defensive against runaway input. */
const MAX_NAME_LENGTH = 80

type Props = {
  /** Average rating from `products.avg_rating` (numeric 3,2; nullable). */
  avgRating: number | null
  /** Total review count from `products.review_count`. */
  reviewCount: number
  /** Top 5 published reviews for this product, newest first. */
  reviews: ProductReviewItem[]
}

function clip(text: string | null | undefined, max: number): string {
  if (typeof text !== 'string') return ''
  const trimmed = text.trim()
  if (!trimmed) return ''
  return trimmed.length > max ? trimmed.slice(0, max - 1) + '…' : trimmed
}

/** Format an ISO date as "Jun 2026" — the mockup uses the month +
 *  year for review dates. The full timestamp is in the `<time
 *  dateTime>` attribute for assistive tech. */
function formatReviewDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
  const year = d.getUTCFullYear()
  return `${month} ${year}`
}

export function ProductReviews({ avgRating, reviewCount, reviews }: Props) {
  const hasReviews = reviewCount > 0 && reviews.length > 0
  const stars = avgRating != null ? formatStarRow(avgRating) : '☆☆☆☆☆'
  const avgDisplay = avgRating != null ? avgRating.toFixed(2) : '—'

  return (
    <div className={styles.reviews}>
      {/* ===== Aggregate header ===== */}
      <div className={styles.header}>
        <div className={styles.score} aria-hidden>
          <span className={styles.stars}>{stars}</span>
          <span className={styles.scoreNum}>{avgDisplay}</span>
        </div>
        <p className={styles.summary}>
          <strong>{reviewCount.toLocaleString()}</strong>{' '}
          {reviewCount === 1 ? 'verified review' : 'verified reviews'}
        </p>
        {!hasReviews && (
          <p className={styles.empty} role="status">
            No reviews yet. Reviews open after Phase 9 ships the buyer write flow — check back
            soon.
          </p>
        )}
      </div>

      {/* ===== Review list ===== */}
      {hasReviews && (
        <ul className={styles.list} role="list" aria-label="Customer reviews">
          {reviews.map((r) => {
            const reviewer = clip(r.reviewer?.display_name ?? null, MAX_NAME_LENGTH) || 'Anonymous'
            const title = clip(r.title ?? null, MAX_TITLE_LENGTH)
            const body = clip(r.body, MAX_BODY_LENGTH)
            const rowStars = formatStarRow(r.rating)
            const dateLabel = formatReviewDate(r.created_at)
            return (
              <li key={r.id} className={styles.item}>
                <header className={styles.itemHead}>
                  <div className={styles.itemMeta}>
                    <span className={styles.itemStars} aria-label={`${r.rating} out of 5 stars`}>
                      {rowStars}
                    </span>
                    {title && <span className={styles.itemTitle}>{title}</span>}
                  </div>
                  <div className={styles.itemSub}>
                    <span className={styles.itemName}>{reviewer}</span>
                    {dateLabel && (
                      <>
                        <span className={styles.dot} aria-hidden>
                          ·
                        </span>
                        <time dateTime={r.created_at} className={styles.itemDate}>
                          {dateLabel}
                        </time>
                      </>
                    )}
                  </div>
                </header>
                <p className={styles.itemBody}>{body}</p>
                {r.helpful_count > 0 && (
                  <p className={styles.itemHelpful}>
                    {r.helpful_count.toLocaleString()}{' '}
                    {r.helpful_count === 1 ? 'person found' : 'people found'} this helpful
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}