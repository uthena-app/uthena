// StatusBadge — small status pill for the partner's product list.
import styles from './StatusBadge.module.css'

const PRODUCT_STATUS_LABELS: Record<string, { label: string; tone: 'draft' | 'review' | 'live' | 'unpublished' | 'archived' }> = {
  draft: { label: 'Draft', tone: 'draft' },
  in_review: { label: 'In review', tone: 'review' },
  published: { label: 'Published', tone: 'live' },
  unpublished: { label: 'Unpublished', tone: 'unpublished' },
  archived: { label: 'Archived', tone: 'archived' },
}

export function PartnerProductStatusBadge({ status }: { status: string }) {
  if (status === 'in_review') {
    return <span className={`${styles.badge} ${styles.review}`}>In review</span>
  }
  if (status === 'published') {
    return <span className={`${styles.badge} ${styles.live}`}>Published</span>
  }
  if (status === 'unpublished') {
    return <span className={`${styles.badge} ${styles.unpublished}`}>Unpublished</span>
  }
  if (status === 'archived') {
    return <span className={`${styles.badge} ${styles.archived}`}>Archived</span>
  }
  return <span className={`${styles.badge} ${styles.draft}`}>Draft</span>
}
