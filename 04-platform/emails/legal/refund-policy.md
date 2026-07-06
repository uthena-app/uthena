---
last_updated: 2026-06-30
title: "Refund Policy"
og_description: "Uthena's 14-day refund policy on digital products — eligibility, process, and how to request a refund."
see_also:
  - label: "Delivery Policy"
    href: "/delivery"
  - label: "Terms of Service"
    href: "/terms"
  - label: "Privacy Policy"
    href: "/privacy"
---

# Refund Policy

We want you to have a positive experience with Uthena. If something isn't right, we're here to help.

## 14-Day Refund Window

We offer a **14-day refund window**, starting from the date of your purchase, for all video courses, PLR video courses, and MRR video courses on Uthena. This window matches our canonical `REFUND_WINDOW_DAYS = 14` constant that gates every refund request in the platform — the same number is enforced server-side for eligibility, banner copy on your order page, and admin-side approval.

## Eligibility

To be eligible for a refund, an order must meet **all three** conditions at the moment you submit your request:

- The order's status is **`paid`** (the payment has been confirmed by Stripe and the order is not pending, failed, or already refunded).
- The request is submitted within **14 days** of the order's `created_at` timestamp — the check uses `now() - order.created_at < REFUND_WINDOW_DAYS` and is enforced server-side, so a tampered URL or stale page cannot bypass it.
- The order has **no prior approved or pending refund** (one refund per order — if a request is already in flight, the refund form on `/account/orders/[id]/refund` will return a 404 indistinguishable from "order not found" until the previous request is resolved).

If any condition fails, the refund form is hidden and the deep link 404s. There is no partial-failure path that lets a request through to admin review — the gate is binary by design.

## How to Request a Refund

Refunds can only be requested from inside your account:

1. Sign in at [uthena.com/login](/login) (or sign up first if you don't have an account yet).
2. Open **Account → Orders** at [uthena.com/account/orders](https://uthena.com/account/orders).
3. Open the order you want to refund.
4. Click **Request a refund** to open the per-order refund form at `/account/orders/[id]/refund`.
5. Pick a reason, choose **Full refund** or **Partial refund**, and (optionally) attach proof of issue (a screenshot or PDF up to 10 MB).
6. Submit. The page redirects to a confirmation screen that names your reference number.

Refund requests made by email or any other channel are not accepted — every refund request must enter the system through your account so the order, the requester, and the audit trail are unambiguous.

## Refund Review and Processing

Once your request is submitted, here is what happens:

- **Admin review** — A Uthena team member reviews your request within **2 business days**. You will receive an email as soon as we reach a decision (approved, partial-amount, or declined, with a short reason).
- **Stripe refund** — When approved, the refund is issued through Stripe to the **original payment method** (the same card you used at checkout). Stripe typically takes **5–10 business days** to post the refund to your bank or card statement, depending on your issuer. We cannot speed up this part of the journey — it is controlled by your card provider.
- **Total expected time** — Plan on roughly 2 business days for our review plus up to 10 business days for Stripe to settle. If your refund still hasn't appeared after 15 business days from approval, please email us using the addresses in the [Contact section](#contact) below.

When a refund is approved:

- You will be unenrolled from the course(s), bundle(s), and bonuses you received.
- Any PLR/MRR license(s) will be revoked.
- You are required to delete all downloaded files and any copy of the PLR/MRR license issued.

## Partial Refunds

You can request a partial refund from the refund form — pick **Partial refund** instead of **Full refund** and enter the amount you would like back (subject to the order's remaining refundable balance). The actual partial-amount decision is **finalized by an admin during review**: our team may approve the amount you asked for, approve a different split, or decline. This is because some line items are non-refundable (see the exceptions below) and the partial-refund math needs to account for partner revenue already settled on those line items.

We will always tell you the final approved amount in the decision email, and only the approved amount will be sent to Stripe.

## Exceptions / Non-Refundable Items

Because all of our products are **digital**, we do not accept refunds for:

- **Purchases more than 14 days old** — the refund window is a hard cut-off, not a guideline. Once `now() - order.created_at` crosses `REFUND_WINDOW_DAYS` the request form 404s.
- **Sale items or discounted bundles** — promotional pricing is final. (Subscriber discounts and coupon discounts are handled case-by-case during admin review.)
- **Gift cards** — once a gift card has been issued, it is treated like cash and is non-refundable. (Uthena does not sell gift subscriptions in v1.)
- **Subscription cancellations after the period ends** — if you cancel a Personal Access subscription, you keep access until the end of the billing period you already paid for. We do not issue a refund for the unused portion of a paid period. To stop future renewals, cancel before the next billing date at [uthena.com/account/settings#billing](https://uthena.com/account/settings#billing).
- **Digital downloads that have been substantially consumed** — once a PLR or MRR file has been downloaded, the redistribution rights you received cannot be revoked (the file copy in your hands is out of our control). After 14 days from purchase, downloaded PLR/MRR content is non-refundable. Within the 14-day window, downloaded PLR/MRR may still be refundable subject to admin judgment based on consumption and redistribution risk — see the proof-of-removal section below.

## Proof of File Removal (PLR / MRR only)

Because PLR and MRR licenses grant you redistribution rights, we may require **proof of file removal** before approving a refund request for a PLR or MRR purchase. The account-area refund request form lets you attach a screenshot or PDF (up to 10 MB) showing the files have been deleted and any copies (including those distributed to your customers or downline) have been revoked. The standard 14-day window still applies.

## European Union 14-Day Cooling-Off Period

If you are located in the **European Union**, you have the legal right to cancel your digital purchase within 14 days for any reason. However, by downloading or accessing digital content, you acknowledge and agree that your right of withdrawal is waived once the digital service has begun.

## Contact

Different questions go to different inboxes so they reach the right team faster:

- **General refund questions, eligibility help, or status checks** — [support@uthena.com](mailto:support@uthena.com). Include your order number and the email you used at checkout.
- **Payment disputes, chargebacks, or billing questions about an existing charge** — [billing@uthena.com](mailto:billing@uthena.com). (If you have already filed a chargeback with your card issuer, please mention the dispute id in the subject line.) To avoid a chargeback, opening a refund request from your account is almost always faster than disputing the charge directly.
- **Technical issues accessing a course, a broken download link, or a file that will not play** — [support@uthena.com](mailto:support@uthena.com). We will usually restore access before the refund window closes.

## Related Pages

- [Request a refund](https://uthena.com/account/orders) — open the order you want to refund.
- [Manage your subscription](https://uthena.com/account/settings#billing) — cancel a recurring Personal Access subscription.
- [Delivery Policy](/delivery) — what "instant digital access" means on Uthena.
- [Terms of Service](/terms) — the rules that govern every refund request.
- [Privacy Policy](/privacy) — how we handle the information you share when requesting a refund.
