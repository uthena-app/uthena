// /admin/orders/[id] — the admin order detail page (P14.8 Slice 1).
//
// RSC. Auth-gated via the /admin layout's requireRole(['admin','super_admin'])
// AND a page-level requireAdmin() call (belt-and-suspenders — the data
// layer never executes for an anon / wrong-role caller).
//
// On every page load:
//   1. Validate the route param via parseOrderDetailId (positive bigint).
//   2. Parse the ?tab= URL param via parseOrderDetailTab (single 'overview'
//      entry in Slice 1).
//   3. Fetch the read-only detail via getAdminOrderDetail (one RPC) +
//      getOrderRefunds + getOrderEvents in parallel (Promise.all).
//   4. Write one audit-log row (action='admin.order_detail_viewed')
//      with the active tab.
//   5. Render: AdminShell + breadcrumb + order header + tab nav +
//      the Overview tab content (Header / Fraud callout / Customer /
//      Order / Stripe / IP / Partner / Affiliate / Refunds / Events).
//
// Slice 1 ships the read path + masked-by-default display. Slice 2
// will add: Reveal interaction (with 30s auto-mask + per-reveal
// audit row) + Destructive actions (issue_manual_refund /
// mark_fraudulent / resend_receipt / copy_payment_intent_id) +
// Admin notes (admin_note audit action) + Customer-view embed of
// /account/orders/[id] (read-only mirror).
//
// 404 when:
//   - id is not a valid positive bigint → notFound()
//   - the order doesn't exist (RPC returns 0 rows) → notFound()
//   - the RPC errored → notFound()

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@foundations/auth/guards'
import { AdminShell } from '@features/admin'
import { sensitivePageMetadata } from '@foundations/metadata'
import {
  OrderDetailTabs,
  OrderDetailOverview,
  getAdminOrderDetail,
  getOrderRefunds,
  getOrderEvents,
  writeOrderDetailViewAuditLog,
} from '@features/admin/order-detail'
import { parseOrderDetailId } from '@features/admin/order-detail/queries/parseOrderDetailId'
import { parseOrderDetailTab } from '@features/admin/order-detail/queries/parseOrderDetailTab'
import styles from './page.module.css'

// P0.21 — `noindex` (inherited from /admin layout too).
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Order · Admin',
  description:
    'Admin order detail — order, customer, Stripe, IP, partner, affiliate, refunds, events. Read-only overview tab.',
  path: '/admin/orders/[id]',
})
export const dynamic = 'force-dynamic'

type SearchParams = {
  tab?: string
}

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<SearchParams>
}

export default async function AdminOrderDetailPage({
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

  // Validate the route param. parseOrderDetailId is strict — any
  // non-numeric / oversized / decimal / signed / scientific input
  // returns null → 404 (we never call the RPC with garbage).
  const canonicalId = parseOrderDetailId(rawId)
  if (!canonicalId) {
    notFound()
  }

  // Parse the active tab. Invalid / missing values fall back to
  // 'overview' (graceful degradation — same pattern as the catalog
  // sort key).
  const activeTab = parseOrderDetailTab(sp.tab)

  // Three parallel reads — detail + refunds + events. The detail
  // RPC is the heavy one; refunds + events are narrower scans on
  // indexes (`refunds.order_id`, `admin_audit_log.target_id`,
  // `processed_webhooks.payload->>'order_id'`). Promise.all keeps
  // the wall-clock at the slowest single round-trip.
  const [detail, refunds, events] = await Promise.all([
    getAdminOrderDetail(canonicalId),
    getOrderRefunds({ rawOrderId: canonicalId }),
    getOrderEvents({ rawOrderId: canonicalId }),
  ])

  if (!detail) {
    notFound()
  }

  // Best-effort audit log: failure here must NOT block the page
  // render. The page load is the audit-worthy event; the audit row
  // is the trail marker.
  await writeOrderDetailViewAuditLog({
    adminId: user.id,
    actorEmail: user.email,
    orderId: canonicalId,
    tab: activeTab,
    ipAddress: null,
    userAgent: null,
  }).catch(() => null)

  return (
    <AdminShell title={`Order #${detail.order_id}`}>
      <nav className={styles.crumb} aria-label="Breadcrumb">
        <Link href="/admin/orders" className={styles.crumbLink}>
          ← All orders
        </Link>
      </nav>

      <header className={styles.header}>
        <h1 className={styles.h1}>Order #{detail.order_id}</h1>
        <p className={styles.sub}>
          {detail.currency} · {detail.customer_display_name} ·{' '}
          <code className={styles.code}>created {detail.created_at}</code>
        </p>
      </header>

      <OrderDetailTabs orderId={canonicalId} activeTab={activeTab} />

      {activeTab === 'overview' ? (
        <OrderDetailOverview
          orderId={canonicalId}
          detail={detail}
          refunds={refunds}
          events={events}
        />
      ) : null}
    </AdminShell>
  )
}
