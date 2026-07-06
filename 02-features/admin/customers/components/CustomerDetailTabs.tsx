// CustomerDetailTabs.tsx — the 9-tab nav for /admin/customers/[id].
//
// Pure RSC. URL-driven via `?tab=<value>` (parsed server-side via
// `parseCustomerDetailTab`). Each tab is a <Link> that swaps the
// `?tab=` param while preserving the customer id (the id is in the
// route, not the URL).
//
// The active tab is marked with `data-active="true"` so the CSS
// module can paint the bottom border. Keyboard nav is the native
// browser tab-key behavior; we don't ship client JS for the nav.

import Link from 'next/link'
import {
  CUSTOMER_DETAIL_TABS,
  CUSTOMER_DETAIL_TAB_LABEL,
  type CustomerDetailTab,
} from '../queries/parseCustomerDetailTab'
import styles from './CustomerDetailTabs.module.css'

export type CustomerDetailTabsProps = {
  customerUserId: string
  activeTab: CustomerDetailTab
}

export function CustomerDetailTabs({
  customerUserId,
  activeTab,
}: CustomerDetailTabsProps) {
  return (
    <nav className={styles.tablist} aria-label="Customer detail sections">
      {CUSTOMER_DETAIL_TABS.map((tab) => {
        const isActive = tab === activeTab
        const href = `/admin/customers/${customerUserId}?tab=${tab}`
        return (
          <Link
            key={tab}
            href={href}
            className={styles.tab}
            data-active={isActive ? 'true' : 'false'}
            aria-current={isActive ? 'page' : undefined}
            scroll={false}
          >
            {CUSTOMER_DETAIL_TAB_LABEL[tab]}
          </Link>
        )
      })}
    </nav>
  )
}