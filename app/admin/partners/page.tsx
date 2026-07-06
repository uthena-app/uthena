// /admin/partners — the admin partners list page (P14.3).
//
// RSC. Auth-gated via the /admin layout's requireRole(['admin','super_admin']).
// Belt-and-suspenders: also calls requireAdmin() below so the page-level
// queries never execute for an anon / wrong-role caller.
//
// On every page load:
//   1. Parse URL filters (search / status / kyc_status / tax_form_status /
//      applied date range).
//   2. Run two queries in parallel: getAdminPartnerStats() for the
//      5-card stats row + getAdminPartnersList() for the paginated table.
//   3. Write one audit-log row capturing the active filter bag + the
//      result count (defense-in-depth — admin reads of PII are
//      audit-logged per AGENTS.md rule 2).
//   4. Render: AdminShell + stats row + filter form + table + pagination.
//
// Slice 1 ships the read path end-to-end. Slices 2+ (filed as
// STUB-117) ship: bulk approve (typed confirmation), bulk suspend
// (typed "SUSPEND" + reason), per-row PII clicks (`view_partner_email`),
// CSV export (10/hr/admin rate limit, signed URL, 5-minute TTL),
// and the per-row action column.

import type { Metadata } from 'next'
import { requireAdmin } from '@foundations/auth/guards'
import { AdminShell } from '@features/admin'
import { sensitivePageMetadata } from '@foundations/metadata'
import {
  PartnerStatsCards,
  PartnerFilters,
  PartnerTable,
  PartnerPagination,
  getAdminPartnerStats,
  getAdminPartnersList,
  writePartnersViewAuditLog,
  DEFAULT_PARTNER_SORT,
  parsePartnerFilters,
  type PartnerSortKey,
} from '@features/admin/partners'
import styles from './partners.module.css'

// P0.21 — `noindex` (also inherited from /admin layout).
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Partners · Admin',
  description: 'Admin partners list — every partner with status, KYC + tax posture, courses count, lifetime revenue, and lifetime paid out.',
  path: '/admin/partners',
})
export const dynamic = 'force-dynamic'

type SearchParams = {
  q?: string
  status?: string
  kycStatus?: string
  taxFormStatus?: string
  appliedFrom?: string
  appliedTo?: string
  sort?: string
  page?: string
}

export default async function AdminPartnersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  // Belt-and-suspenders auth gate (the layout already calls requireRole).
  const user = await requireAdmin()

  const sp = await searchParams
  const filters = parsePartnerFilters(sp)
  const sort = (sp.sort ?? DEFAULT_PARTNER_SORT) as PartnerSortKey
  const page = sp.page ? Math.max(1, Number.parseInt(sp.page, 10) || 1) : 1

  // Two parallel reads: stats row + paginated list.
  const [stats, listResult] = await Promise.all([
    getAdminPartnerStats(),
    getAdminPartnersList({
      filters,
      sort,
      page,
      perPage: 50,
    }),
  ])

  // Best-effort audit log: failure here must NOT block the page render.
  // The user already got past the auth gate; the page is the
  // audit-worthy event, not the audit row itself.
  await writePartnersViewAuditLog({
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
    <AdminShell title="Partners">
      <header className={styles.header}>
        <h1 className={styles.h1}>Partners</h1>
        <p className={styles.sub}>
          Every partner with status, KYC + tax posture, courses count, lifetime
          revenue, and lifetime paid out. Default sort: lifetime revenue
          (high → low).
        </p>
      </header>

      <PartnerStatsCards stats={stats} />

      <PartnerFilters filters={filters} sort={sort} />

      <PartnerTable
        rows={listResult.rows}
        total={listResult.total}
        page={listResult.page}
        perPage={listResult.perPage}
        sort={listResult.sort}
        filters={filters}
      />

      <PartnerPagination
        total={listResult.total}
        page={listResult.page}
        perPage={listResult.perPage}
        filters={filters}
        sort={sort}
      />

      <div className={styles.placeholder}>
        <p className={styles.placeholderTitle}>Coming in next slices</p>
        <p className={styles.placeholderText}>
          Bulk approve + bulk suspend (typed “SUSPEND” confirmation),
          per-row PII-click audit logging (email reveals), and CSV export
          (10/hr/admin rate limit, signed URL, 5-minute TTL).
        </p>
      </div>
    </AdminShell>
  )
}