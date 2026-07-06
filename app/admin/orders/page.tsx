// /admin/orders — the admin orders list page (P14.7).
//
// RSC. Auth-gated via the /admin layout's requireRole(['admin','super_admin']).
// Belt-and-suspenders: also calls requireAdmin() below so the page-level
// queries never execute for an anon / wrong-role caller.
//
// On every page load:
//   1. Parse URL filters (customerEmail + status + date range +
//      affiliateId + productId + partnerId).
//   2. Run two queries in parallel: getAdminOrderStats() for the
//      5-card stats row + getAdminOrdersList() for the paginated table.
//   3. Write one audit-log row capturing the active filter bag + page +
//      result count (defense-in-depth — admin reads of PII are
//      audit-logged per AGENTS.md rule 2).
//   4. Render: AdminShell + stats row + filter form + table + pagination.
//
// Slice 1 ships the read path end-to-end. Slices 2+ (filed as
// STUB-121) ship: CSV export (with Bunny Storage signed URL +
// 10/hr/admin rate limit + file_downloads audit), the manual-refund
// button (with the 14d admin-grace-window gate + typed
// confirmation), per-row PII clicks (`view_order_pii`), the row
// "Refund" prefill-link to /admin/refunds, dropdown population for
// affiliate/product/partner IDs, and the per-row detail page (P14.8).

import type { Metadata } from 'next'
import { requireAdmin } from '@foundations/auth/guards'
import { AdminShell } from '@features/admin'
import { sensitivePageMetadata } from '@foundations/metadata'
import {
  OrderStatsCards,
  OrderFilters,
  OrderTable,
  OrderPagination,
  getAdminOrderStats,
  getAdminOrdersList,
  writeOrdersViewAuditLog,
  parseOrderFilters,
} from '@features/admin/orders'
import styles from './orders.module.css'

// P0.21 — `noindex` (also inherited from /admin layout).
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Orders · Admin',
  description:
    'Admin orders list — every order with customer, status, total, items, partner share, and affiliate attribution. Default sort: date (desc).',
  path: '/admin/orders',
})
export const dynamic = 'force-dynamic'

type SearchParams = {
  status?: string
  from?: string
  to?: string
  customerEmail?: string
  affiliateId?: string
  productId?: string
  partnerId?: string
  page?: string
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  // Belt-and-suspenders auth gate (the layout already calls requireRole).
  const user = await requireAdmin()

  const sp = await searchParams
  const filters = parseOrderFilters(sp)
  const page = sp.page ? Math.max(1, Number.parseInt(sp.page, 10) || 1) : 1

  // Two parallel reads: stats row + paginated list.
  const [stats, listResult] = await Promise.all([
    getAdminOrderStats(),
    getAdminOrdersList({
      filters,
      page,
      perPage: 50,
    }),
  ])

  // Best-effort audit log: failure here must NOT block the page render.
  // The user already got past the auth gate; the page is the
  // audit-worthy event, not the audit row itself.
  await writeOrdersViewAuditLog({
    adminId: user.id,
    actorEmail: user.email,
    filters,
    page,
    resultCount: listResult.rows.length,
    ipAddress: null,
    userAgent: null,
  }).catch(() => null)

  return (
    <AdminShell title="Orders">
      <header className={styles.header}>
        <h1 className={styles.h1}>Orders</h1>
        <p className={styles.sub}>
          Every order with customer, status, total, items, partner share, and
          affiliate attribution. Default sort: date (desc). PII is admin-visible
          and audit-logged.
        </p>
      </header>

      <OrderStatsCards stats={stats} />

      <OrderFilters filters={filters} />

      <OrderTable
        rows={listResult.rows}
        total={listResult.total}
        page={listResult.page}
        perPage={listResult.perPage}
        filters={filters}
      />

      <OrderPagination
        total={listResult.total}
        page={listResult.page}
        perPage={listResult.perPage}
        filters={filters}
      />

      <div className={styles.placeholder}>
        <p className={styles.placeholderTitle}>Coming in next slices</p>
        <p className={styles.placeholderText}>
          CSV export (with Bunny Storage signed URL + 10/hr/admin rate limit +
          file_downloads audit), the per-row manual-refund button (14d admin
          grace window + typed confirmation + prefill-link to /admin/refunds),
          per-row PII-click audit logging, dropdown population for the
          affiliate / product / partner filters, and the order detail page
          (P14.8).
        </p>
      </div>
    </AdminShell>
  )
}
