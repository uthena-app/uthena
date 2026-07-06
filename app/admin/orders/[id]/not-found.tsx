// /admin/orders/[id] — not-found surface. Triggered when:
//   - the id is not a valid positive bigint
//   - the order doesn't exist
//   - the RPC errored (fail-closed → 0 rows → notFound)
//
// Pure RSC, no client JS. Token-only CSS. The breadcrumb links back
// to the orders list (the only useful exit; this isn't an error
// page that needs a "go home" CTA — the admin is in the middle of a
// workflow and needs to get back to the list).

import Link from 'next/link'
import { AdminShell } from '@features/admin'

export default function AdminOrderNotFound() {
  return (
    <AdminShell title="Order not found">
      <div
        style={{
          maxWidth: 720,
          padding: '24px 28px',
          border: '1px solid var(--line, rgba(0, 0, 0, 0.08))',
          borderRadius: 8,
          background: 'var(--bg-elev-1, #fff)',
        }}
      >
        <h1
          style={{
            fontSize: 'var(--font-size-xl, 22px)',
            fontWeight: 600,
            margin: '0 0 12px 0',
            color: 'var(--fg, #111)',
          }}
        >
          Order not found
        </h1>
        <p
          style={{
            fontSize: 'var(--font-size-sm, 13px)',
            color: 'var(--fg-muted, rgba(0, 0, 0, 0.7))',
            lineHeight: 1.5,
            margin: '0 0 16px 0',
          }}
        >
          This order may not exist, may have been deleted, or you may have
          followed a stale link. The page is admin-only — admins are the
          only callers, and they always land here from the orders list
          or an audit-log deep link.
        </p>
        <Link
          href="/admin/orders"
          style={{
            fontSize: 'var(--font-size-sm, 13px)',
            color: 'var(--accent, #ea580c)',
            textDecoration: 'none',
          }}
        >
          ← Back to all orders
        </Link>
      </div>
    </AdminShell>
  )
}
