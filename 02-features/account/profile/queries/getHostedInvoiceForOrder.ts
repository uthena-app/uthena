// getHostedInvoiceForOrder.ts — Stripe hosted-invoice lookup for /account/orders/[id].
//
// P9.11 (Order detail): the spec asks for a "Download invoice" CTA that
// surfaces a PDF. Per STUB-051 (RESOLVED 2026-06-29), we **do not** render
// our own PDF — we link to Stripe's `invoice.hosted_invoice_url`. Stripe
// regenerates the hosted invoice whenever line items change, so the URL is
// the canonical source for the user's invoice view.
//
// Lookup chain (fail-soft at every step):
//   1. The order must be owned by the signed-in user (RLS enforces; we
//      also pass `eq('user_id', user.id)` for defense-in-depth).
//   2. The order must have a `stripe_payment_intent_id` (set by
//      `onPaymentSucceeded` webhook — orders without one aren't paid yet).
//   3. Stripe must be configured (`STRIPE_SECRET_KEY`).
//   4. We fetch the PaymentIntent and read its `latest_invoice` id, then
//      fetch the invoice and return its `hosted_invoice_url` +
//      `invoice_pdf` (the raw PDF URL).
//
// Returns `null` whenever any step in the chain fails or any value is
// missing. The caller (the RSC page) checks the return value to decide
// whether to render the "Download invoice" CTA — the button is hidden
// when there's no invoice, with no error noise in the UI.
//
// PII safety: never logs the `hosted_invoice_url` (it's a single-tenant
// URL keyed to the Stripe Customer ID, so it's effectively a bearer
// token for the user's invoice). The audit-log row (`file_downloads`
// with `kind='invoice_redirect'`) is what gives the admin queue
// visibility into invoice access.

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import {
  isStripeConfigured,
  getStripe,
  withStripeErrorHandling,
} from '@foundations/money/stripe'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'account.profile.getHostedInvoiceForOrder' })

export type HostedInvoice = {
  /** Stripe `hosted_invoice_url` — open in a new tab in the UI. */
  hostedInvoiceUrl: string
  /** Stripe `invoice_pdf` — direct PDF link (raw, hosted by Stripe). */
  invoicePdfUrl: string
  /** Stripe invoice id (invi_...). Useful for the audit log. */
  invoiceId: string
  /** Stripe invoice number (e.g. "ABC-2026-0001") — shown as the CTA label. */
  invoiceNumber: string | null
}

export async function getHostedInvoiceForOrder(
  orderId: number,
): Promise<HostedInvoice | null> {
  if (!Number.isInteger(orderId) || orderId <= 0) return null
  if (!isStripeConfigured()) return null

  const user = await getSessionUser()
  if (!user) return null

  const supabase = await getServerSupabase()
  const { data: order } = await supabase
    .from('orders')
    .select('id, stripe_payment_intent_id, stripe_customer_id, status, currency, total_cents')
    .eq('id', orderId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!order) return null
  if (order.status !== 'paid' && order.status !== 'fulfilled' && order.status !== 'partially_refunded') {
    return null
  }

  const paymentIntentId = order.stripe_payment_intent_id as string | null
  if (!paymentIntentId) return null

  const stripe = getStripe()

  // Step A: retrieve the PaymentIntent → read `invoice` (the field
  // name on the PaymentIntent type — it's `invoice`, NOT `latest_invoice`,
  // despite Stripe dashboard labels calling it "latest invoice"). The
  // field is `string | Stripe.Invoice | null`; we only care about the
  // string id for the next lookup.
  const piResult = await withStripeErrorHandling(
    () => stripe.paymentIntents.retrieve(paymentIntentId),
    { surface: 'account.profile.getHostedInvoiceForOrder' },
  )
  if (!piResult.ok) {
    log.warn(
      { code: 'pi_retrieve_failed', msg: piResult.message, status: piResult.status },
      'paymentIntents.retrieve failed for hosted-invoice lookup',
    )
    return null
  }
  const invoiceRef = piResult.data.invoice
  const latestInvoiceId =
    typeof invoiceRef === 'string'
      ? invoiceRef
      : invoiceRef && typeof invoiceRef === 'object'
        ? (invoiceRef.id ?? null)
        : null
  if (!latestInvoiceId) return null

  // Step B: retrieve the Invoice → return hosted URLs.
  const invResult = await withStripeErrorHandling(
    () => stripe.invoices.retrieve(latestInvoiceId),
    { surface: 'account.profile.getHostedInvoiceForOrder' },
  )
  if (!invResult.ok) {
    log.warn(
      { code: 'invoice_retrieve_failed', msg: invResult.message, status: invResult.status },
      'invoices.retrieve failed for hosted-invoice lookup',
    )
    return null
  }
  const inv = invResult.data
  if (!inv.hosted_invoice_url || !inv.invoice_pdf) return null

  return {
    hostedInvoiceUrl: inv.hosted_invoice_url,
    invoicePdfUrl: inv.invoice_pdf,
    invoiceId: inv.id ?? latestInvoiceId,
    invoiceNumber: inv.number ?? null,
  }
}