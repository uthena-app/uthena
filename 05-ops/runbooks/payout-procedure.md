# Runbook: Payout procedure

**When to use this runbook:** When running the daily payout batch, when investigating a failed payout, or when an admin needs to issue a manual payout.

**Who's involved:** Platform agent (runs the batch), human (approves manual payouts over $1000), finance (for any tax-related questions)

## The daily batch

The payout batch runs at **02:00 UTC** every day via `04-platform/ci/scripts/cron/daily-payout-batch.ts`. It:

1. Selects all `payout_ledger` entries with `status = 'approved'` AND `available_at <= now()`
2. Groups them by `partner_id` (for partner payouts) and `affiliate_id` (for affiliate payouts)
3. Creates a PayPal Payouts batch (one batch per payout type)
4. Submits the batch to PayPal
5. Updates the ledger entries with the PayPal `payout_item_id`
6. Sends confirmation emails to the recipients
7. Posts a summary to `#payouts` in Slack

The full spec is in `01-specs/pages/instructor-payouts.md` and `01-specs/pages/affiliate-dashboard.md`.

## The ledger states

```
pending  → available  → approved  → submitted  → paid
                          ↓
                       rejected → (manual handling)
```

- **pending** — a commission has been earned (e.g. sale completed) but the hold period hasn't elapsed (7 days for partners, 30 days for affiliates)
- **available** — hold period elapsed; eligible for next batch
- **approved** — included in the next batch (or currently being batched)
- **submitted** — sent to PayPal; awaiting confirmation
- **paid** — confirmed by PayPal webhook
- **rejected** — PayPal rejected the payout (recipient not found, account closed, etc.)

Transitions are immutable. Once an entry moves from `pending` to `paid`, the row never changes. Corrections happen in new ledger entries (the accounting principle of append-only).

## Manual payout procedure

For special cases (early payout, missed batch, manual correction):

1. Open the admin payout queue (`/admin/payouts`)
2. Find the ledger entry
3. Click "Pay now" (requires human approval for amounts > $1000)
4. The system creates a one-off PayPal payout for just that entry
5. The ledger entry is marked `submitted` and gets the same treatment as a batch entry

Manual payouts are logged in `admin_audit_log` with the admin's user_id.

## Debugging a failed payout

When a payout fails (PayPal returns `PAYOUT.ITEM.FAILED`):

1. **Check the PayPal dashboard** for the specific item failure reason. Common reasons:
   - Recipient not found (wrong email)
   - Recipient account closed
   - Recipient hasn't accepted PayPal's terms
   - Currency not supported in recipient's country
   - Limit exceeded (recipient has received too many payouts recently)
2. **Update the partner's payout method** in `/admin/partners` if the email is wrong
3. **Re-queue the entry** in `/admin/payouts` (it goes back into the next available batch)
4. **Notify the partner** via email with the reason and the next steps
5. **If the partner is unreachable for 30 days**, mark the entry as `forfeited` and add it to the partner's balance (claimable when they return)

## Re-running a batch

If the batch fails halfway (e.g. PayPal is down for 10 minutes during the 02:00 UTC run):

1. The cron job is idempotent. It can be re-run safely.
2. Re-run: `pnpm tsx 04-platform/ci/scripts/cron/daily-payout-batch.ts`
3. Entries that were already submitted (status = `submitted`) are skipped
4. Entries that were not yet submitted are re-included

PayPal's `senderItemId` (our `payout_ledger.id`) provides a second layer of protection. If somehow the same entry is submitted twice, PayPal rejects the duplicate.

## The hold periods

- **Partner payouts:** 7-day hold from the date of sale. The reasoning is in `01-specs/pages/instructor-payouts.md` — gives time for refunds and disputes to settle.
- **Affiliate payouts:** 30-day hold. The reasoning is the same, plus the longer affiliate chain (we don't pay until the partner's hold is also cleared).

If a refund happens during the hold period, the corresponding ledger entry is voided (status = `cancelled`).

If a refund happens after the hold period but before payout submission, the entry is still voided (it never reached `submitted`).

If a refund happens after submission but before payment, the entry is reversed via a new negative ledger entry (status = `reversal`).

If a refund happens after payment, the partner is invoiced for the refund amount (status = `clawback`). The next batch deducts the clawback from their balance.

## The 80/20 split (in detail)

The split is in `01-specs/pages/_data-model.md` — `payout_ledger.split_partner_bps` and `payout_ledger.split_affiliate_bps`. The default is:
- Partner: 6000 bps (60%)
- Affiliate: 2000 bps (20%)
- Platform: 2000 bps (20%)

The platform cut covers Stripe fees, Bunny storage, infra, and the platform's margin.

Bps = basis points. 6000 bps = 60%. Stored as integer to avoid float issues.

## Tax handling

We do NOT handle tax withholding for partners in v1. Partners are responsible for their own taxes. We provide an annual earnings report (CSV download from `/account/tax`) for partners to use in their filings.

In v2, we may add 1099-NEC generation for US partners earning > $600/year. Tracked in `_followups.md`.

## What NOT to do

- Do NOT edit a `payout_ledger` row directly. The ledger is append-only. Corrections are new rows.
- Do NOT skip the hold period. The hold protects the platform from fraud.
- Do NOT pay out to a non-verified partner. Verification is in the partner onboarding flow.
- Do NOT pay out to a non-verified affiliate. Same.

## Reporting

- **Daily:** Slack post with the batch summary (# of payouts, total amount, # of failures)
- **Weekly:** Email to the human with the week-over-week change in payout volume
- **Monthly:** Detailed report (CSV) to the human and the finance contact
- **Quarterly:** Partner earnings statement (CSV per partner, available in their dashboard)
