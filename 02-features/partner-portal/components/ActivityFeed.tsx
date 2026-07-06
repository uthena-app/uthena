// ActivityFeed.tsx — server-rendered activity feed card.
//
// P12.4 — companion to the dashboard's "Recent activity" section.
// Reads PartnerActivityEntry[] (already mapped by
// getPartnerDashboardExtras) and renders them as a vertical timeline.
//
// RSC, zero client JS. Token-only styling. Empty state surfaces
// the no-activity copy from the spec, never a broken list.

import Link from 'next/link'
import type { PartnerActivityEntry, PartnerActivityKind } from '../queries/getPartnerDashboardExtras'
import styles from './ActivityFeed.module.css'

/** Format cents as USD with the `–` glyph for negative amounts
 *  (refunds / clawbacks). USD-only for now — matches the spec's
 *  single-currency assumption; a future multi-currency slice
 *  pivots on the row's `currency` field. */
function formatAmountCents(cents: number): string {
  const sign = cents < 0 ? '–' : ''
  const abs = Math.abs(cents)
  return `${sign}$${(abs / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/** ISO timestamp → relative-feel display ("2h ago", "Mar 14").
 *  Avoids pulling a heavyweight library — for an MVP dashboard
 *  the "today vs older" split is enough; older entries show the
 *  absolute date so the partner can scan historic activity at
 *  a glance. */
function formatRelativeEventAt(iso: string, now: Date = new Date()): string {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  const diffMs = now.getTime() - t.getTime()
  const diffHours = Math.round(diffMs / (1000 * 60 * 60))
  // Within the last ~7 days: show "Nh ago" / "Nd ago"
  if (diffHours < 24 && diffHours >= 0) {
    if (diffHours === 0) return 'just now'
    if (diffHours === 1) return '1h ago'
    return `${diffHours}h ago`
  }
  const diffDays = Math.round(diffHours / 24)
  if (diffDays >= 0 && diffDays <= 7) {
    if (diffDays === 1) return 'yesterday'
    return `${diffDays}d ago`
  }
  // Older: absolute month/day. We don't add the year — the
  // dashboard always renders alongside 'Lifetime sales' so the
  // partner mentally anchors to "this year".
  return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Map kind → display glyph + color class. Glyphs are inline
 *  ASCII chars (not emoji — per the brand guide + memory note
 *  about B2B UIs) so the feed renders identically across all
 *  platforms without depending on the system font fallback. */
function eventVisuals(
  kind: PartnerActivityKind,
): { glyph: string; tone: 'credit' | 'debit' | 'neutral' } {
  switch (kind) {
    case 'sale':
      return { glyph: '+', tone: 'credit' }
    case 'refund':
      return { glyph: '−', tone: 'debit' }
    case 'payout':
      return { glyph: '→', tone: 'neutral' }
    case 'clawback':
      return { glyph: '−', tone: 'debit' }
    case 'adjustment':
      return { glyph: '~', tone: 'neutral' }
    case 'subscription':
      return { glyph: '↻', tone: 'credit' }
    default:
      return { glyph: '·', tone: 'neutral' }
  }
}

function ActivityRow({
  entry,
}: {
  entry: PartnerActivityEntry
}) {
  const { glyph, tone } = eventVisuals(entry.kind)
  const hasAmount = entry.amountCents !== 0
  const amountDisplay = hasAmount ? formatAmountCents(entry.amountCents) : ''

  // Order-tied entries deep-link to the partner's payouts ledger
  // (the page that already exists — P6.3). When P12.11's
  // /partner/sales surface lands, we'll re-target this link to
  // `/partner/sales?order=<id>` for the per-order drill-down view;
  // until then `/partner/payouts` is the correct destination for
  // a sale/refund (it lists `order_sale` / `refund` ledger rows
  // with the same order_id context).
  //
  // Non-tied entries (payout, clawback, generic adjustment) don't
  // get a link — they're already visible on `/partner/payouts`.
  const inner = (
    <div className={styles.rowInner}>
      <span
        className={`${styles.glyph} ${styles[`tone_${tone}`]}`}
        aria-hidden="true"
      >
        {glyph}
      </span>
      <div className={styles.body}>
        <p className={styles.description}>{entry.description}</p>
        {entry.productTitle && (
          <p className={styles.title}>{entry.productTitle}</p>
        )}
      </div>
      <div className={styles.amountWrap}>
        {amountDisplay && (
          <span
            className={`${styles.amount} ${styles[`tone_${tone}`]}`}
          >
            {amountDisplay}
          </span>
        )}
        <span className={styles.time}>{formatRelativeEventAt(entry.eventAt)}</span>
      </div>
    </div>
  )

  if (entry.orderId != null) {
    return (
      <li className={styles.row}>
        <Link href="/partner/payouts" className={styles.rowLink}>
          {inner}
        </Link>
      </li>
    )
  }
  return <li className={styles.row}>{inner}</li>
}

export function ActivityFeed({ entries }: { entries: PartnerActivityEntry[] }) {
  return (
    <section className={styles.card} aria-label="Recent activity">
      <header className={styles.header}>
        <h2 className={styles.h2}>Recent activity</h2>
        <p className={styles.subtle}>
          Sales, refunds, and payouts — newest first.
        </p>
      </header>
      {entries.length === 0 ? (
        <p className={styles.empty}>
          Your first sale will appear here.
        </p>
      ) : (
        <ul className={styles.list}>
          {entries.map((entry, idx) => (
            <ActivityRow key={`${entry.eventAt}-${idx}-${entry.orderId ?? 'na'}`} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  )
}
