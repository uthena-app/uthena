// /admin/customers — the admin customers list page (P14.1).
//
// RSC. Auth-gated via the /admin layout's requireRole(['admin','super_admin']).
// Belt-and-suspenders: also calls requireAdmin() below so the page-level
// queries never execute for an anon / wrong-role caller.
//
// On every page load:
//   1. Parse URL filters (search / role / status / signup date range /
//      lifetime spend range / risk score range).
//   2. Run two queries in parallel: getAdminCustomerStats() for the
//      5-card stats row + getAdminCustomersList() for the paginated table.
//   3. Write one audit-log row capturing the active filter bag + the
//      result count (defense-in-depth — admin reads of PII are
//      audit-logged per AGENTS.md rule 2).
//   4. Render: AdminShell + stats row + filter form + table + pagination.
//
// Slice 1 ships the read path end-to-end. Slices 2+ (filed as
// STUB-114) ship: per-row PII clicks (`view_customer_email`), bulk
// email via Resend (capped at 100), bulk suspend (typed "SUSPEND"
// confirmation), CSV export (10/hr/admin rate limit, signed URL,
// 5-minute TTL), and the per-row action column.

import type { Metadata } from 'next'
import { requireAdmin } from '@foundations/auth/guards'
import { AdminShell } from '@features/admin'
import { sensitivePageMetadata } from '@foundations/metadata'
import {
  CustomerStatsCards,
  CustomerFilters,
  CustomerTable,
  CustomerPagination,
  getAdminCustomerStats,
  getAdminCustomersList,
  writeCustomersViewAuditLog,
  DEFAULT_CUSTOMER_SORT,
  parseCustomerFilters,
  type CustomerSortKey,
} from '@features/admin/customers'
import styles from './customers.module.css'

// P0.21 — `noindex` (also inherited from /admin layout).
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Customers · Admin',
  description: 'Admin customers list — every profile (customer, partner, affiliate) with lifetime spend, status, and risk score.',
  path: '/admin/customers',
})
export const dynamic = 'force-dynamic'

type SearchParams = {
  q?: string
  role?: string
  status?: string
  signupFrom?: string
  signupTo?: string
  spendMinCents?: string
  spendMaxCents?: string
  riskMin?: string
  riskMax?: string
  sort?: string
  page?: string
}

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  // Belt-and-suspenders auth gate (the layout already calls requireRole).
  const user = await requireAdmin()

  const sp = await searchParams
  const filters = parseCustomerFilters(sp)
  const sort = (sp.sort ?? DEFAULT_CUSTOMER_SORT) as CustomerSortKey
  const page = sp.page ? Math.max(1, Number.parseInt(sp.page, 10) || 1) : 1

  // Two parallel reads: stats row + paginated list.
  const [stats, listResult] = await Promise.all([
    getAdminCustomerStats(),
    getAdminCustomersList({
      filters,
      sort,
      page,
      perPage: 50,
    }),
  ])

  // Best-effort audit log: failure here must NOT block the page render.
  // The user already got past the auth gate; the page is the
  // audit-worthy event, not the audit row itself.
  await writeCustomersViewAuditLog({
    adminId: user.id,
    actorEmail: user.email,
    filters,
    sort,
    page,
    resultCount: listResult.rows.length,
    ipAddress: null,
    userAgent: null,
  }).catch(() => null)

  return (
    <AdminShell title="Customers">
      <header className={styles.header}>
        <h1 className={styles.h1}>Customers</h1>
        <p className={styles.sub}>
          Every non-admin profile. Default sort: lifetime spend (high → low). Risk score is
          computed per-row from refunds + disputes + unresolved risk signals.
        </p>
      </header>

      <CustomerStatsCards stats={stats} />

      <CustomerFilters filters={filters} sort={sort} />

      <CustomerTable
        rows={listResult.rows}
        total={listResult.total}
        page={listResult.page}
        perPage={listResult.perPage}
        sort={listResult.sort}
        filters={filters}
      />

      <CustomerPagination
        total={listResult.total}
        page={listResult.page}
        perPage={listResult.perPage}
        filters={filters}
        sort={sort}
      />
    </AdminShell>
  )
}