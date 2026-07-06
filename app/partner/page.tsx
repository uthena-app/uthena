// /partner — RSC. Partner dashboard with KPIs + status banner +
// activity feed + earnings chart.
//
// P12.4 — adds the "This month" KPI (replacing the empty `totalOrdersCount`
// field in the summary as a 5th financial signal), the "Recent activity"
// feed (last 10 events from payout_ledger ∪ order_items via the
// get_partner_recent_activity RPC), and the "Earnings" 30-day chart
// (inline SVG bar chart — no chart library, zero client JS).
//
// Existing behavior preserved:
//   - Partner-gated (requirePartner) — non-partners redirect to
//     /partner/onboarding.
//   - Status banner: pending = amber "Application under review",
//     suspended = red "Account suspended"; approved → no banner.
//   - 4 product-count / lifetime-sales KPIs read from the partner's
//     own rows (RLS-enforced) and the lifetime-sales RPC.
//
// Render strategy:
//   - 5 parallel reads in getPartnerDashboardSummary (3 product
//     counts + lifetime RPC + month RPC).
//   - 2 additional parallel reads in the page itself
//     (getPartnerRecentActivity + getPartnerDailySalesSeries).
//   - All 7 reads happen in a single Promise.all at the top of
//     the page render, so the dashboard p95 stays under the
//     250ms budget from the spec.

import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requirePartner } from '@foundations/auth/guards'
import {
  getPartnerDashboardSummary,
  type PartnerDashboardSummary,
} from '@features/partner-portal/queries/getMyPartnerProfile'
import {
  getPartnerRecentActivity,
  getPartnerDailySalesSeries,
} from '@features/partner-portal/queries/getPartnerDashboardExtras'
import { PartnerShell } from '@features/partner-portal/PartnerShell'
import { ActivityFeed } from '@features/partner-portal/components/ActivityFeed'
import { EarningsChart } from '@features/partner-portal/components/EarningsChart'
import { sensitivePageMetadata } from '@foundations/metadata'
import styles from './dashboard.module.css'

// P0.21 — `noindex` so the partner dashboard isn't indexed.
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Partner dashboard',
  description: 'Your Uthena partner dashboard — sales, payouts, courses.',
  path: '/partner',
})

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

function KpiCard({
  label,
  value,
  href,
}: {
  label: string
  value: string | number
  href?: string
}) {
  const inner = (
    <>
      <p className={styles.kpiLabel}>{label}</p>
      <p className={styles.kpiValue}>{value}</p>
    </>
  )
  return href ? (
    <Link href={href} className={styles.kpiCard}>
      {inner}
    </Link>
  ) : (
    <div className={styles.kpiCard}>{inner}</div>
  )
}

export default async function PartnerDashboardPage() {
  await requirePartner()

  // Parallelize all 7 reads: 5 inside getPartnerDashboardSummary
  // (3 product counts + lifetime RPC + month RPC) + 2 in the page
  // itself (activity + earnings). The inner Promise.all within
  // getPartnerDashboardSummary starts immediately, so the page's
  // outer Promise.all races the inner Promise.all — both run as a
  // single big parallel fan-out to Supabase.
  //
  // P12.4 — 2 of these 7 reads are new:
  //   - get_partner_month_sales_cents — feeds the "This month" KPI
  //   - get_partner_recent_activity   — feeds the activity feed
  //   - get_partner_daily_sales_series — feeds the earnings chart
  const [summary, activity, earnings] = await Promise.all([
    getPartnerDashboardSummary(),
    getPartnerRecentActivity({ limit: 10 }),
    getPartnerDailySalesSeries({ daysBack: 30 }),
  ])

  if (!summary) {
    redirect('/partner/onboarding')
  }

  return (
    <DashboardContent
      summary={summary}
      activity={activity}
      earnings={earnings}
    />
  )
}

function DashboardContent({
  summary,
  activity,
  earnings,
}: {
  summary: PartnerDashboardSummary
  activity: Awaited<ReturnType<typeof getPartnerRecentActivity>>
  earnings: Awaited<ReturnType<typeof getPartnerDailySalesSeries>>
}) {
  const { partner, productCount, publishedProductCount, pendingProductCount } = summary

  // P12.4 — sum the earnings series for the chart headline. Done
  // in the render path so the chart's totals are always derived
  // from the same data it renders; no second source of truth.
  const earningsTotalCents = earnings.reduce(
    (acc, p) => acc + (Number.isFinite(p.salesCents) ? p.salesCents : 0),
    0,
  )

  return (
    <PartnerShell>
      <div className={styles.wrap}>
        <header className={styles.header}>
          <h1 className={styles.h1}>Welcome, {partner.display_name}</h1>
          <p className={styles.lede}>Your partner hub. Manage courses, sales, and payouts.</p>
        </header>

        {partner.status === 'pending' && (
          <div className={styles.pendingBanner}>
            <p className={styles.pendingText}>
              <strong>Application under review.</strong> Your account is in{' '}
              <code>pending</code> status. You can use the dashboard and settings, but courses
              won&apos;t be published to the marketplace until an admin approves your
              application (typically within 2 business days).
            </p>
          </div>
        )}
        {partner.status === 'suspended' && (
          <div className={styles.suspendedBanner}>
            <p className={styles.pendingText}>
              <strong>Account suspended.</strong> Contact{' '}
              <a href="mailto:support@uthena.com" className={styles.bannerLink}>
                support@uthena.com
              </a>{' '}
              to resolve.
            </p>
          </div>
        )}

        <section className={styles.kpis} aria-label="Partner stats">
          <KpiCard
            label="Products"
            value={productCount}
            href={productCount > 0 ? '/partner/courses' : '/partner/instructor-upload'}
          />
          <KpiCard label="Published" value={publishedProductCount} />
          <KpiCard
            label="Pending review"
            value={pendingProductCount}
            href={pendingProductCount > 0 ? '/partner/courses' : '/partner/instructor-upload'}
          />
          <KpiCard label="Lifetime sales" value={formatMoney(summary.totalSalesCents)} href="/partner/sales" />
          {/* P12.4 — new "This month" KPI. Reads from
              get_partner_month_sales_cents via summary.monthSalesCents. */}
          <KpiCard
            label="This month"
            value={formatMoney(summary.monthSalesCents)}
            href="/partner/sales"
          />
        </section>

        {/* P12.4 — earnings chart (30-day window, inline SVG). */}
        <EarningsChart
          series={earnings}
          daysBack={earnings.length || 30}
          totalCents={earningsTotalCents}
        />

        {/* P12.4 — activity feed (last 10 events). */}
        <ActivityFeed entries={activity} />

        <section className={styles.quick} aria-label="Quick actions">
          <h2 className={styles.h2}>Quick actions</h2>
          <div className={styles.quickGrid}>
            <Link href="/partner/instructor-upload" className={styles.quickCard}>
              <p className={styles.quickTitle}>Upload a course</p>
              <p className={styles.quickHelp}>
                Add a new product to the catalog. Goes through admin review before
                publishing.
              </p>
            </Link>
            <Link href="/partner/courses" className={styles.quickCard}>
              <p className={styles.quickTitle}>Manage courses</p>
              <p className={styles.quickHelp}>
                Edit pricing, status, and content for your existing products.
              </p>
            </Link>
            <Link href="/partner/settings" className={styles.quickCard}>
              <p className={styles.quickTitle}>Settings</p>
              <p className={styles.quickHelp}>
                Bio, website, payout method, and tax information.
              </p>
            </Link>
            <Link href="/partner/payouts" className={styles.quickCard}>
              <p className={styles.quickTitle}>Payouts</p>
              <p className={styles.quickHelp}>
                Lifetime earnings, locked vs available, and recent ledger entries.
              </p>
            </Link>
          </div>
        </section>
      </div>
    </PartnerShell>
  )
}
