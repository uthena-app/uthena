// /partner/courses/[id] loading fallback. Renders while
// `app/partner/courses/[id]/page.tsx` streams in (awaits
// getMyCourseDetail + listPartnerCategories + getSessionUser).
// Mirrors the detail page shape: breadcrumb + title row + tab nav
// + panel. No data fetch. No client JS. Pure RSC + shared Skeleton.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function PartnerCourseDetailLoading() {
  return (
    <div className={styles.wrap} aria-busy="true" aria-label="Loading…">
      <header className={styles.header} aria-hidden="true">
        <Skeleton width={120} height={14} radius={6} ariaLabel="" />
        <div className={styles.titleRow}>
          <Skeleton width="55%" height={28} radius={8} ariaLabel="" />
          <Skeleton width={96} height={22} radius={999} ariaLabel="" />
        </div>
        <Skeleton width="70%" height={14} radius={6} ariaLabel="" />
      </header>

      <nav className={styles.tabBar} aria-hidden="true">
        {['Curriculum', 'Pricing', 'Sales', 'Reviews', 'Settings'].map((label) => (
          <Skeleton key={label} width={88} height={36} radius={6} ariaLabel="" />
        ))}
      </nav>

      <section className={styles.panel} aria-hidden="true">
        <Skeleton width="40%" height={16} radius={6} ariaLabel="" />
        <Skeleton width="100%" height={40} radius={8} ariaLabel="" />
        <Skeleton width="100%" height={72} radius={8} ariaLabel="" />
        <Skeleton width="100%" height={200} radius={8} ariaLabel="" />
        <Skeleton width="100%" height={40} radius={8} ariaLabel="" />
      </section>
    </div>
  )
}