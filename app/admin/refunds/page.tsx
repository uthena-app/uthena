// /admin/refunds — the admin refund approval queue (P14.9 Slice 1).
//
// RSC. Auth-gated via the /admin layout's
// requireRole(['admin','super_admin']) AND a page-level requireAdmin()
// call (belt-and-suspenders — the data layer never executes for an
// anon / wrong-role caller).
//
// On every page load:
//   1. Parse URL filters (status / from / to / customerEmail /
//      productId) + page + refundId (the detail-panel id when the
//      admin clicked a row).
//   2. Default status filter is 'pending' (spec line 65: "Default
//      filter is `status='requested'`" — DB `pending` maps to spec
//      `requested`). Applied on first visit only; explicit `?status=`
//      overrides (including "All" via `?status=` empty).
//   3. Fetch the read path via getAdminRefundStats +
//      getAdminRefundsQueue + (when refundId is selected)
//      getAdminRefundDetail in Promise.all.
//   4. Write one audit-log row per page load — captures the active
//      filter bag + page + result count + (when applicable) the
//      detail-panel refund id.
//   5. Render: AdminShell + breadcrumb + stats row + filter form +
//      queue list + (when refundId is selected) detail panel +
//      pagination.
//
// Slice 1 ships the read path end-to-end. Slices 2+ (filed as
// STUB-122) ship: Approve full action + Approve partial action +
// Reject action + Stripe webhook retry + proof-file signed URL +
// customer email on rejection + Reveal-PII interaction for the
// detail panel (email + IP) + rate-limit infrastructure.

import type { Metadata } from 'next'
import { requireAdmin } from '@foundations/auth/guards'
import { AdminShell } from '@features/admin'
import { sensitivePageMetadata } from '@foundations/metadata'
import {
  RefundStatsCards,
  RefundFilters,
  RefundQueueList,
  RefundPagination,
  RefundDetailPanel,
  getAdminRefundStats,
  getAdminRefundsQueue,
  getAdminRefundDetail,
  writeRefundsViewAuditLog,
  parseRefundFilters,
  parseRefundId,
  DEFAULT_REFUNDS_PAGE_SIZE,
} from '@features/admin/refunds'
import styles from './refunds.module.css'

// P0.21 — `noindex` (also inherited from /admin layout).
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Refunds · Admin',
  description:
    'Admin refund approval queue — every refund request with customer, order, reason, and reversal impact preview. FIFO sort by requested_at.',
  path: '/admin/refunds',
})
export const dynamic = 'force-dynamic'

type SearchParams = {
  status?: string
  from?: string
  to?: string
  customerEmail?: string
  productId?: string
  page?: string
  refundId?: string
}

export default async function AdminRefundsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  // Belt-and-suspenders auth gate (the layout already calls requireRole).
  const user = await requireAdmin()

  const sp = await searchParams
  const filters = parseRefundFilters(sp)
  const page = sp.page ? Math.max(1, Number.parseInt(sp.page, 10) || 1) : 1
  const detailRefundId = parseRefundId(sp.refundId)

  // Three parallel reads: stats row + queue list + (when detail panel
  // is requested) the detail RPC. The detail RPC is a single round-
  // trip with 4 CTEs; the queue RPC is one round-trip; the stats RPC
  // is one round-trip. Promise.all keeps the wall-clock at the slowest.
  const [stats, queueResult, detail] = await Promise.all([
    getAdminRefundStats(),
    getAdminRefundsQueue({
      filters,
      page,
      perPage: DEFAULT_REFUNDS_PAGE_SIZE,
    }),
    detailRefundId !== null
      ? getAdminRefundDetail(detailRefundId)
      : Promise.resolve(null),
  ])

  // Best-effort audit log: failure here must NOT block the page render.
  // The page load + detail-panel open are the audit-worthy events.
  await writeRefundsViewAuditLog({
    adminId: user.id,
    actorEmail: user.email,
    detailRefundId,
    filters,
    page,
    resultCount: queueResult.rows.length,
    ipAddress: null,
    userAgent: null,
  }).catch(() => null)

  // Compute the SLA-overdue count for the topbar callout (spec line 16:
  // "SLA: 24h · avg 8h"). Pinned to the queue list rendering — when the
  // admin filters, the callout reflects the visible set.
  const overdueCount = queueResult.rows.filter((r) => {
    if (r.status !== 'pending') return false
    const ageMs = Date.now() - Date.parse(r.requested_at)
    return Number.isFinite(ageMs) && ageMs > 24 * 60 * 60 * 1000
  }).length

  return (
    <AdminShell title="Refunds">
      <header className={styles.header}>
        <h1 className={styles.h1}>Refunds</h1>
        <p className={styles.sub}>
          {queueResult.total.toLocaleString('en-US')} refund request
          {queueResult.total === 1 ? '' : 's'} matching your filters.
          {overdueCount > 0 ? (
            <>
              {' '}
              <span className={styles.overdue} data-overdue="true">
                {overdueCount} overdue (SLA 24h)
              </span>
            </>
          ) : null}
        </p>
      </header>

      <RefundStatsCards stats={stats} />

      <RefundFilters filters={filters} />

      <div className={styles.layout} data-has-detail={detail !== null}>
        <section className={styles.listPane} aria-label="Refund queue">
          <RefundQueueList
            rows={queueResult.rows}
            total={queueResult.total}
            page={queueResult.page}
            perPage={queueResult.perPage}
            filters={filters}
            activeRefundId={detailRefundId}
          />

          <RefundPagination
            total={queueResult.total}
            page={queueResult.page}
            perPage={queueResult.perPage}
            filters={filters}
          />
        </section>

        {detail !== null ? (
          <section className={styles.detailPane} aria-label="Refund detail panel">
            <RefundDetailPanel detail={detail} filters={filters} />
          </section>
        ) : null}
      </div>

      <div className={styles.placeholder}>
        <p className={styles.placeholderTitle}>Coming in next slices</p>
        <p className={styles.placeholderText}>
          Approve full / Approve partial / Reject actions (with 20/hr approve
          + 50/hr reject rate limits), Stripe refund call, atomic transaction
          wrapping refunds + payout_ledger reversal + affiliate_commissions
          reversal, webhook retry, signed-URL proof download (24h TTL,
          file_downloads audit), customer rejection email via Resend,
          Reveal-PII interaction for the detail panel (masked email +
          IP).
        </p>
      </div>
    </AdminShell>
  )
}