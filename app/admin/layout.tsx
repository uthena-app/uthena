// /admin — layout. Auth-gates every admin route. The actual shell
// rendering (sidebar + topbar) is per-page via AdminShell, because
// each admin page has its own title and its own optional topbar
// actions. This layout only does the auth gate and sets a baseline
// page background; the visible shell is in the page tree.

import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { requireRole } from '@foundations/auth/guards'
import { sensitivePageMetadata } from '@foundations/metadata'

// P0.21 — every page in /admin/* inherits `noindex` from the
// layout's metadata. The auth gate (requireRole) ensures only
// admins can actually see these pages; the noindex is defense
// in depth so even if a URL leaks, it doesn't show in search.
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Admin',
  description: 'Uthena admin console — internal use only.',
  path: '/admin',
})

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Auth gate: redirects to /login (anon) or /403 (wrong role). The
  // role check is what makes /admin a 403 for non-admins rather than
  // a 404 — this is the deliberate security signal in the spec.
  await requireRole(['admin', 'super_admin'])
  return <>{children}</>
}
