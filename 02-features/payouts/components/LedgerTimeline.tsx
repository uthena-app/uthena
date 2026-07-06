// LedgerTimeline.tsx — locked-window 4-milestone timeline.
//
// P6.4 — visualizes the locked → available → paid state machine
// for a single ledger row. Four milestones:
//
//   1. Created   — payout_ledger.created_at (always set)
//   2. Locked    — payout_ledger.locked_until (when status='locked',
//                  this is the release date; when status is past
//                  locked, this row is hidden)
//   3. Available — payout_ledger.available_at (the moment the
//                  row becomes payable; for order_sale, equals
//                  locked_until; for refund, when the refund
//                  cleared)
//   4. Paid      — payout_ledger.paid_at (when the PayPal batch
//                  ran; only set after a successful payout)
//
// Each milestone gets a colored dot (gray / pending / active /
// done) depending on the row's current `status`. The timeline
// reads as a horizontal strip on desktop, vertical on mobile.
//
// Pure presentational — no data fetching. Takes the entry +
// timezone; computes the four dates inline.

import type { LedgerEntry } from '@features/payouts/queries/getPartnerLedger'
import { formatDateTime } from '@features/payouts/format'
import styles from './LedgerTimeline.module.css'

type MilestoneState = 'done' | 'active' | 'pending' | 'skipped'

type Milestone = {
  label: string
  hint: string
  at: string | null
  state: MilestoneState
}

export function LedgerTimeline({
  entry,
  timezone,
}: {
  entry: LedgerEntry
  timezone?: string | null
}) {
  // Compute state per milestone based on the entry's current
  // status. The "active" milestone is the one the row is
  // currently waiting on; everything before it is done,
  // everything after it is pending.
  //
  // Status timeline:
  //   - 'accruing'      → only Created has fired
  //   - 'pending_payout' → Created + Locked fired; waiting on
  //                        Available (next milestone)
  //   - 'locked'        → Created + Locked fired; Available
  //                        milestone is the next target
  //   - 'available'     → Created + Locked + Available fired;
  //                        Paid is next
  //   - 'paid'          → all 4 fired
  //   - 'void'          → row was reversed; only Created fired
  //
  // We render all 4 milestones regardless — the "skipped" /
  // "pending" state communicates "this will never fire for this
  // row type" for things like refunds (which skip the locked
  // milestone entirely because refunds never lock).
  const createdState: MilestoneState = 'done'
  const lockedState: MilestoneState =
    entry.status === 'void'
      ? 'skipped'
      : entry.kind === 'refund'
      ? 'skipped' // refunds don't lock; the original sale did
      : entry.status === 'accruing'
      ? 'pending'
      : 'done'
  const availableState: MilestoneState =
    entry.status === 'void'
      ? 'skipped'
      : entry.status === 'accruing' ||
        entry.status === 'pending_payout' ||
        entry.status === 'locked'
      ? 'pending'
      : 'done'
  const paidState: MilestoneState =
    entry.status === 'void'
      ? 'skipped'
      : entry.status === 'paid'
      ? 'done'
      : 'pending'

  const milestones: Milestone[] = [
    {
      label: 'Created',
      hint: 'When this ledger row was written.',
      at: entry.created_at,
      state: createdState,
    },
    {
      label: 'Locked',
      hint:
        entry.kind === 'refund'
          ? 'Refunds skip the locked window.'
          : 'Held during the 14-day refund window.',
      at: entry.locked_until,
      state: lockedState,
    },
    {
      label: 'Available',
      hint: 'Becomes payable after the lock window.',
      at: entry.available_at,
      state: availableState,
    },
    {
      label: 'Paid',
      hint: 'Included in a PayPal Mass Payout batch.',
      at: entry.paid_at,
      state: paidState,
    },
  ]

  // Pick the "currently waiting on" milestone for the top-line
  // copy. Falls back to "Completed" if all 4 are done.
  const activeMilestone = milestones.find((m) => m.state === 'active')
  const headline =
    activeMilestone
      ? `Currently ${activeMilestone.label.toLowerCase()}`
      : entry.status === 'paid'
      ? 'Completed'
      : entry.status === 'void'
      ? 'Reversed'
      : 'No further action'

  return (
    <section
      className={styles.wrap}
      aria-label={`Timeline for ledger entry #${entry.id}`}
    >
      <header className={styles.head}>
        <h2 className={styles.h2}>Status timeline</h2>
        <p className={styles.headline}>{headline}</p>
      </header>
      <ol className={styles.list}>
        {milestones.map((m, i) => (
          <li
            key={m.label}
            className={styles.item}
            data-state={m.state}
            aria-current={m.state === 'active' ? 'step' : undefined}
          >
            <span className={styles.dot} aria-hidden="true" />
            {i < milestones.length - 1 && (
              <span className={styles.line} aria-hidden="true" />
            )}
            <div className={styles.text}>
              <p className={styles.label}>{m.label}</p>
              {m.at ? (
                <p className={styles.at}>{formatDateTime(m.at, 'en-US', timezone)}</p>
              ) : (
                <p className={styles.atMuted}>—</p>
              )}
              <p className={styles.hint}>{m.hint}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
