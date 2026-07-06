// ContentModerationQueue.tsx — admin moderation surface.
// Server component. Composes flagged reviews + flagged products into a
// single list, sorted by date desc. Approved/rejected/cleared actions
// land via the moderator's actions.ts.

import { getContentModerationQueue } from '../queries/getContentModerationQueue'
import { ContentModerationActions } from './ContentModerationActions'
import styles from './ContentModerationQueue.module.css'

export async function ContentModerationQueue({ limit = 50 }: { limit?: number }) {
  const queue = await getContentModerationQueue(limit)
  if (!queue) return null

  if (queue.items.length === 0) {
    return (
      <section className={styles.empty}>
        <h2 className={styles.emptyTitle}>No flagged content</h2>
        <p className={styles.emptyHint}>
          When a partner flags a review for admin review, or an admin flags a product, it will
          appear here.
        </p>
      </section>
    )
  }

  return (
    <section className={styles.root} aria-label="Content moderation queue">
      <header className={styles.header}>
        <h2 className={styles.heading}>Content moderation</h2>
        <div className={styles.counts}>
          <span className={styles.countPill} data-kind="review">
            {queue.counts.flaggedReviews} flagged {queue.counts.flaggedReviews === 1 ? 'review' : 'reviews'}
          </span>
          <span className={styles.countPill} data-kind="product">
            {queue.counts.flaggedProducts} flagged {queue.counts.flaggedProducts === 1 ? 'product' : 'products'}
          </span>
        </div>
      </header>
      <ul className={styles.list}>
        {queue.items.map((item) => {
          const key = item.kind === 'review' ? `r-${item.id}` : `p-${item.id}`
          if (item.kind === 'review') {
            return (
              <li key={key} className={styles.item} data-kind="review">
                <div className={styles.body}>
                  <p className={styles.kind}>Flagged review</p>
                  <p className={styles.reviewQuote}>"{item.body?.slice(0, 240) ?? ''}{(item.body?.length ?? 0) > 240 ? '…' : ''}"</p>
                  <p className={styles.itemMeta}>
                    <strong>{item.rating}/5</strong>
                    {' · '}
                    by {item.authorDisplayName ?? `user #${item.authorId?.slice(0, 8)}`}
                    {' · '}
                    on <a href={`/products/${item.productSlug}`} target="_blank" rel="noopener noreferrer" className={styles.itemLink}>
                      {item.productTitle}
                    </a>
                    {' · '}
                    {new Date(item.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                    {' · helpful '}{item.helpfulCount}
                  </p>
                  <p className={styles.flag}>
                    <strong>Flag reason:</strong> {item.flaggedReason}
                  </p>
                </div>
                <ContentModerationActions
                  kind="review"
                  reviewId={item.id}
                  productId={item.productId}
                  status={item.status}
                />
              </li>
            )
          }
          // product
          return (
            <li key={key} className={styles.item} data-kind="product">
              <div className={styles.body}>
                <p className={styles.kind}>Flagged product</p>
                <p className={styles.productTitle}>{item.title}</p>
                <p className={styles.itemMeta}>
                  status=<code>{item.status}</code>
                  {' · '}
                  partner: {item.partnerName ?? `Partner #${item.partnerId ?? 'unknown'}`}
                  {' · '}
                  <a href={`/products/${item.slug}`} target="_blank" rel="noopener noreferrer" className={styles.itemLink}>
                    view
                  </a>
                  {' · '}
                  updated {new Date(item.updatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                </p>
              </div>
              <ContentModerationActions
                kind="product"
                productId={item.id}
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}
