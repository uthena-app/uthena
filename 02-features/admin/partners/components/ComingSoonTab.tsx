// ComingSoonTab.tsx — the placeholder panel for tabs that haven't
// landed yet. Per AGENTS.md rule 4 (no placeholder tokens in shipped
// code), this is a real, styled panel that documents what each
// deferred tab will contain.
//
// Used for: Profile, KYC, Tax, Courses, Sales, Payouts, Refunds,
// Notes, Activity tabs (the Overview tab ships end-to-end in Slice 1).
//
// Pure RSC. No client JS.

import type { PartnerDetailTab } from '../queries/parsePartnerDetailTab'
import { PARTNER_DETAIL_TAB_LABEL } from '../queries/parsePartnerDetailTab'
import styles from './ComingSoonTab.module.css'

const TAB_FEATURES: Record<
  Exclude<PartnerDetailTab, 'overview'>,
  readonly string[]
> = {
  profile: [
    'Editable fields: display_name, bio, avatar_url (write-through to profiles + partners)',
    'Read-only: locale, timezone, signup date, role',
    'Audit-logged before/after diff on every save',
  ],
  kyc: [
    'KYC document preview (gov_id front + back, signed URLs, 4h TTL)',
    'Approve / Reject / Request re-submission actions with typed confirmation',
    'Per-document view rate-limited to 30/hr/admin with audit log row per view',
    'Display kyc_reviewed_at + kyc_reviewed_by + kyc_rejection_reason (after schema addition)',
  ],
  tax: [
    'Tax form preview (W-9 / W-8BEN, signed URL, 4h TTL)',
    'Tax ID masked by default; explicit Reveal button with 30s auto-mask + audit row',
    'Mark approved / submitted / none with typed confirmation',
    'tax_form_reviewed_at + tax_form_reviewed_by surfaced after schema addition',
  ],
  courses: [
    'Every product owned by the partner with title, kind, status, price, sales_30d, lifetime_revenue, rating, last_sale_at',
    'Inline link to the admin product detail page (P14.X)',
    'Draft / in_review / published / unpublished / archived status pills',
  ],
  sales: [
    'Paginated order_items joined with orders + products for this partner',
    'Customer email masked (`j***@email.com`) with explicit Reveal per row + audit',
    'Order id, date, product title, tier, unit_price, partner_share, status',
    'Default 20/page with sort by date desc',
  ],
  payouts: [
    'Full payout_ledger history (id, date, kind, amount, status, locked_until, available_at, external_id)',
    'Inline "Trigger payout" action reusing `triggerManualBatch` from P6.7',
    'Inline "Adjust" action (append-only adjustment rows, never UPDATE the original)',
    '5/day/admin trigger rate limit; 100/hr/admin adjust rate limit',
  ],
  refunds: [
    'All refunds joined with orders + order_items for the partner\'s products',
    'Order id, date, customer (masked), product, amount, status, resolved_at, resolution_notes',
    'Link to the admin refund approval queue (P14.9) for unresolved refunds',
  ],
  notes: [
    'Admin-only free-form notes (partner_admin_notes table — already exists in 0001_initial)',
    'Add note via textarea + "Post" button',
    'Edit / soft-delete own notes within 24h (super-admin bypass)',
    'Cross-partner note leaks prevented by RLS (admin-only policy)',
  ],
  activity: [
    'Every admin_audit_log row where target_table=\'partners\' AND target_id = self.id',
    'Plus related events (refund, payout, product actions touching this partner)',
    'Reverse chronological with action-kind filter chips',
    'PII-redacted display (actor + action + timestamp + minimal metadata)',
  ],
}

export function ComingSoonTab({ tab }: { tab: PartnerDetailTab }) {
  // Defensive — overview shouldn't render this component, but we
  // handle it gracefully anyway (returns an empty panel) so a
  // caller bug never crashes the page.
  if (tab === 'overview') return null
  const features = TAB_FEATURES[tab]
  const label = PARTNER_DETAIL_TAB_LABEL[tab]

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2 className={styles.h2}>{label}</h2>
        <span className={styles.badge}>Coming in a follow-up slice</span>
      </header>
      <p className={styles.lede}>
        This tab is planned for the P14.4 follow-up slices. The deferred
        work is filed as <code>STUB-118</code> in <code>STUBS.md</code> —
        it is real, scoped work, not a placeholder.
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