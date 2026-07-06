// /admin/payouts/partner/[id] — admin's per-partner payouts detail
// page. RSC. Reads via service-role through `getAdminPartnerPayouts`
// (admin sees every partner's rows regardless of the partner RLS
// policy). The page composes the new `<AdminPartnerPayouts>`
// feature component for the actual rendering — this file is the
// thin route that owns auth, metadata, and the 404 short-circuit.
//
// P6.8 Slice 1 — read-only. Slice 2+ (force-adjust / clawback /
// "Trigger manual batch" per partner) is deferred to STUB-058.
//
// Auth: belt-and-suspenders. The /admin layout already calls
// `requireRole(['admin', 'super_admin'])`; this page additionally
// calls `requireAdmin()` so the `getAdminPartnerPayouts()` query
// is never invoked by a non-admin caller.
//
// 404 when:
//   - The id is not a positive integer
//   - No session user (redirected to /login by requireAdmin before
//     this code runs)
//   - Non-admin role (redirected to /403 by requireAdmin before
//     this code runs)
//   - The partner row doesn't exist (RLS-equivalent: 0 rows from
//     service-role). We don't distinguish "doesn't exist" from
//     "is owned by another tenant" — both collapse to "0 rows" →
//     404 (matches the P6.4 "404 doesn't leak existence" pattern).

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireAdmin } from '@foundations/auth/guards'
import {
  getAdminPartnerPayouts,
  getPartnerStorageUsage,
  AdminPartnerPayouts,
} from '@features/payouts'
import { sensitivePageMetadata } from '@foundations/metadata'
import { AdminShell } from '@features/admin'
import styles from './page.module.css'

// P0.21 — `noindex` (inherited from /admin layout too).
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Partner payouts',
  description: 'Admin view of one partner\'s ledger + payout requests.',
  path: '/admin/payouts/partner/[id]',
})
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

export default async function AdminPartnerPayoutsPage({ params }: Props) {
  // Belt-and-suspenders auth: never invoke the data layer for anon
  // / non-admin callers. The /admin layout already gates this; this
  // is the second gate.
  const user = await requireAdmin()
  if (!user) {
    // requireAdmin already redirects, but TS needs the fallback.
    return null
  }

  const { id } = await params
  // P7.10 — fetch payouts + storage usage in parallel. Both queries
  // do their own auth + Zod validation + PII-safe selects; either
  // can return null on its own without affecting the other.
  const [detail, storage] = await Promise.all([
    getAdminPartnerPayouts({ partnerId: id }),
    getPartnerStorageUsage({ partnerId: id }),
  ])
  if (!detail) {
    notFound()
  }
  // Storage usage never returns null after auth passes — it returns
  // a zero-filled result on missing data (see query JSDoc). The
  // fallback here is purely a TS narrowing nicety.
  const storageSafe = storage ?? {
    partner_id: detail.partner.id,
    total_bytes: 0,
    file_count: 0,
    product_count: 0,
    by_product: [],
    capped: false,
  }

  return (
    <AdminShell title={`Partner #${detail.partner.id} payouts`}>
      <nav className={styles.crumb} aria-label="Breadcrumb">
        <Link href="/admin/payouts" className={styles.crumbLink}>
          ← All payout requests
        </Link>
      </nav>
      <AdminPartnerPayouts result={detail} storage={storageSafe} />
    </AdminShell>
  )
}