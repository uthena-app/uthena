# Refund Request Submitted — `/account/orders/[id]/refund/sent`

## What this page does

The post-submit confirmation for a refund request. After the user submits the refund form on `/account/orders/[id]/refund`, the server action inserts a `refunds` row and redirects to this page. The page reassures the user that we received the request, shows a human-readable reference code (e.g. `R-12345`), and explains what happens next.

The page is the "we got it" screen — it does NOT let the user submit another refund, edit the just-submitted request, or check on the status of the request. Status checks live on `/account/orders/[id]` (where the `refunds` row's status is shown next to the order); "cancel my refund request" is email-only (see Security). The page is fully **idempotent on re-visit** — reloading the URL shows the same submitted state. Re-visit also does NOT trigger any side effect (no second email, no second DB write, no additional audit row).

This page is the user-side confirmation only. The admin queue, approval, and Stripe-refund issuance are specced in `admin-refunds.md` (separate spec).

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | large checkmark icon + "Refund request submitted" | hard-coded | hero, centered |
| Subhead | "We received your request and will review it within 2 business days." | hard-coded | muted paragraph |
| Reference card | `R-{id}` formatted as `R-` + padded `refunds.id` (e.g. `R-00042` for id 42) | `refunds.id` | mono card with copy-to-clipboard |
| Reference card | "Submitted on {requested_at}" in human format (e.g. "June 12, 2026, 2:34 PM") | `refunds.requested_at` (server's timezone) | small muted line under the code |
| What happens next | 3-step explainer: (1) "We review your request" (1–2 business days), (2) "We email you with a decision", (3) "If approved, your money is back in 5–10 business days" | hard-coded | numbered list, icon per step |
| While you wait | "Browse more products" → `/browse`, "View your other orders" → `/account/orders` | hard-coded links | 2-up card row |
| Primary CTA | "View order details" → `/account/orders/[id]` | hard-coded link | primary button |
| No-quote-help line | "Need to update something? Email support@uthena.com" | hard-coded `mailto:` | small muted text |

**Server load:** `getSubmittedRefund(refundId, userId)` in `02-features/account/queries/getSubmittedRefund.ts` — single query joining `refunds` + `orders`. Returns 404 if the refund does not exist OR the order's `customer_id` does not match `auth.uid()` (same enumeration-leak protection as `account-refund.md`: we do not distinguish "not found" from "not yours" to the client).

**No write actions on this page.** The page is purely read-only. The user can navigate away and back; the state is stable.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open the page | Navigate to `/account/orders/[id]/refund/sent?refundId=[id]` (the only way to land here) | Renders the confirmation | self + owns the refund |
| Open with stale `refundId` | Direct visit with an `id` that does not exist or is not owned by the user | 404 (not 403) — see Security | — |
| Copy reference code | Click copy icon next to `R-12345` | Code copied to clipboard, toast confirms | self |
| View order details | Click "View order details" | Navigate to `/account/orders/[id]` | self |
| Browse catalog | Click "Browse more products" | Navigate to `/browse` | self |
| View other orders | Click "View your other orders" | Navigate to `/account/orders` | self |
| Email support | Click support mailto link | Opens `mailto:support@uthena.com?subject=Refund%20R-{id}%20—%20update%20or%20cancel` pre-filled | self |
| Reload the page | Browser refresh | Renders the same submitted state, no side effect | self |

## What this page does NOT do

- No "submit another refund" CTA (the form on `/refund` server-side checks for an existing pending/approved refund for the same order and 404s if one exists; we do not duplicate that gate here)
- No "edit my refund request" UI (support is email-only for v1)
- No "cancel my refund request" UI (user must email support@uthena.com)
- No live status polling (the page is not a real-time tracker; status lives on `/account/orders/[id]`)
- No second email is sent on re-visit (the original confirmation email is the only one)
- No second audit row on re-visit
- No PII shown beyond the user's own refund reference (no email, no order total, no product names — keep the page focused on "we got it, here's what happens next")
- No live chat / instant support (async only, 2 business days)

## Acceptance criteria

- [ ] Page is auth-gated; anon users are redirected to `/login?next=/account/orders/[id]/refund/sent&refundId=[id]`
- [ ] Page 404s (not 403) when `refundId` is missing, invalid, not owned by the current user, or the parent order's `customer_id` does not match `auth.uid()` — enumeration-leak protection
- [ ] Page shows the reference code formatted as `R-{id}` with zero-padded `refunds.id` (e.g. `R-00042`); copy-to-clipboard works
- [ ] Page shows the 3-step "what happens next" explainer with the same wording the user saw on the form's confirmation
- [ ] "View order details" CTA routes to `/account/orders/[id]`; "Browse more products" routes to `/browse`; "View your other orders" routes to `/account/orders`
- [ ] Reloading the page produces the exact same rendered output; no DB writes, no email sends, no audit-log rows (verified by a test that snapshots `refunds`, `processed_webhooks`, and `admin_audit_log` row counts before and after 3 reloads)
- [ ] No "submit another refund" CTA exists on this page
- [ ] Support mailto link is pre-filled with `?subject=Refund R-{id} — update or cancel` (URL-encoded)
- [ ] No PII beyond the refund reference is displayed (no order total, no product titles, no email)
- [ ] No `TODO` / `FIXME` / `HACK` in the diff

## Design reference

- Mockup: not yet built — to be created during the account-refund feature build
- Components: `00-foundations/ui/CheckmarkHero.tsx`, `00-foundations/ui/ReferenceCodeCard.tsx` (mono + copy button), `00-foundations/ui/StepList.tsx` (3-step numbered), `00-foundations/ui/RelatedActionsRow.tsx` (2-up card)
- Tokens: `00-foundations/design/tokens.css`
- Theme: dark (default)

## Security

- **Auth required:** YES
- **Allowed roles:** any authenticated user who owns the parent order of the refund
- **RLS policies that apply:** `refunds` (`refunds_self_read` — `exists` over `orders` where `customer_id = auth.uid()`), `orders` (`orders_self_read`). Both reads are server-side; the page does not bypass RLS.
- **PII displayed:** no. The reference code `R-{id}` is a non-PII identifier (the `id` is a `bigint`, not derived from email or name). The user already knows their own `requested_at`; we display it from server data, not as a leak.
- **PII in URLs:** the `[id]` is the order id (`bigint`), not PII. The `refundId` query param is the `refunds.id` (`bigint`), not PII.
- **Enumeration protection:** the page 404s on any of: (a) `refundId` not present, (b) `refundId` not a positive integer, (c) no `refunds` row with that id, (d) the parent order's `customer_id` does not match `auth.uid()`. The 404 is identical in all four cases — no way for an attacker to enumerate refund ids belonging to other users.
- **Idempotency on re-visit:** the page is read-only. No server action, no DB write, no email enqueue, no audit-log insert. A test must verify that 3 page reloads produce 0 new rows in `refunds`, `processed_webhooks`, and `admin_audit_log`.
- **No CSRF surface:** no state-changing actions; nothing to CSRF.
- **Rate limiting:** none needed — page is read-only and idempotent. (The refund request itself is rate-limited in the parent spec.)
- **Audit logged:** no. The original refund insert in `account-refund.md` is the audit event; this page does not add to it.
- **Open redirect protection:** N/A — no `?next=` or similar param on this page.
- **Email injection / header injection:** N/A — no email is sent from this page. The mailto link is a static `mailto:support@uthena.com?subject=...` template, and the `R-{id}` in the subject is a server-rendered integer (no user-controlled text is interpolated into the subject).
- **Third-party scripts:** none.

## Performance

- **Target p95:** < 200ms (one read query, no writes, no auth-heavy work)
- **Render strategy:** RSC + SSR. The page is server-rendered; the only client JS is the copy-to-clipboard handler on the reference code.
- **Cache:** NONE — user-specific.
- **DB load:** one indexed lookup: `refunds (order_id)` join `orders (customer_id, id)`. The query path is the same as `account-refund.md`'s eligibility check.
- **Bundle size budget:** < 5KB added to client bundle (copy-to-clipboard button + toast). The page is RSC; the rest is HTML.
- **No images, no fonts, no third-party calls.** Static content with one read query.

## Out of scope for v1

- Live status of the refund decision on this page (status is on `/account/orders/[id]`)
- "Cancel my refund request" inline button (email-only)
- "Update my refund request" inline (email-only)
- "Submit another refund" CTA (gated server-side; not on this page by design)
- Real-time polling for status changes
- Multi-language copy (English only in v1)
- Email-to-self copy of the confirmation (the user already got the email at submit time)

## Open questions for human

- **Reference code format: zero-padded or raw id?** Brief says `R-12345`. My recommendation: use a zero-padded 5-digit format (`R-00042`, `R-12345`) so visual alignment on the card is consistent for low ids. The padding is purely cosmetic; the underlying `refunds.id` is still `bigint`. Alternative: `R-` + raw id (e.g. `R-42`) for the first 99,999 refunds. Confirm padded 5-digit.
- **Should the page show the order total that was refunded?** Pros: closes the loop ("you asked for $497 back"). Cons: adds PII-adjacent detail (total is on the order, not the refund specifically, and the user already saw it on the form). My recommendation: **do not show the total on this page**. The reference code is the only piece of data the user needs; the total lives on `/account/orders/[id]`. Confirm.
- **Auto-redirect to `/account/orders/[id]` after N seconds?** Some post-submit flows auto-redirect (Stripe, PayPal) so the user does not stay on a "dead-end" screen. My recommendation: **no auto-redirect**. The user just took an action; they should not be moved without consent. They have 3 explicit next steps. Confirm no auto-redirect.
- **"While you wait" panel: which actions?** I propose "Browse more products" (`/browse`) and "View your other orders" (`/account/orders`). Alternative: include a "Recommended for you" rail (out of scope — no recommendations engine in v1). Confirm the 2 actions, or add a third (e.g. "View your library" `/library`).

---

## Implementation notes

- (filled by the building agent)
