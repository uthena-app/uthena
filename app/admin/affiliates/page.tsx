// /admin/affiliates — the admin affiliates list page (P14.6).
//
// RSC. Auth-gated via the /admin layout's requireRole(['admin','super_admin']).
// Belt-and-suspenders: also calls requireAdmin() below so the page-level
// queries never execute for an anon / wrong-role caller.
//
// On every page load:
//   1. Parse URL filters (search / status / signup date range).
//   2. Run two queries in parallel: getAdminAffiliateStats() for the
//      5-card stats row + getAdminAffiliatesList() for the paginated table.
//   3. Write one audit-log row capturing the active filter bag + the
//      result count (defense-in-depth — admin reads of PII are
//      audit-logged per AGENTS.md rule 2).
//   4. Render: AdminShell + stats row + filter form + table + pagination.
//
// Slice 1 ships the read path end-to-end. Slices 2+ (filed as
// STUB-120) ship: bulk approve (typed confirmation, mints default link),
// bulk suspend (typed "SUSPEND" + reason), per-row PII clicks
// (`view_affiliate_email`), CSV export (10/hr/admin rate limit,
// signed URL, 5-minute TTL), and the per-row action column.

import type { Metadata } from 'next'
import { requireAdmin } from '@foundations/auth/guards'
import { AdminShell } from '@features/admin'
import { sensitivePageMetadata } from '@foundations/metadata'
import {
  AffiliateStatsCards,
  AffiliateFilters,
  AffiliateTable,
  AffiliatePagination,
  getAdminAffiliateStats,
  getAdminAffiliatesList,
  writeAffiliatesViewAuditLog,
  DEFAULT_AFFILIATE_SORT,
  parseAffiliateFilters,
  type AffiliateSortKey,
} from '@features/admin/affiliates'
import styles from './affiliates.module.css'

// P0.21 — `noindex` (also inherited from /admin layout).
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Affiliates · Admin',
  description:
    'Admin affiliates list — every affiliate with status, lifetime earnings, 30-day clicks + conversions, and conversion rate.',
  path: '/admin/affiliates',
})
export const dynamic = 'force-dynamic'

type SearchParams = {
  q?: string
  status?: string
  joinedFrom?: string
  joinedTo?: string
  sort?: string
  page?: string
}

export default async function AdminAffiliatesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  // Belt-and-suspenders auth gate (the layout already calls requireRole).
  const user = await requireAdmin()

  const sp = await searchParams
  const filters = parseAffiliateFilters(sp)
  const sort = (sp.sort ?? DEFAULT_AFFILIATE_SORT) as AffiliateSortKey
  const page = sp.page ? Math.max(1, Number.parseInt(sp.page, 10) || 1) : 1

  // Two parallel reads: stats row + paginated list.
  const [stats, listResult] = await Promise.all([
    getAdminAffiliateStats(),
    getAdminAffiliatesList({
      filters,
      sort,
      page,
      perPage: 50,
    }),
  ])

  // Best-effort audit log: failure here must NOT block the page render.
  // The user already got past the auth gate; the page is the
  // audit-worthy event, not the audit row itself.
  await writeAffiliatesViewAuditLog({
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
    <AdminShell title="Affiliates">
      <header className={styles.header}>
        <h1 className={styles.h1}>Affiliates</h1>
        <p className={styles.sub}>
          Every affiliate with status, lifetime earnings, 30-day clicks +
          conversions, and conversion rate. Default sort: lifetime earned
          (high → low).
        </p>
      </header>

      <AffiliateStatsCards stats={stats} />

      <AffiliateFilters filters={filters} sort={sort} />

      <AffiliateTable
        rows={listResult.rows}
        total={listResult.total}
        page={listResult.page}
        perPage={listResult.perPage}
        sort={listResult.sort}
        filters={filters}
      />

      <AffiliatePagination
        total={listResult.total}
        page={listResult.page}
        perPage={listResult.perPage}
        filters={filters}
        sort={sort}
      />

      <div className={styles.placeholder}>
        <p className={styles.placeholderTitle}>Coming in next slices</p>
        <p className={styles.placeholderText}>
          Bulk approve + bulk suspend (typed “SUSPEND” confirmation +
          reason), per-row PII-click audit logging (email reveals), and
          CSV export (10/hr/admin rate limit, signed URL, 5-minute TTL).
        </p>
      </div>
    </AdminShell>
  )
}