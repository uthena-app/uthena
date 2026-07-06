// /admin/partners/[id] — the partner detail page (P14.4 Slice 1).
//
// RSC. Auth-gated via the /admin layout's requireRole(['admin','super_admin'])
// AND a page-level requireAdmin() call (belt-and-suspenders — the data
// layer never executes for an anon / wrong-role caller).
//
// On every page load:
//   1. Validate the route param via parsePartnerDetailId (bigint).
//   2. Parse the ?tab= URL param via parsePartnerDetailTab.
//   3. Fetch the read-only detail via getAdminPartnerDetail
//      (1 RPC + 1 PII-aware payout email envelope lookup).
//   4. Write one audit-log row (action='admin.partner_detail_viewed')
//      with the active tab.
//   5. Render: AdminShell + breadcrumb + partner header + 10-tab nav
//      + the matching tab content. The Overview tab ships end-to-end;
//      the remaining 9 tabs render a "coming soon" panel that lists
//      what will land there (deferral is filed as STUB-118; no
//      placeholder comments).
//
// Slice 1 ships the read path + masked-by-default display. The Reveal
// interactions (payout email, tax_id, KYC doc, customer email × 2)
// all land in Slice 2 with the per-field audit-log action set.
//
// 404 when:
//   - id is not a valid bigint → notFound()
//   - partners row doesn't exist → notFound()
//   - RPC returns 0 rows → notFound()
//
// URL contract:
//   /admin/partners/[id]            → Overview tab (default)
//   /admin/partners/[id]?tab=...    → matching tab

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@foundations/auth/guards'
import { AdminShell } from '@features/admin'
import { sensitivePageMetadata } from '@foundations/metadata'
import {
  ComingSoonTab,
  PartnerDetailTabs,
  PartnerDetailOverview,
  PartnerActionRail,
  getAdminPartnerDetail,
  writePartnerDetailViewAuditLog,
} from '@features/admin/partners'
import { parsePartnerDetailId } from '@features/admin/partners/queries/parsePartnerDetailId'
import { parsePartnerDetailTab } from '@features/admin/partners/queries/parsePartnerDetailTab'
import styles from './page.module.css'

// P0.21 — `noindex` (inherited from /admin layout too).
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Partner · Admin',
  description:
    'Admin partner detail — status, KYC, tax, courses, sales, payouts, refunds. Read-only overview tab.',
  path: '/admin/partners/[id]',
})
export const dynamic = 'force-dynamic'

type SearchParams = {
  tab?: string
}

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<SearchParams>
}

export default async function AdminPartnerDetailPage({
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

  // Validate the route param. parsePartnerDetailId is strict — any
  // non-bigint returns null → 404 (we never call the RPC with garbage).
  const canonicalId = parsePartnerDetailId(rawId)
  if (!canonicalId) {
    notFound()
  }

  // Parse the active tab. Invalid / missing values fall back to
  // 'overview' (graceful degradation — same pattern as the catalog
  // sort key).
  const activeTab = parsePartnerDetailTab(sp.tab)

  // Single read for the full Overview payload. The RPC composes 6
  // lateral joins (partner + profile + courses + revenue + paid +
  // downloads + last_active_at) in 1 round-trip. The TS wrapper
  // decrypts + masks the payout email server-side.
  const detail = await getAdminPartnerDetail(canonicalId)
  if (!detail) {
    notFound()
  }

  // Best-effort audit log: failure here must NOT block the page
  // render. The page load is the audit-worthy event; the audit row
  // is the trail marker.
  await writePartnerDetailViewAuditLog({
    adminId: user.id,
    actorEmail: user.email,
    partnerId: canonicalId,
    tab: activeTab,
    ipAddress: null,
    userAgent: null,
  }).catch(() => null)

  return (
    <AdminShell title={`Partner · ${detail.display_name}`}>
      <nav className={styles.crumb} aria-label="Breadcrumb">
        <Link href="/admin/partners" className={styles.crumbLink}>
          ← All partners
        </Link>
      </nav>

      <header className={styles.header}>
        <h1 className={styles.h1}>{detail.display_name}</h1>
        <p className={styles.sub}>
          {detail.status} · partner_id <code className={styles.code}>{detail.partner_id}</code>
        </p>
      </header>

      <PartnerDetailTabs partnerId={canonicalId} activeTab={activeTab} />

      <div className={styles.layout}>
        <div className={styles.main}>
          {activeTab === 'overview' ? (
            <PartnerDetailOverview detail={detail} />
          ) : (
            <ComingSoonTab tab={activeTab} />
          )}
        </div>

        <PartnerActionRail
          partnerId={detail.partner_id}
          partnerDisplayName={detail.display_name}
          status={detail.status}
        />
      </div>
    </AdminShell>
  )
}