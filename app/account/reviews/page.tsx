// /account/reviews — RSC. Two sections: my reviews + leave new.
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireUser } from '@foundations/auth/guards'
import {
  getMyReviews,
  getReviewableProducts,
} from '@features/account/profile/queries/getMyReviews'
import { ReviewsSection } from '@features/account/profile/components/ReviewsSection'
import { sensitivePageMetadata } from '@foundations/metadata'
import styles from './reviews.module.css'

// P0.21 — `noindex` so the reviews surface isn't indexed.
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Reviews',
  description: 'Your Uthena course reviews.',
  path: '/account/reviews',
})

export default async function AccountReviewsPage() {
  const user = await requireUser('/account/reviews')
  const [reviews, reviewable] = await Promise.all([getMyReviews(), getReviewableProducts()])

  if (!user) redirect('/account')

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.h1}>Reviews</h1>
        <p className={styles.lede}>
          Your reviews of products you own, and a list of products you haven&apos;t reviewed yet.
        </p>
      </header>
      <ReviewsSection reviews={reviews} reviewable={reviewable} />
    </div>
  )
}
