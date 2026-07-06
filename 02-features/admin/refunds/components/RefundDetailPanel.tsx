// RefundDetailPanel.tsx — the right-pane detail panel for one refund.
//
// Per spec lines 19-24, the panel renders:
//   - Header: refund id (R-12345), status badge, requested_at, "←
//     Back to queue"
//   - Order card: order id (link to /admin/orders/[id]), order date,
//     total, refunded-so-far
//   - Customer card: display_name + masked email + customer_since +
//     lifetime_orders + lifetime_refunds + refund_rate
//   - Refund request card: reason + notes (free text) + amount +
//     proof file (if any) — Slice 3 adds the signed-URL "View proof"
//     button
//   - Reversal impact card (READ-ONLY PREVIEW): partner debit +
//     affiliate commission reversal amounts. Surfaced BEFORE the admin
//     clicks Approve so they can make an informed decision (spec line
//     66). Slice 2 adds the actual Approve/Reject actions.
//
// No client JS; pure RSC. The "← Back to queue" link preserves the
// active filter bag via URL reconstruction (mirrors the OrderDetail
// tab nav pattern).

import Link from 'next/link'
import { formatMoney } from '@foundations/money/cents'
import type { Currency } from '@foundations/money/cents'
import {
  REFUND_STATUS_LABEL,
  REFUND_STATUS_KIND,
  REFUND_REASON_LABEL,
  type ParsedRefundFilters,
  type RefundDetail,
} from '../types'
import styles from './RefundDetailPanel.module.css'

export type RefundDetailPanelProps = {
  detail: RefundDetail
  filters: ParsedRefundFilters
}

function formatRefundId(id: number): string {
  return `R-${id.toLocaleString('en-US')}`
}

function formatOrderRef(id: number): string {
  return `#${id.toLocaleString('en-US')}`
}

function formatMoneySigned(cents: number, currency: Currency): string {
  // The reversal preview comes back as negative cents (money flowing
  // back to the business). Render with an explicit sign so the admin
  // sees the direction without a "to X" suffix.
  const sign = cents < 0 ? '−' : '+'
  const abs = Math.abs(cents)
  return `${sign}${formatMoney(abs, currency)}`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const date = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  const time = d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return `${date} · ${time}`
}

function backHref(filters: ParsedRefundFilters): string {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.customerEmail) params.set('customerEmail', filters.customerEmail)
  if (filters.productId !== null) params.set('productId', String(filters.productId))
  const qs = params.toString()
  return qs ? `/admin/refunds?${qs}` : '/admin/refunds'
}

export function RefundDetailPanel({ detail, filters }: RefundDetailPanelProps) {
  // detail.currency is a string from the RPC; cast to the strict
  // Currency union so formatMoney accepts it (the defensive mapping
  // in the data layer falls back to 'USD' for missing values).
  const currency = detail.currency as Currency

  return (
    <aside className={styles.panel} aria-label="Refund detail">
      <nav className={styles.crumb} aria-label="Breadcrumb">
        <Link href={backHref(filters)} className={styles.crumbLink}>
          ← Back to queue
        </Link>
      </nav>

      <header className={styles.header}>
        <div className={styles.headerRow}>
          <h2 className={styles.h2}>{formatRefundId(detail.refund_id)}</h2>
          <span className={styles.status} data-kind={REFUND_STATUS_KIND[detail.status]}>
            {REFUND_STATUS_LABEL[detail.status]}
          </span>
        </div>
        <p className={styles.sub}>
          Requested {formatDateTime(detail.requested_at)} ·{' '}
          {detail.amount_cents > 0 ? formatMoney(detail.amount_cents, currency) : '—'}
        </p>
      </header>

      {/* Order card */}
      <section className={styles.card} aria-label="Order">
        <h3 className={styles.cardTitle}>Order</h3>
        <dl className={styles.dl}>
          <div className={styles.row}>
            <dt>Order ID</dt>
            <dd>
              <Link href={`/admin/orders/${detail.order_id}`} className={styles.orderLink}>
                {formatOrderRef(detail.order_id)}
              </Link>
            </dd>
          </div>
          <div className={styles.row}>
            <dt>Order date</dt>
            <dd>{formatDateTime(detail.order_paid_at)}</dd>
          </div>
          <div className={styles.row}>
            <dt>Status</dt>
            <dd>
              <code className={styles.code}>{detail.order_status}</code>
            </dd>
          </div>
          <div className={styles.row}>
            <dt>Order total</dt>
            <dd className={styles.numeric}>
              {formatMoney(detail.order_total_cents, currency)}
            </dd>
          </div>
          <div className={styles.row}>
            <dt>Items</dt>
            <dd className={styles.numeric}>{detail.order_items_count}</dd>
          </div>
          <div className={styles.row}>
            <dt>Stripe PI</dt>
            <dd>
              <code className={styles.code}>
                {detail.order_stripe_payment_intent_id
                  ? detail.order_stripe_payment_intent_id.slice(0, 16) + '…'
                  : '—'}
              </code>
            </dd>
          </div>
        </dl>
      </section>

      {/* Customer card */}
      <section className={styles.card} aria-label="Customer">
        <h3 className={styles.cardTitle}>Customer</h3>
        <dl className={styles.dl}>
          <div className={styles.row}>
            <dt>Name</dt>
            <dd>{detail.customer_display_name || '—'}</dd>
          </div>
          <div className={styles.row}>
            <dt>Email</dt>
            <dd>
              <code className={styles.code}>{detail.customer_email || '—'}</code>
            </dd>
          </div>
          <div className={styles.row}>
            <dt>Customer since</dt>
            <dd>{formatDate(detail.customer_since)}</dd>
          </div>
          <div className={styles.row}>
            <dt>Lifetime orders</dt>
            <dd className={styles.numeric}>
              {detail.customer_lifetime_orders.toLocaleString('en-US')}
            </dd>
          </div>
          <div className={styles.row}>
            <dt>Lifetime refunds</dt>
            <dd className={styles.numeric}>
              {detail.customer_lifetime_refunds.toLocaleString('en-US')}
            </dd>
          </div>
          <div className={styles.row}>
            <dt>Refund rate</dt>
            <dd className={styles.numeric}>
              {detail.customer_lifetime_refund_rate.toFixed(1)}%
            </dd>
          </div>
        </dl>
      </section>

      {/* Refund request card */}
      <section className={styles.card} aria-label="Refund request">
        <h3 className={styles.cardTitle}>Refund request</h3>
        <dl className={styles.dl}>
          <div className={styles.row}>
            <dt>Reason</dt>
            <dd>{REFUND_REASON_LABEL[detail.reason]}</dd>
          </div>
          <div className={styles.row}>
            <dt>Notes</dt>
            <dd className={styles.notes}>
              {detail.notes ? detail.notes : <span className={styles.muted}>(none)</span>}
            </dd>
          </div>
          <div className={styles.row}>
            <dt>Amount requested</dt>
            <dd className={styles.numeric}>
              {formatMoney(detail.amount_cents, currency)}
            </dd>
          </div>
          <div className={styles.row}>
            <dt>Refund method</dt>
            <dd>Original Stripe card</dd>
          </div>
          <div className={styles.row}>
            <dt>Proof</dt>
            <dd>
              {detail.proof_path ? (
                detail.proof_filename ? (
                  <span className={styles.proofTag}>📎 {detail.proof_filename}</span>
                ) : (
                  <span className={styles.proofTag}>📎 attached</span>
                )
              ) : (
                <span className={styles.muted}>(none)</span>
              )}
              {detail.proof_path ? (
                <span className={styles.muted} style={{ marginLeft: 8 }}>
                  (view link ships in Slice 3)
                </span>
              ) : null}
            </dd>
          </div>
          {detail.stripe_refund_id ? (
            <div className={styles.row}>
              <dt>Stripe refund ID</dt>
              <dd>
                <code className={styles.code}>{detail.stripe_refund_id}</code>
              </dd>
            </div>
          ) : null}
          {detail.resolution_notes ? (
            <div className={styles.row}>
              <dt>Resolution</dt>
              <dd className={styles.notes}>{detail.resolution_notes}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {/* Reversal impact preview (READ-ONLY in Slice 1) */}
      <section className={styles.card} aria-label="Reversal impact preview" data-card="reversal">
        <h3 className={styles.cardTitle}>Reversal impact (preview)</h3>
        <p className={styles.cardSub}>
          What will happen on approval. Computed proportionally to the refund
          amount vs. order total.
        </p>
        <dl className={styles.dl}>
          <div className={styles.row}>
            <dt>Partner share reversal</dt>
            <dd className={styles.numeric} data-reversal="partner">
              {formatMoneySigned(detail.partner_share_reversal_cents, currency)}
            </dd>
          </div>
          <div className={styles.row}>
            <dt>Affiliate commission reversal</dt>
            <dd className={styles.numeric} data-reversal="affiliate">
              {formatMoneySigned(
                detail.affiliate_commission_reversal_cents,
                currency,
              )}
            </dd>
          </div>
        </dl>
      </section>

      {/* Decision panel placeholder — Slice 2 ships the actual
          Approve/Reject actions. */}
      <section className={styles.decision} aria-label="Decision panel">
        <h3 className={styles.cardTitle}>Decision</h3>
        <p className={styles.decisionText}>
          Approve / Reject actions ship in the next slice (STUB-122).
        </p>
        <div className={styles.decisionActions}>
          <button type="button" className={styles.btn} data-variant="primary" disabled>
            Approve full
          </button>
          <button type="button" className={styles.btn} data-variant="partial" disabled>
            Approve partial
          </button>
          <button type="button" className={styles.btn} data-variant="danger" disabled>
            Reject
          </button>
        </div>
      </section>
    </aside>
  )
}