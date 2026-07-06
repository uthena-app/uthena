// /admin/account-switcher — the super_admin's entry point for
// impersonating another user. See 01-specs/pages/account-switcher.md
// for the full spec.
//
// Auth gate: super_admin only. The page is built on top of the
// AdminShell pattern (sidebar + topbar) used by the other admin
// pages. The page itself is RSC + SSR (no client JS for the search
// results — only the small client islands for the search input +
// per-row switch button).

import type { Metadata } from 'next'
import { requireRole } from '@foundations/auth/guards'
import { sensitivePageMetadata } from '@foundations/metadata'
import { AdminShell } from '@features/admin'
import {
  ImpersonationSearch,
  ImpersonationResults,
  RecentSessions,
} from '@features/admin/account-switcher'

export const metadata: Metadata = sensitivePageMetadata({
  title: 'Account switcher · Admin',
  description: 'Impersonate another user for support workflows. Super_admin only.',
  path: '/admin/account-switcher',
})

type SearchParams = { q?: string }

export default async function AdminAccountSwitcherPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  // Auth gate: super_admin only. Non-super_admins get redirected to
  // /403 by requireRole. The /admin layout's requireRole(['admin',
  // 'super_admin']) would pass admins through; this inner gate is
  // the per-page privilege separation.
  await requireRole(['super_admin'])

  const sp = await searchParams
  const query = (sp.q ?? '').toString().trim().slice(0, 120)

  return (
    <AdminShell title="Account switcher">
      <p style={{ margin: '0 0 16px 0', color: 'var(--text-mute)', fontSize: 14 }}>
        Impersonate another user for support workflows. Every start is recorded in{' '}
        <code>admin_audit_log</code>. Use only when a customer has given consent or when
        investigating a reported issue.
      </p>
      <ImpersonationSearch initialQuery={query} />
      <ImpersonationResults query={query} />
      <RecentSessions />
    </AdminShell>
  )
}
