// OrderDetailTabs.tsx — the tab nav for /admin/orders/[id].
//
// Slice 1 ships the single 'overview' tab. Slices 2+ will add
// 'actions' (the destructive-action panel — issue manual refund / mark
// fraudulent / resend receipt / copy PI ID / add internal note) +
// 'notes' (admin-only free-form notes). The forward-compatible
// structure mirrors the customer-detail + partner-detail tabs.
//
// Pure RSC. URL-driven via `?tab=<value>` (parsed server-side via
// `parseOrderDetailTab`). Each tab is a <Link> that swaps the `?tab=`
// param while preserving the order id (the id is in the route, not
// the URL).
//
// The active tab is marked with `data-active="true"` so the CSS
// module can paint the bottom border. Keyboard nav is the native
// browser tab-key behavior; we don't ship client JS for the nav.

import Link from 'next/link'
import {
  ORDER_DETAIL_TABS,
  ORDER_DETAIL_TAB_LABEL,
  type OrderDetailTab,
} from '../queries/parseOrderDetailTab'
import styles from './OrderDetailTabs.module.css'

export type OrderDetailTabsProps = {
  orderId: string
  activeTab: OrderDetailTab
}

export function OrderDetailTabs({
  orderId,
  activeTab,
}: OrderDetailTabsProps) {
  return (
    <nav className={styles.tablist} aria-label="Order detail sections">
      {ORDER_DETAIL_TABS.map((tab) => {
        const isActive = tab === activeTab
        const href = `/admin/orders/${orderId}?tab=${tab}`
        return (
          <Link
            key={tab}
            href={href}
            className={styles.tab}
            data-active={isActive ? 'true' : 'false'}
            aria-current={isActive ? 'page' : undefined}
            scroll={false}
          >
            {ORDER_DETAIL_TAB_LABEL[tab]}
          </Link>
        )
      })}
    </nav>
  )
}
