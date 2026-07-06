# Affiliate Settings: Payout Method — `/affiliate/settings/payout`

## What this page does

The affiliate's payout method editor. **Read-only by default** — the affiliate sees the current PayPal email (masked: `j***@paypal.com`), the payout schedule preview, the pending balance, lifetime earned, and the last payout record. Clicking "Edit" opens an inline form for the PayPal email + email confirm field. This is the highest-risk self-service action an affiliate can take: a wrong PayPal email routes real money to the wrong account. So the flow is engineered for safety: two-email confirmation flow, max 3 changes per 30 days, and a "payout method changed" email sent to BOTH the old and new addresses so a hijacker can't silently redirect future payouts without the rightful owner noticing.

The "Request early payout" CTA shown in the prompt is **out of scope for v1** (admin-only manual trigger via `/admin/payouts`). Flagged in Open Questions.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | page title, "Back to settings" link | hard-coded | top bar |
| Current payout method | `affiliates.payout_method` (PayPal email — masked display) | affiliates | card; full email revealed only after re-auth (see Security) |
| Pending balance | `affiliate_commissions` aggregate where `status in ('pending','locked')` | aggregate | money card, USD |
| Available balance | `affiliate_commissions` aggregate where `status='available'` | aggregate | money card, USD |
| Lifetime earned | `affiliate_commissions` aggregate, all statuses | aggregate | money card, USD |
| Payout schedule preview | next 3 expected payout dates (1st of next 3 months) | derived | small list |
| Minimum threshold callout | "$50 minimum payout threshold" with link to `/admin/payouts` spec | hard-coded | inline info card |
| Last payout | `affiliate_payouts` most recent: `created_at`, `amount_cents`, `paypal_batch_id`, `status` | affiliate_payouts | row card |
| Edit button | (only shown if read-only state) | hard-coded | button → reveals form |
| Form (Edit mode) | `paypal_email` (RFC-5322), `paypal_email_confirm` (must match) | (form only) | text input + confirm input + Save + Cancel |
| Change count | `payout_method_changes_count` in the last 30 days, derived from `admin_audit_log` | derived | small text: "X of 3 changes used this period" |

**Server actions** in `02-features/affiliate-portal/actions/settings/payout.ts`:
- `getMyPayoutInfo()` — RSC. Reads `affiliates.payout_method` (decrypted app-layer), aggregates `affiliate_commissions` for pending/available/lifetime, reads most-recent `affiliate_payouts`, counts changes in last 30 days from `admin_audit_log` where `action='affiliate_payout_method_changed'`.
- `requestPayoutMethodEdit()` — server action that opens the form. Requires re-auth (TOTP-style step-up): if the last sensitive action was > 5 minutes ago, the action requires the user to confirm their password (or click an emailed magic link — see Open Questions). Audit row `payout_method_edit_started`.
- `submitPayoutMethodChange(input)` — Zod-validates the email + confirm match. Inside a serializable transaction: (1) insert a new `affiliates` row update with the new `payout_method`, (2) write a `payout_method_changed` row to `admin_audit_log` with `{ before: { email: oldMasked }, after: { email: newMasked } }`, (3) enqueue 2 emails: one to the OLD address (`04-platform/emails/affiliate-payout-method-changed-to-old.tsx`) and one to the NEW address (`04-platform/emails/affiliate-payout-method-changed-to-new.tsx`). Both emails contain a "If this wasn't you, secure your account" link to `/account/settings/sessions` + a "Contact support" mailto.
- `cancelPayoutMethodEdit()` — closes the form without writing.

**Email templates** (new, in `04-platform/emails/`):
- `affiliate-payout-method-changed-to-old.tsx` — sent to the OLD PayPal email. Subject: "Your Uthena affiliate payout method was changed". Body: masked old + new email, timestamp, "If this wasn't you" CTA.
- `affiliate-payout-method-changed-to-new.tsx` — sent to the NEW PayPal email. Subject: "Your Uthena affiliate payout email is now active". Body: confirms the change, "this address will receive your next payout" note, "If this wasn't you" CTA.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open the page | Direct nav to `/affiliate/settings/payout` | Render read-only state | affiliate (self) |
| Click "Edit" | Click "Edit" button | Step-up re-auth check; on success, form reveals | affiliate (self) |
| Edit paypal_email | Type in the email field | Client validation (RFC-5322 shape), re-enable Save | affiliate (self) |
| Edit paypal_email_confirm | Type in the confirm field | Client check: must match paypal_email; re-enable Save | affiliate (self) |
| Cancel edit | Click "Cancel" | Form closes, no write | affiliate (self) |
| Save payout method | Click "Save" | Server action: rate-limit check (max 3 / 30 days), Zod validation, atomic write, 2 emails queued, success toast | affiliate (self) |
| See disabled state | (any of: 3 changes already used in 30 days, payout in flight) | "Edit" button is disabled, with a tooltip explaining why | affiliate (self) |

## What this page does NOT do

- No "Request early payout" CTA in v1 (admin-only manual trigger; see OQ)
- No bank account / wire transfer (PayPal only in v1)
- No multi-currency (USD only)
- No "split payouts" (one recipient = one PayPal email)
- No tax form collection (in v1, affiliates handle their own taxes; 1099-NEC threshold handled by admin)
- No payment-method verification micro-deposits (PayPal doesn't support this; we trust the email + send the confirmation flow)
- No "trust this device" / 2FA (v2)
- No bulk historical change view (the audit log handles that)

## Acceptance criteria

- [ ] Page is auth-gated AND requires `profiles.role = 'affiliate'`; redirects anon to `/login?next=/affiliate/settings/payout` and non-affiliates to `/library`
- [ ] Page is read-only by default; the masked PayPal email displays as `j***@paypal.com` (first char + `***` + full domain)
- [ ] Pending / available / lifetime earnings are aggregated correctly from `affiliate_commissions` (verified by a test that inserts N commissions in each status and asserts the aggregates)
- [ ] "Edit" requires step-up re-auth: if the last sensitive action (any `affiliate_payout_method_*` audit row) was > 5 minutes ago, the user is prompted to confirm their password (or click an emailed magic link — see OQ). Re-auth is logged with `action='payout_method_edit_reauthed'`.
- [ ] Form fields: `paypal_email` (RFC-5322), `paypal_email_confirm` (RFC-5322, must match `paypal_email` — server-side check, not just client); Zod validation rejects malformed input with a specific error code
- [ ] Save is rate-limited to **max 3 changes per 30 days** per affiliate. The 4th attempt within 30 days returns `{ ok: false, code: 'rate_limited', resetsAt: <timestamp> }` and the UI shows "Edit" as disabled with the cooldown copy
- [ ] On save, the OLD and NEW emails each receive a "payout method changed" email (verified via `emails_outbox` test: 2 rows queued, one per address). Both emails contain a "If this wasn't you, secure your account" link to `/account/settings/sessions` (per `account-settings.md`) and a "Contact support" mailto
- [ ] On save, an `affiliate_payout_method_changed` row is written to `admin_audit_log` with `before` JSON containing the masked old email and `after` JSON containing the masked new email (the full emails are never logged)
- [ ] If a payout is currently in flight (any `affiliate_payouts` row with `status='pending'` and `created_at > now() - interval '7 days'`), the "Edit" button is disabled and a tooltip explains: "A payout is in flight. Changes will be queued for after the payout completes." — flag in OQ if simpler is to block changes during pending payouts (no queue)
- [ ] The full PayPal email is never returned to the client. The masked form `j***@paypal.com` is what's stored + returned; reveal is gated by re-auth on a separate "Show full email" sub-action (v2) — in v1 we don't show the full email at all on this page
- [ ] The page renders in < 300ms p95 (RSC, 1 row read on `affiliates`, 3 aggregates on `affiliate_commissions`, 1 row read on `affiliate_payouts`, 1 count on `admin_audit_log`)
- [ ] All form fields are keyboard-navigable with `--border-3` focus rings; mobile responsive at 360px, 768px, 1280px; no PII in URLs, no `TODO` / `FIXME` / `HACK` in the diff, no console errors

## Design reference

- Mockup: not yet built — to be created during the affiliate portal build (`mockups/affiliate-settings-payout.html`)
- Design tokens: `00-foundations/design/tokens.css`
- Theme: both (default dark, with light toggle)
- Components: `00-foundations/ui/MaskedEmail.tsx`, `00-foundations/ui/MoneyCard.tsx`, `00-foundations/ui/StepUpAuthModal.tsx`, `00-foundations/ui/ConfirmInput.tsx`

## Security

- **Auth required:** YES — `requireRole(['affiliate'])` then `user_id = auth.uid()` on every server action
- **Allowed roles:** affiliate (any status; pending affiliates can edit so the field is populated by the time they're approved)
- **RLS policies that apply:**
  - `affiliates` — `affiliates_self_read` (for the masked email read), `affiliates_self_update` (for the payout_method write)
  - `affiliate_commissions` — `affiliate_commissions_self_read` (for the aggregates)
  - `affiliate_payouts` — affiliate self read (for the last-payout card)
  - `admin_audit_log` — admin read only; the server action uses `service_role` to insert
- **PII displayed:** the **masked** PayPal email on the read-only card. The full email is never returned by any server action to the client. No other PII (no SSN, no bank account, no card data — PayPal is the only payout rail).
- **PII in URLs:** NO. The email never appears in a query string or path; the only IDs in the URL are the affiliate's own session-derived `user_id`, which is server-side, never query-stringed.
- **Two-email confirmation flow:** the security notification is the primary defense against a hijacker silently redirecting payouts. The user receives the email at the OLD address (if they still control it — they notice the change) and at the NEW address (which they presumably control — they confirm intent). Both emails link to the Sessions page so the user can investigate and revoke if the change was unauthorized.
- **Step-up re-auth:** opening the form requires a fresh auth signal. If the last sensitive action was > 5 min ago, the user re-confirms via password (Supabase Auth `reauthenticate()`). The 5-minute window is short enough to make a stolen-cookie attack impractical, long enough to not annoy a legitimate user mid-flow. (See OQ for the magic-link alternative.)
- **Rate limiting:** `submitPayoutMethodChange` 3 / 30 days per affiliate (hard cap, not a soft "are you sure?"). Per-IP cap: 10 attempts per 24h (defense against credential-stuffing).
- **Email verification at save time:** the action does NOT verify that the user controls the new PayPal email (PayPal doesn't expose a verification API in v1; "send a penny and ask them to confirm" is overkill for a 30-day cooldown flow). The two-email confirmation flow is the substitute.
- **Audit logged:**
  - `requestPayoutMethodEdit` (step-up success) — `action='payout_method_edit_reauthed'`
  - `submitPayoutMethodChange` — `action='affiliate_payout_method_changed'`, `before`/`after` JSON with masked emails, `target_id` = affiliate id
  - `submitPayoutMethodChange` rate-limit hit — `action='payout_method_change_rate_limited'`, `target_id` = affiliate id
- **CSRF:** server actions use Next.js's built-in origin check + Supabase Auth session cookie
- **Encrypted at rest:** `affiliates.payout_method` JSONB is encrypted at the app layer (per `_data-model.md`'s `payout_method jsonb` — encrypted at app layer convention). The server action decrypts for write, encrypts before insert/update. The key is in Doppler.
- **Third-party scripts:** none

## Performance

- **Target p95:** < 300ms
- **Render strategy:** RSC (one row read on `affiliates`, three aggregates on `affiliate_commissions`, one row read on `affiliate_payouts`, one count on `admin_audit_log`)
- **Cache:** none — page is user-specific and shows live balances
- **DB indexes used:** `affiliate_commissions (affiliate_id, status, created_at desc)`, `affiliate_payouts (affiliate_id, created_at desc)`, `admin_audit_log (target_id, action, at desc)` for the change-count query
- **Bundle size budget:** < 30KB added to client bundle (form, two confirm-input fields, step-up modal, money cards). Reuses platform primitives.

## Out of scope for v1

- "Request early payout" self-service CTA (admin-only manual trigger via `/admin/payouts`)
- Bank account / wire transfer
- Multi-currency
- Split payouts
- Tax form collection (1099-NEC; admin-handled past threshold)
- Payment-method verification micro-deposits
- "Trust this device" / 2FA
- Full-email reveal (masked is the v1 display; full never returned to client)
- Change history view (audit log is the source of truth; the page does not render history)

## Open questions for human

1. **Step-up re-auth method:** the spec calls for password re-confirmation. Alternative: an emailed magic link to the user's primary email (the one on `auth.users`, not the PayPal email — they're typically different). My recommendation: **password re-confirmation** in v1, because (a) Supabase Auth supports it natively via `reauthenticate()`, (b) the user is already on a trusted device if they're on this page, (c) the magic-link path is one more email that adds friction without much marginal security. Confirm or swap.

2. **Pending-payout handling:** when an `affiliate_payouts` row is in flight (`status='pending'`, within 7 days), the spec calls for the change to be **queued** for after the payout completes. Alternative: simply **block** the change until the payout completes (no queue). My recommendation: **block, no queue**. Reasons: queueing adds state-machine complexity (when does the queued change fire? what if the user cancels the queued change?), and a blocked 1-3 day window for a once-per-30-days change is acceptable friction. Confirm or swap.

3. **Rate limit cap (3 / 30 days):** is this the right number? PayPal email changes are extremely rare in practice (1-2 per affiliate lifetime, typically 0). My recommendation: **3 / 30 days is generous**; the cap is mostly there as a defense-in-depth against a hijacker iterating through possible email values to find one they control. Lower to 1 / 30 days if you want stronger friction; higher if you have a use case. Confirm.

4. **Email at the OLD PayPal address — what if it's an abandoned/different-person address?** The "payout method changed" email goes to the OLD PayPal address. If the affiliate gave us an old email they no longer check, the security notification is missed. Mitigations: (a) also send the security notification to the user's primary email (the one on `auth.users`), (b) require PayPal email = primary email at signup (too restrictive), (c) accept the risk (most affiliates use a stable PayPal email). My recommendation: **(a) — send the security notification to BOTH the OLD PayPal address AND the primary `auth.users` email.** Belt-and-suspenders. Confirm.

---

## Implementation notes

- (filled by the building agent)
