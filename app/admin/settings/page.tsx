// /admin/settings — Platform settings editor.
//
// Admin-only surface (gated by /admin layout's `requireRole`). The
// page renders multiple tabs as the spec dictates:
//   - **General** (P14.12 Slice 1 + P14.15 maintenance toggle shipped
//     this tick): the 3 PHASES.md-resolves-STUB numeric fields
//     (royalty, subscriber discount, refund window) + the maintenance
//     mode toggle + customer-facing message editor
//   - **Feature flags** (P14.14 Slice 1 — shipped): inline toggle
//     list with add/remove + audit-logged changes
//
// Tabs are URL-driven via `?tab=<key>` (default-strip pattern — no
// `?tab=general` when on General). Future slices will add Payments,
// Email, Storage, Security per `01-specs/pages/admin-settings.md`.
//
// Reads the current row(s) via `getPlatformSettingsGeneral` +
// `getPlatformSettingsFlags` + `getMaintenanceState`. Each tab renders
// its own client island; the page itself is RSC with no client JS
// beyond what the islands need.

import type { Metadata } from 'next'
import Link from 'next/link'
import { AdminShell } from '@features/admin'
import {
  FeatureFlagsTab,
  GeneralSettingsForm,
  MaintenanceToggle,
  getMaintenanceState,
  getPlatformSettingsFlags,
  getPlatformSettingsGeneral,
} from '@features/admin/platform-settings'
import { sensitivePageMetadata } from '@foundations/metadata'
import { SettingsTabs, type SettingsTabKey } from './SettingsTabs'
import styles from './page.module.css'

export const metadata: Metadata = sensitivePageMetadata({
  title: 'Platform settings · Admin',
  description:
    'Platform-wide defaults: royalty, subscriber discount, refund window, maintenance mode, feature flags.',
  path: '/admin/settings',
})

export const dynamic = 'force-dynamic'

type SearchParams = { tab?: string | string[] }

function parseTab(raw: string | string[] | undefined): SettingsTabKey {
  // URL-driven tab. Unknown values fall back to 'general' (default-strip).
  const v = Array.isArray(raw) ? raw[0] : raw
  if (v === 'flags') return 'flags'
  return 'general'
}

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const sp = await searchParams
  const tab = parseTab(sp.tab)

  // Load both tabs in parallel — even though only one renders, the
  // general read is cheap and we want both ready for tab switches.
  const [general, flags, maintenance] = await Promise.all([
    getPlatformSettingsGeneral(),
    getPlatformSettingsFlags(),
    getMaintenanceState(),
  ])

  if (!general) {
    // The migration seeds a row; reaching this branch means the row
    // is missing or unreadable. Surface a clean error rather than
    // rendering an empty form.
    return (
      <AdminShell title="Platform settings">
        <div className={styles.errorPanel} role="alert">
          <h2 className={styles.errorTitle}>Could not read platform settings</h2>
          <p className={styles.errorBody}>
            The <code>platform_settings</code> row is missing or unreadable. The migration
            should have seeded it — check the DB or run{' '}
            <code>pnpm db:bootstrap</code> to recreate the row.
          </p>
        </div>
      </AdminShell>
    )
  }

  return (
    <AdminShell title="Platform settings">
      <p className={styles.lede}>
        Edit the platform-wide defaults. Changes are audit-logged. Slices 2+ will add Payments,
        Email, Storage, and Security — for now <strong>General</strong> (royalty, subscriber
        discount, refund window, maintenance mode) and <strong>Feature flags</strong> ship.
      </p>

      <SettingsTabs activeTab={tab} />

      <div className={styles.section}>
        {tab === 'general' && (
          <>
            <GeneralSettingsForm initial={general} />
            <MaintenanceToggle initial={maintenance} />
          </>
        )}
        {tab === 'flags' && <FeatureFlagsTab initial={flags} />}
      </div>

      <div className={styles.relatedLinks}>
        <Link href="/admin/dmca-agent" className={styles.relatedLink}>
          Edit DMCA designated agent →
        </Link>
        <Link href="/admin/audit-log" className={styles.relatedLink}>
          View audit log →
        </Link>
      </div>
    </AdminShell>
  )
}