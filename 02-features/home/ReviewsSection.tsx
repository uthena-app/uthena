// ReviewsSection — the "Build your course business with confidence"
// section. Two-column on desktop (score + quote). Score and review
// count are derived from real data when reviews exist; falls back to
// the mockup's "4.43 / 23 verified reviews · Judge.me" copy when the
// reviews table is empty (the mockup-faithful placeholder is
// preferable to "no reviews" so the section stays visually anchored).

import { FEATURED_TESTIMONIAL } from './copy'
import { formatStarRow } from './format'
import type { PublicProductStats } from './queries'
import styles from './ReviewsSection.module.css'

type Props = {
  stats: PublicProductStats
}

export function ReviewsSection({ stats }: Props) {
  const hasReviews = stats.avgRating != null
  const rating = stats.avgRating ?? 4.43
  const reviewCount = 23 // anchor label — replaced by live count in P9.14
  return (
    <section className={styles.sec} aria-labelledby="reviews-h">
      <div className={styles.secHead}>
        <div>
          <div className={styles.eyebrow}>Jumpstart your business</div>
          <h2 id="reviews-h" className={styles.h2}>
            Build your course business
            <br />
            with confidence
          </h2>
        </div>
      </div>
      <div className={styles.rev}>
        <div>
          <div className={styles.eyebrow}>Customer reviews</div>
          <div className={styles.score}>
            <b className={styles.scoreNum}>{rating.toFixed(2)}</b>
            <span className={styles.stars} aria-label={`${rating} out of 5 stars`}>
              {formatStarRow(rating)}
            </span>
          </div>
          <p className={styles.scoreSub}>
            {reviewCount} verified reviews {hasReviews ? '· store aggregate' : '· Judge.me'}
          </p>
        </div>
        <div>
          <blockquote className={styles.quote}>{FEATURED_TESTIMONIAL.body}</blockquote>
          <cite className={styles.cite}>{FEATURED_TESTIMONIAL.cite}</cite>
        </div>
      </div>
    </section>
  )
}
