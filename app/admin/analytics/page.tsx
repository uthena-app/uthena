// /admin/analytics — the admin's analytics dashboard (P14.16).
//
// RSC. Auth-gated via /admin layout's requireRole(['admin','super_admin']).
// Belt-and-suspenders: also calls requireAdmin() below so the page-level
// queries never execute for an anon / wrong-role caller.
//
// On every page load:
//   1. Parse URL date-range params (preset or custom from/to).
//   2. Run getAnalyticsKpi(range) — the 6-KPI aggregate.
//   3. Write one audit-log row (action='admin.analytics_viewed',
//      target_kind='analytics_daily', metadata carries the date range).
//   4. Render: AdminShell + range picker + KPI cards + empty-state copy
//      when the nightly job hasn't populated yet.
//
// Slice 1 ships the schema foundation (analytics_daily table) + the
// 6-KPI surface + URL-driven range picker + audit-log writer. Charts,
// top-10 lists, funnel, cohort grid, and CSV exports land in Slices
// 2-5 (filed as STUB-127).

import type { Metadata } from 'next'
import { requireAdmin } from '@foundations/auth/guards'
import { sensitivePageMetadata } from '@foundations/metadata'
import { AdminShell } from '@features/admin'
import {
  AnalyticsKpiCards,
  AnalyticsRangePicker,
  DEFAULT_ANALYTICS_RANGE_PRESET,
  EMPTY_ANALYTICS_KPI,
  getAnalyticsKpi,
  parseAnalyticsRange,
  writeAnalyticsViewAuditLog,
  type AnalyticsRange,
} from '@features/admin/analytics'
import styles from './page.module.css'

// P0.21 — `noindex` (also inherited from /admin layout).
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Analytics · Admin',
  description:
    'Admin analytics dashboard — aggregate platform metrics (revenue, orders, signups, conversion, refund rate, chargeback rate). Read-only; daily-aggregated.',
  path: '/admin/analytics',
})
export const dynamic = 'force-dynamic'

type SearchParams = {
  preset?: string
  from?: string
  to?: string
}

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  // Belt-and-suspenders auth gate (the layout already calls requireRole).
  const user = await requireAdmin()

  const sp = await searchParams
  const range: AnalyticsRange = parseAnalyticsRange({
    preset: sp.preset,
    from: sp.from,
    to: sp.to,
  })

  // Read the 6 KPIs (fail-soft to EMPTY_ANALYTICS_KPI).
  const kpi = await getAnalyticsKpi(range)

  // Determine if the page is in the "no data yet" state (nightly job
  // hasn't populated the table). Slice 1 always lands here — the
  // nightly aggregation job is STUB-127 Slice 2.
  const isEmpty =
    kpi.totalRevenueCents === 0 &&
    kpi.totalOrders === 0 &&
    kpi.newSignups === 0

  // Best-effort audit log: failure here must NOT block the page render.
  // The user already got past the auth gate; the page is the
  // audit-worthy event, not the audit row itself.
  await writeAnalyticsViewAuditLog({
    adminId: user.id,
    actorEmail: user.email,
    range,
    segment: 'all',
    rowCount: 0,
  }).catch(() => null)

  return (
    <AdminShell title="Analytics">
      <header className={styles.header}>
        <h1 className={styles.h1}>Analytics</h1>
        <p className={styles.sub}>
          Aggregate platform metrics for the selected date range. Daily-aggregated
          from <code>analytics_daily</code> — no raw orders queried.
        </p>
      </header>

      <AnalyticsRangePicker
        activePreset={
          range.kind === 'preset' ? range.preset : DEFAULT_ANALYTICS_RANGE_PRESET
        }
      />

      <AnalyticsKpiCards kpi={kpi} range={range} />

      {isEmpty ? (
        <section className={styles.empty} aria-label="No analytics data yet">
          <h2 className={styles.emptyTitle}>No analytics data yet</h2>
          <p className={styles.emptyBody}>
            The nightly aggregation job (filed as <strong>STUB-127 Slice 2</strong>)
            hasn&apos;t populated <code>analytics_daily</code> for this date range.
            Once it runs, the KPI cards above will surface real numbers. Charts,
            top-10 lists, and the cohort grid ship in subsequent slices.
          </p>
        </section>
      ) : (
        <section className={styles.placeholder} aria-label="Charts coming next">
          <h2 className={styles.placeholderTitle}>Charts — Slice 2+</h2>
          <p className={styles.placeholderBody}>
            Revenue line chart, orders per day, signups per day, top-10
            products / partners / affiliates, funnel, and cohort grid ship
            in STUB-127 Slices 2-5 once the nightly aggregation job is wired.
          </p>
        </section>
      )}
    </AdminShell>
  )
}