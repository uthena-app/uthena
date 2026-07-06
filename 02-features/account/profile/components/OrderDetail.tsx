// OrderDetail — RSC. Single order + items + refund CTA + invoice CTA.
//
// P9.11 — production-grade single-order view. Reads:
//
//   - `order` (the typed return from getMyOrderDetail)
//   - `hostedInvoice` (the Stripe hosted-invoice envelope, null when
//      Stripe isn't configured / no invoice exists yet / the lookup
//      failed; see getHostedInvoiceForOrder for the lookup chain)
//
// The component renders four sections + a sticky action row:
//
//   1. Header         — order id, placed date, status badge,
//                        refund-window hint
//   2. Items          — thumbnail + title (linked) + license badge +
//                        unit price + per-line subscriber discount note
//   3. Summary        — subtotal / discount (with coupon code) / tax /
//                        refunded (when > 0) / total
//   4. Payment        — Stripe PaymentIntent id (truncated) +
//                        billing address (when non-null)
//   5. Actions        — "Download invoice" (CTA → Stripe hosted URL,
//                        gated on `hostedInvoice != null`); "Request
//                        refund" (link, eligibility-gated + disabled
//                        state); "Need help?" mailto fallback
//
// All money values go through `formatMoney` (or the shared
// `@foundations/money/cents` formatter when the cents value is a
// bigint — we use the local formatter for `number` cents to keep the
// component self-contained). No raw hex / px values in the JSX — every
// visual property lives in `OrderDetail.module.css`.

import Link from 'next/link'
import Image from 'next/image'
import { StatusBadge } from './StatusBadge'
import type { OrderDetail, BillingAddress } from '../queries/getMyOrderDetail'
import type { HostedInvoice } from '../queries/getHostedInvoiceForOrder'
import { LicenseBadge } from './LicenseBadge'
import { InvoiceDownloadButton } from './InvoiceDownloadButton'
import styles from './OrderDetail.module.css'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatWindowEnd(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
}

function formatAddress(addr: BillingAddress): string[] {
  // Stripe's billing_address jsonb has variable fields — render only
  // the ones with non-empty values, in a stable order. Empty fields
  // are dropped silently (no "n/a", no blank line).
  const lines: string[] = []
  if (addr.name) lines.push(addr.name)
  if (addr.line1) lines.push(addr.line1)
  if (addr.line2) lines.push(addr.line2)
  // city, state, postal_code go on one line
  const locality = [addr.city, addr.state, addr.postal_code]
    .filter((s): s is string => Boolean(s && s.length > 0))
    .join(', ')
  if (locality) lines.push(locality)
  if (addr.country) lines.push(addr.country)
  return lines
}

export function OrderDetail({
  order,
  hostedInvoice,
}: {
  order: OrderDetail
  hostedInvoice: HostedInvoice | null
}) {
  // Refund eligibility (spec acceptance criterion #2 + #3):
  //   - status must be 'paid' (other statuses are not refundable)
  //   - window must still be open (daysRemaining > 0)
  //   - no active refund row (pending or succeeded)
  const refundEligible =
    order.status === 'paid' && order.days_remaining > 0 && !order.has_active_refund

  // Disabled (visible but not clickable) when status='paid' but a
  // refund is already in flight. Spec criterion #3 wording:
  // "disabled (not just hidden) when a `refunds` row exists with
  // status IN ('requested','approved')". Our schema uses
  // 'pending'/'succeeded'; the meaning is the same.
  const refundDisabledByActive =
    order.status === 'paid' && order.days_remaining > 0 && order.has_active_refund

  const windowAmber = order.days_remaining > 0 && order.days_remaining <= 2

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div>
          <p className={styles.crumb}>
            <Link href="/account/orders" className={styles.crumbLink}>
              ← All orders
            </Link>
          </p>
          <h1 className={styles.h1}>Order #{order.id}</h1>
          <p className={styles.lede}>Placed {formatDate(order.created_at)}</p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      {order.days_remaining > 0 ? (
        <section
          className={`${styles.banner} ${windowAmber ? styles.bannerAmber : styles.bannerInfo}`}
          aria-label="Refund window"
        >
          <p className={styles.bannerText}>
            <strong>Refund window:</strong> eligible until{' '}
            <strong>{formatWindowEnd(order.window_end_at)}</strong> ({order.days_remaining} day
            {order.days_remaining === 1 ? '' : 's'} remaining).
          </p>
        </section>
      ) : order.status === 'paid' ? (
        <section
          className={`${styles.banner} ${styles.bannerMuted}`}
          aria-label="Refund window closed"
        >
          <p className={styles.bannerText}>
            <strong>Refund window closed.</strong> The 14-day refund period for this order has
            ended.
          </p>
        </section>
      ) : null}

      <section className={styles.section}>
        <h2 className={styles.h2}>Items</h2>
        <ul className={styles.itemList}>
          {order.items.map((it) => (
            <li key={it.id} className={styles.item}>
              <div className={styles.itemThumb}>
                {it.product_thumbnail_url ? (
                  <Image
                    src={it.product_thumbnail_url}
                    alt=""
                    width={64}
                    height={64}
                    className={styles.itemThumbImg}
                    unoptimized
                  />
                ) : (
                  <div className={styles.itemThumbPlaceholder} aria-hidden="true" />
                )}
              </div>
              <div className={styles.itemBody}>
                <p className={styles.itemTitle}>
                  {it.product_slug ? (
                    <Link href={`/products/${it.product_slug}`} className={styles.itemLink}>
                      {it.product_title}
                    </Link>
                  ) : (
                    it.product_title
                  )}
                </p>
                <p className={styles.itemMeta}>
                  <LicenseBadge license={it.license} /> · Qty {it.quantity}
                </p>
                {it.subscriber_discount_cents > 0 && (
                  <p className={styles.itemDiscount}>
                    incl. {formatMoney(it.subscriber_discount_cents, order.currency)} subscriber
                    discount
                  </p>
                )}
              </div>
              <div className={styles.itemTotals}>
                {formatMoney(it.line_total_cents, order.currency)}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>Summary</h2>
        <dl className={styles.summary}>
          <div className={styles.summaryRow}>
            <dt>Subtotal</dt>
            <dd>{formatMoney(order.subtotal_cents, order.currency)}</dd>
          </div>
          {order.discount_cents > 0 && (
            <div className={styles.summaryRow}>
              <dt>
                Discount
                {order.coupon_code ? (
                  <span className={styles.couponCode}> · {order.coupon_code}</span>
                ) : null}
              </dt>
              <dd>−{formatMoney(order.discount_cents, order.currency)}</dd>
            </div>
          )}
          {order.tax_cents > 0 && (
            <div className={styles.summaryRow}>
              <dt>Tax</dt>
              <dd>{formatMoney(order.tax_cents, order.currency)}</dd>
            </div>
          )}
          {order.refunded_cents > 0 && (
            <div className={styles.summaryRow}>
              <dt>Refunded</dt>
              <dd>−{formatMoney(order.refunded_cents, order.currency)}</dd>
            </div>
          )}
          <div className={`${styles.summaryRow} ${styles.totalRow}`}>
            <dt>Total</dt>
            <dd>{formatMoney(order.total_cents, order.currency)}</dd>
          </div>
        </dl>
      </section>

      {(order.stripe_payment_intent_short || order.billing_address) && (
        <section className={styles.section}>
          <h2 className={styles.h2}>Payment</h2>
          <dl className={styles.summary}>
            {order.stripe_payment_intent_short && (
              <div className={styles.summaryRow}>
                <dt>Stripe reference</dt>
                <dd className={styles.mono}>{order.stripe_payment_intent_short}</dd>
              </div>
            )}
            {order.billing_address && (
              <div className={styles.summaryRow}>
                <dt>Billing address</dt>
                <dd className={styles.addressBlock}>
                  {formatAddress(order.billing_address).map((line, i) => (
                    <span key={i} className={styles.addressLine}>
                      {line}
                    </span>
                  ))}
                </dd>
              </div>
            )}
          </dl>
          <p className={styles.paymentHelp}>
            Card brand + last 4 digits are stored once Stripe webhook populates the snapshot.{' '}
            <Link href="/account/settings" className={styles.helpLink}>
              Manage payment methods
            </Link>
            .
          </p>
        </section>
      )}

      <section className={styles.actions}>
        <div className={styles.actionsRow}>
          <InvoiceDownloadButton
            orderId={order.id}
            hostedInvoice={hostedInvoice}
          />
          {refundEligible && (
            <Link
              href={`/account/orders/${order.id}/refund`}
              className={`${styles.actionBtn} ${styles.actionBtnSecondary}`}
            >
              Request refund
            </Link>
          )}
          {refundDisabledByActive && (
            <span
              className={`${styles.actionBtn} ${styles.actionBtnDisabled}`}
              aria-disabled="true"
              title="A refund for this order is already being processed."
            >
              Refund in progress
            </span>
          )}
        </div>
        <p className={styles.helpBody}>
          For anything else, email{' '}
          <a href="mailto:support@uthena.com" className={styles.helpLink}>
            support@uthena.com
          </a>{' '}
          with the order id.
        </p>
      </section>
    </div>
  )
}