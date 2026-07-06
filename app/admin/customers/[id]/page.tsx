// /admin/customers/[id] — the customer detail page (P14.2 Slice 1).
//
// RSC. Auth-gated via the /admin layout's requireRole(['admin','super_admin'])
// AND a page-level requireAdmin() call (belt-and-suspenders — the data
// layer never executes for an anon / wrong-role caller).
//
// On every page load:
//   1. Validate the route param via parseCustomerDetailId (UUID).
//   2. Parse the ?tab= URL param via parseCustomerDetailTab.
//   3. Fetch the read-only detail via getAdminCustomerDetail (one RPC +
//      a parallel orders.first_seen_ip lookup).
//   4. Write one audit-log row (action='admin.customer_detail_viewed')
//      with the active tab.
//   5. Render: AdminShell + breadcrumb + customer header + 9-tab nav
//      + the matching tab content. The Overview tab ships end-to-end;
//      the remaining 8 tabs render a "coming soon" panel that lists
//      what will land there (deferral is filed as STUB-115; no
//      placeholder comments).
//
// Slice 1 ships the read path + masked-by-default display. The Reveal
// interaction (30-second auto-mask + per-reveal audit row) lands in
// Slice 2 — the reveal RPCs already exist in migration 0053.
//
// 404 when:
//   - id is not a valid UUID → notFound()
//   - profiles row doesn't exist OR is an admin row → notFound()
//   - RPC returns 0 rows (orphaned / deleted) → notFound()
//
// URL contract:
//   /admin/customers/[id]            → Overview tab (default)
//   /admin/customers/[id]?tab=...    → matching tab

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@foundations/auth/guards'
import { AdminShell } from '@features/admin'
import { sensitivePageMetadata } from '@foundations/metadata'
import {
  ComingSoonTab,
  CustomerDetailTabs,
  CustomerDetailOverview,
  getAdminCustomerDetail,
  writeCustomerDetailViewAuditLog,
} from '@features/admin/customers'
import { parseCustomerDetailId } from '@features/admin/customers/queries/parseCustomerDetailId'
import { parseCustomerDetailTab } from '@features/admin/customers/queries/parseCustomerDetailTab'
import styles from './page.module.css'

// P0.21 — `noindex` (inherited from /admin layout too).
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Customer · Admin',
  description:
    'Admin customer detail — profile, lifetime stats, risk score, contact. Read-only overview tab.',
  path: '/admin/customers/[id]',
})
export const dynamic = 'force-dynamic'

type SearchParams = {
  tab?: string
}

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<SearchParams>
}

export default async function AdminCustomerDetailPage({
  params,
  searchParams,
}: Props) {
  // Belt-and-suspenders auth: never invoke the data layer for anon /
  // non-admin callers. The /admin layout already gates this; this
  // is the second gate.
  const user = await requireAdmin()
  if (!user) return null

  const { id: rawId } = await params
  const sp = await searchParams

  // Validate the route param. parseCustomerDetailId is strict — any
  // non-uuid returns null → 404 (we never call the RPC with garbage).
  const canonicalId = parseCustomerDetailId(rawId)
  if (!canonicalId) {
    notFound()
  }

  // Parse the active tab. Invalid / missing values fall back to
  // 'overview' (graceful degradation — same pattern as the catalog
  // sort key).
  const activeTab = parseCustomerDetailTab(sp.tab)

  // Single read for the full Overview payload.
  const detail = await getAdminCustomerDetail(canonicalId)
  if (!detail) {
    notFound()
  }

  // Best-effort audit log: failure here must NOT block the page
  // render. The page load is the audit-worthy event; the audit row
  // is the trail marker.
  await writeCustomerDetailViewAuditLog({
    adminId: user.id,
    actorEmail: user.email,
    customerUserId: canonicalId,
    tab: activeTab,
    ipAddress: null,
    userAgent: null,
  }).catch(() => null)

  return (
    <AdminShell title={`Customer · ${detail.display_name}`}>
      <nav className={styles.crumb} aria-label="Breadcrumb">
        <Link href="/admin/customers" className={styles.crumbLink}>
          ← All customers
        </Link>
      </nav>

      <header className={styles.header}>
        <h1 className={styles.h1}>{detail.display_name}</h1>
        <p className={styles.sub}>
          {detail.role} · user_id <code className={styles.code}>{detail.user_id}</code>
        </p>
      </header>

      <CustomerDetailTabs
        customerUserId={canonicalId}
        activeTab={activeTab}
      />

      {activeTab === 'overview' ? (
        <CustomerDetailOverview detail={detail} />
      ) : (
        <ComingSoonTab tab={activeTab} />
      )}
    </AdminShell>
  )
}