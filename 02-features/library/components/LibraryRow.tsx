// LibraryRow.tsx — one product card in the /library grid.

import Link from 'next/link'
import { AccessibleProduct } from '@features/library/queries/getUserLibrary'
import { CourseProgressBar } from '@features/lms/components/CourseProgressBar'
import type { CourseProgress } from '@features/lms'
import styles from './LibraryRow.module.css'

const KIND_LABEL: Record<AccessibleProduct['kind'], string> = {
  video_course: 'Video course',
  ebook: 'eBook',
  template_pack: 'Template pack',
  audio_course: 'Audio course',
  bundle: 'Bundle',
  asset_pack: 'Asset pack',
}

const SOURCE_LABEL: Record<AccessibleProduct['access_source'], string> = {
  purchase: 'Purchased',
  admin_grant: 'Granted',
  free_promo: 'Free promo',
  subscription: 'Personal Access',
}

export function LibraryRow({
  product,
  progress,
}: {
  product: AccessibleProduct
  /** P15.9 — optional per-course completion %. Render the bar when
   *  the product is a video_course AND we have progress data. */
  progress?: CourseProgress | null
}) {
  // P7.2 — library rows link to the OWNER's product detail
  // (`/library/[slug]`), not the public PDP (`/products/[slug]`).
  // The library page is re-watch + download + sharing; the public
  // PDP is buy. The two surfaces serve different intents.
  const isVideoCourse = product.kind === 'video_course'
  const showProgress = isVideoCourse && progress != null && progress.totalLessons > 0
  return (
    <Link href={`/library/${product.slug}`} className={styles.card}>
      {product.thumbnail_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={product.thumbnail_url} alt="" className={styles.thumb} />
      ) : (
        <div className={styles.thumbPlaceholder} aria-hidden />
      )}
      <div className={styles.body}>
        <p className={styles.kind}>{KIND_LABEL[product.kind] ?? product.kind}</p>
        <h3 className={styles.title}>{product.title}</h3>
        <p className={styles.desc}>{product.short_description}</p>
        <div className={styles.meta}>
          {product.partner_slug && <span>{product.partner_slug}</span>}
          {product.total_lesson_count > 0 && <span>{product.total_lesson_count} lessons</span>}
          <span className={styles.sourcePill} data-source={product.access_source}>
            {SOURCE_LABEL[product.access_source] ?? product.access_source}
          </span>
        </div>
        {showProgress && progress != null ? (
          <div className={styles.progressWrap}>
            <CourseProgressBar
              percent={progress.percent}
              totalLessons={progress.totalLessons}
              completedLessons={progress.completedLessons}
            />
          </div>
        ) : null}
      </div>
    </Link>
  )
}
