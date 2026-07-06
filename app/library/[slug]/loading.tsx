// /library/[slug] loading fallback. Renders while the page streams in
// (it awaits requireUser + getLibraryProduct). Mirrors the page shape:
// header (breadcrumb + thumbnail + title), main column (files +
// sharing), aside (lessons + certificate placeholders). Pure RSC +
// shared Skeleton primitives — no data fetch, no client JS.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function LibraryProductLoading() {
  return (
    <main
      id="main"
      className={styles.page}
      aria-busy="true"
      aria-label="Loading…"
    >
      {/* Header skeleton */}
      <header className={styles.header}>
        <nav className={styles.breadcrumb} aria-hidden="true">
          <Skeleton width={40} height={12} radius={6} ariaLabel="" />
          <Skeleton width={70} height={12} radius={6} ariaLabel="" />
          <Skeleton width={140} height={12} radius={6} ariaLabel="" />
        </nav>

        <div className={styles.headerLayout}>
          <Skeleton height={210} radius={12} ariaLabel="" />
          <div className={styles.headerBody}>
            <Skeleton width={100} height={12} radius={6} ariaLabel="" />
            <Skeleton width="80%" height={32} radius={8} ariaLabel="" />
            <Skeleton width="40%" height={14} radius={6} ariaLabel="" />
            <Skeleton count={2} ariaLabel="" />
            <Skeleton width={120} height={28} radius={999} ariaLabel="" />
          </div>
        </div>
      </header>

      {/* Two-column layout */}
      <div className={styles.layout}>
        <div className={styles.main}>
          {/* Files section */}
          <section className={styles.section}>
            <Skeleton width={60} height={20} radius={6} ariaLabel="" />
            <Skeleton width="80%" height={14} radius={6} ariaLabel="" />
            <div className={styles.fileRows}>
              {Array.from({ length: 2 }, (_, i) => (
                <div key={i} className={styles.fileRow}>
                  <Skeleton width={70} height={28} radius={6} ariaLabel="" />
                  <div className={styles.fileBody}>
                    <Skeleton width="60%" height={14} radius={6} ariaLabel="" />
                    <Skeleton width="40%" height={12} radius={6} ariaLabel="" />
                  </div>
                  <Skeleton width={100} height={32} radius={6} ariaLabel="" />
                </div>
              ))}
            </div>
          </section>

          {/* Sharing section */}
          <section className={styles.section}>
            <Skeleton width={120} height={20} radius={6} ariaLabel="" />
            <Skeleton width="80%" height={14} radius={6} ariaLabel="" />
            <div className={styles.sharingGrid}>
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} height={110} radius={10} ariaLabel="" />
              ))}
            </div>
          </section>
        </div>

        <aside className={styles.aside} aria-label="Loading course progress">
          {/* Lessons placeholder */}
          <section className={styles.section}>
            <Skeleton width={140} height={20} radius={6} ariaLabel="" />
            <Skeleton count={3} ariaLabel="" />
            <Skeleton width={160} height={40} radius={8} ariaLabel="" />
          </section>
          {/* Certificate placeholder */}
          <section className={styles.section}>
            <Skeleton width={120} height={20} radius={6} ariaLabel="" />
            <Skeleton count={2} ariaLabel="" />
            <div className={styles.steps}>
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} height={40} radius={8} ariaLabel="" />
              ))}
            </div>
          </section>
        </aside>
      </div>
    </main>
  )
}