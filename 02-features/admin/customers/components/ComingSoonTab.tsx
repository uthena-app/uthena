// ComingSoonTab.tsx — the placeholder panel for tabs that haven't
// landed yet. Per AGENTS.md rule 4 (no placeholder tokens in shipped
// code), this is a real, styled panel that documents what each
// deferred tab will contain.
//
// Used for: Profile, Orders, Library, Refunds, Reviews, Sessions,
// Notes, Activity tabs (the Overview tab ships end-to-end in Slice 1).
//
// Pure RSC. No client JS.

import type { CustomerDetailTab } from '../queries/parseCustomerDetailTab'
import { CUSTOMER_DETAIL_TAB_LABEL } from '../queries/parseCustomerDetailTab'
import styles from './ComingSoonTab.module.css'

const TAB_FEATURES: Record<
  Exclude<CustomerDetailTab, 'overview'>,
  readonly string[]
> = {
  profile: [
    'Editable fields: display_name, bio, locale, timezone',
    'Read-only: email, avatar, signup date, role',
    'Audit-logged edit action',
  ],
  orders: [
    'Paginated order history',
    'Order ID, date, items count, total, status',
    'Manual refund action (links to P14.9 refund approval flow)',
  ],
  library: [
    'Every library_grant with tier, source, granted_at, revoked_at',
    'Per-grant revoke action with reason + typed confirmation',
  ],
  refunds: [
    'Full refund history: order, product, amount, status',
    'Resolution notes + resolved timestamps',
  ],
  reviews: [
    "Every review the customer wrote",
    'Status (pending / approved / hidden / flagged)',
    'Per-review unpublish / re-approve action',
  ],
  sessions: [
    'List of active sessions with device + IP + last_active',
    'Per-session revoke action',
    'Bulk "revoke all other sessions" (preserves current admin)',
  ],
  notes: [
    'Admin-only free-form notes',
    'Edit / soft-delete own notes within 24h',
    'Cross-customer note leaks prevented by RLS',
  ],
  activity: [
    'Every admin_audit_log row targeting this customer',
    'Reverse chronological, filterable by action kind',
    'PII-redacted display (actor + action + timestamp)',
  ],
}

export function ComingSoonTab({ tab }: { tab: CustomerDetailTab }) {
  // Defensive — overview shouldn't render this component, but we
  // handle it gracefully anyway (returns an empty panel) so a
  // caller bug never crashes the page.
  if (tab === 'overview') return null
  const features = TAB_FEATURES[tab]
  const label = CUSTOMER_DETAIL_TAB_LABEL[tab]

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2 className={styles.h2}>{label}</h2>
        <span className={styles.badge}>Coming in a follow-up slice</span>
      </header>
      <p className={styles.lede}>
        This tab is planned for the P14.2 follow-up slices. The deferred
        work is filed as <code>STUB-115</code> in <code>STUBS.md</code>
        — it is real, scoped work, not a placeholder.
      </p>
      <h3 className={styles.h3}>What will land here</h3>
      <ul className={styles.list}>
        {features.map((feature) => (
          <li key={feature} className={styles.item}>
            {feature}
          </li>
        ))}
      </ul>
    </div>
  )
}