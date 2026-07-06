// Component tests for the admin order detail feature. Pure RSC
// components, rendered via renderToStaticMarkup to verify the static
// HTML structure.
//
// Coverage:
//   - OrderDetailTabs (single Overview tab rendered with the right
//     active state + the URL pattern)
//   - OrderDetailOverview (every panel renders the right surface +
//     masked-by-default PII behavior + fraud callout conditional +
//     affiliate panel conditional + empty-state branches)

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { OrderDetailTabs } from './components/OrderDetailTabs'
import { OrderDetailOverview } from './components/OrderDetailOverview'
import type { OrderDetail } from './queries/getAdminOrderDetail'
import type { OrderRefundRow } from './queries/getOrderRefunds'
import type { OrderEventRow } from './queries/getOrderEvents'

const baseDetail: OrderDetail = {
  order_id: 12345,
  user_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  customer_checkout_email_raw: 'jane.doe@example.com',
  customer_checkout_email_masked: 'j***@example.com',
  status: 'paid',
  subtotal_cents: 9900,
  discount_cents: 500,
  tax_cents: 0,
  total_cents: 9400,
  currency: 'USD',
  refunded_cents: 0,
  billing_address: null,
  ip_raw: '203.0.113.42',
  ip_masked: '203.0.11...',
  user_agent: 'Mozilla/5.0',
  stripe_checkout_session_id: 'cs_test_abc',
  stripe_payment_intent_id: 'pi_test_xyz',
  stripe_charge_id: 'ch_test_qrs',
  stripe_customer_id: 'cus_test_tuv',
  subscription_id: null,
  coupon_id: null,
  paid_at: '2026-06-30 12:34:56+00',
  fulfilled_at: null,
  created_at: '2026-06-30 12:34:56+00',
  updated_at: '2026-06-30 12:34:56+00',
  customer_display_name: 'Jane Doe',
  customer_avatar_url: null,
  customer_since: '2025-01-01 00:00:00+00',
  customer_lifetime_orders: 3,
  customer_lifetime_spend_cents: 30000,
  customer_last_login_at: '2026-06-25 08:00:00+00',
  partner_id: 99,
  partner_display_name: 'Acme Partner',
  partner_status: 'approved',
  partner_public_slug: 'acme',
  affiliate_id: 42,
  affiliate_display_name: 'Aff Jane',
  affiliate_handle: 'janeaff',
  items_count: 2,
}

describe('OrderDetailTabs', () => {
  it('renders the single Overview tab with the right active state', () => {
    const html = renderToStaticMarkup(
      <OrderDetailTabs orderId="12345" activeTab="overview" />,
    )
    expect(html).toContain('aria-label="Order detail sections"')
    expect(html).toContain('Overview')
    expect(html).toContain('href="/admin/orders/12345?tab=overview"')
    expect(html).toMatch(/data-active="true"[^>]*aria-current="page"/)
    expect(html).toContain('aria-current="page"')
  })
})

describe('OrderDetailOverview', () => {
  it('renders every panel + masked-by-default PII + the customer link', () => {
    const html = renderToStaticMarkup(
      <OrderDetailOverview
        orderId="12345"
        detail={baseDetail}
        refunds={[]}
        events={[]}
      />,
    )
    expect(html).toContain('Customer')
    expect(html).toContain('Order')
    expect(html).toContain('Stripe')
    expect(html).toContain('IP &amp; device')
    expect(html).toContain('Partner')
    expect(html).toContain('Affiliate')
    // Masked email + masked IP rendered, raw never reaches the DOM
    expect(html).toContain('j***@example.com')
    expect(html).toContain('203.0.11...')
    expect(html).not.toContain('jane.doe@example.com')
    expect(html).not.toContain('203.0.113.42')
    // Customer + partner + affiliate cross-links
    expect(html).toContain('href="/admin/customers/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"')
    expect(html).toContain('href="/admin/partners/99"')
    expect(html).toContain('href="/admin/affiliates/42"')
    // Affiliate handle visible
    expect(html).toContain('@janeaff')
    // Status pill with paid tone
    expect(html).toMatch(/data-kind="green"[^>]*>paid/i)
  })

  it('renders the fraud callout when status is fraudulent', () => {
    const html = renderToStaticMarkup(
      <OrderDetailOverview
        orderId="1"
        detail={{ ...baseDetail, status: 'fraudulent' }}
        refunds={[]}
        events={[]}
      />,
    )
    expect(html).toContain('Fraud flagged on this order')
    expect(html).toContain('role="alert"')
  })

  it('omits the fraud callout when status is paid', () => {
    const html = renderToStaticMarkup(
      <OrderDetailOverview
        orderId="1"
        detail={{ ...baseDetail, status: 'paid' }}
        refunds={[]}
        events={[]}
      />,
    )
    expect(html).not.toContain('Fraud flagged on this order')
  })

  it('hides the affiliate panel when orders.affiliate_id is null', () => {
    const html = renderToStaticMarkup(
      <OrderDetailOverview
        orderId="1"
        detail={{
          ...baseDetail,
          affiliate_id: null,
          affiliate_display_name: null,
          affiliate_handle: null,
        }}
        refunds={[]}
        events={[]}
      />,
    )
    expect(html).not.toContain('href="/admin/affiliates/')
  })

  it('renders empty-state copy for zero refunds + zero events', () => {
    const html = renderToStaticMarkup(
      <OrderDetailOverview
        orderId="1"
        detail={baseDetail}
        refunds={[]}
        events={[]}
      />,
    )
    expect(html).toContain('No refunds against this order.')
    expect(html).toContain('No admin actions or Stripe webhook events recorded')
    expect(html).toContain('0 on file')
    expect(html).toContain('0 total')
  })

  it('renders the refund table when refunds exist', () => {
    const refunds: OrderRefundRow[] = [
      {
        refund_id: 55,
        amount_cents: 1200,
        reason: 'requested_by_customer',
        notes: 'extra notes',
        status: 'succeeded',
        stripe_refund_id: 're_abc',
        requested_by: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        requested_by_display_name: 'Jane Doe',
        approved_by: 'ffffffff-1111-2222-3333-444444444444',
        approved_by_display_name: 'Admin',
        approved_at: '2026-06-30 12:00:00+00',
        processed_at: '2026-06-30 12:01:00+00',
        created_at: '2026-06-30 11:59:00+00',
        updated_at: '2026-06-30 12:01:00+00',
      },
    ]
    const html = renderToStaticMarkup(
      <OrderDetailOverview
        orderId="1"
        detail={baseDetail}
        refunds={refunds}
        events={[]}
      />,
    )
    expect(html).toContain('R-55')
    expect(html).toContain('href="/admin/refunds?refundId=55"')
    expect(html).toContain('requested_by_customer')
    expect(html).toMatch(/data-kind="green"[^>]*>succeeded/i)
    expect(html).toContain('1 on file')
  })

  it('renders the events list with audit + webhook kinds distinguished', () => {
    const events: OrderEventRow[] = [
      {
        event_id: 'audit:1',
        event_kind: 'audit_log',
        event_at: '2026-06-30 12:00:00+00',
        actor_id: 'aaaaaaaa',
        actor_email: 'admin@uthena',
        action: 'admin.order_detail_viewed',
        target_kind: 'orders',
        target_id: '1',
        summary: 'admin.order_detail_viewed',
        metadata: null,
      },
      {
        event_id: 'webhook:1',
        event_kind: 'stripe_webhook',
        event_at: '2026-06-30 11:00:00+00',
        actor_id: null,
        actor_email: null,
        action: 'charge.succeeded',
        target_kind: 'processed_webhooks',
        target_id: '1',
        summary: 'charge.succeeded',
        metadata: null,
      },
    ]
    const html = renderToStaticMarkup(
      <OrderDetailOverview
        orderId="1"
        detail={baseDetail}
        refunds={[]}
        events={events}
      />,
    )
    expect(html).toContain('admin.order_detail_viewed')
    expect(html).toContain('charge.succeeded')
    expect(html).toContain('by admin@uthena')
    // Both kinds present
    expect(html).toMatch(/data-kind="audit_log"[^>]*>Admin/i)
    expect(html).toMatch(/data-kind="stripe_webhook"[^>]*>Stripe/i)
    expect(html).toContain('2 total')
  })

  it('renders the partner link even when the partner is missing', () => {
    const html = renderToStaticMarkup(
      <OrderDetailOverview
        orderId="1"
        detail={{
          ...baseDetail,
          partner_id: null,
          partner_display_name: null,
          partner_status: null,
          partner_public_slug: null,
        }}
        refunds={[]}
        events={[]}
      />,
    )
    // The partner panel renders in "empty partner" mode rather than as a
    // link target.
    expect(html).not.toContain('href="/admin/partners/null"')
    expect(html).toContain('No partner attributed to this order.')
  })

  it('renders the order panel summary with the refunded line when > 0', () => {
    const html = renderToStaticMarkup(
      <OrderDetailOverview
        orderId="1"
        detail={{ ...baseDetail, refunded_cents: 500 }}
        refunds={[]}
        events={[]}
      />,
    )
    expect(html).toContain('Refunded')
    expect(html).toMatch(/data-pii="amount-refund"/)
  })

  it('does not render the refunded row when refunded_cents is 0', () => {
    const html = renderToStaticMarkup(
      <OrderDetailOverview
        orderId="1"
        detail={{ ...baseDetail, refunded_cents: 0 }}
        refunds={[]}
        events={[]}
      />,
    )
    expect(html).not.toContain('>Refunded<')
  })

  it('renders the Stripe panel fall-back when no Stripe ids are recorded', () => {
    const html = renderToStaticMarkup(
      <OrderDetailOverview
        orderId="1"
        detail={{
          ...baseDetail,
          stripe_checkout_session_id: null,
          stripe_payment_intent_id: null,
          stripe_charge_id: null,
          stripe_customer_id: null,
          subscription_id: null,
          coupon_id: null,
        }}
        refunds={[]}
        events={[]}
      />,
    )
    expect(html).toContain('No Stripe identifiers recorded for this order.')
  })
})
