// handleStripeWebhook.ts — the actual webhook dispatch logic, kept in
// 04-platform/ so it lives next to other platform-level webhook code.
// The Next route at 03-app/api/webhooks/stripe/route.ts mounts this
// and returns the response.
//
// Steps (per 04-platform/webhooks/README.md):
//   1. Verify signature (STRIPE_WEBHOOK_SECRET). Returns 401 on bad sig.
//   2. Claim the event id (idempotency). Returns 200 on duplicate.
//   3. Switch on event.type and hand off to feature business logic.
//   4. On success: return 200. On thrown error: release the claim so
//      the retry can reprocess; return 500 so Stripe retries.

import type Stripe from 'stripe'
import { verifyWebhook } from '@foundations/money/stripe'
import {
  onPaymentSucceeded,
  onRefund,
  onPaymentFailed,
  onDisputeCreated,
  onDisputeClosed,
} from '@features/checkout'
import {
  onSubscriptionCreated,
  onSubscriptionUpdated,
  onSubscriptionDeleted,
  onInvoiceEvent,
} from '@features/subscriptions'
import {
  claimWebhookEvent,
  finalizeWebhookEvent,
  releaseWebhookEvent,
  type WebhookOutcome,
} from '../_middleware'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'webhooks.stripe' })

export type WebhookResponse = { status: number; body: string }

export async function handleStripeWebhook(
  rawBody: string,
  signature: string | null,
): Promise<WebhookResponse> {
  // 1. Signature verification.
  if (!signature) {
    return { status: 401, body: 'missing signature' }
  }
  let event: Stripe.Event
  try {
    event = verifyWebhook(rawBody, signature)
  } catch (err) {
    log.warn({ code: 'bad_signature' }, 'webhook signature verification failed')
    return { status: 401, body: 'bad signature' }
  }

  // 2. Idempotency.
  let claim
  try {
    claim = await claimWebhookEvent('stripe', event.id, event.type, event as unknown)
  } catch (err) {
    return { status: 500, body: 'idempotency error' }
  }
  if (!claim.claimed) {
    return { status: 200, body: 'OK (duplicate)' }
  }

  // 3. Dispatch.
  // The outcome is tracked so we can finalize the processed_webhooks
  // row with the right value (P3.4 contract):
  //   - 'processed' → the handler ran to completion and acted on the event
  //   - 'skipped'   → the event type is recognized but not actionable
  //                   (Stripe sends dozens of event types we don't act on)
  //   - 'failed'    → reserved for permanent failure; today we always
  //                   release the claim + return 500 (transient path)
  //                   so this branch isn't currently set by the dispatch.
  //                   Kept in the union for future use.
  let outcome: WebhookOutcome = 'processed'
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const res = await onPaymentSucceeded({
          id: session.id,
          payment_intent:
            typeof session.payment_intent === 'string' ? session.payment_intent : null,
          customer: typeof session.customer === 'string' ? session.customer : null,
          customer_email: session.customer_email ?? null,
          amount_total: session.amount_total ?? null,
          metadata: (session.metadata as Record<string, string> | null) ?? null,
          payment_status: session.payment_status,
          // STUB-006 — Stripe's authoritative tax breakdown (present
          // when automatic_tax was enabled on session-create).
          total_details: session.total_details
            ? { amount_tax: session.total_details.amount_tax ?? null }
            : null,
        })
        if (!res.ok) {
          // Soft failure: release the claim so Stripe's retry can
          // reprocess. Without this, Stripe thinks the event is done
          // (we returned 200) but no fulfillment happened — a silent
          // dropped order. Release + return 500 → Stripe retries.
          await releaseWebhookEvent('stripe', event.id)
          log.warn({ code: 'handler_soft_fail', type: event.type, err: res.error }, 'onPaymentSucceeded soft-failed; releasing claim')
          return { status: 500, body: 'handler soft-fail' }
        }
        break
      }
      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge
        const res = await onRefund({
          id: charge.id,
          payment_intent:
            typeof charge.payment_intent === 'string' ? charge.payment_intent : null,
          amount: charge.amount_refunded ?? null,
          metadata: (charge.metadata as Record<string, string> | null) ?? null,
        })
        if (!res.ok) {
          await releaseWebhookEvent('stripe', event.id)
          log.warn({ code: 'handler_soft_fail', type: event.type, err: res.error }, 'onRefund soft-failed; releasing claim')
          return { status: 500, body: 'handler soft-fail' }
        }
        break
      }
      // ----- Payment failure (STUB-063) -----
      // Moves an order out of `awaiting_payment` and releases its cart
      // lines so the buyer can retry, instead of leaving the order
      // stuck forever.
      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent
        const res = await onPaymentFailed({
          event_type: 'payment_intent.payment_failed',
          payment_intent_id: pi.id,
          failure_message: pi.last_payment_error?.message ?? null,
        })
        if (!res.ok) {
          await releaseWebhookEvent('stripe', event.id)
          log.warn({ code: 'handler_soft_fail', type: event.type, err: res.error }, 'onPaymentFailed soft-failed; releasing claim')
          return { status: 500, body: 'handler soft-fail' }
        }
        break
      }
      case 'checkout.session.expired': {
        const session = event.data.object as Stripe.Checkout.Session
        const res = await onPaymentFailed({
          event_type: 'checkout.session.expired',
          checkout_session_id: session.id,
        })
        if (!res.ok) {
          await releaseWebhookEvent('stripe', event.id)
          log.warn({ code: 'handler_soft_fail', type: event.type, err: res.error }, 'onPaymentFailed soft-failed; releasing claim')
          return { status: 500, body: 'handler soft-fail' }
        }
        break
      }
      case 'checkout.session.async_payment_failed': {
        const session = event.data.object as Stripe.Checkout.Session
        const res = await onPaymentFailed({
          event_type: 'checkout.session.async_payment_failed',
          checkout_session_id: session.id,
          payment_intent_id:
            typeof session.payment_intent === 'string' ? session.payment_intent : null,
        })
        if (!res.ok) {
          await releaseWebhookEvent('stripe', event.id)
          log.warn({ code: 'handler_soft_fail', type: event.type, err: res.error }, 'onPaymentFailed soft-failed; releasing claim')
          return { status: 500, body: 'handler soft-fail' }
        }
        break
      }
      // ----- Disputes (STUB-061) -----
      // A lost dispute must reverse/hold the partner payout instead of
      // over-paying — see 02-features/checkout/actions/onDispute.ts.
      case 'charge.dispute.created': {
        const dispute = event.data.object as Stripe.Dispute
        const res = await onDisputeCreated({
          id: dispute.id,
          payment_intent:
            typeof dispute.payment_intent === 'string' ? dispute.payment_intent : null,
          amount: dispute.amount ?? null,
          reason: dispute.reason ?? null,
          status: dispute.status ?? null,
        })
        if (!res.ok) {
          await releaseWebhookEvent('stripe', event.id)
          log.warn({ code: 'handler_soft_fail', type: event.type, err: res.error }, 'onDisputeCreated soft-failed; releasing claim')
          return { status: 500, body: 'handler soft-fail' }
        }
        break
      }
      case 'charge.dispute.closed': {
        const dispute = event.data.object as Stripe.Dispute
        const res = await onDisputeClosed({
          id: dispute.id,
          payment_intent:
            typeof dispute.payment_intent === 'string' ? dispute.payment_intent : null,
          amount: dispute.amount ?? null,
          reason: dispute.reason ?? null,
          status: dispute.status ?? null,
        })
        if (!res.ok) {
          await releaseWebhookEvent('stripe', event.id)
          log.warn({ code: 'handler_soft_fail', type: event.type, err: res.error }, 'onDisputeClosed soft-failed; releasing claim')
          return { status: 500, body: 'handler soft-fail' }
        }
        break
      }
      // ----- Subscription lifecycle -----
      case 'customer.subscription.created': {
        const sub = event.data.object as Stripe.Subscription
        const res = await onSubscriptionCreated(sub as unknown as Parameters<typeof onSubscriptionCreated>[0])
        if (!res.ok) {
          await releaseWebhookEvent('stripe', event.id)
          log.warn({ code: 'handler_soft_fail', type: event.type, err: res.error }, 'onSubscriptionCreated soft-failed; releasing claim')
          return { status: 500, body: 'handler soft-fail' }
        }
        break
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        const res = await onSubscriptionUpdated(sub as unknown as Parameters<typeof onSubscriptionUpdated>[0])
        if (!res.ok) {
          await releaseWebhookEvent('stripe', event.id)
          log.warn({ code: 'handler_soft_fail', type: event.type, err: res.error }, 'onSubscriptionUpdated soft-failed; releasing claim')
          return { status: 500, body: 'handler soft-fail' }
        }
        break
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const res = await onSubscriptionDeleted(sub as unknown as Parameters<typeof onSubscriptionDeleted>[0])
        if (!res.ok) {
          // Pre-P3.4 inconsistency: the deleted handler logs the soft-fail
          // but doesn't release the claim and doesn't return 500. Stripe
          // sees 200, the dedup row stays, and no retry happens. We
          // preserve that behavior here (not in P3.4's scope to change
          // dispatch semantics) but record the failure in the audit log
          // via `failed` outcome so support can see the gap.
          await finalizeWebhookEvent(
            'stripe',
            event.id,
            'failed',
            `onSubscriptionDeleted: ${res.error}`,
          )
          log.warn({ code: 'handler_failed', type: event.type, err: res.error }, 'onSubscriptionDeleted returned error; recorded as failed')
        }
        break
      }
      case 'invoice.paid':
      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice
        const res = await onInvoiceEvent({
          id: inv.id ?? '',
          customer: typeof inv.customer === 'string' ? inv.customer : null,
          subscription: typeof inv.subscription === 'string' ? inv.subscription : null,
          status: inv.status ?? null,
          amount_due: inv.amount_due ?? null,
          amount_paid: inv.amount_paid ?? null,
        })
        if (!res.ok) {
          await releaseWebhookEvent('stripe', event.id)
          log.warn({ code: 'handler_soft_fail', type: event.type, err: res.error }, 'onInvoiceEvent soft-failed; releasing claim')
          return { status: 500, body: 'handler soft-fail' }
        }
        break
      }
      default:
        // Unhandled event type — Stripe sends many we don't act on
        // (e.g. `payment_method.attached`, `customer.updated`). Record
        // the event as `skipped` so the audit log captures that we
        // SAW the event and chose to ignore it.
        outcome = 'skipped'
        log.info({ type: event.type }, 'unhandled stripe event (recorded as skipped)')
    }
  } catch (err) {
    await releaseWebhookEvent('stripe', event.id)
    log.error(
      { code: 'handler_threw', type: event.type, err: (err as Error).message },
      'webhook handler threw',
    )
    return { status: 500, body: 'handler error' }
  }

  // 4. Finalize — write the outcome to processed_webhooks. Idempotent;
  // if the row was already released (transient-failure paths above
  // return before this point), this is a no-op. The service-role
  // client bypasses RLS so the UPDATE always succeeds.
  await finalizeWebhookEvent('stripe', event.id, outcome)

  return { status: 200, body: 'OK' }
}
