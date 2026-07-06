// LibraryProductLessons.tsx — Slice-1 placeholder for the per-product
// lessons / "re-watch" section on /library/[slug]. RSC. The real
// implementation lands in Phase 15 (P15.2 course player shell +
// lesson nav + auto-resume from lesson_progress). For now, this
// component:
//
//   1. Tells the user the player is on its way (with a plain-language
//      reason — "Phase 15 brings the lessons table + resume position").
//   2. Provides a "Watch the player demo" CTA to /library/watch/demo
//      so the user can see the playback surface today.
//   3. Shows the lesson count + total duration from the product's
//      `total_lesson_count` / `total_duration_seconds` so the user
//      sees the expected scope.
//
// Why a real component, not just inline JSX on the page:
//   - The page composes 4 sections. Keeping this in its own file
//     makes the lessons surface swap-in trivial when Phase 15 lands
//     (replace this file's body with the real player shell; the
//     page doesn't change).
//
// Why we render the demo link rather than the real player:
//   - /library/watch/[lessonId] needs a `lessons` table row + a
//     `lesson_progress` row. Neither exists yet (Phase 15 P15.1).
//   - /library/watch/demo exists today with a public HLS test
//     stream. Pointing users there lets them exercise the player
//     surface immediately while we wait on the schema.

import Link from 'next/link'
import { formatDuration } from '@features/product/formatDuration'
import type { LibraryProductSummary } from '../queries/getLibraryProduct'
import styles from './LibraryProductLessons.module.css'

export type LibraryProductLessonsProps = {
  product: LibraryProductSummary
}

export function LibraryProductLessons({ product }: LibraryProductLessonsProps) {
  const lessonLabel = product.total_lesson_count === 1 ? 'lesson' : 'lessons'
  const durationLabel = formatDuration(product.total_duration_seconds)

  return (
    <section className={styles.section} aria-label="Course player (coming soon)">
      <div className={styles.head}>
        <div>
          <h2 className={styles.h2}>Course player</h2>
          <p className={styles.sub}>
            {product.total_lesson_count > 0
              ? `${product.total_lesson_count} ${lessonLabel} · ${durationLabel}`
              : 'No lessons yet.'}
          </p>
        </div>
        <span className={styles.badge} data-soon="true">Coming soon</span>
      </div>

      <div className={styles.body}>
        <p className={styles.copy}>
          The full lesson player — with resume-from-last-position, lesson notes,
          bookmarks, and Q&amp;A — ships in Phase 15. While we build the
          <code className={styles.code}> lessons </code>
          and <code className={styles.code}> lesson_progress </code>tables,
          you can try the player surface against a public test stream.
        </p>

        <div className={styles.cta}>
          <Link href="/library/watch/demo" className={styles.ctaLink}>
            Watch the player demo →
          </Link>
        </div>
      </div>
    </section>
  )
}