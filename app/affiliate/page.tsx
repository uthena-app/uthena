// /affiliate — P13.3 affiliate dashboard page (Slice 1 + P13.4 chart).
//
// Renders the dashboard header + onboarding banner + 4 KPI cards +
// (P13.4) the performance chart. Link hero + UTM builder + top
// products + recent commissions + tools grid land in Slices 2+
// (STUB-105 + future P13.x slices).
//
// Auth + role gates live in the AffiliateShell wrapper (called
// here). Non-affiliate-role visitors never reach this JSX — they're
// redirected to /403 by the shell's `requireRole` guard.
//
// **Render strategy**: RSC + `force-dynamic`. The page reads
// affiliate-scoped data every request; never cache.

import type { Metadata } from 'next'

import {
  AffiliateShell,
  DashboardHeader,
  OnboardingBanner,
  KpiCards,
  PerformanceChart,
  getAffiliateDashboard,
  getAffiliateDailyPerformance,
} from '@features/affiliate-portal'
import { sensitivePageMetadata } from '@foundations/metadata'
import styles from './page.module.css'

export const metadata: Metadata = sensitivePageMetadata({
  title: 'Affiliate dashboard',
  description:
    'Your Uthena affiliate hub — affiliate link, top products, commissions, and tools.',
  path: '/affiliate',
})

// P0.21 — `noindex` (affiliate dashboards are private). The
// `sensitivePageMetadata` helper applies the same `robots` /
// `googleBot` directives as the rest of the auth-gated surfaces.
export const dynamic = 'force-dynamic'

export default async function AffiliateDashboardPage() {
  // P13.4 — the chart RPC and the dashboard summary RPC are
  // independent reads; parallel them in a single round-trip with
  // Promise.all. The affiliate lookup is duplicated (cheaper than
  // restructuring the helpers to share a single auth+lookup phase).
  const [data, performance] = await Promise.all([
    getAffiliateDashboard(),
    getAffiliateDailyPerformance({ daysBack: 30 }),
  ])

  // User is logged in as an affiliate-role user but has no
  // `affiliates` row (e.g. the row was just deleted by an admin).
  // The shell-level `requireRole` already passed, so this is rare
  // — render a clear, non-scary message instead of crashing.
  if (!data) {
    return (
      <AffiliateShell>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Affiliate portal</p>
          <h1 className={styles.h1}>Affiliate dashboard</h1>
        </header>
        <section className={styles.placeholder} aria-label="No affiliate record">
          <p className={styles.placeholderEyebrow}>Setup incomplete</p>
          <h2 className={styles.placeholderH}>No affiliate record found</h2>
          <p className={styles.placeholderBody}>
            We couldn&apos;t find an affiliate record for your account. If you
            recently had your affiliate access removed, you can re-apply from
            the onboarding flow.
          </p>
          <a href="/affiliate/onboarding" className={styles.placeholderLink}>
            Start the onboarding flow →
          </a>
        </section>
      </AffiliateShell>
    )
  }

  return (
    <AffiliateShell>
      <DashboardHeader affiliate={data.affiliate} profile={data.profile} />
      <OnboardingBanner affiliate={data.affiliate} />
      <KpiCards summary={data.summary} />

      {/* P13.4 — performance chart (clicks / conversions / revenue
          over the last 30 days). Reads from
          getAffiliateDailyPerformance; same query already handles
          anon / non-affiliate / RPC-error fail-soft paths so the
          chart still renders (with the "no data" empty state) on
          any read failure. */}
      <PerformanceChart series={performance} daysBack={30} />

      {/* P13.5 Slice 1 ships the link-generator route at
          /affiliate/links (sidebar link below). Future slices add
          the UTM builder (Slice 3), top products by EPC (P13.5
          Slice 4), and the recent commissions table with CSV
          export (P13.x). */}
      <section className={styles.upcoming} aria-label="Coming in next slices">
        <p className={styles.upcomingEyebrow}>Next slices</p>
        <ul className={styles.upcomingList}>
          <li>UTM builder on the link manager (P13.5 Slice 4)</li>
          <li>Top products by EPC (earnings per click) (P13.5 Slice 4)</li>
          <li>Recent commissions table with CSV export (P13.x)</li>
          <li>Tools grid + resources list (P13.x)</li>
          <li>Mini-shop + custom landing pages (P13.8 + P13.9)</li>
        </ul>
      </section>
    </AffiliateShell>
  )
}
