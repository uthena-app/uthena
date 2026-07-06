# 04-platform/webhooks/

Webhook handlers. Inbound HTTP endpoints that receive events from external services (Stripe, PayPal, Bunny, Resend). Every webhook handler is a thin wrapper that does three things: verify the signature, parse the event, and hand it off to the appropriate server action.

## Files

- **`stripe/`** — `/api/webhooks/stripe` — `handleStripeWebhook.ts` is the dispatch logic (signature + claim + switch + finalize); the Next route is in `03-app/api/webhooks/stripe/route.ts`. Handles `checkout.session.completed`, `charge.refunded`, `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`, etc.
- **`paypal.ts`** — `/api/webhooks/paypal` — handles `PAYOUT.BATCH.PROCESSED`, `PAYOUT.ITEM.FAILED`, etc.
- **`bunny.ts`** — `/api/webhooks/bunny` — handles `video.transcoded`, `video.failed`, `storage.object.uploaded`, etc.
- **`resend.ts`** — `/api/webhooks/resend` — handles `email.delivered`, `email.bounced`, `email.complained`, etc.
- **`_middleware.ts`** — shared middleware: `claimWebhookEvent` (race-safe INSERT), `finalizeWebhookEvent` (write outcome), `releaseWebhookEvent` (transient-fail cleanup). Pure functions over `processed_webhooks`. See the [P3.4 idempotency contract](#the-p34-idempotency-contract) below.
- **`_middleware.test.ts`** — 16 unit tests for the three middleware helpers (no DB needed; chainable fake Supabase).
- **`_handlers/`** — actual business logic for each event type, separate from the HTTP wrapper

## The webhook contract

### 1. Signature verification (always)

Every webhook endpoint verifies the source's signature BEFORE parsing the body. Unverified events are rejected with 401.

```ts
// stripe.ts
import { verifyWebhookSignature } from '00-foundations/money/stripe';

export async function POST(req: Request) {
  const sig = req.headers.get('stripe-signature');
  const body = await req.text();
  const event = verifyWebhookSignature(body, sig);  // throws on invalid sig
  // ...
}
```

If signature verification fails, the response is 401 and nothing else runs. We do NOT log the body (could contain PII).

### 2. Idempotency (always)

Every event has a unique ID (`stripe_event_id`, `paypal_event_id`, etc.). Before processing, we check the `processed_webhooks` table:

```ts
const isNew = await tryClaimEvent({
  source: 'stripe',
  eventId: event.id,
});
if (!isNew) {
  return new Response('OK (duplicate)', { status: 200 });
}
```

If the event was already processed, we return 200 and do nothing. This makes webhooks safe to retry.

The `processed_webhooks` table has a unique constraint on `(source, event_id)`. Two concurrent deliveries of the same event will not both process (one will hit the unique constraint and bail).

### 3. Hand-off to business logic

After signature + idempotency, the handler delegates to the relevant feature module:

```ts
// stripe.ts (continued)
import { onPaymentSucceeded } from '02-features/checkout/actions/onPaymentSucceeded';
import { onRefund } from '02-features/checkout/actions/onRefund';

export async function POST(req: Request) {
  // ...verify, idempotency...
  switch (event.type) {
    case 'payment_intent.succeeded':
      await onPaymentSucceeded(event.data.object);
      break;
    case 'charge.refunded':
      await onRefund(event.data.object);
      break;
    // ...
  }
  return new Response('OK', { status: 200 });
}
```

The handler file is the wiring. The business logic lives in the feature module's `actions/` folder. Webhook handlers are SHORT (mostly switch statements).

## Idempotency — the deeper story

`processed_webhooks` is a table in the DB. The flow:

```
Webhook arrives
  → claimWebhookEvent: INSERT (source, event_id, payload, result=NULL)
  → If unique constraint violation: already processed, return 200
  → If insert succeeds: process the event
  → If processing succeeds: finalizeWebhookEvent('processed') — UPDATE result + processed_at
  → If processing fails permanently: finalizeWebhookEvent('failed', err) — UPDATE result + error_message
  → If processing fails transiently: releaseWebhookEvent() — DELETE the row so Stripe's retry can reprocess
```

The three-helper pattern (`claim` / `finalize` / `release`) in `_middleware.ts` enforces the contract. The unique constraint on `(source, event_id)` is the race-safety boundary — two concurrent deliveries of the same event will not both process (one hits the unique constraint and the call returns `{ claimed: false }`).

**Why this matters:** Stripe will retry failed webhooks up to 3 days. PayPal will retry for 72 hours. We MUST be safe to receive the same event multiple times.

## The P3.4 idempotency contract

The `processed_webhooks.result` column has three meaningful values plus NULL:

| `result`     | Set by                              | When                                                                                  |
|--------------|--------------------------------------|---------------------------------------------------------------------------------------|
| `'processed'`| `finalizeWebhookEvent` (success)     | The handler ran to completion and acted on the event. Row stays for the audit log.   |
| `'skipped'`  | `finalizeWebhookEvent` (default)     | The event type is recognized but not actionable (e.g. Stripe sends `payment_method.attached` and we don't act on it). Row stays for the audit log. |
| `'failed'`   | `finalizeWebhookEvent` (permanent)   | The handler decided the event will never succeed, even with retries. Row stays for the audit log. **Currently unused** — the dispatch path uses `releaseWebhookEvent` for all failures and returns 500 to Stripe. Kept in the union for future use. |
| `NULL`       | `claimWebhookEvent` (initial)        | The row is freshly claimed; the handler hasn't run yet. Also the state of any row that was claimed then released (transient-failure path) — but that path DELETEs the row, so NULL is the pre-dispatch state only. |

**Transience vs permanence.** Today, the dispatch loop (e.g. `handleStripeWebhook.ts`) treats every soft-fail as transient: it calls `releaseWebhookEvent` and returns 500. Stripe retries for up to 3 days. The `'failed'` outcome is reserved for a future "I know this will never succeed" path (e.g. a permanent 4xx from a downstream service).

**Finalize is idempotent.** If the row was already released (the transient-failure paths return before the finalize call), `finalizeWebhookEvent` is a no-op. The service-role client bypasses RLS, so the UPDATE always succeeds when the row exists.

## Retention

The `processed_webhooks` table has a 30-day retention window:

- `expires_at` is a STORED generated column: `created_at + 30 days`. No date math on every read.
- `public.cleanup_old_webhook_events()` is the `SECURITY DEFINER` retention function. It DELETEs rows where `expires_at < now()` and returns the deleted-row count. `service_role` only — only the platform-side maintenance cron (Phase 18 P18.7) can call it.
- `processed_webhooks_expires_idx` (partial index, `WHERE expires_at IS NOT NULL`) makes the cleanup scan an index range scan, not a full table scan.

The 30-day window covers:
- Stripe's 3-day replay window
- PayPal's 5-day replay window
- Bunny's 1-day replay window
- The 30-day audit / "did event X arrive?" support window
- A 3-week safety margin for the cleanup cron to run

## Payload size cap

The middleware caps the stored `payload` at 64 KB. Payloads larger than 64 KB are replaced with a truncation marker:

```json
{
  "__uthena_truncated": true,
  "event_id": "evt_123",
  "event_type": "payment_intent.succeeded",
  "original_bytes": 98765
}
```

The full payload is still logged to pino (with PII redacted by the upstream logger) — we just don't store it in the row. Stripe's `payment_intent.succeeded` is ~2 KB; we never need 64 KB. The cap bounds the worst-case row size so a single runaway event doesn't bloat the table.

## Stripe webhooks — the full list

Events we subscribe to (configured in the Stripe Dashboard):

- `payment_intent.succeeded` → grant library access, send confirmation email
- `payment_intent.payment_failed` → notify user, no library grant
- `charge.refunded` → revoke library access (per refund policy), send refund email
- `charge.dispute.created` → alert admin, freeze the order, request evidence
- `charge.dispute.closed` → unfreeze if won, take action if lost
- `customer.created` → link to our user record
- `customer.updated` → sync name/email changes
- `customer.subscription.deleted` → (v2; we don't have subscriptions in v1)
- `account.updated` (Connect) → for partner onboarding, if we use Stripe Connect in v2

**Every event is handled. There is no "ignore" case.** If we don't recognize an event type, we log it and return 200 (so Stripe stops retrying). We do not crash on unknown events.

## PayPal webhooks — the full list

- `PAYOUT.BATCH.PROCESSED` → mark ledger entries as paid, send payout emails
- `PAYOUT.ITEM.FAILED` → mark the specific entry as failed, retry on next batch
- `PAYOUT.ITEM.UNCLAIMED` → after 30 days, the recipient hasn't accepted; send reminder
- `PAYOUT.ITEM.REFUNDED` → mark as refunded, alert admin
- `PAYOUT.BATCH.DENIED` → the entire batch was rejected; alert admin

## Bunny webhooks — the full list

- `video.transcoded` → mark the file as ready, enable the product
- `video.failed` → mark as failed, alert partner, allow re-upload
- `storage.object.uploaded` → (origin tier) log the upload, queue transcoding
- `storage.object.deleted` → log the deletion

## Resend webhooks — the full list

- `email.delivered` → update `email_log.delivered_at`
- `email.bounced` → flag the email, alert if it's a critical email (e.g. payout)
- `email.complained` → auto-unsubscribe from non-transactional emails
- `email.opened` → (optional) track for deliverability

## Local testing

```bash
# Stripe CLI for local webhook testing
stripe listen --forward-to localhost:3000/api/webhooks/stripe
stripe trigger payment_intent.succeeded

# PayPal (no CLI; use the IPN simulator in the PayPal Dashboard)
# Bunny (no CLI; use the dashboard's "test event" button)
```

In staging, every webhook is tested before the feature goes live. The test is in `06-quality/tests/e2e/webhooks.spec.ts`.

## What does NOT go here

- Outbound API calls to external services (those are in `00-foundations/money/stripe.ts` and similar)
- The actual business logic (that's in `02-features/[name]/actions/`)
- Scheduled jobs (those are in `04-platform/ci/cron/`)
- Webhook signature verification (that's in `00-foundations/money/stripe.ts`)

If you're writing the response body of a webhook, you're in the wrong folder. If you're writing the HTTP route that receives a webhook, you're in the right folder. If you're writing the side effect of a webhook, you're in the feature folder.
