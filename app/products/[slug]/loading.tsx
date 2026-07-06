// Product detail loading fallback. Renders while `app/products/[slug]/page.tsx`
// streams in. Mirrors the PDP's 2-column layout: gallery placeholder on
// the left, header + price + license radio + perks on the right; below
// the fold, tabs placeholder + sidebar placeholder.
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function ProductLoading() {
  return (
    <main id="main" className={styles.page} aria-busy="true" aria-label="Loading…">
      {/* Breadcrumb skeleton */}
      <nav className={styles.breadcrumb} aria-hidden="true">
        <Skeleton width={60} height={12} radius={6} ariaLabel="" />
        <span className={styles.bcSep}>›</span>
        <Skeleton width={80} height={12} radius={6} ariaLabel="" />
        <span className={styles.bcSep}>›</span>
        <Skeleton width={140} height={12} radius={6} ariaLabel="" />
      </nav>

      {/* Top section: gallery on the left, info on the right (1.15fr / 0.85fr) */}
      <div className={styles.pdpTop}>
        <div className={styles.gallery}>
          <Skeleton height={420} radius={14} ariaLabel="" />
          <div className={styles.thumbs}>
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} width={72} height={72} radius={8} ariaLabel="" />
            ))}
          </div>
        </div>

        <div className={styles.pinfo}>
          <header className={styles.header}>
            <Skeleton width={100} height={12} radius={6} ariaLabel="" />
            <Skeleton width="80%" height={36} radius={8} ariaLabel="" />
            <Skeleton width="40%" height={12} radius={6} ariaLabel="" />
            <Skeleton count={2} ariaLabel="" />
          </header>

          {/* Price block */}
          <div className={styles.price}>
            <Skeleton width={120} height={32} radius={6} ariaLabel="" />
            <Skeleton width={70} height={20} radius={6} ariaLabel="" />
          </div>

          {/* License radio group */}
          <div className={styles.licenses} aria-hidden="true">
            {Array.from({ length: 2 }, (_, i) => (
              <Skeleton key={i} height={56} radius={10} ariaLabel="" />
            ))}
          </div>

          {/* CTA */}
          <Skeleton height={48} radius={999} ariaLabel="" />

          {/* Perks list */}
          <div className={styles.perks}>
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} width="90%" height={14} radius={6} ariaLabel="" />
            ))}
          </div>
        </div>
      </div>

      {/* Below the fold: tabs placeholder + sidebar placeholder */}
      <div className={styles.pdpBelow}>
        <div className={styles.pdpTabs}>
          {/* 4 tab buttons */}
          <div className={styles.tabBar} aria-hidden="true">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} width={90} height={32} radius={6} ariaLabel="" />
            ))}
          </div>
          {/* Tab body */}
          <div className={styles.tabBody}>
            <Skeleton count={6} ariaLabel="" />
          </div>
        </div>

        <aside className={styles.sidebar} aria-label="Product summary loading">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className={styles.sidebarRow}>
              <Skeleton width={70} height={12} radius={6} ariaLabel="" />
              <Skeleton width="60%" height={14} radius={6} ariaLabel="" />
            </div>
          ))}
          <Skeleton height={44} radius={999} ariaLabel="" />
        </aside>
      </div>
    </main>
  )
}