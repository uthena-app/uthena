# Refund Procedure Runbook

> When a customer requests a refund. For admin-only manual intervention; routine refunds go through the customer's request flow at `/account/orders/[id]/refund`.

## When this runbook applies

A customer emailed support with a refund request that did NOT come through `/account/orders/[id]/refund`. Examples:
- The customer's account got deleted before they could submit the request.
- The original purchase was more than 14 days ago (auto-refund window expired).
- The order is `partially_refunded` or `refunded` and they want to re-reverse.

For all routine requests — under 14 days, single order — tell the customer to submit through `/account/orders/[id]/refund`. Don't manually refund those.

## Step-by-step

### 1. Verify the customer

Ask for:
1. The order ID (or the email + approximate date).
2. The reason — write it down word-for-word.

If the customer can't produce the order ID but produces the email, search the admin customers table at `/admin/customers?q=<email>` to find the row.

If they can't produce either, ask them to sign in to their email and reply from the address on file.

### 2. Decide whether to refund

The quick rubric:

- **Definite refund** — duplicate purchase, accidental purchase, charged twice, service outage during purchase, customer claims non-receipt of files.
- **Conditional refund** — customer changed their mind, with usage evidence (no downloads). Review the `file_downloads` row count for the order. If 0 downloads, refund. Otherwise escalate.
- **Deny** — heavy use (5+ downloads, 50%+ curriculum viewed, course completion > 50%). Escalate before denying.

### 3. Issue the refund (Stripe)

1. Open Stripe Dashboard → Payments → search for the order's `stripe_charge_id` (find it via the admin order detail at `/admin/orders/[id]`).
2. Click **Refund**.
3. Amount: the full `total_cents`. Reasons: `requested_by_customer`. **Do NOT** refund partial unless the customer is asking for partial.
4. Copy the refund's `id` (begins with `re_`) into the order detail page notes before clicking Confirm.

### 4. Update Uthena

1. The Stripe webhook `charge.refunded` fires within ~30s and runs the auto-reversal:
   - `orders.status` → `refunded` (or `partially_refunded` for partial)
   - `payout_ledger` rows for the original sale flip to `reversed` (royalty disappears from the partner's pending balance)
   - `library_grants` rows for the order are hard-deleted (cascade)
   - `audit_log` writes one `refund_processed` row
2. **Verify** — go to `/admin/orders/[id]` after 1 minute. The status pill should say `refunded`.
3. **Manual ledger correction** — if the webhook did not fire (Stripe occasionally drops events) and 5 minutes have passed, manually:
   - `psql $DATABASE_URL` and run `update orders set status='refunded', refunded_at=now() where id=<id>;`
   - `update payout_ledger set status='reversed' where order_id=<id>;`
   - `delete from library_grants where order_id=<id>;`
   - `insert into admin_audit_log (...) values ('manual_refund_reversal', ...)`
4. Notify the customer at the email on file: standard refund confirmation template.

### 5. Customer comes back

If they email again asking about timing:

> Refunds typically post to your statement within 5-10 business days, depending on your card issuer. If you don't see it after 14 days, reply with your bank's confirmation and we'll re-check on our end.

Do NOT promise a specific date. Banks vary wildly.

## Common pitfalls

- **Refunding without checking downloads.** Always check `file_downloads` count for the order's `library_grants` before refunding. A "changed mind" refund on a heavily-used course creates a support escalation.
- **Forgetting to manually reverse the ledger when the webhook fails.** The partner's balance depends on this. The refund ONLY takes effect once `payout_ledger.status = 'reversed'`. Otherwise the partner still owes us money we'll never collect.
- **Refunding via Stripe Dashboard but not updating Uthena.** Always trigger the auto path via Stripe (so the webhook fires). Never manually update both systems and skip Stripe — the audit trail is in Stripe.

## Escalation paths

| Issue | Escalate to |
|---|---|
| Customer says they never received files | First-line support — link them to `/library`. If file is missing after 24h, escalate to engineering. |
| Refund > $500 | Klaas (founder) — confirm before issuing. |
| Partner pushback on a refund (e.g. "they used the course already") | Klaas — this is a partner-relationship call. |
| Chargeback received (not refund requested by customer) | Stripe Radar + Klaas — fight the dispute per Stripe's guidance. |

## Related docs

- `incident-response.md` — for site-wide or payment-wide issues
- `secret-rotation.md` — for Stripe API key leaks
- `security-incident.md` — for PII or access breaches
