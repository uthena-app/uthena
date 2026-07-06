// PartnerDetailTabs.tsx — the 10-tab nav for /admin/partners/[id].
//
// Pure RSC. URL-driven via `?tab=<value>` (parsed server-side via
// `parsePartnerDetailTab`). Each tab is a <Link> that swaps the
// `?tab=` param while preserving the partner id (the id is in the
// route, not the URL).
//
// The active tab is marked with `data-active="true"` so the CSS
// module can paint the bottom border. Keyboard nav is the native
// browser tab-key behavior; we don't ship client JS for the nav.

import Link from 'next/link'
import {
  PARTNER_DETAIL_TABS,
  PARTNER_DETAIL_TAB_LABEL,
  type PartnerDetailTab,
} from '../queries/parsePartnerDetailTab'
import styles from './PartnerDetailTabs.module.css'

export type PartnerDetailTabsProps = {
  partnerId: string
  activeTab: PartnerDetailTab
}

export function PartnerDetailTabs({
  partnerId,
  activeTab,
}: PartnerDetailTabsProps) {
  return (
    <nav className={styles.tablist} aria-label="Partner detail sections">
      {PARTNER_DETAIL_TABS.map((tab) => {
        const isActive = tab === activeTab
        const href = `/admin/partners/${partnerId}?tab=${tab}`
        return (
          <Link
            key={tab}
            href={href}
            className={styles.tab}
            data-active={isActive ? 'true' : 'false'}
            aria-current={isActive ? 'page' : undefined}
            scroll={false}
          >
            {PARTNER_DETAIL_TAB_LABEL[tab]}
          </Link>
        )
      })}
    </nav>
  )
}