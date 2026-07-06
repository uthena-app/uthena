// /admin/dmca-agent — DMCA designated-agent editor.
//
// Admin-only surface (gated by the /admin layout's `requireRole`).
// Reads the current `platform_settings.dmca_agent` row via
// `getDmcaAgentForAdmin` and hands the value + last-updated timestamp
// to the `<DmcaAgentForm>` client island (which also renders a live
// preview so the admin can see exactly what /dmca will show).
//
// No client JS beyond the editor island itself; the page is RSC.

import type { Metadata } from 'next'
import { AdminShell } from '@features/admin'
import { DmcaAgentForm, getDmcaAgentForAdmin, getPlatformSetting } from '@features/admin/platform-settings'
import { sensitivePageMetadata } from '@foundations/metadata'

export const metadata: Metadata = sensitivePageMetadata({
  title: 'DMCA Agent · Admin',
  description: 'Edit the DMCA designated agent contact for /dmca.',
  path: '/admin/dmca-agent',
})

export const dynamic = 'force-dynamic'

export default async function AdminDmcaAgentPage() {
  // Two reads in parallel: the strongly-typed contact shape (for the
  // form) + the full row (for the last-updated timestamp). Both are
  // service-role + cached per-request.
  const [agent, row] = await Promise.all([
    getDmcaAgentForAdmin(),
    getPlatformSetting('dmca_agent'),
  ])
  return (
    <AdminShell title="DMCA designated agent">
      <DmcaAgentForm initial={agent} updatedAt={row?.updated_at ?? null} />
    </AdminShell>
  )
}