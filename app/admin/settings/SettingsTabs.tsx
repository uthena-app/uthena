'use client'

// SettingsTabs — URL-driven tab nav for /admin/settings.
//
// Each tab is a Next.js `<Link>` that drives `?tab=<key>`. Active state
// is computed from the URL via `useSearchParams()` + `usePathname()`.
// Default-strip pattern: when on the General tab, the URL is just
// `/admin/settings` (no `?tab=general`).
//
// Renders 2 active tabs (General + Feature flags). Future slices will
// add Payments, Email, Storage, Security — the tabs array is the
// single source of truth for what's currently navigable.

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import styles from './page.module.css'

export type SettingsTabKey = 'general' | 'flags'

type TabSpec = {
  key: SettingsTabKey
  label: string
  /** When true, the tab renders even though the section doesn't ship yet
   * (e.g. v2). For v1 we render only tabs whose sections actually exist. */
  available: boolean
}

const TABS: TabSpec[] = [
  { key: 'general', label: 'General', available: true },
  { key: 'flags', label: 'Feature flags', available: true },
]

export function SettingsTabs({ activeTab }: { activeTab: SettingsTabKey }) {
  const pathname = usePathname()
  const sp = useSearchParams()
  // We only need the tab param here. The page-level `activeTab` is the
  // canonical source — the tabs just navigate to their own URL.
  // `useSearchParams` is intentionally not used to compute activeTab
  // (would require `useState` + an effect to handle the default-strip).
  void sp

  function hrefFor(key: SettingsTabKey): string {
    if (key === 'general') return pathname // default-strip
    return `${pathname}?tab=${key}`
  }

  return (
    <nav className={styles.tabNav} aria-label="Platform settings tabs" data-testid="settings-tab-nav">
      {TABS.filter((t) => t.available).map((t) => {
        const isActive = t.key === activeTab
        return (
          <Link
            key={t.key}
            href={hrefFor(t.key)}
            className={[styles.tabLink, isActive ? styles.tabLinkActive : ''].filter(Boolean).join(' ')}
            aria-current={isActive ? 'page' : undefined}
            data-testid={`settings-tab-${t.key}`}
          >
            {t.label}
          </Link>
        )
      })}
      {/* Future tabs render as disabled chips so the admin sees what's coming. */}
      {TABS.filter((t) => !t.available).map((t) => (
        <span
          key={t.key}
          className={styles.tabLinkDisabled}
          aria-disabled="true"
          title="Coming in a future slice"
        >
          {t.label}
        </span>
      ))}
    </nav>
  )
}