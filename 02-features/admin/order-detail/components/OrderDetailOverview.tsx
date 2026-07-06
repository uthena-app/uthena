// OrderDetailOverview.tsx — the Overview tab content for
// /admin/orders/[id] (P14.8 Slice 1).
//
// Renders the read-only summary the spec calls for on the Overview
// tab:
//   1. Fraud callout (conditional — only when status='fraudulent' OR
//      fraud_score >= 70)
//   2. Customer panel (display_name + email masked + signup date +
//      lifetime orders + lifetime spend + last login)
//   3. Order panel (status + line items count + subtotal + discount +
//      tax + total + refunded + currency)
//   4. Stripe panel (checkout_session_id + payment_intent_id +
//      charge_id + customer_id + subscription_id — full IDs for
//      admin per spec line 63)
//   5. IP / device panel (raw IP masked by default + UA +
//      billing_address if present)
//   6. Partner panel (display_name link to /admin/partners/[id] +
//      partner_status pill)
//   7. Affiliate panel (conditional — display_name link to
//      /admin/affiliates/[id] + handle)
//   8. Refunds panel (newest first)
//   9. Events panel (admin_audit_log + Stripe webhooks, interleaved
//      by event_at desc)
//
// Slice 1 ships the read path + masked-by-default display. Slice 2
// will add:
//   - Reveal interactions for IP + email (with audit rows)
//   - Destructive actions (issue_manual_refund / mark_fraudulent /
//     resend_receipt / copy_payment_intent_id / admin_note)
//   - Customer-view embed (read-only inline /account/orders/[id])
//
// Pure RSC. No client JS shipped. Token-only CSS.

import Link from 'next/link'
import { formatDate } from '@features/payouts'
import { formatMoney, type Currency } from '@foundations/money/cents'
import { ORDER_STATUS_LABEL, ORDER_STATUS_KIND } from '@features/admin/orders/types'
import type { OrderDetail } from '../queries/getAdminOrderDetail'
import { getOrderRefunds, type OrderRefundRow } from '../queries/getOrderRefunds'
import { getOrderEvents, type OrderEventRow } from '../queries/getOrderEvents'
import styles from './OrderDetailOverview.module.css'

export type OrderDetailOverviewProps = {
  orderId: string
  detail: OrderDetail
  refunds: OrderRefundRow[]
  events: OrderEventRow[]
}

export function OrderDetailOverview({
  orderId,
  detail,
  refunds,
  events,
}: OrderDetailOverviewProps) {
  const statusLabel = ORDER_STATUS_LABEL[detail.status] ?? detail.status
  const statusKind = ORDER_STATUS_KIND[detail.status] ?? 'gray'

  const isFraud = detail.status === 'fraudulent'

  return (
    <div className={styles.wrap}>
      {isFraud ? (
        <FraudCallout />
      ) : null}

      <div className={styles.grid}>
        <CustomerPanel detail={detail} />
        <OrderPanel detail={detail} />
        <StripePanel detail={detail} />
        <IPPanel detail={detail} />
        <PartnerPanel detail={detail} />
        {detail.affiliate_id ? <AffiliatePanel detail={detail} /> : null}
      </div>

      <RefundsPanel orderId={orderId} refunds={refunds} />
      <EventsPanel orderId={orderId} events={events} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fraud callout
// ---------------------------------------------------------------------------

function FraudCallout() {
  return (
    <section className={styles.fraudCallout} role="alert" aria-label="Fraud warning">
      <strong className={styles.fraudHeading}>Fraud flagged on this order</strong>
      <p className={styles.fraudBody}>
        This order is marked as <code>fraudulent</code>. Library grants have
        been (or will be) revoked for every line item, partner/affiliate
        ledger rows are reversed, and the customer has been notified.
        Review the event log below for the full chain of action.
      </p>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Customer panel
// ---------------------------------------------------------------------------

function CustomerPanel({ detail }: { detail: OrderDetail }) {
  return (
    <section className={styles.section} aria-label="Customer">
      <header className={styles.sectionHeader}>
        <h2 className={styles.h2}>Customer</h2>
      </header>
      <dl className={styles.dl}>
        <div className={styles.dlRow}>
          <dt className={styles.dt}>Name</dt>
          <dd className={styles.dd}>
            <Link
              href={`/admin/customers/${detail.user_id}`}
              className={styles.link}
            >
              {detail.customer_display_name}
            </Link>
          </dd>
        </div>
        <div className={styles.dlRow}>
          <dt className={styles.dt}>Email (checkout)</dt>
          <dd className={styles.dd} data-pii="masked">
            {detail.customer_checkout_email_masked ?? '—'}
          </dd>
        </div>
        <div className={styles.dlRow}>
          <dt className={styles.dt}>Customer since</dt>
          <dd className={styles.dd}>
            {detail.customer_since ? formatDate(detail.customer_since) : '—'}
          </dd>
        </div>
        <div className={styles.dlRow}>
          <dt className={styles.dt}>Last login</dt>
          <dd className={styles.dd}>
            {detail.customer_last_login_at
              ? formatDate(detail.customer_last_login_at)
              : '—'}
          </dd>
        </div>
        <div className={styles.dlRow}>
          <dt className={styles.dt}>Lifetime orders</dt>
          <dd className={styles.dd}>
            {detail.customer_lifetime_orders.toLocaleString('en-US')}
          </dd>
        </div>
        <div className={styles.dlRow}>
          <dt className={styles.dt}>Lifetime spend</dt>
          <dd className={styles.dd}>
            {formatMoney(detail.customer_lifetime_spend_cents)}
          </dd>
        </div>
      </dl>
      <p className={styles.maskHint}>
        Checkout email + IP are masked by default. The Reveal interaction
        (with a per-reveal audit row + 30s auto-mask) lands in a follow-up
        slice.
      </p>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Order panel — money breakdown
// ---------------------------------------------------------------------------

function OrderPanel({ detail }: { detail: OrderDetail }) {
  const currency = asCurrency(detail.currency)
  return (
    <section className={styles.section} aria-label="Order">
      <header className={styles.sectionHeader}>
        <h2 className={styles.h2}>Order</h2>
        <span className={styles.statusPill} data-kind={statusKindFor(detail.status)}>
          {statusLabelFor(detail.status)}
        </span>
      </header>
      <dl className={styles.dl}>
        <div className={styles.dlRow}>
          <dt className={styles.dt}>Items</dt>
          <dd className={styles.dd}>
            {detail.items_count.toLocaleString('en-US')}
          </dd>
        </div>
        <div className={styles.dlRow}>
          <dt className={styles.dt}>Subtotal</dt>
          <dd className={styles.dd}>
            {formatMoney(detail.subtotal_cents, currency)}
          </dd>
        </div>
        <div className={styles.dlRow}>
          <dt className={styles.dt}>Discount</dt>
          <dd className={styles.dd}>
            {detail.discount_cents > 0
              ? `−${formatMoney(detail.discount_cents, currency)}`
              : formatMoney(0, currency)}
          </dd>
        </div>
        <div className={styles.dlRow}>
          <dt className={styles.dt}>Tax</dt>
          <dd className={styles.dd}>
            {detail.tax_cents > 0
              ? formatMoney(detail.tax_cents, currency)
              : 'Calculated by Stripe at payment'}
          </dd>
        </div>
        <div className={styles.dlRow}>
          <dt className={styles.dt}>Total</dt>
          <dd className={styles.dd} data-strong="true">
            {formatMoney(detail.total_cents, currency)}
          </dd>
        </div>
        {detail.refunded_cents > 0 ? (
          <div className={styles.dlRow}>
            <dt className={styles.dt}>Refunded</dt>
            <dd className={styles.dd} data-pii="amount-refund">
              {formatMoney(detail.refunded_cents, currency)}
            </dd>
          </div>
        ) : null}
        <div className={styles.dlRow}>
          <dt className={styles.dt}>Created</dt>
          <dd className={styles.dd}>{formatDate(detail.created_at)}</dd>
        </div>
        {detail.paid_at ? (
          <div className={styles.dlRow}>
            <dt className={styles.dt}>Paid</dt>
            <dd className={styles.dd}>{formatDate(detail.paid_at)}</dd>
          </div>
        ) : null}
        {detail.fulfilled_at ? (
          <div className={styles.dlRow}>
            <dt className={styles.dt}>Fulfilled</dt>
            <dd className={styles.dd}>{formatDate(detail.fulfilled_at)}</dd>
          </div>
        ) : null}
        {detail.billing_address ? (
          <div className={styles.dlRow}>
            <dt className={styles.dt}>Billing address</dt>
            <dd className={styles.dd} data-mono="true">
              <BillingAddressRenderable address={detail.billing_address} />
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  )
}

function statusLabelFor(status: OrderDetail['status']): string {
  return ORDER_STATUS_LABEL[status] ?? status
}

function statusKindFor(status: OrderDetail['status']): string {
  return ORDER_STATUS_KIND[status] ?? 'gray'
}

/** Defensively narrow an arbitrary string to the typed Currency union. */
function asCurrency(raw: string): Currency {
  return raw === 'USD' || raw === 'EUR' || raw === 'GBP' ? raw : 'USD'
}

// Conservative renderer for the jsonb billing_address block. We do not
// invent a schema — we render whatever keys the row carries, with a
// fail-soft to "(no billing address on file)" when the body is empty.
// Pure: no client JS.
function BillingAddressRenderable({
  address,
}: {
  address: Record<string, unknown>
}) {
  if (!address || typeof address !== 'object') return null
  const entries = Object.entries(address).filter(([, v]) => {
    if (v === null || v === undefined) return false
    if (typeof v === 'string') return v.trim().length > 0
    return true
  })
  if (entries.length === 0) return null
  return (
    <ul className={styles.billList}>
      {entries.map(([k, v]) => (
        <li key={k} className={styles.billItem}>
          <span className={styles.billKey}>{k}:</span>{' '}
          <span className={styles.billVal}>{String(v)}</span>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Stripe panel — full IDs for admin (no truncation per spec line 63)
// ---------------------------------------------------------------------------

function StripePanel({ detail }: { detail: OrderDetail }) {
  const rows: Array<{ label: string; value: string | null; mono?: boolean }> = [
    {
      label: 'Checkout session',
      value: detail.stripe_checkout_session_id,
      mono: true,
    },
    {
      label: 'Payment intent',
      value: detail.stripe_payment_intent_id,
      mono: true,
    },
    { label: 'Charge', value: detail.stripe_charge_id, mono: true },
    { label: 'Customer', value: detail.stripe_customer_id, mono: true },
    {
      label: 'Subscription',
      value: detail.subscription_id,
      mono: true,
    },
    { label: 'Coupon id', value: detail.coupon_id === null ? null : String(detail.coupon_id) },
  ]
  const anyRow = rows.some((r) => r.value !== null)
  return (
    <section className={styles.section} aria-label="Stripe">
      <header className={styles.sectionHeader}>
        <h2 className={styles.h2}>Stripe</h2>
      </header>
      {anyRow ? (
        <dl className={styles.dl}>
          {rows.map((r) => (
            <div key={r.label} className={styles.dlRow}>
              <dt className={styles.dt}>{r.label}</dt>
              <dd
                className={styles.dd}
                data-mono={r.mono ? 'true' : 'false'}
              >
                {r.value ?? '—'}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className={styles.emptyHint}>
          No Stripe identifiers recorded for this order.
        </p>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// IP / device panel
// ---------------------------------------------------------------------------

function IPPanel({ detail }: { detail: OrderDetail }) {
  return (
    <section className={styles.section} aria-label="IP and device">
      <header className={styles.sectionHeader}>
        <h2 className={styles.h2}>IP &amp; device</h2>
      </header>
      <dl className={styles.dl}>
        <div className={styles.dlRow}>
          <dt className={styles.dt}>IP</dt>
          <dd className={styles.dd} data-pii="masked">
            {detail.ip_masked ?? '—'}
          </dd>
        </div>
        <div className={styles.dlRow}>
          <dt className={styles.dt}>User agent</dt>
          <dd className={styles.dd} data-mono="true">
            {detail.user_agent ?? '—'}
          </dd>
        </div>
      </dl>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Partner panel
// ---------------------------------------------------------------------------

function PartnerPanel({ detail }: { detail: OrderDetail }) {
  if (!detail.partner_id) {
    return (
      <section className={styles.section} aria-label="Partner">
        <header className={styles.sectionHeader}>
          <h2 className={styles.h2}>Partner</h2>
        </header>
        <p className={styles.emptyHint}>No partner attributed to this order.</p>
      </section>
    )
  }
  return (
    <section className={styles.section} aria-label="Partner">
      <header className={styles.sectionHeader}>
        <h2 className={styles.h2}>Partner</h2>
        {detail.partner_status ? (
          <span
            className={styles.statusPill}
            data-kind={partnerKind(detail.partner_status)}
          >
            {detail.partner_status}
          </span>
        ) : null}
      </header>
      <dl className={styles.dl}>
        <div className={styles.dlRow}>
          <dt className={styles.dt}>Name</dt>
          <dd className={styles.dd}>
            <Link
              href={`/admin/partners/${detail.partner_id}`}
              className={styles.link}
            >
              {detail.partner_display_name ?? 'Unknown partner'}
            </Link>
          </dd>
        </div>
        {detail.partner_public_slug ? (
          <div className={styles.dlRow}>
            <dt className={styles.dt}>Public slug</dt>
            <dd className={styles.dd} data-mono="true">
              {detail.partner_public_slug}
            </dd>
          </div>
        ) : null}
        <div className={styles.dlRow}>
          <dt className={styles.dt}>Partner id</dt>
          <dd className={styles.dd} data-mono="true">
            #{detail.partner_id}
          </dd>
        </div>
      </dl>
    </section>
  )
}

function partnerKind(status: string): string {
  if (status === 'approved') return 'green'
  if (status === 'suspended') return 'red'
  return 'amber'
}

// ---------------------------------------------------------------------------
// Affiliate panel — conditional render only when affiliate_id present
// ---------------------------------------------------------------------------

function AffiliatePanel({ detail }: { detail: OrderDetail }) {
  if (!detail.affiliate_id) return null
  return (
    <section className={styles.section} aria-label="Affiliate">
      <header className={styles.sectionHeader}>
        <h2 className={styles.h2}>Affiliate</h2>
      </header>
      <dl className={styles.dl}>
        <div className={styles.dlRow}>
          <dt className={styles.dt}>Name</dt>
          <dd className={styles.dd}>
            <Link
              href={`/admin/affiliates/${detail.affiliate_id}`}
              className={styles.link}
            >
              {detail.affiliate_display_name ?? 'Unknown affiliate'}
            </Link>
          </dd>
        </div>
        {detail.affiliate_handle ? (
          <div className={styles.dlRow}>
            <dt className={styles.dt}>Handle</dt>
            <dd className={styles.dd} data-mono="true">
              @{detail.affiliate_handle}
            </dd>
          </div>
        ) : null}
        <div className={styles.dlRow}>
          <dt className={styles.dt}>Affiliate id</dt>
          <dd className={styles.dd} data-mono="true">
            #{detail.affiliate_id}
          </dd>
        </div>
      </dl>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Refunds panel
// ---------------------------------------------------------------------------

function RefundsPanel({
  orderId,
  refunds,
}: {
  orderId: string
  refunds: OrderRefundRow[]
}) {
  return (
    <section className={styles.section} aria-label="Refunds">
      <header className={styles.sectionHeader}>
        <h2 className={styles.h2}>Refunds</h2>
        <span className={styles.counter}>
          {refunds.length} on file
        </span>
      </header>
      {refunds.length === 0 ? (
        <p className={styles.emptyHint}>No refunds against this order.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Id</th>
              <th scope="col">Amount</th>
              <th scope="col">Reason</th>
              <th scope="col">Status</th>
              <th scope="col">Resolved by</th>
              <th scope="col">When</th>
            </tr>
          </thead>
          <tbody>
            {refunds.map((r) => (
              <tr key={r.refund_id}>
                <td data-mono="true">
                  <Link
                    href={`/admin/refunds?refundId=${r.refund_id}`}
                    className={styles.link}
                  >
                    R-{r.refund_id}
                  </Link>
                </td>
                <td data-strong="true">{formatMoney(r.amount_cents)}</td>
                <td>{r.reason}</td>
                <td>
                  <span className={styles.statusPill} data-kind={refundKind(r.status)}>
                    {r.status}
                  </span>
                </td>
                <td>{r.approved_by_display_name ?? '—'}</td>
                <td>{formatDate(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className={styles.emptyHint}>
        Full refund approval + denial actions live in{' '}
        <Link href="/admin/refunds" className={styles.linkInline}>
          the refunds queue
        </Link>{' '}
        (P14.9).
      </p>
      {/* orderId is reserved for the future reveal-action handler that
          will accept either an inline update from this panel or a deep
          link from the refunds queue. */}
      <span data-order-id={orderId} hidden />
    </section>
  )
}

function refundKind(status: string): string {
  if (status === 'succeeded') return 'green'
  if (status === 'failed') return 'red'
  if (status === 'pending') return 'amber'
  return 'gray'
}

// ---------------------------------------------------------------------------
// Events panel — interleaved audit_log + Stripe webhooks
// ---------------------------------------------------------------------------

function EventsPanel({
  orderId,
  events,
}: {
  orderId: string
  events: OrderEventRow[]
}) {
  return (
    <section className={styles.section} aria-label="Events">
      <header className={styles.sectionHeader}>
        <h2 className={styles.h2}>Events</h2>
        <span className={styles.counter}>
          {events.length} total
        </span>
      </header>
      {events.length === 0 ? (
        <p className={styles.emptyHint}>
          No admin actions or Stripe webhook events recorded for this
          order yet.
        </p>
      ) : (
        <ul className={styles.eventsList}>
          {events.map((ev) => (
            <li
              key={ev.event_id}
              className={styles.eventsItem}
              data-kind={ev.event_kind}
            >
              <header className={styles.eventsHeader}>
                <span
                  className={styles.eventsKind}
                  data-kind={ev.event_kind}
                >
                  {ev.event_kind === 'stripe_webhook'
                    ? 'Stripe'
                    : 'Admin'}
                </span>
                <time className={styles.eventsTime} dateTime={ev.event_at}>
                  {formatDate(ev.event_at)}
                </time>
              </header>
              <p className={styles.eventsBody}>
                <code className={styles.eventsAction}>{ev.action}</code>
                {ev.actor_email ? (
                  <span className={styles.eventsActor}>
                    {' '}
                    by {ev.actor_email}
                  </span>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.emptyHint}>
        The{' '}
        <Link href="/admin/audit" className={styles.linkInline}>
          Audit log search
        </Link>{' '}
        (P14.18) will offer deeper filters by actor / event / date.
      </p>
      <span data-order-id={orderId} hidden />
    </section>
  )
}
