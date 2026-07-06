// ContinueWatchingRail.tsx — SERVER. P15.10 — the "Continue watching"
// rail at the top of /library. Shows the user's most-recently-watched
// NOT-yet-completed lessons. Each tile links to the watch URL with
// the resume-time as `?t=` (the player auto-seeks on mount).

import Link from 'next/link'
import { formatLessonDuration } from '@features/lms'
import styles from './ContinueWatchingRail.module.css'

export type ContinueWatchingItem = {
  productId: number
  productTitle: string
  productSlug: string
  lessonId: number
  lessonTitle: string
  positionSeconds: number
  lastWatchedAt: string
}

export function ContinueWatchingRail({
  items,
}: {
  items: ContinueWatchingItem[]
}) {
  if (items.length === 0) return null
  return (
    <section className={styles.root} aria-label="Continue watching">
      <header className={styles.header}>
        <h2 className={styles.heading}>Continue watching</h2>
        <p className={styles.sub}>
          Pick up where you left off in {items.length}{' '}
          {items.length === 1 ? 'course' : 'courses'}.
        </p>
      </header>
      <ul className={styles.list}>
        {items.map((item) => {
          const resumeUrl = `/learn/${item.productSlug}/lessons/${item.lessonId}?t=${item.positionSeconds}`
          return (
            <li key={`${item.productId}-${item.lessonId}`} className={styles.item}>
              <Link href={resumeUrl} className={styles.link}>
                <div className={styles.info}>
                  <p className={styles.course}>{item.productTitle}</p>
                  <p className={styles.lesson}>{item.lessonTitle}</p>
                  <p className={styles.meta}>
                    Resume at {formatLessonDuration(item.positionSeconds)}
                  </p>
                </div>
                <span className={styles.cta} aria-hidden>
                  ▶
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
