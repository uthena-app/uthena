# STUBS-archive.md — Resolved / shipped STUBs (chronological by source order)

> Auto-maintained by `uthena-cleanup` cron. Each block below was
> removed from `STUBS.md` once its gap was filled. Entries keep
> their original STUB-id and full body.

First created: 2026-06-30.

---

### [STUB-005] Cart is auth-only in v1 (no anon cookie cart)
- Phase: SHIPPED in P4.2 (2026-06-25)
- Why (now historical): Originally deferred because the spec opened
  four open questions about anon cart storage + merge policy + UI.
- Resolution: P4.2 shipped the HTTP-only signed `uthena_anon_cart`
  cookie + the union-respecting merge on signup/signin. See
  `01-specs/pages/cart.md` "Open questions for human" (now Resolved)
  + `00-foundations/cookies/README.md` + `02-features/cart/README.md`
  for the final design. Anon users now see the same cart UI as auth
  users; the cookie persists across reloads; merge happens
  automatically on auth success.
- Owner: Mavis
- Created: 2026-06-16
- Shipped: 2026-06-25 (P4.2)

### [STUB-009] DMCA agent contact is hard-coded on /dmca (no admin_settings read)
- Phase: PH10.4 → RESOLVED 2026-06-29
- Why: The DMCA spec proposes an `admin_settings` key-value table for
  editable platform settings (`dmca_agent`, `support_email`,
  `legal_email`, `maintenance_mode`, etc.) and recommends the DMCA
  page read the agent contact from `admin_settings.dmca_agent`. The
  `admin_settings` table is proposed in `dmca.md` Open Q §2 but is
  not part of PH03 (the initial migration). The PH11 build hard-codes
  the agent name + email on `/dmca` and flags the address as
  "owned by the human" so it is obvious where to update.
- Resolution: The key-value store is now `app_settings` (renamed from
  the originally-proposed `platform_settings` to avoid colliding with
  the legacy singleton table from `0001_initial.sql` — see dmca.md
  Open Q §2 footnote). Migration `0036_app_settings.sql` ships the
  table + 3 RLS policies + the `dmca_agent` seed row. P10.4 built:
  - `02-features/legal/queries/getDmcaAgent.ts` — public read with a
    narrow allowlist (name + email + mailing_address + phone)
  - `02-features/legal/components/DmcaAgentCard.tsx` — data-driven card
  - `app/dmca/page.tsx` — composes the card from the query
  - `02-features/admin/platform-settings/` — admin editor module
    (query + action + audit + form + tests)
  - `app/admin/dmca-agent/page.tsx` — admin editor page (RSC, gated,
    pre-fills from the same row)
  - `02-features/admin/shell/AdminSidebar.tsx` — System-section nav link
  The hard-coded block in `04-platform/emails/legal/dmca.md` is gone;
  the page body now references the data-driven editor at
  `/admin/dmca-agent`.
- Owner: Mavis
- Created: 2026-06-16
- Resolved: 2026-06-29

### [STUB-017] [RESOLVED 2026-06-29] Avatar upload — Bunny signed PUT + mime/size allowlist + browser-direct PUT
- **Status: SHIPPED in P9.2 Slice 1.** The upload pipeline (signed
  PUT URL + mime/size allowlist + 5MB cap + user-scoped path +
  audit row) is wired into `/account/profile` end-to-end. The
  follow-up for the **cropper** (square aspect-ratio library) is
  filed separately as STUB-077 — Slice 2 of P9.2. See
  `account-profile.md` §"P9.2 — Implementation notes" for the
  shipped surface. Resolved by 2026-06-29 cron tick
  (`/Users/klaas/.mavis/scratchpads/mvs_5bea8108875847b0919e1f1cb8dc1c6c/`).
- Phase: was PH10a follow-up; now SHIPPED. Slice 2 (cropper) still
  owed as STUB-077.
- Why: The spec calls for a Bunny signed PUT URL + image cropper
  (mime allowlist `image/jpeg, image/png, image/webp`, 5MB cap, square
  crop, Bunny storage path `avatars/{user_id}/{uuid}.{ext}`). The
  form's avatar section in v1 displays the current `avatar_url` (or
  initials if null) and supports a "Remove" action that sets
  `avatar_url = null`. A separate worker session will add the upload
  (Bunny signed PUT + a small cropper).
- Blocker: none. The page is fully usable without the upload.
- Owner: Mavis
- Created: 2026-06-17
- Resolved: 2026-06-29. STUB-077 filed for the cropper follow-up.

### [STUB-032] Partner dashboard lifetime sales shows $0 (aggregation lands in PH15)
- Phase: ~~PH15~~ **RESOLVED 2026-06-26 by P6.1**
- Why: ~~The dashboard summary reads
  `payout_ledger.amount_cents where kind='order_sale' and
  partner_id = partners.id` for the lifetime-sales KPI. The
  aggregation is a simple SUM today; we hold off on wiring
  until PH15 so the partner page doesn't pull from a moving
  target.~~
- Resolution: Migration `0029_partner_lifetime_sales.sql` ships the
  `public.get_partner_lifetime_sales_cents(bigint)` RPC +
  partial covering index `payout_ledger_partner_order_sale_idx
  (partner_id, amount_cents) WHERE kind = 'order_sale'`.
  `getPartnerDashboardSummary` calls it via
  `supabase.rpc('get_partner_lifetime_sales_cents', { p_partner_id })`
  in parallel with the 3 product-count reads. The RPC is
  SECURITY DEFINER + checks `current_partner_id() = p_partner_id
  OR is_admin()` internally (never leaks another partner's data).
  Lifetime sales KPI on /partner now reflects the canonical
  payout_ledger state.
- Blocker: ~~PH15.~~ Resolved.
- Owner: Mavis
- Created: 2026-06-17
- Resolved: 2026-06-26

### [STUB-051] P4.13 — "Download invoice (PDF)" link on /checkout/success is not wired
- Phase: was Phase 4 (Cart + checkout deep) — P4.13 marked `[x]` in PROGRESS.md with this gap deferred to P4.12
- Why (historical): The success-page acceptance criterion required a downloadable invoice PDF. The spec open question asked Klaas to approve `@react-pdf/renderer` vs headless Chromium. Building without a library choice would either pick unilaterally (forbidden by AGENTS.md §1 "end products") or stub it out (violates the no-TODO rule).
- Resolution: **RESOLVED 2026-06-29** — Klaas decision: link to Stripe's hosted invoice URL (`invoice.hosted_invoice_url`) instead of generating our own PDF. Zero new deps, zero new code path, Stripe regenerates the invoice when line items change. Implementation: surface `hosted_invoice_url` next to "View order details" on `/checkout/success` + on `/account/orders/[id]`; open in new tab with `rel="noopener noreferrer"`; gate behind auth (the Stripe URL is single-tenant per customer but still bearer-token-shaped, so we add a tracking row to `file_downloads` with `kind='invoice_redirect'`). P4.12 work re-scoped from "generate PDF" to "render Stripe invoice URL CTA + audit row".
- Owner: Mavis (cron)
- Created: 2026-06-26
- Resolved: 2026-06-29 (Klaas decision). P4.12 implementation ≤ 0.5 tick once Stripe live.

### [STUB-053] P6.5 — Bank account payout method + micro-deposit verification
- Phase: was Phase 6 (Royalty + payouts deep) — P6.5 Slice 1 marked `[~]` with this gap deferred to Slice 2
- Why (historical): PHASES.md P6.5 reads "Partner payout method — PayPal email + bank details (encrypted at rest), micro-deposit verification for bank". Slice 1 shipped PayPal email encryption + masking + audit; bank + micro-deposit needed a KYC provider decision.
- Resolution: **RESOLVED 2026-06-29** — Klaas decision: **PayPal Mass Payout handles actual disbursement** (already in stack per AGENTS.md §"Stack"), **Stripe Connect handles partner onboarding + bank KYC**. Rationale: PayPal has built-in micro-deposit / KYC for partner bank verification AND can disburse; but we already pay the Stripe platform fee on inbound payments, so onboarding partners through Stripe Connect unifies the partner relationship under Stripe and lets PayPal Mass Payout fire the actual disbursement. Implementation: (a) new migration adds 3 encrypted JSONB slots (`bank_account_holder_encrypted`, `bank_routing_encrypted`, `bank_account_encrypted`) + `stripe_connect_account_id` + `bank_verified_at` columns. (b) Partner settings form gains a "Connect Stripe" button → `stripe.accountLinks.create()` onboarding URL. (c) After Stripe Connect onboarding, partner's bank account is already KYC-verified by Stripe (no separate micro-deposit flow needed). (d) `requestPayoutAction` writes `payout_method = { paypal_email_encrypted, stripe_connect_account_id }`; admin approval calls PayPal Mass Payout (uses PayPal email) or Stripe Transfer (uses Stripe Connect account). (e) Webhook from Stripe Connect (`account.updated` event) flips `bank_verified_at` when `details_submitted && charges_enabled && payouts_enabled`.
- Owner: Mavis (cron)
- Created: 2026-06-26
- Resolved: 2026-06-29 (Klaas decision). Implementation unblocked, requires Stripe live + PAYPAL_CLIENT_ID + PAYPAL_SECRET in Doppler. Estimated 2-3 ticks once creds are wired.

### [STUB-054] P6.5 — Tax ID encryption at rest
- Phase: was Phase 6 (Royalty + payouts deep) — P6.5 Slice 1 marked `[~]` with this gap deferred
- Why (historical): Partner-settings spec §"Security" §"PII encryption approach" lists tax_id as one of the encrypted-at-rest columns. P6.5 Slice 1 encrypts PayPal email but defers tax_id to a separate slice because the spec is ambiguous between JSONB (alongside PayPal) and a dedicated `bytea` column. Until encryption lands, `partners.tax_id` is plaintext.
- Resolution: **RESOLVED 2026-06-29** — Klaas decision: **same AES-256-GCM envelope as PayPal email.** Concretely: store as a JSONB envelope slot inside `payout_method.tax_id_encrypted` (same `encryptString()` + `decryptStringOrPassThrough()` pattern), NOT a dedicated `bytea` column. Reuses the existing `PARTNER_PAYOUT_ENCRYPTION_KEY`, the existing `encryptString`/`decryptString` helpers, the existing `decryptPayoutMethod` parser — adds a `tax_id` field to the payout_method envelope shape, not a new column. Estimated ≤ 0.5 tick: schema migration adds the JSONB slot (idempotent `jsonb_set`); `updatePartnerSettingsAction` extends to encrypt tax_id alongside paypal_email; `getMyPartnerProfile.ts` decrypts both fields; audit-log diff already covers tax_id (the masked value shape is unchanged). The `bytea` column option from the data-model spec is dropped — JSONB envelope is the single source of truth for all partner PII at rest.
- Owner: Mavis (cron)
- Created: 2026-06-26
- Resolved: 2026-06-29 (Klaas decision). Implementation ≤ 0.5 tick; lands inside the same slice as STUB-053 (P6.5 Slice 2 re-scope).