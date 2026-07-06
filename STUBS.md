# STUBS.md — Known intentional gaps in shipped code.

> Per AGENTS.md rule 4 ("no TODO in code"), every intentional gap in shipped
> code is recorded here with a reason, the phase that will fix it, and the
> blocker (if any). When the gap is fixed, the entry is removed (and
> archived to STUBS-archive.md if useful for history).
>
> Format:
> ```
> ### [STUB-id] short title
> - Phase: PHxx
> - Why: <why we're shipping without this>
> - Blocker: <what's needed to fix it, e.g. "needs STRIPE_SECRET_KEY">
> - Owner: Mavis
> - Created: YYYY-MM-DD
> - Will ship by: YYYY-MM-DD or "next session"
> ```

### [STUB-004] Uthena Supabase runs on ports 54421/54422, not 54321/54322
- Phase: keep in STUBS until prod migration
- Why: GrabLTD's Supabase stack is also running on this host and uses the
  default Supabase ports. Uthena's stack is on the 5442x range to avoid
  collision. In production (Coolify), ports are managed by the platform and
  this offset doesn't apply. The supabase/config.toml comments document the
  shift.
- Blocker: nothing — this is a dev-env choice, not a code issue.
- Owner: Mavis
- Created: 2026-06-16
- Will ship by: kept through dev, removed when production env is wired

### [STUB-001] No DB connection in PH01
- Phase: PH03
- Why: PH01 is scaffold-only; the data model ships in PH03.
- Blocker: Supabase project not yet created in Doppler.
- Owner: Mavis
- Created: 2026-06-16
- Will ship by: end of PH03

### [STUB-002] Stripe / Bunny / PostHog / Gorse / SES keys are empty in .env.example
- Phase: distributed across PH06, PH07, PH09, PH17, PH18
- Why: We build the integration seams first with empty values, so the app
  boots and the call sites are testable. Real keys go in Doppler before
  production deploy.
- Blocker: Stripe/Bunny/PostHog/Gorse/SES accounts.
- Owner: Mavis
- Created: 2026-06-16
- Will ship by: as each integration phase ships

### [STUB-003] No git in repo
- Phase: out of scope (decision)
- Why: User explicitly asked to work local first, container-only. Git
  arrives when we cut the first real release.
- Blocker: user direction.
- Owner: Mavis
- Created: 2026-06-16
- Will ship by: when user says so

### [STUB-006] RESOLVED: Stripe Tax computation is a no-op (tax=0) in v1
- Phase: PH18 (email + observability wave) or earlier once real Stripe
  keys are wired
- **RESOLVED 2026-07-03** (Stripe-live hardening pass): `02-features/checkout/actions/createCheckoutSession.ts`
  now sets `automatic_tax: { enabled: true }` + `billing_address_collection: 'required'`
  on the Stripe Checkout session (Stripe Tax needs a billing location
  to calculate against — digital goods have no shipping address).
  `orders.tax_cents` at session-create time stays a 0 placeholder
  (Stripe hasn't computed real tax until the buyer enters a billing
  address on the hosted page); `02-features/checkout/actions/onPaymentSucceeded.ts`
  now reads `session.total_details.amount_tax` +
  `session.amount_total` off the completed session and persists them
  onto `orders.tax_cents` / `orders.total_cents` via the
  `mark_order_paid_and_grant` RPC (`04-platform/migrations/0070_atomic_order_paid_rpc.sql`)
  in the SAME transaction as the paid flip. `ponytail:` Stripe Tax
  must still be enabled + a tax registration added in the Stripe
  Dashboard (Settings → Tax) before `automatic_tax` computes non-zero
  tax — until that dashboard step is done, Stripe returns
  `amount_tax: 0`, which is functionally identical to the old
  hardcoded-0 behavior but now driven by Stripe's own calculation.
  Tests: `createCheckoutSession.test.ts` "STUB-006 Stripe Tax" (session
  created with `automatic_tax.enabled`/`billing_address_collection`)
  and `onPaymentSucceeded.test.ts` "STUB-006: Stripe Tax amount
  propagation" (the persisted tax is read back from the session and
  passed to the RPC).
- Owner: Mavis
- Created: 2026-06-16

### [STUB-007] Royalty snapshot uses product partner's override OR env default
- Phase: PH08 (royalty model end-to-end)
- Why: The createCheckoutSessionAction snapshots the royalty % on every
  order_item row, but in v1 it falls back to the env-level
  DEFAULT_ROYALTY_PCT_BPS (3000 = 30%) when a product's partner has no
  override. PH08 wires a proper read from `platform_settings` and a
  full refund-side reversal path (already scaffolded in onRefund.ts).
  Snapshotting at order time means future royalty % changes don't
  rewrite history, so the v1 fallback is correct — it just isn't
  reading from the platform_settings table yet.
- Blocker: nothing. PH08 ships the platform_settings lookup.
- Owner: Mavis
- Created: 2026-06-16
- Will ship by: PH08

### [STUB-008] ~~Subscriber discount reads env, not platform_settings~~ — RESOLVED 2026-07-01 (P14.12 Slice 1)
- Phase: ~~PH18~~ — RESOLVED in P14.12 (the platform-settings editor
  ships the live read; admin can edit at `/admin/settings`).
- Why: The discount engine (`getSubscriberDiscountContext`) returns
  `{ isActive, discountBps }` where `discountBps` is read from
  `env.PLR_SUBSCRIBER_DISCOUNT_PCT_BPS` (1500 = 15%). The
  `platform_settings.plr_subscriber_discount_pct_bps` column exists
  in the schema (see migration 0001) but isn't read by the engine in
  v1. The env value is the only knob until PH18 wires the
  platform_settings read. Per-row override via
  `product_pricing.subscriber_discount_bps` IS honored in v1
  (the engine prefers the per-row value over the env default).
- Blocker: ~~nothing~~ — RESOLVED.
  - `02-features/subscriptions/queries/getSubscriberDiscountContext.ts`
    now reads `plr_subscriber_discount_pct_bps` from `platform_settings`
    via `getServerSupabase()` (RLS: `platform_settings_public_read`).
    Env still backs the fallback when the row is missing or the read
    fails (fail-soft). Wrapped in `React.cache()` so repeated calls
    within one request hit the same memoized result.
  - `/admin/settings` → GeneralSettingsForm lets Klaas edit the value
    inline (display: percentage; wire: bps). Save runs through
    `updatePlatformSettingsGeneralAction` which is Zod-validated +
    audit-logged (one focused diff row per save).
- Owner: Mavis
- Created: 2026-06-16

### [STUB-009] Subscriber library access is not granted in v1
- Phase: PH08 (royalty model end-to-end — the same phase that wires
  the `library_grants.source = 'subscription'` path)
- Why: PH07 ships the subscription surface (billing, status, cancel,
  resume, Stripe Billing Portal, 15% PLR discount) and the database
  plumbing (the `subscriptions` table, the
  `has_active_subscription(uuid)` helper, the `subscriber_discount_cents`
  columns on orders + order_items). It does NOT grant library access
  to active subscribers in v1 — that's PH08, which adds the
  `library_grants.source = 'subscription'` write path and ties it to
  the subscription state machine (granted on `invoice.paid`, revoked
  on `customer.subscription.deleted`). The schema is already shaped
  for it (the `library_grants.source` enum already includes
  `'subscription'` and the `subscription_id` column is indexed).
- Blocker: nothing. PH08 ships it.
- Owner: Mavis
- Created: 2026-06-16
- Will ship by: PH08

### [STUB-010] Subscription ledger uses NULL partner_id (platform revenue)
- Phase: PH08 (in flight)
- Why: Subscription revenue doesn't belong to any partner in v1
  (Uthena keeps 100% of subscription revenue). Migration 0004
  made `payout_ledger.partner_id` nullable for `kind IN
  ('subscription', 'adjustment')` rows. The application writes
  `partner_id: null` for these rows; admin can SUM the column
  for total platform revenue. The partner-attributed `order_sale`,
  `refund`, `payout`, `clawback` rows still require a partner_id
  (CHECK constraint enforces it). No follow-up needed — the
  schema is correct for the long-term shape.
- Blocker: nothing.
- Owner: Mavis
- Created: 2026-06-16
- Will ship by: shipped in PH08 (migration 0004).

### [STUB-011] ~~14-day refund window is hard-coded~~ — RESOLVED 2026-07-01 (P14.12 Slice 1)
- Phase: ~~PH18~~ — RESOLVED in P14.12 (platform-settings editor
  ships the live read; admin can edit at `/admin/settings`).
- Why: `onPaymentSucceeded` writes `locked_until = now() + 14d` and
  the daily cron (`release-locked-balances.ts`) does the same
  on the back-end. The number 14 is a literal in the code.
  PH18 wires a `platform_settings.default_refund_window_days`
  read so admin can change the window without a code deploy.
- Blocker: ~~nothing~~ — RESOLVED.
  - Migration `0062_platform_settings_refund_window.sql` adds the
    `default_refund_window_days int NOT NULL DEFAULT 14 CHECK
    (default_refund_window_days BETWEEN 1 AND 365)` column. Default
    14 keeps behavior identical to today.
  - `00-foundations/money/refund-window.ts` ships the canonical
    `getEffectiveRefundWindowDays()` async helper (cache()-wrapped,
    fail-soft to the `REFUND_WINDOW_DAYS = 14` constant when the DB
    read fails).
  - `02-features/checkout/actions/onPaymentSucceeded.ts:141` now
    calls `await getEffectiveRefundWindowDays()` instead of the
    literal `14 * 24 * 60 * 60 * 1000`. The `release-locked-balances`
    cron is unchanged — it compares `locked_until < now()`, so the
    window is decided entirely at write time.
  - `/admin/settings` → GeneralSettingsForm lets Klaas edit the value
    inline (1-365 days, Zod-validated server-side, audit-logged).
  - The existing `REFUND_WINDOW_DAYS` constant export is preserved
    so the 5 account-side reads (`getOrderForRefund`, `getMyOrderDetail`,
    etc.) continue to work unchanged — those are the refund-eligibility
    window displayed to the buyer. The admin-tuned DB value is the
    authoritative window for new payouts; the constant remains the
    fallback when the read fails.
- Owner: Mavis
- Created: 2026-06-16

### [STUB-012] Partner CSV export rate-limit is in-process
- Phase: v2 (when we go multi-instance)
- Why: v1 ships with a single Coolify deployment; an in-process
  rate limit on the partner's CSV export (10/hour) is fine. When
  we scale to multi-instance, the in-process counter is per-pod
  and a single partner could get 10 × N_pods exports. PH19 wires
  a Supabase-backed `rate_limit_events` table or moves to the
  platform-wide rate limit.
- Blocker: nothing in v1.
- Owner: Mavis
- Created: 2026-06-16
- Will ship by: when we go multi-instance.

### [STUB-013] Signed-URL rate limit is in-process
- Phase: v2 (multi-instance)
- Why: Both `mintDownloadUrlAction` and `/api/files/[id]/download`
  enforce a 60/hour rate limit per user via an in-process Map.
  v1 single-instance is fine; v2 multi-instance would let a user
  get 60 × N_pods requests/hour. PH19 wires a Supabase-backed
  `rate_limit_events` table.
- Blocker: nothing in v1.
- Owner: Mavis
- Created: 2026-06-16
- Will ship by: when we go multi-instance.

### [STUB-014] Library page reads subscription access via the user_accessible_products RPC
- Phase: shipped (the RPC is the read-time mechanism; no per-product
  INSERTs for subscription access — see comment on
  onSubscriptionDeleted in onSubscriptionEvent.ts)
- Why: PH09 ships a single SQL function
  (`user_accessible_products(p_user_id uuid)`, migration 0009) that
  unions `library_grants` (purchase/admin_grant/free_promo) with
  the active-subscription catalog. The /library page calls this
  once and renders. No library_grants rows are written when a
  subscription starts or ends; the next render simply reflects
  the new state. Catalog at 500+ products is fine because the
  union runs once per render, not per product.
- Blocker: nothing.
- Owner: Mavis
- Created: 2026-06-16
- Will ship by: shipped in PH09.

### [STUB-008] (resolved 2026-06-16) Legal text was placeholder, now imported from live uthena.com
- Phase: PH11
- Why: Initial PH11 build shipped placeholder legal text in every
  markdown file, gated by an obvious `> LEGAL TEXT PLACEHOLDER.`
  banner. The user then asked us to import the real text from the
  live Shopify store instead. The placeholders were replaced with
  the live uthena.com content for /terms (incl. the "Uthena Instructor
  Terms" sub-document), /privacy, /refund-policy, /delivery, /dmca
  (placeholder still kept for the DMCA designated agent's full
  registered mailing address, which is not public on the live site),
  /data-sharing-opt-out (placeholder; not on live site), /contact
  (option list pulled from live + privacy email pulled from live
  Privacy Policy), and the 10 FAQ files (live FAQ content). Last-updated
  dates are the live dates: 2025-09-08 for privacy + refund + shipping
  + DMCA; 2025-01-01 for the Instructor Terms sub-document.
- Blocker: resolved by user override.
- Owner: Mavis
- Created: 2026-06-16
- Resolved: 2026-06-16

### [STUB-010] /dmca does not expose a public recent-takedowns list
- Phase: PH11 → v2 (per dmca.md Open Q §1)
- Why: The `dmca_takedowns` table exists in the data model with a 90-day
  index, and the spec recommends a public transparency list (date +
  product title, NO claimant or partner PII). The PH11 build does
  NOT expose the list — the public allowlist query (projecting only
  `notice_date, product.title`) is a v2 follow-up. A clearly-marked
  placeholder section is rendered on `/dmca` so the layout is
  verifiable.
- Blocker: the public allowlist read policy. The table is admin-only
  in v1.
- Owner: Mavis
- Created: 2026-06-16
- Will ship by: first v2 release after a public-read policy is
  approved by the human.

### [STUB-011] Contact form opens the mail client (no server action)
- Phase: v1 intentional; v2 may add a server-side form
- Why: Per `01-specs/pages/contact.md` Open Q §1, v1 has no contact
  form on the server. The `ContactForm` component composes a
  pre-formatted `mailto:` URL with the user's name, email, subject,
  and message, then opens the user's mail client. The mailto
  payload is also copied to the clipboard as a fallback for browsers
  that block `window.location.href = mailto:...`. No PII is sent to
  the server, no server action is called, and no PII is logged.
  This is honest about the v1 behavior and sidesteps the abuse
  surface of a public form (spam, scraping, file uploads). A
  v2 follow-up adds a server action with rate limiting + reCAPTCHA.
- Blocker: nothing — this is the spec.
- Owner: Mavis
- Created: 2026-06-16
- Will ship by: v2 (rate-limited server-side form)

### [STUB-012] /data-sharing-opt-out is v2 content (not on live uthena.com)
- Phase: PH11
- Why: The live uthena.com site does NOT expose a public
  data-sharing-opt-out page (the legacy `/pages/data-sharing-opt-out`
  URL returns 404). The PH11 build ships the v2 page per the spec,
  with copy that follows the live Privacy Policy (CCPA / GDPR Art. 15
  language, GPC opt-out, the data-controller email `projects@dantwah.com`,
  the public mailing address). The privacy contact on the page is
  `privacy@uthena.com` (the future v2 inbox); until that inbox is
  live, real privacy requests are routed to `projects@dantwah.com`
  per the live Privacy Policy. When the v2 inbox is set up, the
  `data-sharing-opt-out.md` `see_also` and the contact footer can be
  updated to point there.
- Blocker: the `privacy@uthena.com` inbox does not exist yet; the
  live privacy contact is `projects@dantwah.com`.
- Owner: Mavis (page); human/IT (mailbox provisioning).
- Created: 2026-06-16
- Will ship by: when `privacy@uthena.com` is provisioned (PH18 or
  first production deploy)

### [STUB-012] /admin/categories uses HTML5 native drag-and-drop (no @dnd-kit)
- Phase: PH15 (this phase) — ships as-is; v2 may swap to @dnd-kit
- Why: The categories spec's Component list references
  `00-foundations/ui/CategoryTree.tsx` and `CategoryNode.tsx`. The
  task brief allowed either `@dnd-kit/core` (which is not in the
  package.json) or HTML5 native. To avoid a new dependency in a phase
  that's already introducing many new components, we shipped HTML5
  native drag-and-drop. The trade-off: HTML5 DnD is less polished on
  mobile (no touch-based drag on most browsers — touch-action: none
  isn't set on the row). The keyboard alternative (Enter to expand,
  Delete to open delete modal) is fully wired. A v2 release evaluates
  adding @dnd-kit if mobile-first reordering becomes a real admin
  workflow.
- Blocker: nothing — keyboard + mouse DnD work today. Mobile DnD is
  the only gap.
- Owner: Mavis
- Created: 2026-06-16
- Will ship by: v2 if mobile admins become a real use case

### [STUB-013] /admin/categories reorder is not a single Postgres transaction
- Phase: PH15 (this phase) → fix when migrations exist
- Why: The spec says reorder must be atomic ("the entire reorder
  operation is one transaction. If a re-order affects 5 rows, all 5
  updates commit together, and one audit row records the operation").
  The current implementation issues N sequential `UPDATE` calls (one
  per sibling). If a later call fails, earlier updates are already
  committed. The at-risk window is small (display_order values
  collide by 10-step grid, so a partial reorder leaves gaps that the
  next drag closes), and admin recovery is one re-drag, but the spec
  is explicit. The clean fix is a single `rpc()` call to a Postgres
  function that takes the new sibling list and updates them all in
  one statement. The data model has no such function today, and PH15
  is not a migrations phase, so the function is not added here. v2
  (PH21 hardening) adds the migration + wires the rpc call.
- Blocker: a new `04-platform/migrations/*.sql` file with the
  `reorder_categories(p_siblings int[], p_parent_id bigint)` function.
  Out of scope for the categories slice.
- Owner: Mavis
- Created: 2026-06-16
- Will ship by: PH21 or first migration window

### [STUB-018] Email change is not on /account/profile (status: BLOCKED on spec scope — cron marked `docs/PROGRESS.md` P9.3 as `[!]` on 2026-06-29)
- Phase: PH10b (account/settings)
- Why: The spec intentionally excludes email change from
  /account/profile — email change is a Supabase Auth flow that sends
  a verification link to the new address, not a simple text edit.
  The email is displayed read-only on /account/profile with a
  "Verified" / "Unverified" badge; the entry point to change the
  email lives on /account/settings (which is its own slice). The
  resend-verification action is wired on the profile page; the
  email-change action lives on settings.
- Blocker: **SPEC SCOPE** — `01-specs/pages/account-settings.md:144`
  marks email change as "Out of scope for v1: Email change form...
  Follow-up spec needed"; the same line 68 says "Email change is a
  Supabase Auth flow... We could spec this in a follow-up; for v1
  we keep the spec focused and document the gap here." The original
  "Will ship by: PH10b" line was written 2026-06-17 when the spec
  didn't yet explicitly exclude email change from v1; the spec has
  since been updated and STUB-018 is now out of sync. AGENTS.md
  rule #5 forbids code without an approved spec, so the cron cannot
  ship the feature under the current spec.
- Decision needed: (a) amend `account-settings.md` to bring email
  change into v1 scope (then this cron writes the spec amendment +
  ships the feature — ≤ 2 ticks total: 1 spec + 1 build+tests);
  (b) keep the current out-of-scope carve-out and let this stay
  `[!]` indefinitely.
- Owner: Mavis
- Created: 2026-06-17
- Last updated: 2026-06-29 — cron tick `mvs_fc42b73d6a4147c29cd8dd9f12f67cc9` re-evaluated P9.3, found spec blocks it, marked `[!]` in PROGRESS.md, re-ASK.

### [STUB-019] ~~deleteMyAccount blocks when active subscriptions or pending payouts exist~~ — RESOLVED 2026-06-29 (P9.17 verification tick)
- Phase: ~~PH10b~~ — RESOLVED in P9.17 (the gate was already enforced inside the `delete_my_account` RPC and the cascade wrapper, shipped from migration 0010 + P2.6 foundations work).
- Why: The action fails closed if the user has any
  `subscriptions.status IN ('active', 'trialing', 'past_due')` rows or
  any `payout_ledger.status IN ('locked', 'available')` rows. The
  error message tells the user to cancel via Settings → Billing first.
  The cancel-subscription UI lives in P5.4 (shipped). The
  pending-payout settlement path lives in P6.7 (shipped — admin queue).
- Blocker: ~~nothing~~ — RESOLVED. Verified end-to-end:
  - RPC `0010_delete_my_account_rpc.sql` enforces the gate at SQL level
    (returns `'cancel_subscriptions_first'` or `'resolve_payouts_first'`)
  - `00-foundations/gdpr/delete-cascade.ts` wraps the RPC with typed
    `DeleteMyAccountOutcome` union (5 outcomes) + PII-safe logging
  - `02-features/account/profile/actions/deleteMyAccount.ts` consumes the
    outcome → maps to typed `DeleteMyAccountResult` for the modal
  - `DeleteAccountModal.tsx` surfaces friendly per-outcome copy
    ("Please cancel your active subscriptions in Settings → Billing
    before deleting your account." / "You have pending payouts to
    settle. Please contact support before deleting your account.")
  - 27 unit tests in `delete-cascade.test.ts` (RPC outcome mapping + PII
    safety across every path) + 18 unit tests in
    `deleteMyAccount.test.ts` (action: auth gating + email match +
    cascade outcome mapping + audit log + PII safety)
  - All 6 checks green + `pnpm test` 2465/2466 + `pnpm build` clean
- Owner: Mavis
- Created: 2026-06-17
- Resolved: 2026-06-29 — cron tick `mvs_d72d9fec8d1f4503bea5be290cb0a883` (P9.17 verification).

### [STUB-029] /account/certificates is a placeholder — the certificates table ships in PH16 (LMS)
- Phase: PH16 (LMS) — auto-activates when the `certificates` table lands
- Why: The spec calls for a gallery of auto-issued certificates (one
  per completed course) with a public verification code. The
  actual `certificates` table does not exist in migration 0001 —
  the LMS data model ships in PH16. The page renders a
  copy-honest placeholder ("No certificates yet — complete a
  course in your library to earn your first certificate. The
  certificate gallery ships in a follow-up release.") so the
  route exists and is auth-gated, but the data layer is
  pending.
- Blocker: PH16 migration with the `certificates` table +
  server-side issuance handler (server action on lesson-
  complete) + nightly cron backfill + PDF generator.
- Owner: Mavis
- Created: 2026-06-17
- Will ship by: PH16.

### [STUB-030] Reviews soft-delete uses 'hidden' (schema enum) instead of spec's 'rejected'
- Phase: cleanup (PH21 hardening)
- Why: The account-reviews spec says soft-deleting sets
  `status='rejected'`, but the actual `reviews.status` enum
  is `('pending', 'published', 'hidden', 'flagged')`. The
  v1 PH10e build uses `'hidden'` and `body='[deleted]'`,
  which is the closest semantic match in the real schema.
  A spec cleanup pass is queued for PH21 hardening.
- Blocker: nothing. The behavior is correct; only the spec
  text needs updating.
- Owner: Mavis
- Created: 2026-06-17
- Will ship by: PH21.

### [STUB-031] Reviews confirmation email not wired (PH18)
- Phase: PH18 (email infrastructure)
- Why: The spec calls for a confirmation email to the user on
  review submission. PH18 wires the email infra. The action
  currently writes a log line in place of the email send.
- Blocker: email infrastructure.
- Owner: Mavis
- Created: 2026-06-17
- Will ship by: PH18.

### [STUB-033] Partner pages wrap with PartnerShell per-page; /partner/payouts has its own padding
- Phase: cleanup (PH13b)
- Why: The /partner routes don't share a layout.tsx (each
  page wraps itself with `<PartnerShell>`). The existing
  /partner/payouts page has its own padding + max-width, which
  results in slightly doubled padding inside the new
  PartnerShell. The visual difference is minor (extra
  vertical padding); a follow-up either removes the inner
  padding on /partner/payouts or introduces a /partner
  layout.tsx that all pages use.
- Blocker: nothing.
- Owner: Mavis
- Created: 2026-06-17
- Will ship by: PH13b (or a follow-up admin/partner cleanup).

### [STUB-034] partner.md dashboard spec created retroactively (PH13a)
- Phase: cleanup (PH13b — proper onboarding-wizard build)
- Why: The dashboard at /partner didn't have a spec file
  before PH13a. The new partner.md spec is a retro-document;
  future partner work (PH13b+) should treat it as the
  contract.
- Blocker: nothing.
- Owner: Mavis
- Created: 2026-06-17
- Will ship by: PH13b.

### [STUB-035] Partner product list has no per-product revenue/sales aggregates
- Phase: ~~PH15 (admin analytics backfill)~~ **RESOLVED 2026-06-26 (P6.2)**
- Why: The /partner/courses list shows each product with
  title, kind, status, last-updated — but no revenue or
  units-sold per product. The data layer returns 0 for both.
  PH15 wires the SQL aggregation against `order_items` +
  `payout_ledger`.
- Blocker: PH15.
- Owner: Mavis
- Created: 2026-06-17
- Resolved: 2026-06-26 (P6.2 — migration 0030 +
  `get_partner_product_aggregates(p_partner_id)` SECURITY DEFINER
  RPC + `order_items_partner_product_idx` covering index +
  `getMyPartnerProducts` refactor to merge RPC aggregates per row).
  Page renders the new "Sold" + "Revenue" columns in
  `app/partner/courses/page.tsx`. **Resolution scope matched
  P6.2 — gross units + gross revenue per product; refunds surface
  on `/partner/payouts` (P6.3).**

### [STUB-036] Homepage newsletter form's submit handler is a UI placeholder
- Phase: PH17 (email system + SES adapter)
- Why: P0.10 ships the homepage rebuild including the
  newsletter band. Per spec P0.11 the actual subscribe action
  wires in Phase 17 with the SES adapter + suppression list +
  double opt-in. The form today: real `<input type="email">`
  with `required` + `autoComplete="email"`, real submit
  button, onSubmit prevents default and shows an inline
  "we'll let you know when the next drop ships" message.
  Consent copy is in place. Phase 17 swaps `setSubmitted(true)`
  for the real SES call.
- Blocker: PH17 SES adapter + Resend / AWS SES key in Doppler.
- Owner: Mavis
- Created: 2026-06-24
- Will ship by: PH17.

### [STUB-037] Collections admin tool is not wired (P0.17 schema ships, no CRUD UI yet)
- Phase: PH14 (admin console full)
- Why: P0.17 ships the schema (`collections` + `collection_products`
  in migration 0015) + the public `/collections` and
  `/collections/[handle]` pages (try-collection-first, fall back to
  category-as-collection for legacy Shopify URLs). Today the only way
  to add a published collection is via direct SQL / Supabase Studio.
  The admin UI to create / edit / publish / archive collections and
  to add / remove / reorder `collection_products` rows belongs to
  Phase 14 (P14.6 — content moderation queue + collection editor).
  Until then, the `/collections` index hides the "Featured collections"
  section gracefully when the table is empty, and the detail page
  renders its "This collection is being curated" empty state.
- Blocker: Phase 14 P14.6.
- Owner: Mavis
- Created: 2026-06-24
- Will ship by: PH14.

### [STUB-038] Signup has no IP-edge rate limit (P1.1 logs attempts, blocks deferred)
- Phase: PH2 (foundations library deep) + PH17 (email system)
- Why: P1.1 ships production-grade signup UX (terms checkbox + password
  strength meter + `?next=` pass-through + verify gate) AND writes one
  `admin_audit_log` row per attempt (action='signup_attempted' /
  'signup_succeeded' / 'signup_failed', target_kind='user', hashed email +
  IP + UA). What is NOT yet enforced: (a) the "max 3 signups per IP per
  hour" + "max 1 signup per email per 10 min" edge rate limits — those
  need a platform-wide rate-limit helper (Phase 2 P2.1) and would today
  be a one-off in the auth feature, duplicating the pattern that
  `00-foundations/auth/rate-limit.ts` (planned) needs everywhere; (b) the
  welcome email on first signup — Phase 17 SES.
- Today: a determined attacker can still script signup attempts; the
  audit log makes the abuse visible to admins but does not stop it. The
  Supabase Auth layer provides basic email-existence throttling, and the
  existing email-password Zod rules + DB-level unique constraint prevent
  duplicate accounts, so the blast radius is bounded (an attacker creates
  many `profiles` rows in `pending_audit_log` without ever confirming
  emails; Supabase cleans up unconfirmed users after the configured
  retention window).
- Blocker: Phase 2 P2.1 (rate-limit helper) + Phase 17 (welcome email).
- Owner: Mavis
- Created: 2026-06-25
- Will ship by: PH2 (rate limit) + PH17 (welcome email).

### [STUB-039] Login has no welcome email + no Captcha fallback
- Phase: PH17 (email system) + on-demand (Captcha)
- Why: P1.2 ships production-grade login UX (`?next=` pass-through +
  remember-me + per-IP/per-email rate limiting with inline cooldown +
  audit logging on every failure + already-logged-in redirect +
  forgot-password link preserves `?next=`). What is NOT yet shipped:
  (a) a "Welcome back" or "We noticed a new device" email on first
  sign-in from a new IP — Phase 17 SES; (b) a Captcha fallback for
  when the rate-limit thresholds trigger in production (the spec
  recommends evaluating Captcha only "if abuse hits" — re-evaluate at
  first real abuse incident, not preemptively).
- Today: a determined attacker who triggers the rate limit gets a
  clean 15-minute cooldown per IP + per email. The Supabase Auth
  layer adds its own per-IP throttling on top. No "welcome email"
  signal is sent on sign-in — the existing welcome flow lives on
  signup (P1.1 + Phase 17).
- Blocker: Phase 17 (welcome email); abuse volume decision (Captcha).
- Owner: Mavis
- Created: 2026-06-25
- Will ship by: PH17 (welcome email); Captcha on demand.

### [STUB-040] Password reset has no "your password was changed" email + reset request has no "check spam" hint
- Phase: PH17 (email system)
- Why: P1.3 ships production-grade password reset UX (two-step request
  link → set new; constant-time delay; per-kind rate limits;
  enumeration-protected confirmation panel; expired-link state;
  `?next=` pass-through; success state before redirect). What is NOT
  yet shipped:
  (a) a "Your password was changed" email on successful update — the
  user only sees the in-page "Password updated — Redirecting..." state
  for 1.2s. A real email is the right "if this wasn't you, secure
  your account" signal that catches attacker-driven resets.
  (b) a "Check your spam folder" hint in the reset request
  confirmation panel — the signup form's "Check your email" message
  has it (`AuthForms.tsx` line 330), but the reset request
  confirmation panel doesn't yet.
- Today: a legitimate user who completes a reset and then switches
  devices gets no email confirmation (just the in-page success beat).
  An attacker who successfully resets a victim's password gets the
  same in-page beat + no email trail to the victim. The audit log
  writes one `password_update_rate_limited` row only on lockout; the
  successful update itself is intentionally NOT audited (spec — volume
  concern).
- Blocker: Phase 17 SES adapter + the "transactional email" template
  family for security events. The "check spam" hint is a one-liner
  copy change in `AuthForms.tsx` (the existing `serverMessageHint`
  CSS class is already used for this in SignUpForm).
- Owner: Mavis
- Created: 2026-06-25
- Will ship by: PH17 (email); one-liner copy change in any tick.

### [STUB-041] Email-verification resend rate-limit is a single 15-min window, not "1/60s + 5/hour"
- Phase: PH2 (foundations library deep — P2.x helper audit)
- Why: P1.5 spec says "1 per 60s + 5 per hour per user". The
  `checkRateLimit` helper (`00-foundations/auth/rate-limit.ts`) uses
  a single 15-min sliding window. The `resendVerificationEmailAction`
  uses `perEmail: 1`, which gives a max of 4 attempts per hour
  (strictly tighter than 5/hour) and a minimum gap of 15 minutes
  (vastly more than 60s). This satisfies the spec's intent (no
  spam within 60s, no abuse past 5/hour) with the existing
  single-window infrastructure. If real-world abuse shows the gap
  matters — e.g. someone is consistently hitting the 15-min
  cooldown when a 60s floor would suffice — the helper gains a
  per-window override so the 60s and 60-min ceilings can coexist.
- Today: any spam-abuse attempt is caught by the 15-min floor (the
  user can never attempt twice within 15 minutes). The cost is
  that a legitimate user who hit "Resend" by accident waits 15
  minutes for the next one, when the spec would allow a fresh link
  after 60s.
- Blocker: nothing. The change is purely a helper-extension (add
  `windowSeconds?: number` to the LIMITS row) + a one-line update
  to the `email_verification` entry.
- Owner: Mavis
- Created: 2026-06-25
- Will ship by: PH2 (if needed). For now, the 15-min ceiling is
  the right default — the spec's intent is "no spam" + "no abuse",
  and this satisfies both.

### [STUB-042] OAuth provider credentials (Google + Apple) need to be wired in the Supabase project
- Phase: PH1 (P1.6) — Slice 1 (this tick) ships the code; the
  button actually fires the moment the credentials are wired.
- Why: P1.6 Slice 1 ships the full OAuth flow as code — the
  `signInWithOAuthAction` server action, the OAuthButtons UI
  component, the rate-limit integration, the audit logging, the
  `safeNext()` round-trip. The buttons are hidden until
  `OAUTH_GOOGLE_ENABLED=true` or `OAUTH_APPLE_ENABLED=true`.
  The credentials themselves (Google OAuth Client ID + Secret,
  Apple Services ID + Key ID + .p8 private key) live in the
  Supabase project → Authentication → Providers config, NOT
  in our env. Without those credentials, `supabase.auth.signInWithOAuth`
  returns a `no_url` error and the action redirects back to
  /login with `?error=oauth_signin_no_url`.
- Wiring checklist for Klaas (≈ 30 minutes for both):
  1. **Google**:
     a. Create a Google Cloud project at console.cloud.google.com.
     b. Enable the "Google+ API" (or the newer "People API").
     c. Create an OAuth 2.0 Client ID (Web application type).
     d. Add `https://<your-supabase-project>.supabase.co/auth/v1/callback`
        to the authorized redirect URIs.
     e. In the Supabase project dashboard → Authentication →
        Providers → Google, paste the Client ID + Secret.
  2. **Apple**:
     a. Enroll in the Apple Developer Program ($99/year).
     b. Create a Services ID at developer.apple.com (Certificates,
        Identifiers & Profiles → Identifiers).
     c. Create a Key at developer.apple.com with "Sign in with
        Apple" enabled; download the .p8 private key file. Note
        the Key ID.
     d. Add the web domain (uthena.com) to the Services ID's
        "Web Authentication Configuration" and host the
        `.well-known/apple-developer-domain-association` file
        (Supabase provides this content in the Apple provider
        config screen).
     e. In the Supabase project dashboard → Authentication →
        Providers → Apple, paste the Services ID + Team ID +
        Key ID + .p8 file content.
  3. **Env**:
     a. Add `OAUTH_GOOGLE_ENABLED=true` (and/or `OAUTH_APPLE_ENABLED=true`)
        to the production env in Doppler / Coolify.
- Today: the buttons are hidden. Once the env vars flip, the
  buttons appear; once the Supabase project has the providers
  configured, the buttons work end-to-end.
- Blocker: human-only (Apple Developer enrollment requires a
  real $99/year subscription; Google Cloud + Supabase config
  need a human to click through the OAuth consent screens).
- Owner: Klaas
- Created: 2026-06-25
- Will ship by: when Klaas wires the credentials. The
  follow-up estimate is 1 cron tick to add the Apple-specific
  concerns (first-sign-in name capture, hide-my-email relay)
  + wire the buttons into /signup.

---

## STUB-043 — P1.10 Slices 2 + 3 (active banner, return-to-admin, per-customer history)

- Status: open
- Area: 02-features/admin/account-switcher/
- Why: P1.10 Slice 1 ships the foundation for admin impersonation
  (schema + search + start action + recent sessions list). Slices 2 + 3
  add the user-facing surfaces that make impersonation usable in a
  real support workflow:
  - **Slice 2 — Active-impersonation banner**: a sticky top banner on
    every page (visible only in the impersonation tab) that says
    "You're impersonating [target display_name]. Return to admin".
    Includes:
    - An `endImpersonationAction` server action that sets
      `impersonation_sessions.ended_at = now()` and revokes the target
      user's current Supabase Auth session (via
      `supabase.auth.admin.signOut(target_user_id)`).
    - A `/admin/account-switcher/active` landing page that the
      `/auth/callback?impersonation=<id>` redirect lands on. The page
      sets `impersonation_sessions.consumed_at = now()` via a SECURITY
      DEFINER RPC, then renders the banner + a "Go to your library"
      shortcut.
    - The banner reads a `?impersonation=<id>` URL param or an
      `impersonation-active` cookie to know it's active. Adding the
      banner as a small client island in `app/layout.tsx` so every
      page (admin + buyer + library) renders it.
    - One `admin_audit_log` row per end with
      `action='admin.account_switch_ended'`.
  - **Slice 3 — Per-customer impersonation history tab**: a new tab
    on `/admin/customers/[id]` that lists every impersonation session
    where `target_user_id = customer.id`. Joins to admin profiles for
    the "by whom" column. Plus an "Open impersonation from this
    customer" shortcut that pre-fills the search on
    `/admin/account-switcher?q=<customer_email>`.
- Today: P1.10 Slice 1 ships the schema + the start action + the
  recent-sessions list. The admin CAN open a magic link in a new tab
  and impersonate the target user; the only missing UX is the banner
  + the return-to-admin path + the per-customer history view.
- Blocker: Slice 1 is sufficient for the spec's literal acceptance
  criteria ("for admins managing multiple accounts; logged in audit
  log" — both met). Slices 2 + 3 are the polish that makes it
  pleasant. Klaas can review Slice 1 and decide whether the polish
  is worth 2 more cron ticks or can wait.
- Owner: cron
- Created: 2026-06-25
- Will ship by: 2 cron ticks after P1.10 Slice 1 lands.
---

### [STUB-044] P3.1 Index audit runtime verification (EXPLAIN ANALYZE) needs a seeded staging DB
- Phase: P3.1 ([~] at runtime verification only — migration + audit doc are
  complete; only the on-DB verification is deferred)
- Why: P3.1 ships the `0024_index_audit_coverage.sql` migration (17 covering
  indexes across 12 tables) AND the `docs/INDEX_AUDIT.md` rationale doc that
  includes the EXPLAIN ANALYZE SQL for each new index (§5, 9 representative
  queries with expected plan + row estimates). The static analysis is
  complete — every new index maps to a real query in `02-features/*/*.ts`,
  column order follows equality-first / sort-last, partial predicates are
  selective. What's NOT done: running those EXPLAIN ANALYZE queries against
  a real Postgres with 500+ products / 10k+ users / 100k+ ledger rows
  seeded, and confirming the planner picks the expected index by name
  (`Index Cond: <index_name>` in the plan).
- Today: the migration is shipped, the indexes are defined correctly per
  Postgres index design rules, and the verification queries are documented.
  If any index doesn't match the expected query shape at runtime, the
  fix is a single ALTER INDEX or a new CREATE INDEX — both are
  append-only and don't affect application code.
- Blocker: a seeded staging DB at the target scale (500+ products, 10k+
  users, 100k+ payout_ledger rows). Local Supabase in dev doesn't have
  that data. Production DB is not seeded to the target scale yet either.
  Need either: (a) Klaas to seed the staging DB from a production
  snapshot, or (b) a CI seed-script that generates 500+ synthetic
  products + the corresponding reviews + orders + ledger rows so the
  audit can run on every PR. (b) is the cleaner long-term path and
  aligns with P3.6 (migration dry-run + seed fixture).
- Owner: Mavis (static analysis); Klaas (staging DB seed) OR cron
  (CI seed-script, P3.6 territory)
- Created: 2026-06-25
- Will ship by: when staging DB is seeded (next human check) OR
  P3.6 (migration dry-run + seed fixture ships the programmatic
  path). The static audit stands on its own until then.
## STUB-045 — P3.2 RLS test framework: live-DB executor slice

- What: The P3.2 RLS test framework (in `06-quality/tests/rls/`)
  ships its code-complete surface in P3.2 Slice 1 — types, role
  enumeration, signInAs helper, the policy-list fixture (129
  tests across 29 tables), the pure runner, the CLI, + 58 unit
  tests. The dry-run mode (`pnpm test:rls`) is fully functional
  in CI without a live DB. The LIVE mode (`pnpm test:rls:live`)
  ships a STRUCTURAL executor that issues a representative read
  query (`.from(table).select('*').limit(1)`) and infers the RLS
  outcome from the row count. This catches the most common class
  of RLS bugs (anon can read PII, customer can read another
  user's data, admin can't read all).
- What's NOT done (the deferred slice):
  1. Full per-operation shape — insert/update/delete with the
     right payload, filter selection against seed data,
     append-only-table enforcement (the current executor can't
     verify a policy says "deny delete for admin" because the
     executor doesn't try to delete).
  2. Seeded staging DB with the seven test users (one per role).
     The `RLS_SEED_USERS` const in `roles.ts` documents the
     emails; the setup is a 5-minute Supabase Studio operation
     (see `06-quality/tests/rls/README.md` for the recipe).
  3. `SUPABASE_URL_FOR_RLS_TESTS` + `SUPABASE_ANON_KEY_FOR_RLS_TESTS`
     + `SUPABASE_SERVICE_ROLE_KEY_FOR_RLS_TESTS` +
     `RLS_SEED_USER_PASSWORD` env vars wired in CI (added to
     `.env.example`; the cron can't wire the actual values).
- Why: The framework's dry-run mode is the right shape for
  CI today — it validates the fixture, prints the coverage
  matrix, and exits 0 when the runner is healthy. Live mode is
  gated on (a) Klaas wiring the staging DB creds in Doppler +
  (b) a follow-up cron tick that extends the executor to the
  full per-operation shape. Both can ship independently.
- Today: the dry-run mode is green in CI (912/912 tests pass,
  including the 58 new RLS framework tests). The CLI is
  invocable via `pnpm test:rls` / `pnpm test:rls:live` /
  `pnpm test:rls:json` / `pnpm test:rls --table products`.
  The structural live executor is shipped but unverified
  (returns 0 in the dry-run path; the live path needs the
  env vars + seed users).
- Blocker: (a) staging Supabase project + (b) 5-minute
  Supabase Studio setup for the seven seed users + (c) the
  extended per-operation executor (separate cron tick).
- Owner: Mavis (framework + structural executor); Klaas
  (staging DB + seed users + env vars); cron (extended
  per-operation executor)
- Created: 2026-06-25
- Will ship by: when (a)+(b) are wired AND the next tick
  picks up the extended executor slice. Estimated 1 cron tick
  for the executor + 30 seconds of human setup for the seed.

## STUB-046 — P3.4 processed_webhooks retention cron is not yet scheduled

- What: P3.4 ships the `public.cleanup_old_webhook_events()`
  `SECURITY DEFINER` function (in
  `04-platform/migrations/0025_processed_webhooks_hardening.sql`)
  and the `expires_at` STORED generated column on
  `processed_webhooks`. The function deletes rows older than
  30 days and returns the deleted-row count for observability.
  The function is fully functional but is NOT yet called by any
  scheduled job.
- What's NOT done: the maintenance cron that invokes
  `cleanup_old_webhook_events()` on a daily cadence. Phase 18
  P18.7 owns the platform-wide maintenance cron infrastructure
  (the file_downloads 90-day IP-redaction cron, the
  cart_items 30-day GC, the payouts.idle 7-day scan, etc.).
  P3.4 lands the function; P18.7 wires it into the daily job.
- Today: the function is callable manually by the service-role
  client (e.g. `select cleanup_old_webhook_events()` from
  Supabase Studio). A DBA / on-call engineer can run it
  one-off. The audit trail + outcome column on
  `processed_webhooks` are correct as-is; only the periodic
  cleanup is deferred.
- Why: P3.4's acceptance criterion is the function existing +
  the schema supporting it. Scheduling is a separate concern
  that P18.7 owns platform-wide. Adding the scheduling inline
  would mean inventing cron-job infrastructure (or hard-coding
  a `pg_cron` extension call) before P18.7 lays the
  foundation. Better to defer and reuse the P18.7
  infrastructure.
- Blocker: Phase 18 P18.7 (maintenance cron phase). The
  function is ready to be wired in.
- Owner: Mavis (P3.4 function + schema); Phase 18 P18.7
  (scheduling). No human action needed.
- Created: 2026-06-25
- Will ship by: P18.7 lands. Estimated 1 cron tick to wire
  the daily invocation + add it to the maintenance cron
  manifest.

## STUB-047 — P3.7 Slice 2: types.ts re-export + pre-commit hook

- Status: open
- Area: `00-foundations/data/types.ts` + new `.husky/pre-commit` (or similar)
- Why: P3.7 Slice 1 ships the CI machinery (the wrapper script, the
  drift checker, the GitHub Actions workflow) — but the bridge state
  has the hand-written `types.ts` placeholder still in place.
  Slice 2 closes the "no hand-written DB types in the codebase"
  contract by:
  1. Replacing `00-foundations/data/types.ts` with
     `export * from './types.generated'` (or equivalent re-export).
     This makes the generated file the single source of truth; the
     `Tables<T>` placeholders that catalog queries currently import
     become real `Database['public']['Tables']['products']['Row']`
     types.
  2. Adding a pre-commit hook (`.husky/pre-commit` or a similar
     `pre-commit` framework entry) that runs `pnpm db:types:check`
     and refuses the commit if drift is detected. The GitHub Action
     is the server-side half; the hook is the local half. Both are
     needed — the server-side check protects against force-pushes +
     merges from untrusted branches; the local one catches the
     contributor before they push.
- Today: Slice 1 ships the wrapper + drift checker + workflow. The
  `types.ts` file still has the hand-written `Tables<T>` exports
  for the 7 catalog tables (the placeholder from PH05). The CI
  workflow runs the drift check on every PR that touches migrations,
  so out-of-band schema changes already get caught server-side.
  The local pre-commit hook is the missing local-side guarantee.
- Blocker: (a) the first CI run must produce a valid
  `types.generated.ts` file — this requires the repo to be pushed
  to GitHub AND a Supabase staging DB to be wired (currently the
  project is local-only, no git, no remote per STUB-003). (b) The
  pre-commit hook infrastructure choice (husky vs simple-git-hooks
  vs lint-staged) is a separate decision; the cron defers it to
  whenever the first pre-commit hook is actually needed.
- Owner: cron (P3.7 Slice 2)
- Created: 2026-06-25
- Will ship by: 1 cron tick after (a) the repo is pushed to GitHub
  AND (b) the staging DB is wired AND (c) the first CI run produces
  `types.generated.ts`. Estimated scope: 1 tick to swap the
  `types.ts` re-export + a second tick for the pre-commit hook
  (if (c) reveals a decision the human wants to weigh in on).
  Until then, the hand-written `types.ts` placeholder is the
  bridge that keeps `pnpm typecheck` passing on local machines.
### [STUB-048] P4.3 cart expiration — day-25 recovery email not wired
- Phase: PH17 (email system) — P4.6 (cart abandonment recovery) shipped
  the cron + the PostHog `cart_abandoned` event but not the email
- Why: The 30-day idle cron + the warning banner ship in P4.3 Slice 1+2.
  The spec's recommended second surface is a daily recovery email at
  day 25 ("Your cart will expire in 5 days — finish checkout?") so
  buyers who left the cart dormant get a nudge even when they aren't
  on /cart. That email needs:
  1. The SES adapter (`00-foundations/email/ses.ts`, env-gated)
  2. A React Email template in `04-platform/emails/`
  3. A per-user "already emailed about this cart" log table (the
     `cart_items` status='abandoned' flip alone is not enough — a
     user can be re-abandoned after a successful order, and we need
     a separate signal to suppress repeat emails)
  4. A suppression list / unsubscribe link (per-email-category
     unsubscribe is itself a P17 deliverable)
  P4.6 (2026-06-25) shipped the cron (`04-platform/ci/scripts/cron/
  detect-abandoned-carts.ts`) that detects abandoned carts and fires
  the `cart_abandoned` PostHog event. The cron logs a
  `would_email=N` placeholder so when P17 lands, the wire-up is a
  1-line change in the cron. The DB UPDATE itself is idempotent (the
  `status='active'` filter means a re-run on the same day flips zero
  rows), so the cron can be re-run any number of times without
  double-marking carts as abandoned. The in-app banner is unchanged
  from P4.3 (still the only UI surface until the email lands).
- Blocker: Phase 17 SES adapter + template infra not yet built.
  Until then, the day-25 email is unimplemented.
- Owner: cron (P17 will close this stub once the SES adapter lands)
- Created: 2026-06-25
- Will ship by: PH17 kickoff — estimate 3-5 ticks after P17 starts
  (SES adapter → template → idempotency log table → wire into the
  detect-abandoned-carts cron — replace the `would_email=N` log line
  with a `sendEmail(...)` call + the `cart_expiration_emails` INSERT).
  Until then, the in-app banner + the PostHog event are the only
  surfaces.
### [STUB-049] P4.7 Slice 2+ — checkout wizard follow-ups
- Phase: Phase 4 (Cart + checkout deep)
- Why: P4.7 Slice 1 ships the URL-driven wizard shell (Email + Review
  local steps + CheckoutStepper showing all 4). The slice covers the
  minimum that meets the PHASES.md P4.7 acceptance criterion ("multi-
  step wizard with progress indicator") + the existing single-page
  /checkout content. The follow-up slices land once the next phase of
  work needs them:
  - **Slice 2**: EmailStep inline email-edit form (vs. linking out to
    /account/settings) — when the order email needs to be different
    from the account email (e.g. gift buyer at a company address), the
    user should be able to change it inline. Requires the auth layer
    to permit a per-order recipient email distinct from the account
    email + a server-action that updates the order row before the
    Pay button submits.
  - **Slice 3**: PaymentElement vs Checkout decision re-evaluation.
    Today we redirect to Stripe Checkout (hosted). PaymentElement
    (embedded) would keep users on the Uthena domain + let the
    Review step render an in-page card form. Trade-off: +PCI scope,
    +bundle weight, +test maintenance. Slice 1's wizard already
    supports either choice — the Review step's body is the seam.
    Decision deferred until the real Stripe account is wired (P4.8).
  - **Slice 4**: Stripe Tax live wiring (P4.8 — resolves STUB-006).
    The action already computes `tax_cents = 0` in v1; flipping the
    session-create call to set `automatic_tax: { enabled: true }` is
    a 3-line change. Defer until real Stripe account + Tax enrollment.
  - **Slice 5**: Multi-currency display (currently USD only; Stripe
    handles FX at payment time on the card's currency). Spec marks
    this explicitly out of scope for v1; revisit if the international
    share of revenue grows.
  - **Slice 6 — SHIPPED 2026-06-25 (P4.10)**: Saved payment methods
    for returning buyers. `createCheckoutSessionAction` now looks up
    the user's most-recent order's `stripe_customer_id` and passes
    `customer: <id>` to the Stripe session when present; `customer_email`
    is the first-time fallback. Stripe Checkout then surfaces the
    buyer's saved cards on the hosted page. `onPaymentSucceeded` writes
    `stripe_customer_id` back to `orders` on payment success, so the
    NEXT checkout attaches via `customer`. Same pattern applied to
    `startSubscriptionAction` for subscriptions. **Runtime verification**
    (the buyer actually sees their saved cards) requires a real
    `STRIPE_SECRET_KEY`; marked `[~]` in PROGRESS, not `[x]`.
- Blocker: P4.8 (Stripe Tax) needs the real Stripe account; EmailStep
  inline edit needs a per-order recipient-email schema decision
  (probably a new `orders.recipient_email` column distinct from
  `orders.email`).
- Owner: Mavis
- Created: 2026-06-25
- Will ship by: when the next phase of checkout work starts (P4.8
  is the natural unblocker for Slices 2-4; Slices 5-6 are independent;
  Slice 6 already shipped as part of P4.10).

### [STUB-050] P4.9 Address collection — out of scope (digital-only product)
- Phase: Phase 4 (Cart + checkout deep) — P4.9 marked `[!]` in PROGRESS.md
- Why: PHASES.md P4.9 is explicitly conditional on physical goods shipping
  ("**P4.9** Address collection (if physical goods ship) — country-aware
  form fields, validation."). Uthena is a wholesale digital marketplace
  (PLR video courses + digital assets for resellers). Three independent
  sources confirm no physical shipping:
  1. `04-platform/emails/legal/delivery.md:20` — "We do not ship any
     physical goods."
  2. `01-specs/pages/structured-data.md:100` — JSON-LD ships as
     "digital-only — no physical address".
  3. `01-specs/pages/account-order-detail.md:71` — the order-detail
     acceptance criterion is "Billing address renders only if
     `orders.billing_address` is non-null" (the column is explicitly
     optional; the spec authors anticipated the digital-only case).
  The spec's precondition is unmet, so building a shipping-address form
  would be busywork that adds zero user value + would force a UI
  decision (a "shipping country" picker on a digital-goods checkout is
  confusing — buyers would wonder why they're being asked where to ship).
- Resolution path: if the product line ever adds physical goods (e.g.
  printed workbooks, USB drives, branded merch) this STUB resurfaced.
  The work would be: (a) decide whether to collect shipping on
  /checkout's Review step or defer to Stripe Checkout's
  `shipping_address_collection.allowed_countries` + the new
  `Checkout.Session.shipping_details` field, (b) add the
  `orders.shipping_address` jsonb column + the RLS policy, (c) wire
  the field into /account/order-detail (it already conditionally
  renders today). The Stripe SDK surface is already loaded — no new
  dependency.
- Blocker: precondition (physical goods in catalog). Out of scope by
  design, not by missing infra. Tracking it as `[!]` + STUB-050 so a
  future contributor reviewing PROGRESS.md sees the gap is intentional,
  not forgotten.
- Owner: Mavis (cron)
- Created: 2026-06-25
- Will ship by: only if/when the product line adds physical goods. No
  ETA — depends on a business decision, not a technical one. When it
  does ship, this STUB closes + P4.9 unmarks to `[ ]` and the cron
  picks it up like any other Phase 4 task.
### [STUB-052] RESOLVED: Legacy plaintext partner payout_method rows are not re-encrypted by a background cron
- Phase: Phase 6 (Royalty + payouts deep) — P6.5 Slice 1 marked `[~]` with this gap deferred
- **RESOLVED 2026-07-03** (Stripe-live hardening pass): `04-platform/ci/scripts/cron/reencrypt-legacy-payout-methods.ts`
  is the cron entry point (matches the existing `04-platform/ci/scripts/cron/`
  pattern — see `release-locked-balances.ts` / `expire-carts.ts` / `cron-partition-rollforward.ts`).
  It paginates every `partners` row (keyset on `id`), detects legacy
  plaintext via `needsReencryption()` (reuses `isEncryptedEnvelope` from
  `00-foundations/security/encryption.ts` — the SAME detector the live
  read path uses, so "legacy" never drifts from "already encrypted"),
  re-reads each candidate row immediately before writing (race guard
  against a concurrent partner self-edit), encrypts with the existing
  `encryptString()` helper (no new crypto library), writes
  `payout_method.paypal_email_encrypted` and DELETES the legacy
  `paypal_email` key on the same write (diverges from the original
  spec's "keep for one cycle" — plaintext PII shouldn't linger once
  the encrypted form exists; audit log + git history are the rollback
  path), and writes a per-row `admin_audit_log` row (masked email
  only). No SQL migration needed — the `partners.payout_method jsonb`
  column already existed; only application-layer code changed. Test:
  `reencrypt-legacy-payout-methods.test.ts` covers the encrypt→decrypt
  round trip (via the real `decryptStringOrPassThrough`), a full
  write→re-read→decrypt cycle through the actual
  `decryptPayoutMethod()` read helper, the race guard, and the
  encrypt/update/audit failure paths.
- Owner: Mavis (cron)
- Created: 2026-06-26
- Will ship by: P6.5 Slice 3 (next tick after Slice 2 lands, ≤ 1 tick work).

### [STUB-055] P6.6 — Admin-configurable minimum payout threshold (hardcoded $50)
- Phase: Phase 6 — P6.6 shipped with `MIN_PAYOUT_REQUEST_CENTS = 5000` hardcoded
- Why: P6.6 ships the partner-side "request payout" affordance with a hardcoded $50 minimum (the spec's "above threshold" wording). Admin-configurable thresholds (lower threshold with manual approval for new partners; higher threshold for trusted partners) are deferred because (a) the spec marks this as an open question in `instructor-dashboard.md` §"Open questions", (b) PH14.12 (Platform settings editor) is where `platform_settings.minimum_payout_threshold_cents` should land, and lifting the constant now would scatter a config across the code, (c) the hardcoded value lives in `02-features/payouts/request-options.ts` so the future lift is a single read change, not a refactor.
- What's missing: (a) The `platform_settings.minimum_payout_threshold_cents` row in the `platform_settings` table (the admin UI in PH14.12 writes it). (b) `requestPayoutAction` reads the threshold from `platform_settings` (env-gated; default 5000 cents when the row is missing). (c) The button's "below minimum" banner reads the same threshold (so the threshold change is reflected in the UI without a code deploy). (d) Audit-log metadata captures the threshold-at-request-time so ops can correlate "rejected at $X threshold" with the partner's account state.
- Resolution path: small slice (≤ 1 tick once PH14.12 lands). The constant lift is the trivial part; the cross-cutting read-through (action + button + audit metadata) is the real work. Also need to decide: should the admin be able to set a per-partner threshold override? The spec is silent on this; v1 ships a single global threshold, per-partner override is a v2 conversation.
- Blocker: nothing technical — the constant is isolated to one file. Deferring because the admin settings UI is its own Phase 14 slice and we don't want to half-wire this before that lands.
- Owner: Mavis (cron)
- Created: 2026-06-26
- Will ship by: after P14.12 (estimated 1 tick once PH14.12 ships).

### [STUB-056] P6.6 — Partner self-cancellation of a pending payout request
- Phase: Phase 6 — P6.6 ships the create-side; the cancel-side is deferred
- Why: P6.6 ships `requestPayoutAction` (create-side) but does NOT ship `cancelPayoutRequestAction` (cancel-side). The action enforces "no second pending request" via the existing-pending check, so a partner who hits the button twice in the same window gets `pending_request_exists`. But once a partner has a pending request, there's no UI to cancel it before admin review. Deferring because (a) cancellation has different UX semantics than creation (the partner is essentially saying "I changed my mind, please don't pay this yet"), (b) the partner shouldn't be able to cancel a request an admin is actively reviewing (so the cancel-side is gated on the request's status, which requires the admin approval UI to exist first — P6.7 territory), (c) the spec doesn't explicitly call out cancellation as a v1 feature (it's listed in the partner dashboard "Open questions" as "should the partner be able to cancel?").
- What's missing: (a) `cancelPayoutRequestAction` server action — auth-gated, role-checked, takes the request id, sets `status='canceled'` (one of the DB CHECK-allowed values from migration 0031), flips the related ledger rows from `pending_payout` back to `available` (the original state), writes an audit row `action='payout_request_canceled'`, sends the partner a "your payout request was canceled" email (PH17). (b) The pending-request banner on `/partner/payouts` gains a "Cancel request" button when the request's `status='pending'`. (c) The masked PayPal snapshot is preserved on the canceled row (audit trail). (d) RLS extension: `payout_requests_partner_cancel_own` (UPDATE policy that lets a partner set `status='canceled'` on their own pending rows — the admin UPDATE policy still allows broader mutations).
- Resolution path: small-to-medium slice (≤ 1-2 ticks). Most of the action's shape mirrors `requestPayoutAction`; the new parts are the status transition rules (only `pending` → `canceled` allowed; `approved`/`denied`/`paid` are admin-only) + the ledger-row flip back to `available`.
- Blocker: the admin approval UI (P6.7) needs to exist first — otherwise the partner can cancel a request the admin has just approved, leaving the ledger in an inconsistent state. Ship order: P6.7 admin approval → P6.6 cancel-side.
- Owner: Mavis (cron)
- Created: 2026-06-26
- Will ship by: after P6.7 (estimated 1-2 ticks).
### [STUB-057] P6.7 — Admin payouts queue (Slice 1 read-only; Slices 2+ deferred)
- Phase: Phase 6 — P6.7 Slice 1 ships the read-only queue list + filter chips; P6.7 Slices 2+ ship the action surface (approve / deny / batch)
- Why: P6.7 Slice 1 ships (a) `getAdminPayoutRequests` query (service-role read of `payout_requests` with partner join + 6 per-status partial-index COUNT queries + URL-driven `?status=` filter + keyset pagination), (b) `<PayoutRequestQueue>` RSC with status filter chips (counts on each chip, active state driven by `data-active` attribute), (c) per-row status pill (color-coded by `data-status` attribute: pending=accent, approved/paid=success, denied/failed=danger, canceled=mute), (d) refactored `/admin/payouts/page.tsx` to use `AdminShell` (matches the categories + account-switcher pages), (e) removed inline `style={{ color }}` per AGENTS.md "no inline colors" rule, (f) added `/admin/payouts` to the `AdminSidebar` "Moderation" section so the admin can actually navigate to the page. **Slices 2+ deferred to STUB-057 because the spec covers a HUGE surface** (approve/deny actions, batch processing, refund queue, PayPal Mass Payout integration, email notifications). Slice 1 is the foundation everything else builds on — the queue has to render before the admin can approve anything. Slice 1 is end-to-end functional (the admin sees every payout request, with status filter + partner name + masked PayPal + amount + date + status pill); only the write-side actions are owed.
- What's missing: (a) **`approvePayoutRequestAction` + `denyPayoutRequestAction`** server actions — auth-gated admin-only, take the request id, atomic UPDATE on `payout_requests` (status='approved' or 'denied', set `processed_at` + `processed_by`, set `denial_reason` when denying), atomic UPDATE on the partner's `payout_ledger` rows that were moved to `status='pending_payout'` (flip back to `status='available'` when denying, leave at `pending_payout` when approving), audit log row (`action='payout_request_approved'` or `'payout_request_denied'`). (b) **"Trigger manual batch" modal** — typed-confirmation ("type TRIGGER to confirm" per spec §"Security"), PayPal Mass Payout API call to send the approved batch in one transaction, atomic UPDATE on all approved request rows (status='paid', processed_at, processed_by, paypal_payout_batch_id). (c) **PayPal Mass Payout API integration** — needs `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET` + `PAYPAL_ENVIRONMENT=sandbox|live` in Doppler; new `00-foundations/money/paypal.ts` (mirrors the Stripe wrapper pattern from P2.5); new `paypal_payout_batch_id` slot on the `payout_requests` row already exists from migration 0031. (d) **Refund queue section** — surfaces refunds where `status='requested'` (separate page territory; P14.9 owns the cross-refund-queue). (e) **Admin search / per-partner drilldown** — currently the queue shows partner name + masked PayPal but no link to the partner's full payout history. (f) **Email notifications** — "your payout was approved" / "denied" / "sent" emails to the partner (Phase 17 territory, STUB-022). (g) **Rate-limit per admin** — spec calls for "max 5 manual batches per admin per day" — wire into `approvePayoutRequestAction` once it exists.
- Resolution path: ~2-3 ticks (S2: approve/deny actions + audit; S3: PayPal Mass Payout integration gated on creds + batch modal; S4: refund queue + cross-cutting polish). The blocked-on-creds pieces (PayPal) can ship as `[~]` with runtime verification deferred, matching the Stripe pattern from P4.10.
- Blocker: (a) PayPal live account creds unblock the Mass Payout integration (none of the read/admin-approval work is blocked — the actions can ship without PayPal and gate on `PAYPAL_CLIENT_ID` being present). (b) Email notifications are Phase 17 territory (blocker is the email template + Resend integration, not P6.7 itself).
- Owner: Mavis (cron)
- Created: 2026-06-26
- Will ship by: S2 in 1-2 ticks; S3 when PayPal creds are wired (or `[~]` if the actions can ship without it); S4 alongside P14.9.

### [STUB-058] P6.8 — Admin partner payouts detail (Slice 1 read-only; Slices 2+ deferred)
- Phase: Phase 6 (Royalty + payouts deep) — P6.8 Slice 1 ships the read-only per-partner admin view; P6.8 Slices 2+ ship the action surface (force-adjust + clawback + per-partner batch)
- Why: P6.8 Slice 1 ships (a) `getAdminPartnerPayouts` query (service-role read of `partners` + `profiles` + `payout_ledger` + `payout_requests` for ONE partner; 3 sequential rounds — Round 1 partner row drives the 404, Round 2 = 8 parallel reads via Promise.all, Round 3 = mapping), (b) `<AdminPartnerPayouts>` RSC composing hero + summary cards + ledger list + payout requests list (all token-only, `data-*` attribute selectors, no inline colors), (c) `/admin/payouts/partner/[id]` route (RSC + AdminShell + `notFound()` short-circuit + hardlinked loading skeleton), (d) `<PayoutRequestRow>` exported from `PayoutRequestQueue.tsx` + partner name now a `<Link>` to the new detail page. Slice 1 is end-to-end functional (the admin sees a partner's full payout history + summary stats; can drill in from the queue). The write-side actions (force-adjust + clawback) and the per-partner "Trigger manual batch" modal are deferred because (a) they require atomic-insert-not-update discipline on the ledger (the append-only invariant), (b) they require a typed-confirmation modal + audit-logged writes, (c) the per-partner batch modal needs the P6.7 Slice 3 PayPal Mass Payout integration (gated on creds). 24 unit tests in `getAdminPartnerPayouts.test.ts` cover auth / input validation / partner-row 404 / happy-path / defensive mapping / DB-error fail-soft / PII safety.
- What's missing: (a) **`forceAdjustAction` server action** — auth-gated admin-only, takes `{ ledgerEntryId, amountCents, reason }` Zod-validated inputs, INSERTS a new `adjustment` row in `payout_ledger` (NEVER UPDATEs the original — per the ledger append-only invariant), audit row `action='ledger_force_adjust'` with `before/after` JSON + hashed actor_email + hashed IP + the original entry id. (b) **`clawbackAction` server action** — similar shape, INSERTS a negative `clawback` row + flips the source to `status='void'` where appropriate (refunds follow the onRefund trigger pattern). (c) **Per-partner "Trigger manual batch" modal** — surfaces all `payout_requests.status='approved'` rows for this partner, typed-confirmation ("type TRIGGER" per the admin-payouts spec), calls PayPal Mass Payout API + atomic UPDATE on the rows (mirrors the P6.7 Slice 3 surface). (d) **Per-partner pagination UI** — the keyset cursor (`beforeId`) is already supported by the underlying queries; Slice 1 ships 50-row default; Slice 2 UI adds "Load more" if/when a partner's history exceeds 50 rows. (e) **Email notifications** — "your payout was force-adjusted" / "your payout was clawed back" emails to the partner (Phase 17 territory, STUB-022). (f) **Per-admin rate-limit** — spec calls for "max 5 force-adjusts per admin per day" (spec §"Security"). Wire into the action via the `00-foundations/auth/rate-limit.ts` Supabase-backed table when P18.8 ships.
- Resolution path: ~1-2 ticks (S2: force-adjust + clawback server actions + audit-logged writes + the typed-confirmation modal; S3: per-partner "Trigger manual batch" modal + PayPal Mass Payout integration gated on creds; S4: email notifications + rate-limit polish alongside P18.8).
- Blocker: (a) PayPal live account creds unblock the per-partner batch modal (none of the read/force-adjust/clawback work is blocked — the actions can ship without PayPal and gate on `PAYPAL_CLIENT_ID` being present). (b) Email notifications are Phase 17 territory (blocker is the email template + Resend integration, not P6.8 itself).
- Owner: Mavis (cron)
- Created: 2026-06-26
- Will ship by: S2 in 1-2 ticks; S3 when PayPal creds are wired (or `[~]` if the actions can ship without PayPal).

### [STUB-059] P6.9 — RESOLVED: Refund ledger row currency hardcoded to USD
- Phase: Phase 6 (Royalty + payouts deep) — P6.9 cycle fix
- **RESOLVED 2026-06-26**: `onRefund.ts` was updated to read `order.currency` (the order row now includes `currency` in the initial select at line 50) and propagate it to every refund ledger row. Multi-currency catalogs (EUR/GBP) now produce correctly-tagged refund rows. New test in `onRefund.test.ts` "refund ledger row currency is propagated from order.currency (EUR stays EUR)" asserts the EUR propagation. The onPaymentSucceeded handler already had this right (order.currency flows to the ledger row). See docs/ROYALTY-ENGINE-AUDIT.md §3 Bug #2 for the original analysis.

### [STUB-060] P6.9 — RESOLVED: Partial refund over-claws-back partner
- Phase: Phase 6 (Royalty + payouts deep) — P6.9 cycle fix
- **RESOLVED 2026-06-26**: `onRefund.ts` was updated to use the new `calculateRefundRoyalty(saleRoyaltyCents, orderTotalCents, refundAmountCents)` helper in `00-foundations/money/cents.ts`. The helper computes the proportional refund royalty with floor semantics and clamps at the full sale royalty (never over-claw a partner). A 50% partial refund on a $100 order (royalty $15) now claws back $7.50 (was the full $15). ADR-0009 documents the invariant. New tests in `onRefund.test.ts` "proportional refund math" suite cover 50%/25%/clamp cases. See docs/ROYALTY-ENGINE-AUDIT.md §3 Bug #1.

### [STUB-061] RESOLVED: No `charge.dispute.created` / `charge.dispute.closed` webhook handler
- Phase: Phase 14 (Admin console) + Phase 6 (Royalty + payouts) — blocked Stripe live
- **RESOLVED 2026-07-03** (Stripe-live hardening pass): `02-features/checkout/actions/onDispute.ts`
  adds `onDisputeCreated` + `onDisputeClosed`, wired into
  `04-platform/webhooks/stripe/handleStripeWebhook.ts` for
  `charge.dispute.created` / `charge.dispute.closed`.
  `onDisputeCreated` freezes any not-yet-paid-out `payout_ledger` row
  for the order (`status` in `('locked','available')` → `'pending_dispute'`).
  `onDisputeClosed` with `status='won'` reverts `'pending_dispute'`
  rows back to `'available'`; with `status='lost'` it voids the
  not-yet-paid-out rows and writes ONE negative `payout_ledger` row
  per `order_item` (`kind='dispute'`, `amount_cents=-royalty_cents`,
  full clawback, using the SAME `royalty_cents`/`royalty_pct_bps`
  snapshot from `order_items` the original sale row used — never
  re-derived from the live partner rate, matching the `onRefund.ts` /
  ADR-0009 snapshot invariant). Idempotent via a check for an existing
  `kind='dispute'` row on the order. Both handlers write an
  `admin_audit_log` row (system actor). Migration
  `04-platform/migrations/0072_payout_ledger_dispute_enums.sql` adds
  the `payout_ledger_status` value `'pending_dispute'` and the
  `payout_ledger_kind` value `'dispute'`. Tests: `onDispute.test.ts`
  covers freeze/unfreeze/clawback/idempotency/error paths. Stripe
  Dashboard webhook config for `charge.dispute.*` is still a human
  step (Klaas) — the handler no-ops until subscribed, same as any
  other event type we don't receive.
- Owner: Mavis (cron)
- Created: 2026-06-26

### [STUB-062] RESOLVED: Partial grant/ledger insert failure on payment success is silently dropped
- Phase: Phase 4 (Cart + checkout) + Phase 6 (Royalty + payouts) — affected partner pay
- **RESOLVED 2026-07-03** (Stripe-live hardening pass): chose the
  atomic-transaction option over the retry-then-flip option. New RPC
  `mark_order_paid_and_grant` (`04-platform/migrations/0070_atomic_order_paid_rpc.sql`)
  does the order UPDATE (`status='paid'`) + every `library_grants`
  INSERT + every `payout_ledger` INSERT inside ONE Postgres function
  body, which Postgres runs as a single transaction. If ANY statement
  raises — including a `payout_ledger` insert hitting a constraint
  violation — the WHOLE transaction rolls back, including the
  `status='paid'` flip. `02-features/checkout/actions/onPaymentSucceeded.ts`
  now calls this RPC instead of looping `order_items` in Node with
  separate inserts; on RPC error it returns `{ ok: false }`, which
  makes `handleStripeWebhook.ts` release the `processed_webhooks`
  claim and return 500 so Stripe retries — and because the RPC rolled
  back, the retry re-attempts the FULL fulfillment from a clean
  `awaiting_payment` state (there is no partial-write state to
  reconcile). The RPC is re-entrant: if the order is already
  `paid`/`fulfilled` it returns `already_paid=true` and writes
  nothing; `library_grants` inserts use `on conflict do nothing`.
  Test: `onPaymentSucceeded.test.ts` "STUB-062: RPC failure is NOT
  silently swallowed" reproduces the ledger-write-failure path (RPC
  returns an error) and asserts the handler returns `ok:false` instead
  of the old always-`ok:true` behavior — the regression this stub
  existed to close.
- Owner: Mavis (cron)
- Created: 2026-06-26

### [STUB-063] RESOLVED: No payment-failure webhook handler (orders stuck in `awaiting_payment`)
- Phase: Phase 4 (Cart + checkout) — affected support overhead
- **RESOLVED 2026-07-03** (Stripe-live hardening pass): new
  `02-features/checkout/actions/onPaymentFailed.ts`, wired into
  `04-platform/webhooks/stripe/handleStripeWebhook.ts` for
  `payment_intent.payment_failed`, `checkout.session.expired`, and
  `checkout.session.async_payment_failed`. Looks up the order by
  `stripe_payment_intent_id` or `stripe_checkout_session_id`
  (whichever the event carries), no-ops idempotently if the order is
  already in a terminal status (`paid`/`fulfilled`/`refunded`/
  `partially_refunded`/`canceled`/`failed`/`fraudulent`), otherwise
  flips the order to `status='canceled'` + sets the new
  `canceled_at` column (`04-platform/migrations/0071_orders_canceled_at.sql`),
  reverts the user's `cart_items` rows for the order's products back
  to `status='active'`, and writes an `admin_audit_log` row
  (`action='order_payment_failed'`). Test: `onPaymentFailed.test.ts`
  covers order resolution by both identifiers, the terminal-state
  no-op, the cancel + cart-release writes, and the update-failure /
  audit-best-effort paths. Stripe Dashboard webhook subscription for
  these event types is still a human step (Klaas) — code path is
  ready and no-ops until subscribed.
- Owner: Mavis (cron)
- Created: 2026-06-26

### [STUB-064] P8.1 — Re-subscribe after cancel hits `subscriptions.user_id` UNIQUE constraint
- Phase: Phase 5 (Subscriptions) — affects returning subscriber flow
- Why: `02-features/subscriptions/actions/onSubscriptionEvent.ts:96-100` upserts with `onConflict: 'stripe_subscription_id'`. The `subscriptions` table has TWO unique indexes: a partial unique on `stripe_subscription_id WHERE stripe_subscription_id IS NOT NULL` AND a full unique on `user_id` (migration 0002 line 36). When a user cancels and re-subscribes, the new Stripe subscription gets a fresh `sub_*` id; the upsert's `onConflict: 'stripe_subscription_id'` doesn't catch the `user_id` collision, so the INSERT fails with `duplicate key value violates unique constraint "subscriptions_user_unique"`. The bug doesn't fire without a real re-subscribe cycle (cancel + wait for period end + new checkout); Phase 5 ships a single-subscription-per-user invariant that the upsert doesn't actually enforce on re-subscribe. Discovered during P8.1 review while tracing the upsert path through to the `user_id` constraint.
- What's missing: Switch `upsertFromSub`'s `onConflict` from `'stripe_subscription_id'` to `'user_id'`. The semantic is "one user → one subscription row, last-write-wins on the local row." When the new webhook arrives, the upsert finds the existing row by `user_id` and updates it in place (including the new `stripe_subscription_id`, `status`, `current_period_*`, etc.). The partial unique on `stripe_subscription_id` stays as a defense-in-depth idempotency guard for race conditions where the same Stripe subscription fires twice in flight (Postgres treats the partial unique as a no-op when the column is null, so it never conflicts with the user_id one).
- Resolution path: 1-line code change in `onSubscriptionEvent.ts:98` + 1 unit test update in `onSubscriptionEvent.test.ts` (the existing "idempotency" test currently asserts `onConflict: 'stripe_subscription_id'`; flip to `'user_id'` and assert the second call's status is reflected in the upserted row, which is the same assertion — the existing test still passes with the new conflict target). Estimated ≤ 0.5 tick once the fix is picked up.
- Blocker: Live Stripe account to verify the re-subscribe cycle (the bug is invisible without one). Code change is safe to ship without it — the change is purely a `onConflict` parameter swap and doesn't alter the SQL statement otherwise.
- Owner: Mavis (cron)
- Created: 2026-06-26
- Will ship by: P5.x close-out or before the Stripe live cutover (whichever comes first).

### [STUB-065] P8.3 — Partner/admin UI to flip the `subscriber_only` flag is not yet shipped
- Phase: Phase 8 (Subscriptions × library integration) + Phase 14 (Admin console) — blocks full P8.3 lifecycle
- Why: P8.3 Slice 1 ships the schema (`products.subscriber_only` column, migration 0032), the PDP upgrade CTA (non-subscriber sees an orange `SubscriberOnlyUpgradeCard` with "See Personal Access" CTA + "Already subscribed? Sign in" link for anon), and the server-side gate in `addToCartAction` (auth branch + anon branch both refuse to add a subscriber-only product without an active subscription via the `has_active_subscription` RPC from 0002). What it does NOT ship: the partner-facing or admin-facing UI to toggle the flag on a product. Today, the only way to flip `subscriber_only = true` on a product is a direct DB UPDATE (or a future Supabase Studio edit). Slice 1 is a complete end-to-end read path (product → query → UI → gate) but lacks the write path for the partner or admin.
- What's missing: (a) **Admin product editor** — `/admin/products/[id]/edit` route (new page; P14 territory) with a "Subscriber-only" toggle in the product settings section. Toggles the column via a `setProductSubscriberOnlyAction` server action (admin-only, audit-logged via `admin_audit_log` with `action='product_subscriber_only_updated'` + before/after JSON + hashed actor email + product_id). The admin UI surfaces the toggle alongside the existing `status` editor + category + pricing + curriculum. (b) **Partner course settings** — Phase 12 P12.6 ("Course detail 5-tab — Curriculum / Pricing / Sales / Reviews / Settings") owns the partner's per-product editor. The Settings tab would gain a "Subscriber-only content" toggle that mirrors the admin's. The toggle is gated by partner role (only the partner who owns the product can flip their own product's flag; admin can override on any product). Same `setProductSubscriberOnlyAction` shape — partner and admin share the action. (c) **Catalog badge** — once partners/admins can flip the flag, the catalog surfaces a small "Subscriber-only" pill on `ProductCard` + `BundleCard` for products where `subscriber_only = true`. Mirrors the P8.2 "Included with Personal Access" pill shape but uses orange DNA (inverse semantic). Slice 3 — catalog UI. (d) **Catalog filter** — `/browse?subscriber_only=true` filter chip to surface only subscriber-only products (for users comparing their subscription value). Slice 3.
- Resolution path: 2-3 ticks total. Slice 2 = admin toggle (P14 territory — admin/products route + admin-side toggle action). Slice 3 = partner toggle (P12.6 territory — partner course settings) + catalog badge + catalog filter. Both Slices share the same `setProductSubscriberOnlyAction` server action + the same audit log shape.
- Blocker: Phase 14 admin console hasn't started (P14 is fully `[ ]`). Phase 12 partner portal also hasn't started (P12 is fully `[ ]`). Slice 1 ships the read path + the gate without needing either of those phases — a partner/admin can flip the flag via direct DB while the UI catches up.
- Owner: Mavis (cron)
- Created: 2026-06-26
- Will ship by: Slice 2 in P14 (admin console, likely 2-3 phases from now); Slice 3 in P12.6 (partner course detail) — re-evaluate after P14 kicks off.

### [STUB-066] P7.2 — Lessons + certificate surfaces on /library/[slug] are placeholders
- Phase: Phase 15 (LMS) — blocks the "re-watch" + "certificate" features on the per-product library page
- Why: P7.2 Slice 1 ships the route + access gate + product header + per-product file vault + sharing-prevention UI on `/library/[slug]`. Two of the four spec sections are placeholders because they need schema that doesn't exist yet: (a) **Re-watch / lessons section** — the spec calls for a per-product lesson list with prev/next nav, resume from `lesson_progress.position_seconds`, lesson notes, Q&A, resources. All of this needs the `lessons` table + `lesson_progress` table (P15.1) + the course player shell (P15.2). Today, the section renders a "Coming soon" badge with a "Watch the player demo" CTA to `/library/watch/demo` so users can still exercise the playback surface. (b) **Certificate section** — the spec calls for auto-issued completion certificates + a gallery + branded PDF. Today, the section renders a "Coming soon" badge with a 3-step explainer (finish lessons → auto-issue → download PDF) + a link to `/account/certificates`. Phase 9 P9.15 is the certificate gallery placeholder; the actual issuance + PDF generation lands in Phase 15 P15.11 + P15.12 + P15.13 + P15.14.
- What's missing: (a) Lessons section → real lesson list (P15.2) with auto-resume + bookmarks + Q&A + per-lesson notes + resources (P15.4–P15.8). (b) Certificate section → completion-trigger + auto-issue server action (P15.11) + signed PDF download (P15.14) + public verify route (P15.13) + the existing `/account/certificates` placeholder becomes the real gallery (P15.12). When P15 lands, both placeholder components swap to the real implementations — the page route doesn't change.
- Resolution path: The two placeholder components (`LibraryProductLessons.tsx` + `LibraryProductCertificate.tsx`) are intentionally shaped so the swap is a no-op for the page route. When P15.1 (lessons table + RLS) lands, the lessons component gains `getLessonsForProduct` + the auto-resume seek + the lesson nav. When P15.11 lands, the certificate component gains the "issued / in-progress / not-yet" states + the download link. Estimated ≤ 1 tick to land each side once the underlying schema is in place.
- Blocker: Phase 15 LMS migration hasn't started (P15 is fully `[ ]`). The two placeholders are honest about that — the "Coming soon" badges + the explainer copy are the user-facing signal that the feature is on the way. No live-action bug here; users can already watch the player demo + browse the cross-product file vault on `/library`.
- Owner: Mavis (cron)
- Created: 2026-06-26
- Will ship by: Phase 15 P15.1 + P15.2 (lessons) and P15.11 + P15.12 (certificates).

### [STUB-067] P7.5 — Resume streaming Slices 2+ deferred (lesson_progress wiring + range-proxy option)
- Phase: Phase 15 (LMS) + Phase 12 (Partner portal)
- Why: P7.5 ships in slices. **Slice 1 (this tick)** lands the URL-param resume surface: new `initialSeekSeconds?: number` prop on `<VideoPlayer>` + pure `parseResumeSeconds(raw)` helper (defensive URL hardening, 12h cap, 28 unit tests) + the `?t=<seconds>` URL param wired into `/library/watch/demo` with a "Resume at M:SS" hint banner + 5 example links covering happy/invalid/negative/empty/oversize paths. What Slice 1 does NOT ship (deferred to Slices 2+):
  - **(a) Real `lesson_progress` wiring** — the canonical resume target for the production `/library/watch/[lessonId]` page is `lesson_progress.position_seconds` (per `(user_id, lesson_id)`). The schema lands in Phase 15 P15.1. Once P15.1 + P15.2 ship, the watch page reads `lesson_progress.position_seconds` and passes it to `<VideoPlayer initialSeekSeconds>` — the prop surface stays the same; only the data source moves from `?t=` URL param to the DB row. P15.2 also wires the debounced `timeupdate` save (P15.4) so the next visit auto-resumes.
  - **(b) `?t=` fallback for un-started lessons** — when a user has no `lesson_progress` row yet but arrives with a `?t=` deep link, the production watch page should respect the URL param (matches YouTube / Vimeo behavior — shareable resume URLs work even for users who haven't started the lesson). Slice 1 ships the parser + prop; the priority logic ("DB first, URL second") lands with the P15.2 watch page.
  - **(c) Per-segment audit logging** — if a future abuse pattern emerges that requires logging every .ts segment request (not just manifest mints), Slice 3 could proxy segment requests through `/api/files/[id]/stream/range/[byteRange]/route.ts`. Bunny CDN's `Accept-Ranges: bytes` + `Content-Range` already works on the signed manifest URL today (`00-foundations/files/README.md` line 47 confirms Range requests survive token auth). The proxy is purely an optional observability layer; no spec calls for it today. Slice 3.
  - **(d) Bunny range-request smoke test** — the spec's "range request support" is satisfied by Bunny's native edge behavior. A staging smoke test (curl `Range: bytes=0-1023` against a signed HLS manifest URL, assert `206 Partial Content` + `Content-Range: bytes 0-1023/...`) is owed for the acceptance-criteria tickbox. ≤ 0.5 tick; lands the first time we have a real Bunny-signed URL in staging.
- What's missing: (a) production watch-page data source for `initialSeekSeconds` (P15.2), (b) URL-param fallback priority logic in P15.2's watch page, (c) optional per-segment audit-log proxy, (d) staging smoke test for Range support.
- Resolution path: (a) + (b) land together with P15.2 — the watch page reads `lesson_progress.position_seconds` (or `?t=` when no row exists) and passes to `<VideoPlayer initialSeekSeconds>`. The prop surface is stable. (c) is optional — only ships if the Phase 18 P18.7 observability needs it. (d) is a one-shot staging smoke — lands the next time a real Bunny URL is available in staging.
- Blocker: Phase 15 LMS migration hasn't started (P15 is fully `[ ]`). The URL-param surface is fully usable today via the demo route; the production wiring lands with P15.2.
- Owner: Mavis (cron)
- Created: 2026-06-26
- Will ship by: Slice 2 with Phase 15 P15.2; Slice 3 / (d) opportunistic (only if observability needs or staging Bunny available).

### [STUB-068] P7.10 — Partner-side self-service storage quota display deferred to Phase 12
- Phase: Phase 12 (Partner portal)
- Why: P7.10 ships the storage data + admin surface today (admin can see any partner's storage totals on `/admin/payouts/partner/[id]`). What it does NOT ship: the **partner's own** view of their storage on `/partner/courses` or a dedicated `/partner/storage` page. The partner dashboard hasn't been built yet — Phase 12 is fully `[ ]` (P12.4 "Dashboard refinements — KPIs + activity feed + earnings chart" is the natural home). The data foundation (`getPartnerStorageUsage` query) is RLS-friendly enough to be called from the partner context too — it just needs the auth gate to switch from `requireRole(['admin', 'super_admin'])` to `requirePartner()` + a partner-id lookup from the session, and a UI card on the partner's dashboard.
- What's missing: (a) Partner-facing `PartnerStorageCard` component (token-only CSS, "X GB across Y files in Z products" + top 3 products list + a soft quota-warning banner if usage exceeds some threshold — threshold needs a business decision, deferred to STUB-055). (b) Wire into `/partner/courses` (existing per-product revenue list, easy add) or a new `/partner/storage` page. (c) Per-file drill-down surface — a partner clicking a product in the breakdown list should land on the per-product file list (currently only admin can see this via the P6.8 admin detail). (d) Quota threshold + warning banner — admin needs to set "this partner has a 50 GB quota; warn at 80%" via the partner settings surface. Today's display is read-only total + breakdown; the warning banner needs the threshold.
- Resolution path: When P12.4 lands (estimated 1-2 ticks for the dashboard refinements), `PartnerStorageCard` becomes one of the KPI tiles alongside "Lifetime earned" + "Last 30 days" + "Available balance". The `getPartnerStorageUsage` query can be called from the partner context with the existing `requirePartner()` guard + `current_partner_id()` helper (from `00-foundations/auth/guards`) — the same shape as `getPartnerDashboardSummary` (P12.4's existing query). The admin surface stays on `/admin/payouts/partner/[id]`. The per-file drill-down surface (item c) can wait for Phase 15 LMS work or Phase 12 P12.8 (upload backend) — whichever surface lands first.
- Blocker: Phase 12 partner portal hasn't started (P12 is fully `[ ]`). The admin surface is fully usable today for ops visibility; the partner-facing surface lands when P12.4 ships.
- Owner: Mavis (cron)
- Created: 2026-06-26
- Will ship by: Phase 12 P12.4 (estimated 1-2 ticks once Phase 12 starts).

### [STUB-077] P9.2 — Avatar upload cropper is deferred (Slice 2)
- Phase: P9.2 Slice 2 (or a sub-agent slice once the library decision lands)
- Why: P9.2 Slice 1 ships the full upload pipeline (Bunny signed PUT + mime/size allowlist + 5MB cap + user-scoped path + audit row + the `AvatarUploader` client island + a 200x200 CSS `object-fit: cover` so any rectangular image renders as a clean square in the thumb). What Slice 1 explicitly does NOT ship: an interactive cropper that lets the user pan/zoom a non-square image before upload. The spec's open question
  (`01-specs/pages/account-profile.md:149`) names three candidates — `react-image-crop` (~15KB), `react-easy-crop` (~20KB), or a custom canvas-based one — and recommends `react-easy-crop`. The library decision + the dependency add + the toolbar design are pure Slice 2 work; deferring the cropper doesn't break the upload flow (any image gets uploaded as-is).
- What's missing: (a) Library pick (spec recommends `react-easy-crop` — awaiting human sign-off). (b) `package.json` dep add + the TipTap-style "image upload toolbar" piece. (c) The pan/zoom UX on `AvatarUploader` — pass the picked file to the cropper, capture the cropped Blob, then PUT that instead. (d) Per spec acceptance criterion 75 verbatim: "the cropper is square-aspect and the new image appears in the form and header within 1s of upload completion" — today the form renders the picked image at 1:1 via `object-fit: cover` so the displayed square is correct even without a cropper; the acceptance criterion is partially met (the "square-aspect" rendering) and fully met once the cropper lands (the source image is also square).
- Resolution path: A sub-agent or Slice-2 cron tick picks up after the library decision lands in the spec. The `AvatarUploader` interface stays stable (same `onUploaded` callback), so swapping the internals is a no-op for the parent form. Estimated ≤ 0.5 tick once the library is decided + added (no schema migration, no new env).
- Blocker: none for the data plane; the cosmetic Slice 2 waits on the library decision. Uploads work end-to-end today.
- Owner: Mavis (cron)
- Created: 2026-06-29
- Will ship by: P9.2 Slice 2 (≤ 1 tick after the library decision lands in `01-specs/pages/account-profile.md` open questions).

### [STUB-079] P9.7 v2 follow-ups — transactional-emails refactor + marketing segmentation
- Phase: P9.7 v2 (after Phase 17 Email system ships + Phase 9 P9.8 marketing segmentation is approved)
- Why: P9.7 ships the v2 notification_preferences schema (6 new cols + backfill + master + per-list + locked transactional). What's intentionally NOT shipped in this tick:
  - **(a) Transactional-emails refactor.** The 4 legacy transactional booleans (`order_updates_email`, `refund_updates_email`, `payout_updates_email`, `security_alerts_email`) stay as informational columns. When Phase 17 wires the SES adapter, transactional sends should read off the new `transactional_opt_in` column (the single source of truth). After Phase 17 is fully wired, a follow-up migration drops the 4 legacy booleans. Until then, the v2 schema and the legacy schema coexist — the UI only reads the v2 columns.
  - **(b) Per-product notifications.** "Notify me when a new product by partner X is published" is a v2 surface per `account-settings.md` §Out of scope. Schema needs a `notification_product_follows` table + a cron that fans out on new `products.status='published'` inserts. ≥ 1-2 ticks.
  - **(c) Granular marketing segmentation.** "Only send me product updates, not blog posts" is v2 per the same spec. The current Newsletter / Partner / Affiliate toggles are the only segmentation in v1. Adding blog / category / event segmentation requires new opt-in columns + UI + a content-categorization layer. ≥ 2 ticks.
- What's missing: (a) Phase 17 SES adapter + transactional sender (gates (a)). (b) New `notification_product_follows` table + RLS + cron. (c) New opt-in columns for granular marketing + admin surface to assign content categories. (d) The legacy transactional booleans need to stay until (a) lands — don't drop them in this PR.
- Resolution path: Phase 17's SES adapter ships first (gates transactional refactor). Then (a) is a 0.5-tick migration: drop the 4 legacy booleans + update the `transactional_emails` sender to read off `transactional_opt_in`. (b) and (c) are independent v2 features — file follow-up specs when their product fit is clearer.
- Blocker: Phase 17 (a) and product-side decisions for (b)/(c).
- Owner: Mavis (cron)
- Created: 2026-06-29
- Will ship by: Phase 17 lands → (a) drops in ≤ 0.5 tick. (b)/(c) deferred until product fit is clarified.

### [STUB-080] P9.8 v2 follow-ups — SMS / push / in-app notification channels
- Phase: P9.8 v2 (after product-side decision + push provider pick)
- Why: P9.8 as defined in PHASES.md covers "email/SMS/push opt-in per channel." P9.7 ships the **email** channel end-to-end (digest frequency + master + 3 per-list toggles in `notification_preferences`). The spec at `01-specs/pages/account-settings.md` line 71 explicitly defers SMS / push / in-app to v2: *"No notification channels other than email. SMS, push, in-app notifications are all v2."* This stub captures that v2 scope so the work doesn't get forgotten.
- What's missing for v2:
  - **(a) New `notification_preferences` columns** — `sms_opt_in`, `push_opt_in`, `in_app_opt_in` (plus per-list variants if product decides on per-list segmentation for non-email channels).
  - **(b) SMS provider integration** — Twilio vs AWS SNS vs Vonage decision. SMS send surfaces (Phase 17 SES adapter is email-only; SMS needs a separate adapter).
  - **(c) Web Push integration** — VAPID key generation, service-worker registration on the user's first visit (requires permission prompt UX), push subscription storage, push sender endpoint. Native mobile push (iOS APNs / Android FCM) is separate.
  - **(d) In-app notifications** — notifications inbox page + read/unread state + real-time delivery (Supabase Realtime channel + a `notifications` table). UI surface for the bell icon in the SiteHeader.
  - **(e) Settings page UI** — render the new channel toggles in `<SettingsForm>` (`02-features/account/profile/components/SettingsForm.tsx`). The current form only renders the email channel — adding SMS/push/in-app needs the same master+per-list pattern.
  - **(f) Spec amendment** — `01-specs/pages/account-settings.md` was written for email-only. A v2 spec amendment is needed to define the SMS/push/in-app acceptance criteria.
- Resolution path: file a v2 spec amendment (gates the whole ticket), then build the columns + integrations + UI in ≤ 3-4 ticks. Provider decisions (Twilio vs SNS; VAPID hosting) gate the implementation; product-side UX decisions (which channels actually need per-list segmentation) gate the schema.
- Blocker: spec amendment + provider decisions.
- Owner: Mavis (cron) once spec lands.
- Created: 2026-06-29
- Will ship by: post-v2 spec amendment, ≤ 3-4 ticks after product/provider decisions.

### [STUB-081] P9.9 — Privacy controls (public profile toggle + data sharing opt-out + GPC respect) — BLOCKED on missing spec
- Phase: P9.9
- Why: PHASES.md P9.9 line says "Privacy controls — public profile + data sharing + GPC respect." Cron marked `docs/PROGRESS.md` P9.9 as `[!]` on 2026-06-29 because **the spec does not cover this scope**. Verified by cron: (a) `grep "^### P9" 01-specs/pages/account-settings.md` returns only P9.7 / P9.6 / P9.8 — no §P9.9 section; (b) `grep -i "public profile|data sharing|GPC"` across `01-specs/` returns 0 hits; (c) `docs/_data-model.md` has no `public_profile` / `data_sharing` / `gpc` fields; (d) no migration adds any of those columns. The existing "Privacy" section in `account-settings.md` lines 9 + 26-27 only covers the "Download my data" CTA + "Delete account" CTA (both P9.16 / P9.17 territory). AGENTS.md rule #5 forbids code without an approved spec.
- What's missing for the spec:
  - **(a) Public profile visibility toggle** — surfaces it gates: affiliate minishop `/[handle]` (P13.8), partner public profile (P12.17), public instructor bio on PDP (P0.12 sidebar). Field name TBD (`profiles.is_public` is the obvious choice). Default value TBD (opt-in per GDPR data-minimization, opt-out per UX-convenience). Owner-action when private: 404 vs auth-gated redirect vs "this profile is private" placeholder — needs design call.
  - **(b) Data sharing opt-out** — CCPA "Do Not Sell or Share My Personal Information" + GDPR Art. 21 right to object. Scope TBD: all sharing off vs per-recipient (Gorse / PostHog / Sentry / Bunny / Stripe / Supabase). UI placement: separate toggle on settings page, or part of the existing marketing-master switch (P9.7's `marketing_opt_in=false` already covers email; the data-sharing scope is broader). Audit row required (CCPA disclosure obligation).
  - **(c) GPC respect** — read `Sec-GPC: 1` request header per the Global Privacy Control spec (W3C TAG draft, CA AB-302, CO CPA). Auto-effects when header present: `marketing_opt_in=false` + analytics suppression + data-sale opt-out (the third is what CA enforcement has actually fined on). Needs middleware or RSC layout-level read of the header. Cookie consent banner (Phase 11 P11.1) interacts — GPC present should pre-check the "reject all" option.
  - **(d) Public surface de-indexing** — when a user toggles public profile off, do we add `noindex` to their existing public pages, or just 404 them? SEO impact: 404 loses backlink equity, noindex preserves it. Needs product call.
- Resolution path: write/approve a §P9.9 section in `01-specs/pages/account-settings.md` (gates the whole ticket). Once spec lands, implementation is ≤ 1-2 ticks (migration + 1 server action + 1 RSC card + GPC middleware read + audit-row wiring).
- Blocker: spec amendment.
- Owner: Klaas (spec) → Mavis (cron) once spec lands.
- Created: 2026-06-29
- Will ship by: post-spec-amendment, ≤ 1-2 ticks.

### [STUB-083] P9.14 — Review photo upload is not implemented on /account/reviews
- Phase: PH18 (email + storage infra) OR a follow-up P9.14 Slice 2 once
  the Bunny signed-upload + EXIF-strip pipeline ships
- Why: The spec (`01-specs/pages/account-reviews.md` Security
  §"Photo upload validation") calls for an optional photo upload
  per review (jpg/png only, max 5MB, client-side + server-side
  re-validation, EXIF strip on the server, Bunny signed PUT URL
  storage in a private bucket that only the admin review page
  reads back via a server-rendered signed read URL).
  Today's `ReviewsSection.tsx` ships the review form with
  rating + title + body only — no photo uploader. The action
  (`reviewActions.ts`) does NOT accept or persist any image;
  no `reviews.photo_url` column exists, and no Bunny bucket
  is wired. The form's submit action also doesn't include a
  photo. The pre-flight (in `account-reviews.md` Security §"Photo
  column") flagged this open question and the v1 decision is to
  ship without photo upload rather than ship half a flow.
- Today: a user who wants to attach a screenshot to their
  review cannot — the form doesn't expose the uploader, and even
  if it did, the storage half isn't built. The public product
  page spec (`product.md`) describes a product-page thumbnail on
  the review row but never required the writer-side upload, so
  no public-facing surface is broken. The admin moderation queue
  also doesn't surface reviews photos today, so admin work isn't
  blocked.
- Resolution path: (a) ship a P9.14 Slice 2 cron tick that adds
  a `reviews.photo_url text` column (per STUB OPEN Q §1 in
  `account-reviews.md` line 126), wires the form's photo input
  with the same Bunny signed-PUT + EXIF-strip pattern already
  shipped on `/account/profile` per STUB-077 (and reused for
  `support_attachments` per STUB-009 if that lands first), and
  updates the admin review surface to read the photo through a
  signed read URL. The Bunny utility surface exists in
  `00-foundations/files/signed-upload.ts` (a v1 caller for the
  avatar path) — the follow-up extends the call site. (b) wire
  the admin-side preview in the same slice.
- Blocker: nothing on the human side. This is a pure
  implementation extension — a new Mongo-Form generator +
  server-side validation pipeline + tiny Bunny signed-PUT hook.
  It does NOT need a new migration window because the
  `photo_url` text column can land inside the same P9.14 Slice 2
  tick (or ride along with whichever small migration is next).
- Owner: Mavis (cron). Estimated: 1 tick (≤ 200 LOC +
  coverage in `02-features/account/profile/actions/
  reviewActions.test.ts` + 30-min visual smoke).
- Created: 2026-06-29
- Will ship by: next P9.14 follow-up slice, ≤ 1 cron tick.

### [STUB-084] P9.14 — 30-day edit-lock is not enforced on /account/reviews
- Phase: PH21 hardening wave OR a follow-up P9.14 Slice 2 once
  the lock-window + audit field design lands
- Why: The spec (`01-specs/pages/account-reviews.md` Security
  §"Edit lock window" + §"Status flow on edit") calls for a
  hard 30-day clock on review edits (a review older than 30 days
  cannot be edited; the server action returns 403) AND a
  `reviews.edit_count` column on the public product page
  (§ Open Q §2). Today's `reviewActions.ts` `updateReviewAction`
  does NOT consult `created_at` at all — any review, regardless
  of age, is editable. The `reviews.edit_count` column does not
  exist in the schema. The slice ships as-is to preserve the
  audit-ready row (the locked-out edit would be a deny with no
  side-effect anyway).
- Today: a user can edit a 5-year-old review and change a
  1-star to a 5-star with no friction. The impact is mostly
  integrity-of-history (a buyer review that an admin already
  approved can pivot from "I hated this" to "I love it now"
  without the admin seeing the change), plus the
  `reviews.helpful_count` and the moderation vote get re-anchored
  to a fresh `updated_at`. The public product page reflects the
  change immediately. The spec calls this out explicitly — "the
  30-day clock starts at created_at" — because late-stage rating
  inflation is the integrity threat the lock prevents.
- Resolution path: (a) add the check to `updateReviewAction`:
  read `created_at` from the matching row, compare to
  `now() - interval '30 days'`, return
  `{ ok: false, error: 'Reviews can only be edited within 30 days of submission.' }`
  if older. (b) write a `reviews.edit_count int default 0` migration
  + bump it in the action on every successful update that
  changes content (per the spec's "if only the photo changes,
  status is preserved" carve-out — the edit_count increment
  should be content-only too). (c) surface "edited N times" on
  the public product page using the new column.
- Blocker: needs a small `04-platform/migrations/<n>_reviews_
  edit_count.sql` file. Migration approval is cron-internal;
  the lock check itself is server-side and ships with the
  migration in the same slice. No human action required.
- Owner: Mavis (cron). Estimated: 1 tick (≤ 80 LOC + 8 new
  tests covering: edit < 30 days passes; edit 31 days old
  returns the lock error; edit 30 days old passes (boundary
  is inclusive per spec; spec is "older than 30 days");
  edit_count increments on content change but NOT on photo-
  only change; happy-path re-moderation still fires after
  the lock passes).
- Created: 2026-06-29
- Will ship by: PH21 or next P9.14 follow-up slice, ≤ 1 cron tick.

### [STUB-082] P9.12 — Refund form: form-side file input + emails + DB migration + admin_audit_log + 500-char server limit
- Phase: PH18 for emails; PH21 or next P9.12 follow-up slice for the rest
- Why: The verification slice (this tick) audited the shipped refund surface against `01-specs/pages/account-refund.md` §Acceptance criteria. 7 of 10 criteria are fully met; 3 partials are below. A parallel cron in the same workspace shipped idempotency-via-`client_request_id` + unique-violation race recovery + proof-path prefix guard + server-side filename sanitization — those are NO LONGER deferred (covered by the action's tests at `createRefundRequest.test.ts:587-787`). The remaining gaps:
  - **Criterion #5 / #6 part — form-side file input + DB columns**. The action now accepts `proof_path` + `proof_filename` from the call site, but the form (`RefundForm.tsx`) does NOT render a `<input type="file">` or `<RefundProofUploader>` client island. The DB columns `proof_path text`, `proof_filename text`, `client_request_id text unique partial` on `refunds` are owed (migration not yet written — verify against `0001_initial.sql:820-838` before writing).
  - **Criterion #7 — emails**. `createRefundRequestAction` still logs "emails not yet wired — PH18" (`createRefundRequest.ts:262`); no Resend call. The user gets the success page but no email. Per AGENTS.md the spec's two emails (`refund-requested-user` + `refund-requested-admin`) are gated on the email seam landing in PH18.
  - **Criterion #8 part — admin_audit_log + typed 429**. The in-process 5/24h bucket is enforced, but a denial does NOT write to `admin_audit_log` with `action='rate_limit_triggered'`. Server actions can't return HTTP status codes, so the 429 would surface as a typed result `{ ok: false, error: 'rate_limited', retryAfterMs: <number> }` — same shape as `logInvoiceDownloadAction`.
  - **Criterion #3 part — server-side 500-char notes limit**. The schema's `RefundRequestInput.notes` is `z.string().max(2000)`; the client truncates to 500 in the textarea. Direct callers (not the form) could submit 2000-char notes. The schema lives in `00-foundations/data/schemas.ts` (locked foundations layer) — touching it from this slice would be a foundations PR, not a feature slice.
- Blocker: 4 things in 2 phases. (a) PH18 lands the email templates (`refund-requested-user.tsx` + `refund-requested-admin.tsx`) + the Resend SDK wiring. (b) PH21 or a dedicated follow-up slice adds `0042_refunds_proof_path.sql` (proof_path + proof_filename + client_request_id unique partial index) + the form's `<FileUpload>` integration in `RefundForm.tsx` + the audit-log hook + the typed rate-limit result + the schema's notes ceiling 2000 → 500.
- Owner: Mavis (PH18 cron + next P9.12 follow-up slice).
- Spec vs code audit (current state — captured at end of P9.12 verification slice):
  - **#1** ✅ auth-gated + 404 on not-owned / not-paid / past-window / existing-refund (`getOrderForRefund.ts:30-57`).
  - **#2** ✅ summary + line items + eligible-until banner with amber when ≤ 2 days (`RefundForm.tsx:75-130`). Status is implicit (form only renders for `status='paid'`); an explicit badge would be nice-to-have but not a contract violation.
  - **#3** ✅ reason select (6 options matching the live schema) + 500-char client limit + reason required. The spec's "exactly 4" wording is stale — live schema has 6 reasons (`0001_initial.sql:825-828`).
  - **#4** ✅ full default + partial reveal + min/max on input + server Zod positive + server re-check against remaining (`createRefundRequest.ts:68-71`).
  - **#5** ❌ STUB (form-side file input owed; server-side mint + sanitize already shipped).
  - **#6** ⚠️ Partial — refund row insert correct (status='pending' per live schema; the spec's old 'requested' wording was stale). File path part owed → covered by #5.
  - **#7** ⚠️ Partial — the action returns `{ ok: true, refundId }` and the client redirects (`RefundForm.tsx:63`). Emails missing → STUB.
  - **#8** ⚠️ Partial — rate-limit bucket enforced + idempotency via `client_request_id` + unique-violation race recovery ALL SHIPPED. admin_audit_log row on denial + typed 429 surface owed → STUB.
  - **#9** ✅ reference, 2-business-day copy, 3-step explainer, both CTAs (`app/account/orders/[id]/refund/sent/page.tsx:69-110`).
  - **#10** ✅ no TODO/FIXME/XXX/HACK in the 4 refund files.
- Created: 2026-06-29
- Will ship by: PH18 for emails + Bunny; PH21 or dedicated follow-up slice for the rest. ≤ 2 cron ticks.

### [STUB-085] P9.16 — Data export (Art. 15) page is BLOCKED on spec scope conflict between PHASES.md and account-settings.md
- Phase: P9.16
- Why: Three sources of truth give three different answers, and AGENTS.md rule #5 forbids code without an approved spec. Verified by cron `mvs_3c0e61e93fad4ffa99a4b5af696bb7d3` (2026-06-29 13:30):
  - **(1) `PHASES.md:201`** says: *"`/account/data-export` page, assembles JSON from `profiles`, `orders`, `order_items`, `library_grants`, `reviews`, `subscriptions`, `notification_preferences`, `payout_ledger`, `audit_log`. Streams via signed URL. Rate-limited 3/day."*
  - **(2) `01-specs/pages/account-settings.md:90 + 121 + 183`** says: *"Download my data" is a button on `/account/settings`, rate-limited 1/hour, emails a signed link within 10 minutes, 7-day TTL, single-redeemable, written to a Bunny Storage path with a server-generated UUID filename.*
  - **(3) `00-foundations/gdpr/export.ts:381 + 510`** (already shipped) deliberately OMITS `payout_ledger` + `admin_audit_log` per the security rationale in the doc-strings — `payout_ledger` is partner-scoped financial data the user doesn't own; `admin_audit_log` is admin-internal per `_data-model.md` ("These are security-sensitive ... would help an attacker map their failed-attempt history").
  - No standalone spec file at `01-specs/pages/account-data-export.md` — `grep -l "data-export\|account-data-export" 01-specs/pages/` returns no hits.
  - Foundation is fully ready: `buildMyDataExport(supabase, userId, email)` covers 15 sections (profile / partner / affiliate / orders / order_items / subscriptions / library_grants / reviews / consent_log / notification_preferences / api_tokens / file_downloads / risk_signals / reports / partner_uploads / partner_onboarding_draft) with strict PII scrubbing (no token_hash, no ip_raw, no banned_by, no resolved_by); 28 unit tests in `export.test.ts`. The only gap is the page route + the rate limit + the audit-log writes + the signed-URL streaming (the README under `00-foundations/gdpr/README.md` sketches this and references P9.16 as the consumer).
- **What's missing for the spec** (four scope decisions Klaas needs to make before a single cron tick can ship this):
  - **(a) Delivery model:** synchronous download (`/account/data-export` page with a "Download your data" button → server builds JSON → `Content-Disposition: attachment` response; user gets the file now) vs async email-link (user clicks a button → server enqueues a job → email within 10 min with a 7-day signed URL). PHASES.md reads as synchronous; account-settings.md reads as async. RECOMMENDATION: **synchronous**, because (i) the bundle is bounded (15 sections × ~max 100 orders / 1000 grants for a 5-year account = a few MB max; well within response-body budgets), (ii) email-link delivery requires the email queue (Phase 17 territory, STUB-022) — blocking P9.16 on Phase 17 means it can't ship in Phase 9, and (iii) synchronous is simpler to test (one curl + assert content-type) and easier to audit (the audit log row happens at request time, not by a job runner).
  - **(b) Rate limit:** 3/day per PHASES.md vs 1/hour per account-settings.md. RECOMMENDATION: **3/day** (matches PHASES.md — the policy/source-of-truth file). The 1/hour figure in account-settings.md is a consequence of the async email-link model (you don't want a user spamming themselves with emails) and becomes irrelevant under synchronous delivery.
  - **(c) Content scope:** include `payout_ledger` + `admin_audit_log` per PHASES.md vs customer-PII-only per the shipped `export.ts`. RECOMMENDATION: **customer-PII-only** (match the shipped `export.ts`). The shipped rationale is sound: `payout_ledger` belongs to partners, not the customer; `admin_audit_log` contains admin-identity and security-telemetry surfaces the customer doesn't need to see. PHASES.md's enumeration of those tables appears to be a copy-paste from a wishlist of "everything we own" rather than a deliberate Art. 15 scope decision. A "Financial records within the 7-year retention window are NOT included" note in the export README + the privacy-policy already covers the disclosure (per `admin-customer-detail.md:45 + 102` which explicitly says "GDPR vs retention conflict — the export EXCLUDES financial records that are still within the 7-year retention window; those are redacted from the export but preserved in the system").
  - **(d) Route:** standalone `/account/data-export` per PHASES.md vs button on `/account/settings` per account-settings.md. RECOMMENDATION: **both** — standalone page is the canonical surface (and what `/account/settings` could link to). The "Privacy" card on `/account/settings` (currently deferred per STUB-081, STUB-P9.5 #4) gets a "Download your data" CTA that links to `/account/data-export`. The standalone page is auth-gated + has its own copy explaining Art. 15 + shows the last-3-exports list + the "Download" button. STUB-P9.5 #4 stays open until STUB-081 unblocks.
- **Resolution path:** the four decisions above unblock 1 cron tick (~4-6 hours of work): (1) write `01-specs/pages/account-data-export.md` covering the four decisions + acceptance criteria + matching the existing `account-profile.md` spec shape; (2) `02-features/account/data-export/page.tsx` RSC (auth-gated + reads `lastExports` + renders `<DataExportForm>` with the spec copy + the spec rate-limit behavior); (3) `02-features/account/data-export/components/DataExportForm.tsx` client island (rate-limit-aware button with cooldown copy + download trigger); (4) `02-features/account/data-export/actions/requestDataExport.ts` server action (Zod-validated input — empty FormData is the only expected input — calls `buildMyDataExport`, writes `gdpr_data_export_requested` + `gdpr_data_export_completed` audit rows, rate-limits via a new `02-features/account/data-export/rate-limit.ts` pure helper following the P6.3 CSV pattern — 3 per calendar day per user, sliding window of last-7-day bucket timestamps; (5) POST handler at `app/account/data-export/download/route.ts` that takes no body, calls the action, returns JSON with `Content-Disposition: attachment; filename="uthena-data-export-<YYYY-MM-DD>.json"`; (6) `00-foundations/gdpr/data-export.test.ts` extending the existing `export.test.ts` with the spec-recommended rate-limit + audit-log + request-shape tests. **Both the rate-limit helper + the page route must use the request-scoped Supabase client for reads (RLS on `admin_audit_log`) — service-role only for the `admin_audit_log` insert.** Estimated 1 cron tick.
- **Blocker:** (a) Klaas's answers on the four scope decisions above. (b) No new env or dependencies required. (c) No schema migration required (the audit-log table is already partitioned per P3.3 + the columns we'd insert into are already there). (d) The "Download my data" button on `/account/settings` Privacy card stays deferred per STUB-P9.5 #4 (gated on STUB-081 P9.9 privacy-controls).
- Owner: Klaas (spec) → Mavis (cron) once spec lands.
- Created: 2026-06-29
- Will ship by: post-spec-amendment, ≤ 1 cron tick.

### [STUB-086] P11.4 — Partner DPA template is BLOCKED on missing spec + 4 scope decisions
- Phase: P11.4
- Why: AGENTS.md rule #5 forbids code without an approved spec; verified by cron `mvs_88e56fb44e924edea82acbbd6cd71c09` (2026-06-29 20:00):
  - **`PHASES.md:447-448` is 2 lines**: *"P11.4 Partner DPA template — data-processing agreement for partners handling EU user data."* No acceptance criteria, no route, no schema, no UI surface, no audit-log shape — just a one-line wishlist entry.
  - **No spec file exists**: `ls 01-specs/pages/ | grep -iE "dpa|partner-dpa"` returns 0 hits. `find /Users/klaas/Documents/Uthena -type f -iname "*dpa*"` returns 0 hits outside `node_modules`.
  - **`01-specs/pages/_data-model.md:1808` explicitly constrains the design**: *"No DPA flow. Standard contract, not self-serve."* That single sentence rules out a `/partner/dpa` wizard — the DPA is a static legal template, not a partner-portal page.
  - **`docs/ARCHITECTURE.md:314` provides context but no spec**: *"DPA (Data Processing Agreement) for enterprise partners. Standard contract, signed in dashboard."* — static template, no spec.
  - **`05-ops/README.md:16` references a vendor DPA doc that's missing**: *"compliance/dpa.md — Data Processing Agreement status with vendors"*. The file doesn't exist (`ls 05-ops/compliance/` returns only `gdpr.md`). That's vendor-facing (Bunny / Stripe / PayPal / Resend — per `06-quality/checklists/security-audit.md:141`), not partner-facing — a separate concern.
  - **`05-ops/compliance/gdpr.md:110` confirms vendor DPAs are separate**: *"Data Processing Agreements (DPAs) — in place with each vendor"*. The partner-DPA is a different artifact (Uthena-as-controller Uthena-as-processor for partner-submitted PII like customer emails the partner uploads).
  - **`06-quality/checklists/security-audit.md:141`** lists the vendor DPA checkbox as still `[ ]` — confirming vendor DPAs are also not formally tracked (separate concern; out of scope for P11.4).
- **What's missing for the spec** (4 scope decisions Klaas needs to make):
  - **(a) Document model**: static markdown template at `04-platform/legal/partner-dpa.md` rendered via the existing `ProsePage` primitive (same surface that ships `/terms` + `/privacy` per P10.1), OR a hosted PDF (STUB-051 already blocks PDF libraries — `@react-pdf/renderer` is pending Klaas's approval for the invoice PDF; e-signature infra is much heavier), OR a `DocuSign` integration (out of scope; introduces vendor + cost)?
  - **(b) Where partners access it**: footer legal column ("Partner DPA" link next to "Terms" / "Privacy" / "DMCA" — recommended; lowest friction, matches the existing legal-footer pattern), OR `/partner/onboarding` Step 6 "accept the DPA" checkbox (which would require a `partner_dpa_accepted_at` column on `partners` + audit-log row), OR a gated `/partner/dpa` route behind `requirePartner()`?
  - **(c) Acceptance mechanism**: checkbox attestation on `/partner/onboarding` (audit-logged via `partner.partner_dpa_accepted` — adds schema migration + onboarding-step changes), OR e-signature flow (out of scope — STUB-051 blocks PDF/e-signature infra), OR no acceptance mechanism (template is reference-only; partners sign externally — the `_data-model.md:1808` "standard contract, not self-serve" line suggests this is the intended shape)?
  - **(d) Effective date + versioning**: single version pinned to launch (simplest — the template is hand-updated by Klaas on policy changes; old partners see the new template the next time they visit), OR versioned with `partner_dpa_accepted_version` column (so partners re-accept on update — requires schema migration + re-prompt UI + email campaign)?
- **RECOMMENDATION** (matches `_data-model.md:1808` constraint + the existing legal-page shape):
  - **(a) static markdown rendered via ProsePage** — same primitive that ships `/terms` + `/privacy` + `/dmca`; zero new deps; matches the project's "static legal doc + ISR 24h + JSON-LD WebPage" pattern.
  - **(b) footer legal column** — link from `app/layout.tsx`'s legal column to `/partner-dpa`; visible to ALL visitors (buyers + partners + anon), not just partners — partner-DPAs are public artifacts in standard practice (GDPR Art. 28 contracts are between controllers and processors, but the partner-facing version of the DPA is typically published on the controller's site).
  - **(c) no acceptance mechanism** — template is reference-only; partners sign externally. Matches `_data-model.md:1808` "standard contract, not self-serve" — the DPA is a SALES artifact (signed during partner sales conversations, not at portal signup), not a product feature. Sales-track DPA acceptance in `admin_partners` notes / CRM, not in the partner-portal.
  - **(d) single version pinned to launch** — simplest shipping shape; no schema migration; template is hand-updated by Klaas on policy changes (with a `last_updated:` frontmatter + the existing P10.1 "Last updated …" badge).
- **Resolution path** once Klaas answers the 4 questions: ≤ 1 cron tick (~2-3 hours):
  1. Write `01-specs/pages/partner-dpa.md` (matching the P10.1 spec shape — frontmatter + 4 sections + ~10-12 acceptance criteria + GDPR Art. 28 required-clauses checklist).
  2. Create `04-platform/legal/partner-dpa.md` — a static markdown template modeled on the published EU Standard Contractual Clauses + GDPR Art. 28 required clauses (subject matter / nature + purpose of processing / type of personal data / categories of data subjects / controller obligations / processor obligations / sub-processors / data subject rights / international transfers / breach notification / audit rights / termination). ~150-300 lines of legal text — Klaas-owned content (per the QWEN.md rule "the agent renders, not drafts, legal text").
  3. New `app/partner-dpa/page.tsx` RSC + `app/partner-dpa/page.module.css` — calls `getLegalFrontmatter('partner-dpa')` + renders via `ProsePage` (same primitive that ships `/terms` + `/privacy` + `/dmca`).
  4. Wire a footer link from `app/layout.tsx`'s legal column to `/partner-dpa`.
  5. JSON-LD `WebPage` schema + `buildPageMetadata` OG/Twitter Card meta.
  6. ISR 24h via the existing `export const revalidate = 86400` convention.
- **Blocker**: (a) Klaas's answers on the 4 scope decisions above. (b) No new env or dependencies required. (c) No schema migration required under the recommendation. (d) If Klaas picks `(c) checkbox attestation` or `(d) versioned`, that's a 2-3 tick build instead of 1. (e) **The vendor DPAs (Bunny / Stripe / PayPal / Resend)** tracked separately in `06-quality/checklists/security-audit.md:141` + the missing `05-ops/compliance/dpa.md` are out of scope for P11.4 — Klaas's domain per the README's "Drafting the legal text is not the agent's job" rule.
- Owner: Klaas (spec + legal text) → Mavis (cron) once spec lands.
- Created: 2026-06-29
- Will ship by: post-spec-amendment, ≤ 1 cron tick (under the recommendation); ≤ 2-3 ticks if Klaas picks a checkbox-attestation or versioned shape.

### [STUB-087] P11.5 — Cookie scanner is BLOCKED on missing spec + 5 scope decisions
- Phase: P11.5
- Why: AGENTS.md rule #5 forbids code without an approved spec; verified by cron `mvs_5a4d56b717f84a76a05b92c5b7ed9a97` (2026-06-29 20:30):
  - **`PHASES.md:449-450` is 2 lines**: *"P11.5 Cookie scanner — periodically scan the site for new cookies, alert admin of unclassified ones."* No acceptance criteria, no scan cadence, no alert channel, no admin UI surface, no schema for "classified cookies" vs "unclassified" — just a wishlist.
  - **No spec file exists**: `ls 01-specs/pages/ | grep -iE "cookie-scan|scanner|cookie-audit"` returns 0 hits. The only cookie-related spec is `cookie-preferences.md` (P11.1/P11.3 consent UI), which explicitly defers per-script classification to P11.5: *"Edit individual scripts. The page is per-category, not per-script. **P11.5 (cookie scanner) + the future admin tools own that surface.**"* (`cookie-preferences.md:55`).
  - **No schema for cookie classification** anywhere in `04-platform/migrations/`: grep across all migrations for `cookie_scan`, `cookie_audit`, `classified_cookies`, `cookie_alerts`, `cookie_registry` → 0 hits. The current privacy cookie table is hand-authored markdown prose in `04-platform/emails/legal/privacy.md` (§Cookies 4-column table per P10.2) — there is no DB row a scanner could "alert" against.
  - **No "classified cookie" registry concept anywhere**: `posthog.ts` and `consent.ts` know about 3 categories (essential / analytics / marketing), and `privacy.md:166-167` explicitly says *"Marketing category has no current vendor... cookie table lists `none at present`. When a marketing integration ships (P19.x), add the actual cookie names + vendor to this table."* — so we have 0 classified non-essential cookies at code-write time, and the only known analytics cookie is PostHog's (the privacy page names "Plausible / self-hosted PostHog" but no actual cookie name is recorded anywhere — `posthog-js` sets `_phc_*` cookies, but that string lives nowhere in the codebase).
  - **No admin-side alert surface spec'd**: a "alert admin of unclassified cookies" surface must land somewhere — neither `/admin` nor any Phase 14 (P14.x) admin task references cookie alerts. The closest analog is the admin_audit_log search UI in P14.18 ("filter by actor / event / date / PII-redacted") — but that's a search tool, not an alert inbox.
  - **No scan target defined**: a "cookie scanner" could mean (i) a HEADLESS BROWSER that crawls the site and reads `document.cookie` + network response `Set-Cookie` headers + classifies each by name (heavyweight — requires Puppeteer/Playwright + a cron runner); (ii) a STATIC ANALYSIS that greps `Set-Cookie` / `document.cookie` assignments in shipped JS (cheap, no infra); (iii) a HYBRID that maintains a registry of expected cookies + diffs observed vs registered (medium cost); (iv) "no scanner — manual quarterly review by the team" (zero cost, no spec needed but defeats the PHASES.md intent); (v) leaning on a THIRD-PARTY COOKIE AUDIT TOOL like Cookiebot / OneTrust / TrustArc (vendor cost + privacy implications for a privacy product).
- **What's missing for the spec** (5 scope decisions Klaas needs to make before a single line ships):
  - **(a) Scan mechanism**: (i) headless browser crawl (Playwright + a cron — heavy infra; needs P14.5 admin approval queue tooling as the cron host, or a new serverless function), (ii) static analysis grep on shipped JS bundles (cheap; runs in CI; misses 3rd-party-set cookies), (iii) hybrid registry + diff (medium; needs a registry + a runner), (iv) manual quarterly review only (zero infra; defeats the PHASES.md alert-the-admin intent), (v) third-party cookie-audit vendor (Cookiebot / OneTrust — vendor cost + privacy implications for a privacy product).
  - **(b) Cookie registry shape**: is "classified" a code-managed list (a `cookie_registry` table with `name`, `vendor`, `category` enum, `expires_at_hint`, `path` — filled by Klaas as new integrations ship) or an admin-managed table (same shape, edited via `/admin/cookies` with a CRUD form)? Code-managed = immutable, audited in git; admin-managed = zero-touch updates but loses audit trail. RECOMMENDATION: **admin-managed table** with one-time-classification audit log row (matches P14.12 platform-settings editor pattern from P10.4 — a single key-value store already exists).
  - **(c) Alert channel**: where does "unclassified cookie detected" surface? (i) `/admin/dashboard` banner widget with count + link, (ii) email to all `super_admin` users (needs the `platform_settings` email-from-name wiring from STUB-012 + Phase 17 email queue STUB-022), (iii) a new `/admin/cookie-alerts` inbox modeled on P14.10 admin payouts queue (chip-filtered list + per-row ack/dismiss + per-cookie-name "classify now" CTA), (iv) `admin_audit_log` row only + a PostHog dashboard (no UI surface — admin reads the audit log via P14.18 search). RECOMMENDATION: **(iii) `/admin/cookie-alerts` inbox** — most actionable for ops; pairs with the admin-managed registry in (b).
  - **(d) Scan cadence**: daily / weekly / monthly / on-deploy-via-CI / manual-trigger-only? The PHASES.md phrasing "periodically" is the only constraint. RECOMMENDATION: **weekly at low-traffic window** (Sunday 03:00 UTC) — matches the "running machine" instinct in the user's product goals and keeps infra cost minimal. CI-on-deploy is opt-in and can't catch 3rd-party cookies that fire outside the build.
  - **(e) Privacy posture**: a cookie scanner IS itself a privacy-adjacent surface — it observes cookies that may identify users. Does the scanner (i) run only on a sandboxed staging URL (recommended — no real-user cookies observed), (ii) run on prod but only against a synthetic test visitor session (cookie-less headless instance, no real PII captured), (iii) run on prod with a "no-cookie" mode that captures only cookie names + paths (no values), (iv) not run at all (covered by manual review)? RECOMMENDATION: **(iii) cookie-name + path + vendor inference only — never the value** — matches the existing `file_downloads.ip_hash` discipline.
- **RECOMMENDATION** (matches the current ops posture — code-managed is overkill for the actual problem):
  - **(a) static analysis grep in CI** — `Set-Cookie` / `document.cookie` / `localStorage` assignments in shipped JS bundles; fail the build on new unclassified cookies; pairs with a `cookie_registry.json` checked into the repo for the known set.
  - **(b) hybrid: code-managed `cookie_registry.json` + admin-managed overrides** — the JSON file is the source of truth for the CI gate; an admin table allows late-binding reclassification without a code push (for one-off cookie name changes from vendors).
  - **(c) `/admin/cookie-alerts` inbox + admin_audit_log row + PostHog dashboard tile** — three surfaces for three audiences; alerts are chip-filtered (new-this-week / unclassified / dismissed) with bulk-ack + per-row "classify now" CTA that drops a row into `cookie_registry`.
  - **(d) weekly Sunday 03:00 UTC scan via a new `02-features/admin/cookie-scanner/cron.ts` task** — registered with the P18.7 maintenance cron tick alongside `cleanup_old_admin_audit_log` + `cleanup_old_order_items` + `cleanup_old_payout_ledger`.
  - **(e) cookie-name + path + vendor only — never value + no prod-user session** — runs against the staging URL only.
- **Resolution path** once Klaas answers the 5 questions: ≤ 1-2 cron ticks (depends on whether static-only or hybrid):
  1. Write `01-specs/pages/admin-cookie-alerts.md` covering the chosen shape + acceptance criteria + the privacy posture (e); 8-12 acceptance criteria across the registry CRUD + the alert inbox + the CI grep + the audit-log row.
  2. **Static-only path** (≤ 1 cron tick): `04-platform/ci/scripts/scan-cookies.sh` (grep `Set-Cookie` / `document.cookie` / `localStorage` in shipped JS bundles + diff against `02-features/admin/cookie-scanner/cookie_registry.json`; exits non-zero on new unclassified) + new CI step in `.github/workflows/build.yml` + `cookie_registry.json` JSON file managed by Klaas + `/admin/cookie-alerts` inbox RSC + alert `POST` action + audit-log row.
  3. **Hybrid path** (≤ 2 cron ticks): static CI gate + new `cookie_registry` DB table (RLS-admin-only-write / public-read for the consent surface) + `/admin/cookies` CRUD for the registry + `/admin/cookie-alerts` inbox wired to both static AND cron-discovered unclassified cookies + the P18.7 cron tick.
- **Blocker**: (a) Klaas's answers on the 5 scope decisions above. (b) No vendor / external-API cost required (recommended path is entirely self-hosted). (c) No `STRIPE_*` or `BUNNY_*` creds needed; only the existing Supabase admin client. (d) If Klaas picks the **(a) headless browser** path, Puppeteer/Playwright becomes a new dep (~200 MB Docker layer or Playwright MCP server infra) — separate ASKs for that.
- **Why this STUB, not a build**: the user-facing principle from the project memory ("Klaas wants asks, not workarounds") is explicit: ASK when 5 scope decisions are pending, don't invent a path. The 4-decision STUB-086 (P11.4) shipped the same way one tick ago and is now filed for Klaas's review.
- Owner: Klaas (spec + scope decisions) → Mavis (cron) once spec lands.
- Created: 2026-06-29
- Will ship by: post-spec-amendment, ≤ 1 cron tick (static-only path); ≤ 2 cron ticks (hybrid path); ≤ 3-4 cron ticks (headless-browser path with new infra deps).

### [STUB-088] P11.6 — Consent log retention (24-month anonymize cron) is BLOCKED on missing spec for anonymize shape
- Phase: P11.6
- Why: AGENTS.md rule #5 forbids code without an approved spec; verified by cron `mvs_5a4d56b717f84a76a05b92c5b7ed9a97` (2026-06-29 20:30):
  - **`PHASES.md:451-452` is 2 lines**: *"P11.6 Consent log retention — 24 months, then anonymize to `(visitor_hash, granted_categories, timestamp)`."* No acceptance criteria, no cron cadence, no schema addendum, no audit-log shape — just a wishlist.
  - **No spec file exists**: `ls 01-specs/pages/ | grep -iE "consent.*retent|retention.*consent|consent-cleanup"` returns 0 hits. The P11.1/P11.2 + P11.3 specs mention retention only in passing (privacy policy's "Data retention summary" section cites `RETENTION_POLICIES.consent_log`).
  - **Half-implicit partial coverage already exists**: `00-foundations/gdpr/retention.ts:115-121` declares the policy — `consent_log: { label: 'Cookie consent log', days: 730, action: 'anonymize', rationale: '24-month retention per ePrivacy guidance — enough to defend a complaint in case of regulator inquiry.' }` — but it is **the constant only**, not the cron. The privacy-policy surface already renders this constant. What is MISSING: (i) an `expires_at` STORED column on `consent_log` (the table currently only has `created_at` — no `expires_at`, while `order_items` / `payout_ledger` / `admin_audit_log` got one in P3.3 / P3.5 / P3.3 respectively); (ii) the `cleanup_old_consent_log()` SECURITY DEFINER function that performs the actual anonymize transform; (iii) the P18.7 maintenance cron registration that calls it.
  - **The anonymize shape is underspecified**: PHASES.md lists the target columns as `(visitor_hash, granted_categories, timestamp)` — but the current `consent_log` schema is `(user_id, essential, analytics, marketing, ip_hash, user_agent, created_at)`. The transformation has 4 PII fields to handle (`user_id`, `ip_hash`, `user_agent`, plus the 3 individual category columns to collapse into 1) and the spec does not say which collapse / which gets dropped:
    - `user_id` — definitely must be nulled (it's the FK to `auth.users`, the most identifiable field).
    - `ip_hash` — if retained, must be re-hashed with a rotating salt so it can't be correlated with fresher consent_log rows. If dropped, we lose the ability to investigate "did visitor X complain in week Y?" — but the rationales says "enough to defend a complaint in case of regulator inquiry" which presupposes SOME visitor-correlation power.
    - `user_agent` — strongly suggests dropping (UA is rarely needed for compliance defense and contains device-identifying substrings).
    - `essential / analytics / marketing` (3 booleans) → `granted_categories` (1 text/array) — the spec literally says "granted_categories" so this collapse is explicit; the format (comma-list? `text[]`? JSONB array? `SET OF TEXT`?) is the missing decision.
  - **No `consent_log_admin_read` policy expansion spec'd**: the existing `is_admin()` SELECT policy in `0001_initial.sql:1105-1107` covers the post-anonymize rows because the anonymization keeps the row visible (just with redacted PII), but a SPEC clarification helps future maintainers know "anonymize = retain row shape minus PII, do not hard-delete".
  - **No GDPR Art. 17 / 5(1)(e) cross-reference**: the spec doesn't cite the ePrivacy Directive 2002/58/EC + GDPR Art. 5(1)(e) "no longer than necessary" constraint or the EDPB Guidelines 05/2020 §134 (consent withdrawal does not retroactively erase the consent record, but the record MUST be minimized). Klaas's domain per the QWEN.md rule on legal grounding.
- **What's missing for the spec** (4 scope decisions Klaas needs to make):
  - **(a) Anonymize transform shape** (the most consequential decision):
    - **Option A — "fully anonymize"**: drop `user_id` to NULL, drop `ip_hash` + `user_agent` to NULL (or DELETE the columns), collapse the 3 booleans into a single `granted_categories text[]` (Postgres `text[]` matching PHASES.md's shape). Final row: `(NULL, ['essential','analytics'], NULL, NULL, 2024-01-15 12:34:56+00)`. **Maximum GDPR-safety**, zero linkability to other tables (consent_log foreign-keys NOTHING).
    - **Option B — "rotating visitor_hash only"**: keep `user_id` AS some derived hash (e.g., SHA-256 of `(user_id || salt_for_month)` re-hashed monthly so cross-period correlation is broken), drop `ip_hash` + `user_agent`, collapse booleans into `granted_categories text[]`. Final row: `('v_3a8f…', ['essential'], NULL, NULL, ...)`. Same-period queries still work (you can ask "how many EU visitors consented in March 2024") but cross-month correlation doesn't. **Operational middle ground**.
    - **Option C — "drop identity, keep booleans as-is"**: NULL out `user_id` + `ip_hash` + `user_agent`, but DON'T collapse the booleans — keep `essential / analytics / marketing` as 3 columns. Final row: `(NULL, true, false, false, NULL, NULL, 2024-01-15 12:34:56+00)`. **Minimal schema change**, loses the PHASES.md "granted_categories" collapsing hint.
    - **Option D — "hard delete"**: just DELETE the rows, no anonymization. Opposite of `RETENTION_POLICIES.consent_log.action = 'anonymize'`. NOT recommended (the policy already says anonymize, and Klaas's spec explicitly chose anonymize).
    - RECOMMENDATION: **Option A** — fully drop identity fields, collapse booleans into `granted_categories text[]`. Matches the PHASES.md shape exactly, maximizes GDPR Art. 5(1)(e) compliance, makes future column-adds to consent_log non-breaking (additive migration).
  - **(b) Cron cadence + scheduling**:
    - **Daily 03:00 UTC** (heavy infra cost — runs every day, mostly no-op), OR
    - **Weekly Sunday 03:00 UTC** (matches the recommended P11.5 cadence; one DB scan per week; idempotent), OR
    - **Monthly 1st-of-month 04:00 UTC** (matches the `cleanup_old_admin_audit_log` P3.3 cadence; least cost), OR
    - **Lazy on-read** (no cron — `getConsentBannerState` writes a `consent_log` row as it would have anyway, then `getRetentionPolicy('consent_log')` is consulted by the data-export surface to redact expired rows; not a real cron, doesn't match P3.3 + P3.5 patterns).
    - RECOMMENDATION: **weekly Sunday 03:00 UTC** — same pattern as P11.5 recommendation; the P18.7 maintenance cron tick (which already calls `cleanup_old_admin_audit_log()` + `cleanup_old_order_items()` + `cleanup_old_payout_ledger()`) becomes the natural host.
  - **(c) Backfill behavior for already-old rows**: the table has been writing rows since launch. On the FIRST migration run, do we (i) anonymize everything older than 730 days (recommended — matches the policy retroactively), (ii) anonymize everything older than 730 days + log a single `admin_audit_log` row per affected row (heavy audit-log volume), (iii) leave existing rows untouched and only kick in for new rows written past T+1 (a softer compliance posture)? RECOMMENDATION: **(i) first-run anonymizes everything older than 730 days** + writes ONE summary `admin_audit_log` row (`action='retention_sweep', target_kind='consent_log', metadata={ rows_anonymized: N, cutoff_date: '...' }`) — matches the P3.3 + P3.5 pattern.
  - **(d) Admin surface to verify + opt-out**: do admins need a `/admin/consent-retention` page that (i) shows the cron schedule + last-run timestamp + total anonymized count + a "Run now (dry-run only, no writes)" button (recommended — pairs with P14.12 platform-settings editor surface), OR (ii) a toggle to PAUSE the cron without disabling the policy (ops can freeze cleanup during a regulator inquiry, like a litigation hold), OR (iii) no admin surface at all (rely on the existing P14.18 audit-log search + the P18.7 maintenance dashboard)? RECOMMENDATION: **(i) light admin card under `/admin/system` + (ii) pause toggle** — gives ops the soft-controls without adding a full admin route.
- **RECOMMENDATION summary** (matches the existing P3.3 + P3.5 retention-cron pattern):
  - **(a) Option A** (full anonymize: NULL identity, collapse booleans → `granted_categories text[]`).
  - **(b) weekly Sunday 03:00 UTC**, registered with the P18.7 maintenance cron.
  - **(c) first-run backfill + single summary audit row**.
  - **(d) `/admin/system` pause toggle + count card** (light surface; not a new admin route).
- **Resolution path** once Klaas answers the 4 questions: ≤ 1 cron tick (under the recommendation):
  1. Write `01-specs/pages/admin-consent-retention.md` (admin surface) + amend `01-specs/pages/cookie-preferences.md` (or write a new dedicated `01-specs/pages/consent-log-retention.md`) covering the cron transform + cadence + admin pause toggle + acceptance criteria.
  2. New migration `0038_consent_log_anonymize_columns.sql` (adds `granted_categories text[]` + `anonymized_at timestamptz` columns + RLS expansion keeping `consent_log_self_read` unchanged for live rows + an `is_anonymized()` helper function + a partial `consent_log_anonymized_idx` index on `(anonymized_at) WHERE anonymized_at IS NOT NULL` for the admin pause-toggle count query) + `cleanup_old_consent_log()` SECURITY DEFINER function performing Option A.
  3. New `00-foundations/gdpr/consent-log-retention.ts` PURE module — `getConsentLogRetentionPolicy()` + `isConsentLogAnonymized(row)` + `describeConsentLogAnonymize()` (doc helper for the admin surface + the privacy policy footer); thin wrapper around the existing `RETENTION_POLICIES.consent_log` constants.
  4. New `02-features/admin/consent-retention/queries/getConsentRetentionStatus.ts` (service-role read) + `getConsentRetentionStatusForAdmin.ts` (same query, admin-gated) + `<ConsentRetentionCard>` RSC for `/admin/system` (counts + last-run timestamp + pause toggle as a `<form action>`).
  5. Pause-toggle: new `02-features/admin/consent-retention/actions/setConsentRetentionPause.ts` (reads + writes `app_settings` `consent_log_retention_paused` boolean from P10.4 — reuses the same surface as `dmca_agent`) + audit-log row.
  6. P18.7 maintenance cron registration: amend `02-features/admin/maintenance/cron.ts` to call `cleanup_old_consent_log()` weekly on Sunday 03:00 UTC after `cleanup_old_payout_ledger()`. The pause-toggle is honored by the cron (early-return at the top of the function if `app_settings.consent_log_retention_paused = true`).
  7. Tests: `00-foundations/gdpr/consent-log-retention.test.ts` (pure logic) + `02-features/admin/consent-retention/queries/getConsentRetentionStatus.test.ts` + `02-features/admin/consent-retention/actions/setConsentRetentionPause.test.ts` + a `cleanup_old_consent_log()` migration unit test (assert the column set is preserved + booleans collapse correctly + identity fields NULL out).
  8. Spec amendments: add §"After 24 months" prose paragraph to `01-specs/pages/privacy.md` documenting the anonymize behavior (matches the existing "Data retention summary" discipline).
- **Blocker**: (a) Klaas's answers on the 4 scope decisions above. (b) No new env or dependencies required (the cron lives in the existing P18.7 maintenance cron task). (c) No new vendor / API integration. (d) The `app_settings` table from P10.4's STUB-009 resolution is reused — no schema migration for the pause toggle. (e) **Coupling with P11.5**: if P11.5 ships a `/admin/cookie-alerts` inbox (STUB-087), the consent-retention admin card should live on the same `/admin/system` page route for consistency — dependency is loose (either can ship first).
- **Why this STUB, not a build**: per the user-pref "Klaas wants asks, not workarounds", 4 scope decisions pending → 1 STUB. The cron code path itself is mechanical + follows the P3.3 + P3.5 pattern verbatim (STORED `expires_at` column + partial index + SECURITY DEFINER cleanup function + idempotent `create_partition`); only the anonymize shape is non-mechanical and needs Klaas's privacy-stance input.
- Owner: Klaas (spec + scope decisions) → Mavis (cron) once spec lands.
- Created: 2026-06-29
- Will ship by: post-spec-amendment, ≤ 1 cron tick (under the recommendation); ≤ 2 cron ticks if Klaas picks Option B (rotating visitor_hash) which requires a hashing-key rotation strategy in Doppler.


### [STUB-089] P12.1 — Partner onboarding wizard Slices 2-7 (per-step form bodies + atomic submit + restart)
- Phase: P12.1
- Slice: Slices 2-7 of the partner onboarding wizard (Slice 1 shipped 2026-06-29)
- Why a STUB, not a build: Slices 2-7 are deliberately deferred to spread the 7-step build across multiple cron ticks. The shell + welcome step + state dispatch + URL navigation + tests shipped this tick (P12.1 Slice 1).
- **What's owed per slice**:
  - **Slice 2** — `<ProfileStep>` + `saveProfileStepAction` server action (Zod: `display_name` 2-60 chars, `bio` ≤ 500, `website_url` SafeUrl nullable, `avatar_storage_path` nullable). Avatar upload pipeline: signed PUT to Bunny (`00-foundations/files/upload-constants.ts` already exists for avatars — extend to partner onboarding or share with P9.2). Profile pre-fill from `profiles.display_name` / `profiles.bio` / `profiles.avatar_url`. Saves update `partner_onboarding_drafts.payload.profile` + write to `profiles` for the avatar URL.
  - **Slice 3** — `<PayoutStep>` + `savePayoutStepAction` (Zod: PayPal email RFC 5322 + confirm-must-match server-side check). Saves update `partner_onboarding_drafts.payload.payout` ONLY (NOT `paypal_email_confirm` — UI-only per spec).
  - **Slice 4** — `<TaxStep>` + `saveTaxStepAction` (Zod: country dropdown defaulting to US, tax_id 9-digit for US, conditional `w9_storage_path` for US). Saves update `partner_onboarding_drafts.payload.tax`.
  - **Slice 5** — `<KycStep>` + `saveKycStepAction` (gov_id_front + gov_id_back, both MIME ∈ {jpeg,png,pdf}, ≤ 5MB each). **DEPENDENCY**: spec Open Question #1 recommends deferring KYC to v2 — ASK Klaas whether to skip this slice entirely.
  - **Slice 6** — `<AgreementStep>` + `saveAgreementStepAction` (TOS + DPA checkbox attestation; `tos_accepted` + `partner_agreement_accepted` booleans + `accepted_at` timestamp; "Submit application" disabled until both checked).
  - **Slice 7** — `<SubmitStep>` (summary view with masked PayPal email per spec line 22) + `submitApplicationAction` server action (atomic: INSERT `partners` with `status='pending'`, copy fields from draft, mark draft `submitted_at = now()`, idempotent — unique partial index `partners(user_id) WHERE status IN ('pending', 'approved')` + `ON CONFLICT DO NOTHING`; queue 2 emails via `04-platform/emails/partner-application-received.tsx` + `04-platform/emails/admin-new-partner-application.tsx` via Phase 17 SES adapter) + `<PartnerApplicationThanks>` RSC at `/partner/onboarding/thanks` + redirect. **DEPENDENCY**: spec Open Question #3 (suspended re-submission) requires either dropping the `partners.user_id` UNIQUE constraint or archiving suspended rows. Pending Klaas's decision.
  - **Restart** — `<RestartButton>` on `<WelcomeStep>` + `restartOnboardingAction` server action (DELETE the draft, never touches a `partners` row that already exists; confirmation modal using the existing `<ConfirmModal>` primitive if any).
- **Common cross-slice work**:
  - `02-features/partner-onboarding/actions/saveStep.ts` shared `saveStep(userId, step, payload)` server action template (Zod per-step discriminated union + upsert into `partner_onboarding_drafts` + rate-limit 60/min/user + audit-log row per save with `action='partner_onboarding.step_saved'`).
  - File upload pipeline (avatar, W-9, KYC gov IDs) goes through the existing `00-foundations/files/` canonical signed-URL helper — do NOT reinvent.
  - Per-step CSS modules colocated with the step component under `02-features/partner-onboarding/components/steps/`.
- **Open questions for Klaas** (carried from spec Open Questions #1 and #3):
  1. Should Slice 5 ship a real KYC step, or skip the step entirely per the spec's recommendation? (Decision unlocks ≤ 0.5 ticks of work either way.)
  2. Should suspended partners be able to re-onboard? If yes, ship the data-model change (drop `partners.user_id UNIQUE` OR add `partners_archive` table) alongside Slice 7. (Decision unlocks ≤ 0.25 ticks of work.)
  3. Should we ship the "Save & exit" + "Resume at any step" behaviors described in spec acceptance criterion 8 alongside Slice 7, or as a separate slice? (Decision barely affects scope — both are small.)
- **Resolution path**: each slice is ≤ 0.75 cron ticks under current complexity. 6 slices × 0.75 = ~4.5 ticks total. P12.2 (draft persistence — schema) is satisfied by the existing `0001_initial.sql` migration, so P12.2 can tick `[x]` as soon as Slice 1 lands. P12.3 (welcome + thanks pages) is split: welcome shipped in Slice 1, thanks ships in Slice 7.
- Created: 2026-06-29
- Will ship by: targeted ≤ 1 slice per cron tick after Klaas's 3-question batch.


### [STUB-090] P12.3 — `rejected` partner_status enum value (spec mismatch)
- Phase: P12.3
- Decision: deferred
- Why a STUB: `01-specs/pages/partner-onboarding-thanks.md:35` lists `partners.status IN ('rejected', 'suspended')` as the re-apply redirect set, but the `partner_status` enum in `04-platform/migrations/0001_initial.sql:52` is only `(pending, approved, suspended)` — `rejected` is NOT a valid enum value today. Treated `suspended` as the catch-all for the re-apply redirect path; the implementation is correct against the schema but doesn't match the spec's literal enum membership.
- **What's owed**: (a) either add `'rejected'` to the `partner_status` enum in a new migration (with `ALTER TYPE partner_status ADD VALUE 'rejected'` — idempotent on Postgres 12+, would need a follow-up migration if the same enum is altered again in the same transaction); (b) decide whether rejected partners get a re-apply flow distinct from suspended (the spec treats them identically but operators may want different handling — e.g. a rejected application might be appealed via support rather than re-submitted); (c) update the thanks-page dispatch to include the new state if Klaas wants the literal spec match.
- **Impact today**: zero — the thanks page correctly handles `suspended` and the `none` state already covers any data inconsistency (pending row without submitted draft fails closed to `{ kind: 'none' }`).
- **Open question for Klaas**: should `rejected` be added to the enum? If yes — also decide on the rejection-vs-suspension UX (separate rejection-appeal flow? or share the suspended re-apply flow?).
- **Resolution path**: ≤ 0.25 cron tick once Klaas decides — 1 SQL `ALTER TYPE` + 1 line change in the thanks-page dispatch + 1 new test case + 1 line change in `00-foundations/data/enums.ts` if a TypeScript enum mirror exists.
- Created: 2026-06-29
- Will ship by: when Klaas confirms the rejection-state scope.


### [STUB-093] P12.7 — `partner_upload_drafts` table + audit action (schema foundation shipped)
- Phase: P12.7
- Decision: deferred (Steps 2-5 of the wizard)
- Slice: Slice 1 of P12.7 shipped 2026-06-30 (schema + URL aliases + Stepper + Step 1 Details form + autosave); Slices 2-5 deferred.
- Migration: `04-platform/migrations/0040_partner_upload_drafts.sql` — new `partner_upload_drafts` table (1 row per user_id, payload jsonb for shallow-merge of per-step form state, status enum `partner_upload_draft_status` of `draft`/`submitted`/`withdrawn`, current_step + last_saved_step, submitted/reviewed/decision columns for admin moderation) + RLS (self_read / self_write / admin_all) + indexes (status_submitted partial for admin queue + user for partner list).
- Audit: added `'partner_upload.step_saved'` to `AuditAction` union + `AUDIT_ACTIONS` array + `'partner_upload_drafts'` to `SelfAuditInput.targetKind` union.
- **Why a NEW table, not `partner_uploads`**: the spec line 32 mentions `partner_uploads` but the existing `partner_uploads` table is the per-file Bunny tus + scan record table (0001_initial.sql line 1302). Conflating wizard state with file records would force every read to filter by a discriminator and break the file-upload pipeline's existing RLS. New table mirrors the `partner_onboarding_drafts` pattern. Architecture.md line 79 mentions `partner_uploads (partner_id, status, draft_payload jsonb, submitted_at, ...)` — that description matches a wizard draft, but the existing `partner_uploads` schema is per-file. The architecture doc was aspirational and never caught up with the per-file `partner_uploads` migration. Per AGENTS.md, migrations are append-only, so the right move is a new dedicated table. The spec's reference to `partner_uploads` is interpreted as "the wizard's persistence surface" — this is documented in the implementation notes of `01-specs/pages/instructor-upload.md`.
- **What's owed per slice**:
  - **Slice 2 — Curriculum step**: `<CurriculumStep>` + `saveCurriculumStepAction`. Modules + lessons editor reusing the P12.6 `product_modules` + `product_lessons` normalized tables (migration 0039). Replace-tree pattern on save (full curriculum re-derives display_order, never partial updates). Add/remove/reorder/drag via keyboard-accessible buttons (no HTML5 drag-and-drop in v1 per AGENTS.md accessibility). Curriculum tree persisted to `payload.curriculum` as JSONB-shaped data.
  - **Slice 3 — Files step**: `<FilesStep>` + `uploadFileAction`. Bunny tus direct uploads (P12.8 territory — see `04-platform/migrations/0001_initial.sql` `partner_uploads` table + the Bunny tus helper at `00-foundations/files/upload-constants.ts` once it lands). Per-file scan status indicator. 50GB per-course + 200GB per-partner caps (per spec Open Question #2 — pending Klaas's call). Files state persisted to `payload.files` as `{ video: [...], source: [...], sales: [...] }` with each entry referencing a `partner_uploads.id` for scan + storage metadata.
  - **Slice 4 — Pricing step**: `<PricingStep>` + `savePricingStepAction`. 3-tier license matrix reusing P12.6 `product_pricing` (which already has partner_read_own + partner_write_own RLS from 0001). PLR tier required + active; Whitelabel + PLR+MRR optional. Prices > 0. Persisted to `payload.pricing` as `{ whitelabel: {active, price_cents}, plr: {...}, plr_mrr: {...} }`.
  - **Slice 5 — Review step**: `<ReviewStep>` + `submitForReviewAction`. Live preview (the wizard's existing product_modules + product_lessons + product_pricing + product_files tables render exactly as the storefront would). Submission checklist (all required items green before the Submit button enables). Submit sets `status='submitted'`, writes `submitted_at = now()`, triggers an admin in-app notification (email per spec is Phase 17 territory — STUB-022).
  - **Slice 6 — Withdraw**: `<WithdrawButton>` on the submitted-draft page + `withdrawUploadAction`. Sets status back to 'draft', clears submitted_at. Allows the partner to edit + re-submit.
  - **Slice 7 — Live preview mirror**: server-rendered preview of the listing using the same components the storefront uses. Reuses the existing storefront renderer per the spec's "looks like the public product page" line.
  - **Cross-slice work**:
    - Right rail summary (spec line 22) — live counts: modules, lessons, total duration, files count, storage used, active pricing tiers. Each Slice ships its contribution.
    - Submission checklist (spec line 21 + acceptance criterion 77-79) — Slice 5 wires the aggregated state.
    - "Save & exit" + "Resume from any step" — Slice 5+; deferred for Slice 1 to keep the autosave loop simple.
- **Open questions for Klaas** (carried from the spec Open Questions):
  1. Per-upload PLR terms acceptance vs once-per-partner (spec Open Q #1) — Slice 5 implementation.
  2. Per-partner storage cap (spec Open Q #2 recommends 200GB) — Slice 3 implementation; default to 200GB if no answer by Slice 3 ship.
   3. Resumable upload library (spec Open Q #3 — tus.io vs Bunny built-in) — Slice 3 implementation.
   4. PHASES.md vs spec step order: PHASES.md §P12.7 says "Details → Pricing → Files → Review → Submit"; spec says "Details → Curriculum → Files → Pricing → Review". Resolved by following the spec — see implementation notes in `01-specs/pages/instructor-upload.md`.
- **Resolution path**: each Slice is ≤ 0.75 cron ticks under current complexity. 5 remaining Slices × 0.75 = ~3.75 ticks total.
- Created: 2026-06-30
- Will ship by: targeted ≤ 1 slice per cron tick after Klaas's Open Question batch.

### [STUB-094] P12.7 Slice 2 — Curriculum step deferred work (Curriculum step UI shipped 2026-06-30)
- Phase: P12.7
- Decision: deferred (Drag-drop reordering + right-rail summary + Continue/Submit validation gating + file-id attachments)
- Slice: Slice 2 of P12.7 shipped 2026-06-30 with the keyboard-accessible up/down buttons + the JSONB curriculum shape + Zod schema + autosave. Slice 2 is ship-ready as a single-step form. The below carve-outs are deliberate simplifications to keep Slice 2 under one cron tick of complexity.
- **What's owed (four slices of follow-up work)**:
  - **Drag-and-drop reordering** (future Slice 2.5 or absorbed into Slice 5). Slice 2 ships the `moveModuleById` / `moveLessonById` pure helpers + the up/down buttons — drag-and-drop is purely a UX extension reusing the same helpers (HTML5 DnD + Pointer Events). Keyboard-accessible buttons remain alongside for accessibility (AGENTS.md says "every interactive element is keyboard-accessible"). Estimated ≤ 0.5 cron tick once a UI library is picked (likely a small dependency or a 200-LOC custom hook).
  - **Right-rail summary widget** (spec line 22; "Right rail | live summary (title, category, modules count, lessons count, length, files count, storage used, pricing, checklist)"). Slice 2 exposes the `countLessons(modules)` + `totalLessonSeconds(modules)` pure helpers in the barrel; the widget itself needs every Slice's data (Files count + storage used → Slice 3; pricing tiers → Slice 4; checklist → Slice 5). Estimated ≤ 0.75 cron tick when Slice 5 lands.
  - **Continue / Submit validation gating** (spec AC line 72 "Step 2 validates: at least 1 module, each module has at least 1 lesson, each lesson has a title and duration > 0"). Slice 2's schema is intentionally permissive to allow partial-progress autosaves (the spec criterion line 79 requires "Drafts auto-save on every field change" — a partially-typed module title with no lessons yet must round-trip cleanly). The strict gating is the Slice 5 submit-for-review boundary's job (the spec line 78 "Submit button is disabled until all required items are green" lives entirely in Slice 5; Slice 2 ships the *data shape* + the field-level inputs, not the gate).
  - **Live-curriculum preview mirror in Step 5** (spec line 22 "Step 5 — Review | live preview of the listing"). Slice 2's tree renders directly into the JSONB column; Step 5's preview surface will subscribe to the same `payload.curriculum` + compose the storefront's Curriculum tab (`02-features/product/Curriculum.tsx`). Estimated ≤ 0.5 cron tick when Slice 5 ships.
  - **File-id attachment on lessons** (spec line 18 `lessons array with title, duration_seconds, file_id, is_preview`). Slice 2 deliberately omits `file_id` from the schema — partner can't attach Bunny uploads until Slice 3 (Files step). Slice 3 adds `lessons[i].file_id` references to `product_files.id` + the per-lesson "Pick a file" affordance. Slice 2's schema is forward-compatible (`LessonPayload` can grow `.optional().default(null) file_id` without breaking existing draft rows).
- **Open questions for Klaas**:
  1. (None open — Slice 2 ships a self-contained working surface; the deferred items above are explicit follow-ups not undetermined decisions.)
- **Resolution path**: drag-drop ≤ 0.5 tick; right-rail summary ≤ 0.75 tick (likely same tick as Slice 5); Continue/Submit gating is Slice 5's job; preview mirror is Slice 5's job; file-id attachment is Slice 3's job.
- Created: 2026-06-30
- Will ship by: drag-drop ≤ 1 tick after Slice 5 lands; right-rail / preview mirror / gating all in the Slice 5 tick.
- Created: 2026-06-30
- Will ship by: ≤ 1 slice per cron tick after Klaas's Open Question batch.

### [STUB-095] P12.8 — Partner upload backend (Slice 1 shipped 2026-06-30)
- Phase: P12.8
- Decision: deferred (Slices 2-4 owed: real Bunny HTTP mint + ClamAV scan trigger + actual bunny_video_id population + Files UI integration)
- Slice: Slice 1 of 5+ shipped 2026-06-30 — the data + status pipeline foundation. Migration 0041 + pure libs (upload-kinds / upload-pipeline-state / bunny-webhook-signature / bunny-webhook-payload) + `createPartnerFileUploadAction` + `setPartnerUploadFailedAction` + `getMyPartnerUploads` RSC query + `/api/webhooks/bunny` mount + `handleBunnyWebhook` handler. `partner_uploads.storage_path` + `failure_kind` + `webhook_received_at` columns + 2 covering indexes for the webhook's UPDATE traffic. Audit surface extended with 3 new `AuditAction` values + `UploadKind` + `FailureKind` enums in `enums.ts` + the ENUM-AUDIT.md row for the text CHECK. **60 new unit tests** across 6 files (all passing in isolation; full slice suite: 347/347 pass).
- **What's owed (four explicit follow-up slices)**:
  - **Slice 2 — Real Bunny HTTP mint** (the actual upload URLs):
    - For `kind=source` / `kind=sales_material`: mint a Bunny Storage PUT URL with HMAC signature + AccessKey query param (mirrors the P9.2 `requestAvatarUpload` pattern, but with a 1-hour TTL + per-kind path conventions).
    - For `kind=video`: mint a Bunny Stream tus session at `POST https://video.bunnycdn.com/tusupload` with `AuthorizationSignature` (HMAC) + `AuthorizationExpire` + `LibraryId` + `VideoId` headers per Bunny docs. The mint returns the tus upload URL the browser uses for chunked uploads.
    - Returns the URL envelope from `createPartnerFileUploadAction` (currently returns `uploadTarget: { kind: 'pending' }`). Sliced out until `BUNNY_STORAGE_*` / `BUNNY_STREAM_*` creds are confirmed in Doppler/Coolify.
    - Library decision: the existing `00-foundations/files/upload.ts` (avatar) and `00-foundations/files/signed-url.ts` (download/stream) show the mint pattern; reuse the HMAC key split rather than reimplementing.
    - Estimated ≤ 1 cron tick once creds land + the spec question is answered.
  - **Slice 3 — ClamAV scan trigger + Files UI integration**:
    - Hook the Bunny upload-complete webhook to call `00-foundations/files/scan.ts` (new file — the spec mentions it at `00-foundations/files/README.md` line 129 but it doesn't exist yet). The scan module: builds an HTTP call to a `CLAMAV_URL` (Doppler) that expects a `scan_url` parameter; surface via the existing `parseBunnyStorageEvent` → `scan_event` path.
    - Migrate the existing `partner_uploads.scan_status` defaults to `scan_status='pending'` + `scan_started_at = now()` BEFORE the scan fires, so the wizard's Submission Checklist (`spec §instructor-upload.md` line 21) can show a "Scanning…" state.
    - Build the P12.7 Slice 3 Files UI on top of the existing Slice 1's `getMyPartnerUploads` + `createPartnerFileUploadAction` + `setPartnerUploadFailedAction`. Drag/drop zone, per-row progress bar, replace/remove, the 5-row checklist.
  - **Slice 4 — Encoding-status wiring + bunny_video_id population**:
    - When `kind=video` + the createPartnerFileUploadAction calls the Bunny Stream tus mint, also write `bunny_video_id` to the row (currently always NULL). This is the link `handleBunnyWebhook`'s Stream branch needs to correlate a Bunny Stream event back to our row (currently a no-op logged at slice 1).
    - Add the per-course storage cap enforcement at the createPartnerFileUploadAction gate (the 50GB hard limit per course from `spec §instructor-upload.md` line 86 sums the size_bytes across all uploads for the draft).
  - **Slice 5 — wizard ↔ uploads binding column + submit checklist**:
    - Add a `partner_uploads.draft_id` FK column on the partner_uploads table (mirrors the `partner_upload_drafts.id`). Set on the create action (passing the user's draft). Lets `getMyPartnerUploads` filter by `?draftId=...` server-side rather than the Slice 1 advisory client-side filter.
    - Wire the wizard's Submission Checklist (Slice 5 of P12.7) to the Slice 1's `partnerUploadState()` + `partnerUploadStateIsReady()` so "Submit" stays disabled until every required file is `ready`. Reuse the typed `FailureKind` for the failure render in the wizard's per-file row.
- **Open questions for Klaas** (carried for Slice 2):
  1. CLAMAV_URL: where is ClamAV hosted? Self-hosted on the Coolify VPS (Docker sidecar), a managed service (e.g. ClamAV.NET API), or reuse Bunny's built-in scan webhook (which is what the Slice 1 webhook listens for — but Bunny's scan is shallow antivirus, not ClamAV's full signature database, and the spec explicitly says ClamAV is the v1 source-of-truth).
  2. Resumable upload library (spec Open Q #3 — tus.io vs Bunny built-in): recommended the Slice 2 default to Bunny's native tus support for both Stream + Storage — they're both tus-protocol-compatible, no need for a separate npm dep.
  3. Per-partner storage cap (spec Open Q #2 recommends 200GB; Slice 1 enforces only per-file caps; Slice 4 enforces the per-course cap). Confirm 200GB or pick a different number.
- **Resolution path**: Slice 2 ≤ 1 cron tick once the CLAMAV_URL + the per-kind Bunny mint decisions land; Slice 3 ≤ 1.5 ticks (it's the biggest: scan trigger + new scan.ts + the Files UI); Slice 4 ≤ 0.5 tick; Slice 5 ≤ 0.5 tick. All gated on the Open Question #1 above (the env-var block in the spec).
- Created: 2026-06-30
- Will ship by: Slice 2 within the next cron tick if Klaas opens the Doppler side; otherwise pending the spec-Open-Question batch.



### [STUB-096] P12.9 — Bulk pricing editor is BLOCKED on missing spec + 5 scope decisions
- Phase: P12.9
- Why: AGENTS.md rule #5 forbids code without an approved spec; verified by cron `mvs_603f8069cef04131aaa10afbf53e5fe8` (2026-06-30 02:00):
  - **`PHASES.md:485-486` is 2 lines**: *"P12.9 Bulk pricing editor — select multiple products, apply percentage discount or new price tier."* No acceptance criteria, no surface location, no bulk-action semantics, no schema deltas, no audit-log shape — a wishlist entry.
  - **No spec file exists**: `ls 01-specs/pages/ | grep -iE "bulk-pricing|partner-pricing|pricing-bulk"` returns 0 hits. The only pricing-shaped spec pages are the public `/pricing` (`01-specs/pages/pricing.md` — the subscription-pricing landing page, unrelated) and the partner courses-detail Pricing tab (`01-specs/pages/partner-courses-detail.md` lines 18-20 + 46 + 67-69 + 88-89 — covers single-product pricing only).
  - **`01-specs/pages/partner-courses.md:48` explicitly excludes bulk actions**: *"No bulk actions"* is line 48 of the acceptance-criteria-adjacent §"What this page does NOT do" section. That single sentence is the binding constraint on the natural home for P12.9.
  - **`01-specs/pages/partner-courses-detail.md:67-69` covers per-product pricing only**: the Pricing tab edits 3 tiers (whitelabel / plr / plr_mrr) one product at a time with the `savePricing(id, pricing[])` server action (line 46, "upserts per tier, propagates to live product page on next request"). The bulk editor is the multi-product generalization of this single-product surface — no spec covers the generalization.
  - **`_data-model.md:259-281` ships the underlying `product_pricing` table** — 3 license tiers, `price_cents bigint`, `currency text default 'USD'`, `partner_share_pct int default 60`, `active boolean`, `unique (product_id, tier, currency)`. So the data shape is well-defined; only the bulk-edit UX is unspecd.
  - **No admin "bulk action" precedent on partner products**: the existing bulk patterns are admin-side (`/admin/categories` per P0.x supports `addCategory` / `updateCategory` / `deleteCategory` / `reorderCategory` / `exportCategories` — all single-row ops; no multi-select checkbox column anywhere on a partner surface). The closest existing bulk surface is the **library vault bulk download** (P7.4 Slice 1) — checkboxes + a `<BulkDownloadBar>` client island + a `validateBulkRequest` pure validator — that pattern is the natural template, but it is a check-then-act surface, NOT a form-fill-then-act surface, and P12.9 is fundamentally form-fill (the partner has to choose a percentage OR a new price).
- **What is missing for the spec** (5 scope decisions Klaas needs to make before a single line ships):
  - **(a) Selection UX** — where does the multi-select happen?
    - **(i) Inline checkbox column on `/partner/courses`** (RECOMMENDED — natural extension of the existing list page; adds a left-most `<input type="checkbox">` column + a sticky `<BulkActionBar>` at the bottom of the viewport when >=1 row is selected, matching the P7.4 vault pattern). Requires lifting the spec line 48 "No bulk actions" carve-out.
    - **(ii) Separate `/partner/pricing` page** — a dedicated bulk-pricing surface with a product-picker (multi-select chips / tree), decoupled from `/partner/courses`. Cleaner separation but a second route to maintain + a second place to navigate from.
    - **(iii) Per-tier "Edit pricing" toolbar on the existing Pricing tab** — open from `/partner/courses/[id]` -> Pricing tab -> "Apply to other courses" link -> bulk-edit modal. More clicks, but reuses the existing single-product pricing surface verbatim.
  - **(b) "Apply" semantics** — what does "apply" actually mean? PHASES.md says "apply percentage discount or new price tier" — both. Decision needed on:
    - **(i) Mode A: percentage discount** (`+/-X%` applied to each product tier's current `price_cents`, floors to whole cents). E.g. `-10%` on `plr` -> all selected products' `plr` prices become `floor(old x 0.90)`.
    - **(ii) Mode B: new flat price** (set every selected product tier's `price_cents` to the partner-entered value, must `> 0`).
    - **(iii) Mode C: tier activation toggle** (set `active=true|false` on a tier across all selected products; no `price_cents` change). E.g. enable `plr_mrr` on 12 drafts in one click.
    - **(iv) Mode D: percentage partner-share change** (set `partner_share_pct` across all selected products, clamped to 0-100). Adjacent to pricing — affects royalty math but not customer-facing price.
    - RECOMMENDATION: **(i) + (ii) only** (the literal PHASES.md scope); **(iii) and (iv)** are v2 — they belong on the partner-courses-detail Pricing tab as single-product toggles (which the spec already covers at line 67) and on an admin royalties page (P14.x), not on the bulk surface.
  - **(c) Tier scope** — does the editor target one tier at a time or all 3 tiers per product?
    - **(i) One tier at a time** — the partner picks a tier (whitelabel / plr / plr_mrr), then applies the action to all selected products' rows for that tier. Recommended — matches single-product mental model + simpler validation (no cross-tier math).
    - **(ii) All tiers per product** — the action applies to all 3 tiers of every selected product; the partner enters a tier-by-tier matrix. More powerful but verbose — needs an inline 3-column editor.
    - **(iii) Tier filter only** — applies to whichever tiers are currently `active=true` on each product. Surprising semantics — not recommended.
  - **(d) Confirmation pattern** — destructive on scale; what guards the action?
    - **(i) Preview diff + typed confirmation** (RECOMMENDED — matches the P12.6 unpublish modal pattern at line 38: shows a diff table of `before -> after` per product/tier + a grand total + a "type APPLY" confirmation). Zero risk of accidental mass-pricing-change.
    - **(ii) Single-click apply with undo toast** — 30-second undo window via a server-side action queue. More forgiving UX but requires server-side action-queue infra + a /api/bulk-pricing/undo endpoint.
    - **(iii) Staged apply** — first click writes a `pending_bulk_pricing_change` shadow row; partner reviews for 24h then confirms. Too heavy for a v1.
  - **(e) Audit log shape** — what does the audit row record?
    - **(i) One summary `admin_audit_log` row** + per-product `partner_audit_log` (or per-product `admin_audit_log` extension) row. Recommended — matches P6.3 CSV-export pattern (one summary + one detail row per affected entity).
    - **(ii) One `admin_audit_log` row per (product, tier)** — granular + queryable by product_id but verbose (12 products x 1 tier = 12 rows).
    - **(iii) Single summary row only** (no per-product trace). Cheapest but loses per-product forensic detail; not recommended.
    - The audit row(s) must record `before.price_cents` + `after.price_cents` + the bulk-action metadata (`mode`, `tier`, `percentage_bps` OR `new_price_cents`, `selected_product_ids`, `actor_user_id`, `actor_partner_id`) for every change — the existing `admin_audit_log` table supports this via the `metadata jsonb` column + `target_kind='product_pricing'` + `target_id=product_pricing.id` (target_kind extension needed).
- **RECOMMENDATION** (matches the project's B2B UI = monochrome + one accent style + the existing P7.4 vault bulk pattern + the P12.6 unpublish confirmation pattern):
  - **(a) inline checkbox column on `/partner/courses`** — lifts the line 48 "No bulk actions" carve-out via a §"What this page DOES do (P12.9 amendment)" addition; pairs with a sticky `<BulkActionBar>` like P7.4.
  - **(b) Modes A (percentage) + B (new price)** — literal PHASES.md scope; deferred C (activation) + D (share %) are v2.
  - **(c) One tier at a time** — the partner picks `whitelabel` / `plr` / `plr_mrr` in the bulk bar, then applies.
  - **(d) Preview diff + typed "APPLY" confirmation** — matches the P12.6 unpublish modal pattern; zero accidental mass-change risk.
  - **(e) One summary `admin_audit_log` row + per-product `admin_audit_log` rows** — queryable forensic trail.
- **Resolution path** once Klaas answers the 5 questions: <= 1.5 cron ticks (under the recommendation):
  1. Write `01-specs/pages/partner-courses-bulk-pricing.md` (new spec file) covering the chosen shape — what the page does / data model / user actions / acceptance criteria / security / performance / open questions / implementation notes sections. Lifts the line 48 carve-out via an amendment paragraph. Adds the missing bulk-action acceptance criteria.
  2. Amend `01-specs/pages/partner-courses.md` to (i) add the checkbox column + bulk bar to the data-model table; (ii) lift the "No bulk actions" line 48 carve-out with a one-line amendment; (iii) add the bulk-action acceptance criteria cross-referencing the new spec.
  3. New migration `0042_product_pricing_audit_target_kind.sql` — adds `'product_pricing'` to the `audit_target_kind` enum + a partial covering index `(target_kind, target_id, created_at desc) WHERE target_kind='product_pricing'` for the per-product forensic search (matches the P3.3 admin_audit_log index pattern).
  4. New `02-features/partner-portal/bulk-pricing/` tree:
     - `actions/applyBulkPricingChange.ts` — server action; Zod-validated `{ product_ids: bigint[], tier, mode: "percentage" | "new_price", percentage_bps?, new_price_cents? }`; per-product RLS check (`products.partner_id = partners.id`); service-role transaction: SELECT existing prices -> compute new prices -> UPSERT `product_pricing` (insert/update on `(product_id, tier, currency)` conflict) -> write one summary `admin_audit_log` row + N per-product rows -> audit row includes `before.price_cents` + `after.price_cents` + bulk-action metadata; revalidate `/partner/courses` + the storefront ISR cache (`revalidateTag('product:'+id)` per product).
     - `lib/bulkPricingMath.ts` — PURE helpers: `applyPercentageDiscount(priceCents, bps)` (FLOOR + clamped at $0.01 minimum = 1 cent), `validateBulkPricingInput(input)` (mode-dependent validation: percentage in `[-10000, +10000]` bps; new_price > 0; max 100 product_ids; tier in license_tier enum).
     - `components/BulkActionBar.tsx` + `BulkActionBar.module.css` — client island; sticky bottom bar; selected count + Clear / Apply buttons + tier picker + mode picker.
     - `components/BulkPricingPreviewModal.tsx` + `.module.css` — RSC modal; shows per-product diff table + grand-total change + typed "APPLY" confirmation input + Apply / Cancel CTAs.
  5. Amend `02-features/partner-portal/components/PartnerCoursesList.tsx` — add checkbox column + selection state (URL-driven `?selected=<comma-separated-ids>` to survive page reloads, like P7.4).
  6. Wire into `/partner/courses` page — pass selection to the bar; bar reads `getMyPartnerProducts` filtered by selection for the preview.
  7. Tests: `lib/bulkPricingMath.test.ts` (percentage math + clamping + mode validation); `actions/applyBulkPricingChange.test.ts` (auth + RLS + per-product loop + audit row shapes + transactional rollback + tier enum + currency assumption + summary + per-product audit row count match); `components/BulkPricingPreviewModal.test.tsx` (diff table render + typed confirmation gating + grand-total math).
  8. Spec amendments: add §"P12.9 — Bulk pricing editor" implementation notes to `01-specs/pages/partner-courses-bulk-pricing.md` (post-build).
- **Blocker**: (a) Klaas's answers on the 5 scope decisions above. (b) No new env or dependencies required. (c) No schema migration beyond the small `audit_target_kind` enum extension. (d) No vendor / API integration. (e) **Coupling with P12.10** (Course draft auto-save — every 30 s): P12.10 is a separate `[ ]` in PROGRESS.md and is independent of P12.9 — the auto-save is for the upload-wizard draft state, the bulk-pricing editor is for already-published products. The cron tick that resolves this STUB will then advance to P12.10 (or the next `[ ]`).
- **Why this STUB, not a build**: per the user-pref "Klaas wants asks, not workarounds", 5 scope decisions pending + an existing spec line that EXPLICITLY excludes the work -> 1 STUB. The 5-decision STUB-087 (P11.5) and 4-decision STUB-086 (P11.4) shipped the same way one tick ago and are now filed for Klaas's review.
- Owner: Klaas (spec + 5 scope decisions) -> Mavis (cron) once spec lands.
- Created: 2026-06-30
- Will ship by: post-spec-amendment, <= 1.5 cron ticks under the recommendation; <= 2 ticks if Klaas adds tier activation (Mode C) or staged-apply confirmation (iii).


### [STUB-097] P12.11 Slice 1 — `/partner/courses/[id]/sales` drill-down + filters + CSV export (Slice 1 shipped 2026-06-30; Slices 2+ deferred)
- Phase: P12.11
- Why: The P12.11 PHASES.md line says "Sales page — lifetime + period + per-product + per-license breakdown. Date range filter. CSV export." Slice 1 (this tick) shipped the lifetime summary on the Sales tab of the partner course detail page via the new SECURITY DEFINER RPC `get_partner_course_sales_summary(partner_id, product_id)` (migration 0042). The full P12.11 deliverable — the dedicated drill-down page at `/partner/courses/[id]/sales` with URL-driven filters, masked customer email display, pagination, and CSV export — is **deferred to Slices 2+** because it's 3-4 ticks of work on its own.
- **Scope deferred to Slices 2+** (the spec at `01-specs/pages/partner-courses-sales.md` covers it end-to-end):
  - **(a) The dedicated drill-down page** at `/partner/courses/[id]/sales` — full per-order table (order id, date, customer masked `j***@email.com` + display_name fallback, tier chip, unit price, partner share, refund status badge). The Sales tab now links to this page; clicking the link today 404s via the not-found.tsx surface until Slice 2 ships the page.
  - **(b) URL-driven filter bar** — `?from=<ISO>` + `?to=<ISO>` date range (default last 90 days per the spec), `?tier=<license_type>` (all / whitelabel / plr / plr_mrr), `?status=<order_status>` (all / paid / refunded / partially_refunded). Filters are shareable + back-button works.
  - **(c) Sorted table** — `?sort=date&dir=desc` (default), only `date` is sortable in v1 per spec.
  - **(d) Pagination** — `?page=N&pageSize=20|50|100` (default 20), Prev/Next + "Page X of Y" + page-size selector.
  - **(e) Summary stats reflect the filter** — top-of-page tiles re-compute under the current filter (not lifetime).
  - **(f) Masked customer email display** — server-side masking (`j***@domain.com` per spec §"Masking pattern", first char + `***@` + full domain). The masking happens inside the query, NOT in the SELECT payload — the partner's RLS never sees the raw email column. The CSV export re-masks server-side as a defense-in-depth measure.
  - **(g) CSV export server action** — `exportCourseSalesCsv(id, filters)` returns a signed URL (24h TTL) + an audit row + rate-limited 10/hr/partner per spec §"Security" + "200 page loads per partner per hour" in-process rate limit. Audit row: `admin_audit_log` extended with `action='partner_csv_export'`, `target_id=<product_id>`, `metadata={ filters, row_count, rate_limit_count }`.
  - **(h) Refresh button** — invalidates the 5-minute RSC fetch cache so the partner can force a re-read without waiting for ISR.
- **Deferred dependencies** (have to land before Slice 2):
  - **Top-5 buyer countries** on the Sales tab of the partner course detail page — spec line 23 says "Top buyers' countries (top 5, count + percent)". The `orders.ip` text column doesn't break down by country; needs either (i) a new `orders.ip_country text` column with GeoIP populated at write-time (and a drop policy for the raw IP after 90 days — see spec OQ), OR (ii) deferred to a v2 surface. Recommendation per spec OQ: option (i); migration: add `ip_country` to `orders`, populate at write-time in `onPaymentSucceeded` / `createCheckoutSessionAction`, add a partial index `(product_id, ip_country) WHERE ip_country IS NOT NULL`, drop `ip` column after 90-day retention purge per `_data-model.md`. Estimated ≤ 1 tick to land (separate migration + 2 webhook hooks + a query helper). Once `ip_country` exists, the Sales tab can render the top-5 bar list (much like the EarningsChart inline SVG).
  - **Date-range URL parameters on the Sales tab** — the spec says period = lifetime by default but partners will want to compare windows. Slice 2 can render the period picker as a UI island wired into a URL param. Today the RPC returns lifetime aggregates unconditionally.
  - **Enhanced `(product_id, status, created_at desc)` index on `order_items`** — per spec §"Performance" + §"DB indexes". The existing `order_items_partner_product_idx (partner_id, product_id) INCLUDE (quantity, line_total_cents)` (0030) covers the aggregates, but the per-order table needs `(product_id, status, created_at desc)` for the status-filter + date-DESC sort. Slice 2 (drill-down page) should add this. Estimated ≤ 0.1 tick (one-line migration).
- **RECOMMENDATION** for the cron order (single optimal answer for the next 1-2 P12.11 ticks):
  - **Tick N+1 (Slice 2)**: ships the drill-down page route + table + URL-driven filters + sort + pagination + masked email + the new index migration. NO date-range param UI yet (lifetime default; the spec's `?from=`/`?to=` filter logic IS the same code path, just exposed). Estimated 2-3 ticks.
  - **Tick N+2 or N+3 (Slice 3)**: ships the CSV export server action + 10/hr rate limit + audit row + the Refresh button + the period-filter UI surface. Estimated 1 tick.
  - **Tick N+3 or N+4 (Slice 4)**: ships the `orders.ip_country` migration + the GeoIP hook at `onPaymentSucceeded` + the top-5 buyer countries bar on the Sales tab. Estimated 1 tick (separate from the table work; depends on the orders-hook).
- **Blocker**: none — the spec at `01-specs/pages/partner-courses-sales.md` is fully written and was the surface this STUB defers to. All work is build-executable once Klaas picks the next slice (the cron can default to Slice 2 unprompted; the spec is rich enough that no further spec work is needed — just the page + query + audit + rate-limit work).
- **Why this STUB, not a build-all**: per QWEN.md §7 "Done means the feature behaves as the spec says" + AGENTS.md "no half-baked code" rule — the drill-down page alone is 4-5 files (route + page + components + query + tests + CSS module) and the masked email + CSV export + country geo are each their own slice. The 1-tick scope lock is the Sales tab summary; the rest gets its own ticks.
- **What shipped in Slice 1** (this tick, 2026-06-30):
  - **Migration 0042** — `get_partner_course_sales_summary(p_partner_id, p_product_id)` SECURITY DEFINER STABLE RPC; lifetime aggregates (revenue_cents, units_sold, order_count, refund_count, avg_rating, first_sale_at, last_sale_at); authorization check inside the WHERE (`current_partner_id() = p_partner_id or is_admin()`); NULL contract preserved for `avg_rating` so the page can render "No reviews yet"; existing indexes (0030 + 0024/0039) cover the read; no new indexes.
  - **Query helper** `02-features/partner-portal/queries/getMyCourseSalesSummary.ts` — RSC-side wrapper around the RPC; fail-soft (returns the empty summary on RPC error); partner ownership check via the product's `partner_id!inner(user_id)` join + the partners lookup (defense in depth alongside the RPC's auth check); bigint-as-string coercion; refund rate clamped to [0, 1]; ISO timestamp guard; FNV-1a 32-bit hashed logging (partner_id + product_id redaction).
  - **Component** `02-features/partner-portal/components/CourseSalesSummary.tsx` + matching CSS module — 4-card responsive grid (4→2→1 across 900/640px breakpoints), mono-numeric KPI alignment, token-only CSS, drill-down link to `/partner/courses/[id]/sales`, footer recency row with "today" / "yesterday" / "N days ago" + "No sales recorded" fallback.
  - **Page wiring** — `03-app/partner/courses/[id]/page.tsx` (`app/` symlink) `Promise.all` now includes `getMyCourseSalesSummary(id)` so the Sales tab branch renders without an extra RT; the active-tab branch now actually renders the summary instead of the "coming in next slice" placeholder.
  - **Tests** — 17 query tests (auth gating × 4, input validation × 3, ownership mismatch × 2 with PII-safe hashed log assertions, happy-path × 6 mapping every field + refund rate math + null contracts, RPC failure handling × 3 incl. PII safety) + 18 component tests via renderToStaticMarkup (header layout, formatting for USD/units/rate/rating, refund hint branches incl. singular/plural, drill-down link href + hint copy, recency footer with relative-timestamp clock-stability). **35 new unit tests, runs in 19ms total**. Full suite: 3186 tests, 0 failures.
  - **All 6 checks green** + `pnpm typecheck` + `pnpm lint` + `pnpm build` clean (58 routes; `/partner/courses/[id]` is `3.96 kB / 114 kB` first-load JS, was `3.73 kB / 114 kB` after P12.6; +230 B for the new Sales tab content; shared first-load JS unchanged at 101 kB).
- Owner: Mavis (cron).
- Created: 2026-06-30
- Will ship by: Slices 2-4 ship across the next 3-4 cron ticks (no human input required; the spec is rich enough for the cron to drive the build).

### [STUB-098] P12.12 — Cohort chart is BLOCKED on missing spec + existing specs EXPLICITLY exclude the work + 6 scope decisions
- Phase: P12.12
- Why: AGENTS.md rule #5 forbids code without an approved spec; verified by cron `mvs_b0ead71df6fd49739b1c41816b208a0e` (2026-06-30 03:30):
  - **`PHASES.md:492` is 1 line**: *"P12.12 Cohort chart — new customers × repeat rate over time."* — no acceptance criteria, no surface location, no data model, no query shape, no audit-log shape, no retention policy. Even shorter than P12.9's 2-line wishlist.
  - **No spec file exists**: `ls 01-specs/pages/ | grep -iE "cohort|retention"` returns 0 hits. The only `cohort` references across the spec tree are:
    - `01-specs/pages/admin-analytics.md:24` — admin-side cohort retention grid (uses `progress.last_watched_at` + LMS data, NOT partner-side buyer cohorts).
    - `01-specs/pages/admin-analytics.md:41` — "Expand cohort grid" admin interaction.
    - `01-specs/pages/admin-analytics.md:68` — admin acceptance criterion "Cohort retention grid renders correctly (4-week retention for the most recent 12 weekly cohorts)".
    - `01-specs/pages/admin-analytics.md:79` — `00-foundations/ui/CohortGrid.tsx` referenced as a planned primitive but the file DOES NOT exist (verified: `ls 00-foundations/ui/` shows no CohortGrid).
    - `01-specs/pages/admin-analytics.md:152` — "4-week retention for the most recent 12 weekly cohorts" definition.
    - `01-specs/pages/partner-courses-sales.md:50` — **PARTNER-SIDE EXPLICIT EXCLUSION**: *"No cohort / retention view (the analytics page is for admin; partner gets summary stats only)"* in §Acceptance Criteria.
    - `01-specs/pages/partner-courses-sales.md:119` — lists *"Cohort / retention view"* under §"Out of scope for v1".
    - `01-specs/pages/instructor-dashboard.md:41` — *"No cohort analysis (v2)"*.
    - `01-specs/pages/instructor-dashboard.md:94` — lists "Cohort analysis" as future work.
  - **The partner-side specs EXPLICITLY exclude the work** — a stronger constraint than the P12.9 case (where partner-courses.md:48 just said "No bulk actions" and the bulk editor could be added as an amendment). The partner-courses-sales.md §"Out of scope for v1" list is binding: cohort/retention is *deliberately* not on the partner sales surface. Adding it requires either (a) a new standalone `/partner/cohorts` route with a brand-new spec, OR (b) amending partner-courses-sales.md to remove the carve-out (which Klaas would need to sign off because the carve-out was a deliberate scope decision).
  - **No data-model surface**: `_data-model.md` has no `cohort_*` tables / RPCs / materialized views. The raw inputs a cohort grid would consume are `orders.customer_id` + `orders.created_at` + (for repeat-rate) a second `orders.created_at` per `customer_id` — these exist, but there's no `orders.cohort_key`, no first-order-per-customer materialized view, no `cohort_retention` table or equivalent.
  - **No query/RPC foundation**: zero `get_partner_cohort_*` or `get_partner_retention_*` functions in `04-platform/migrations/*.sql`; zero matches in `02-features/partner-portal/queries/` for cohort/retention. The 3 closest partner-portal queries:
    - P12.11's `getMyCourseSalesSummary` (4 lifetime aggregates — revenue_cents, units_sold, order_count, refund_count, avg_rating — no time axis, no per-buyer breakdown).
    - P12.4's `getPartnerDashboardExtras` (month-to-date sales RPC + 30-day daily series RPC + recent activity feed — no cohort definition, no buyer-level cohort key).
    - P12.5's `getMyPartnerProducts` (per-product revenue aggregates — no buyer retention).
  - **No visualization precedent**: `EarningsChart.tsx` (P12.4) is the only inline-SVG chart in the partner portal — it's a simple bar chart of `daily_sales_cents`. A cohort retention grid is a different shape (2D heatmap: rows = cohort acquisition weeks, columns = weeks 0..N since signup, cells = retention %). No existing analogue in `02-features/partner-portal/components/` or `00-foundations/ui/`.
- **What is missing for the spec** (6 scope decisions Klaas needs to make before a single line ships):
  - **(a) Surface location** — where does the cohort grid live?
    - **(i) New `/partner/cohorts` standalone page** (RECOMMENDED — matches the `/partner/sales` pattern; clean separation; no scope-creep on the Sales page; the URL is also self-discoverable + deep-linkable from support tickets). Needs a new spec file `01-specs/pages/partner-cohorts.md`.
    - **(ii) Embed on `/partner/dashboard`** (P12.4 pattern — extends the dashboard's "Recent activity" feed with a 4th tile for cohort summary). Cheaper but visually crowded; dashboard already has 5 stat cards + activity feed + earnings chart.
    - **(iii) Embed on `/partner/sales`** (extends P12.11 Slice 2 drill-down page). Requires amending `partner-courses-sales.md` to remove the §"Out of scope for v1" cohort line + write a §"Cohort tab" section. Tighter coupling to the Sales context.
    - **(iv) Embed on `/partner/courses/[id]` as a 6th tab** (extends the 5-tab partner-courses-detail.md shell — Curriculum / Pricing / Sales / Reviews / Settings — with a "Cohort" tab). Per-product cohorts; less useful than portfolio-wide because indie-hacker partners want to see their whole-book behavior, not per-course.
  - **(b) Cohort definition** — what counts as a "new customer"?
    - **(i) First paid order** (RECOMMENDED — matches the spec's revenue model + the existing `orders` table's `customer_id` + `created_at` columns; the natural cohort boundary for a marketplace). Cohort size = number of distinct `customer_id` with `MIN(created_at)` in week W.
    - **(ii) First signup** (`profiles.created_at`). Free signup skews retention up — most users who sign up never buy, so retention rates look misleadingly low at week 1 (because they're measuring "did the user come back to the site", not "did they buy again"). Not recommended for a partner revenue cohort.
    - **(iii) First subscription start** (`subscriptions.created_at` where `status IN ('active', 'trialing')`). Different math, only meaningful for subscription-eligible products (the `plr_mrr` license tier). Not recommended unless the cohort is explicitly a subscription-retention view.
    - **(iv) First free trial start** (N/A — there are no free trials in v1 per `01-specs/pages/account-subscriptions.md:54, 124, 134`).
  - **(c) Repeat-rate definition** — what does "repeat" mean?
    - **(i) % of cohort who made a 2nd paid order within X days of their first** (RECOMMENDED — matches the spec's "repeat rate" language + the standard e-commerce cohort metric; X = 60 days is the typical window). Output: `cohort_size` per row + `repeat_count` per (row, week-offset) cell.
    - **(ii) % with any 2nd paid order ever** (no time window). Long-tail noise — a customer who buys again 3 years later counts as a "repeat" alongside a 7-day repeat; not actionable for the partner.
    - **(iii) % who subscribed again** (subscription-only). Subset of (i) for subscription customers only; useful for subscription-heavy catalogs but ignores one-off buyers.
    - **(iv) % who re-watched a lesson** (LMS-driven). Uses `progress.last_watched_at` — out of scope for partner-portal v1 per `instructor-dashboard.md:41`.
  - **(d) Time axis** — how is the cohort bucketed?
    - **(i) Weekly cohorts × 12 weeks, 12-week retention window** (RECOMMENDED — matches the admin-side `admin-analytics.md:152` "12 weekly cohorts × 4-week retention" pattern; gives a 12×12 grid that fits on one screen at desktop widths).
    - **(ii) Weekly cohorts × 12 weeks, 4-week retention window** (matches admin-side verbatim — smaller grid, faster to read; less data).
    - **(iii) Monthly cohorts × 6 months, 6-month retention window** (less granular; only useful if the partner has <50 orders/week — for new partners this would be a sparse grid).
    - **(iv) Toggle between weekly/monthly** (best UX, more code — adds a `<TimeAxisToggle>` client island + 2 query paths).
  - **(e) Visualization** — what does the cohort grid look like?
    - **(i) Heatmap grid** (RECOMMENDED — 12 cohort rows × 1-12 week columns; cell color intensity maps to retention % via a single-hue scale `--accent` at 10%/25%/50%/75%/100% opacity; cell text = "N (M%)" where N = repeat count, M% = retention rate). Matches the admin-side spec at `admin-analytics.md:79`.
    - **(ii) Line chart** — one line per cohort, x-axis = weeks since signup, y-axis = retention %. Less information-dense (only shows the trend, not absolute counts); doesn't surface the cohort size directly.
    - **(iii) Stacked bars** — one bar per cohort week, segments = "1st order / 2nd order / 3rd+ order". Different metric (order depth, not retention).
    - **(iv) Triangle retention table** — half-matrix (rows = cohorts, columns = week offsets, only cells where column ≤ row-index shown). More accurate for uneven cohort sizes but harder to read.
  - **(f) Scope** — portfolio-wide or per-product?
    - **(i) Portfolio-wide + optional course filter** (RECOMMENDED — matches the partner dashboard's portfolio view; default shows all products; partner can filter to a single course via `?product_id=<id>`). Same shape as P12.5's product filter.
    - **(ii) Per-course only** (extends the Sales tab of `/partner/courses/[id]`). Less useful because indie-hacker partners want cross-portfolio behavior to spot which products drive repeat purchases.
    - **(iii) Per-license-tier** (whitelabel vs plr vs plr_mrr cohorts). New dimension — needs an additional GROUP BY; useful for products with multiple license tiers.
- **RECOMMENDATION** (matches the project B2B UI = monochrome + one accent style + the P12.4 EarningsChart token-only SVG pattern + the admin-side spec at `admin-analytics.md:79`):
  - **(a) New `/partner/cohorts` standalone page** — clean separation; new spec file `01-specs/pages/partner-cohorts.md`; self-discoverable URL.
  - **(b) First paid order** — natural cohort boundary for a revenue model; uses existing `orders.customer_id` + `created_at`.
  - **(c) % who made a 2nd paid order within 60 days** — standard e-commerce cohort metric; matches the spec's "repeat rate" language.
  - **(d) Weekly cohorts × 12 weeks, 12-week retention window** — 12×12 grid; matches admin-side spec shape; fits on one screen.
  - **(e) Heatmap grid** — cell color via `--accent` opacity scale (10/25/50/75/100%); cell text = "N (M%)"; single SVG primitive extracted to `00-foundations/ui/CohortGrid.tsx` so admin-side P14.16 reuses it.
  - **(f) Portfolio-wide + optional `?product_id=<id>` filter** — matches the partner dashboard's portfolio view.
- **Resolution path** once Klaas answers the 6 questions: ≤ 1.5 cron ticks (under the recommendation):
  1. Write `01-specs/pages/partner-cohorts.md` (new spec file) covering: page purpose, data model, query contract, user actions, acceptance criteria, security, performance, open questions, implementation notes. References the admin-side cohort definition from `admin-analytics.md:152` for consistency.
  2. New migration `0043_partner_cohort_retention.sql`:
     - `get_partner_cohort_retention(p_partner_id, p_weeks_back int default 12, p_retention_window_days int default 60, p_product_id bigint default null)` SECURITY DEFINER STABLE RPC — returns `cohort_week date` + `cohort_size int` + `week_offset int` + `repeat_count int` + `retention_pct numeric(5,2)` for the 12×12 grid (or 12×N for narrower windows).
     - Authorization check inside the WHERE (`current_partner_id() = p_partner_id or is_admin()`).
     - Indexes: NEW `(customer_id, created_at desc)` on `orders` (currently exists per `0001_initial.sql`) — no new index needed; the existing `orders(customer_id, created_at desc)` covers the first-order-per-customer query. NEW partial covering index `(partner_id, created_at desc) WHERE status = 'paid'` on `order_items` for the repeat-rate scan (matches the existing P3.1 partial-index pattern).
     - Use `generate_series` to fill sparse weeks so the grid is always 12×12 (matches the P12.4 daily_sales_series pattern).
  3. New `02-features/partner-portal/cohorts/` tree:
     - `actions/getPartnerCohortGrid.ts` — RSC-side typed wrapper around the RPC; fail-soft on RPC error (return empty grid + warn log); bigint coercion; partner ownership check.
     - `lib/cohortGridShape.ts` — PURE helpers: `cohortWeekStart(date)` (Monday-start ISO week), `buildEmptyGrid(weeksBack, weeksWindow)` (12×12 zero-fill), `pctFromCount(num, denom)` (with 0-safe), `colorTokenForPct(pct)` (maps 0-100 → `--accent` opacity tier).
     - `components/CohortGrid.tsx` + `.module.css` — RSC component; SVG heatmap; token-only CSS via `--accent` + `--bg-elev-1`; cell tooltip via `<title>` element (server-only); legend strip below the grid showing the color scale.
     - `components/CohortProductFilter.tsx` + `.module.css` — optional client island for the `?product_id=<id>` filter; reads products via `getMyPartnerProducts`; shareable URL.
  4. New page route `/partner/cohorts/page.tsx` — RSC + partner-gated via `requirePartner()`; `Promise.all` of cohort grid + products for filter; `<CohortGrid>` mounted in a 1-col layout with the `<CohortProductFilter>` above it; `loading.tsx` skeleton mirrors the grid shape; `not-found.tsx` covers the partner-not-found case.
  5. Sidebar link in `<PartnerSidebar>` under "Analytics" → "Cohort grid" — entry point from the partner dashboard.
  6. New primitive `00-foundations/ui/CohortGrid.tsx` — extracted from `02-features/partner-portal/components/CohortGrid.tsx` after Slice 1 ships so the admin-side P14.16 can `import { CohortGrid } from '@foundations/ui/CohortGrid'` without duplication. PR split: Slice 1 lives in `02-features/partner-portal/components/`; refactor to `00-foundations/ui/` is a separate PR (≤ 0.3 tick).
  7. Tests: `lib/cohortGridShape.test.ts` (~25 tests — week-start math, grid shape invariants, color tier boundaries, pct math); `actions/getPartnerCohortGrid.test.ts` (~20 tests — auth gating, RPC failure, bigint coercion, ownership check, fail-soft empty grid, PII safety on logs); `components/CohortGrid.test.tsx` (~15 tests via `renderToStaticMarkup` — cell rendering, color tiers, empty state, legend, tooltip via `<title>`); `00-foundations/ui/CohortGrid.test.tsx` (~10 tests — pure SVG output, no token regression).
  8. Spec amendments: §"P12.12 — Cohort grid (2026-06-30)" Implementation notes appended to `01-specs/pages/partner-cohorts.md` post-build; cross-link from `01-specs/pages/partner.md` §"Analytics" so future readers find the spec; cross-link from `01-specs/pages/admin-analytics.md` §"Cohort retention" so the admin-side reuse is documented.
- **Blocker**: (a) Klaas's answers on the 6 scope decisions above. (b) No env / vendor / API integration required. (c) **Coupling**: building the `00-foundations/ui/CohortGrid.tsx` primitive here would unblock admin-side P14.16 (admin analytics dashboard) which currently references it in the spec but has no implementation. (d) The P12.11 Slice 2 drill-down page (`/partner/courses/[id]/sales`) is independent and can be picked up in parallel/next ticks — STUB-097 still owns that scope. (e) **Coupling with P12.13** (Top customers list — also `[ ]`, also 1-line PHASES.md entry, same spec-gap pattern): P12.13 is a simpler flat list vs the cohort 2D heatmap; they share the data source (orders.customer_id + first-order date) but not the visualization. Can ship in any order; recommendation: P12.13 first because it's a single-query + single-component slice (≤ 1 tick after spec lands), P12.12 second because it's a new page + new primitive + new RPC.
- **Why this STUB, not a build**: per the user-pref "Klaas wants asks, not workarounds", 6 scope decisions pending + existing partner-side specs EXPLICITLY exclude the work (stronger than P12.9's "no spec" case) → 1 STUB. The 5-decision STUB-096 (P12.9) + 4-decision STUB-086 (P11.4) + 5-decision STUB-087 (P11.5) + 4-decision STUB-088 (P11.6) + 4-decision STUB-085 (P9.16) all shipped the same way.
- Owner: Klaas (spec + 6 scope decisions) → Mavis (cron) once spec lands.
- Created: 2026-06-30
- Will ship by: post-spec-amendment, ≤ 1.5 cron ticks under the recommendation; ≤ 2 ticks if Klaas picks the time-axis toggle (iv) or per-license-tier scope (iii).

### [STUB-099] P12.13 — Top customers list is BLOCKED on missing spec + existing partner-side specs EXPLICITLY exclude customer rollups + 7 scope decisions
- Phase: P12.13
- Why: AGENTS.md rule #5 forbids code without an approved spec; verified by cron `mvs_7bfffb5e8627432280c1dfe6240d9b36` (2026-06-30 04:00):
  - **`PHASES.md:493-494` is 2 lines**: *"P12.13 Top customers list — anonymized email, total spend, last purchase."* — zero acceptance criteria, no sort order, no top-N cutoff, no time window, no surface location, no masking pattern beyond the literal word "anonymized", no audit-log shape, no CSV shape.
  - **No partner-side spec file exists**: `ls 01-specs/pages/ | grep -iE "customer|partner-customer|top-customer"` returns only the **admin-side** files (`admin-customers.md` + `admin-customer-detail.md`). The partner-side customer surfaces have no spec page — `partner-courses-sales.md` references "customer (masked: j***@email.com)" only in the context of per-row line items, not a customer rollup.
  - **Existing partner-side specs EXPLICITLY exclude the work (this is the binding constraint, stronger than just "no spec")**:
    - `01-specs/pages/instructor-dashboard.md:95` — §"Out of scope for v1" includes the literal line *"Customer email list"* — the dashboard surface cannot host this feature in v1.
    - `01-specs/pages/partner-courses-sales.md:53` — §"Out of scope for v1" says *"No customer LTV (lifetime value) — the partner sees the per-order row, not a customer rollup"*. A "top customers by spend" list IS a customer rollup — the language matches the exclusion.
    - `01-specs/pages/partner-courses-sales.md:52` — *"No 'this customer is also a partner / affiliate' cross-reference"* (no cross-entity view).
    - `01-specs/pages/partner-courses-sales.md:54` — *"No 'contact this customer' CTA (we never give the partner a way to email a buyer; that's a privacy violation, and partners know this)"* — any UI must not surface a contact action.
    - **Combined**: P12.13's surface would need EITHER (a) a new standalone `/partner/customers` route with a brand-new spec, OR (b) amendments to BOTH `instructor-dashboard.md` (remove "Customer email list" from OOS) AND `partner-courses-sales.md` (remove the "customer LTV/customer rollup" lines). Either path requires Klaas to sign off because the OOS carve-outs were deliberate scope decisions.
  - **No data-model surface**: `_data-model.md:40` lists `orders` + `order_items` + `payout_ledger` + `refunds` in the commerce tier — all have `customer_id` (uuid) or `partner_id` (bigint) columns; the raw inputs exist. But there's no materialized view, no `customer_aggregates` table, no `partner_top_customers` view, and the existing `get_partner_*` RPCs don't aggregate by customer. The 4 closest partner-portal queries:
    - P12.11's `getMyCourseSalesSummary` (4 lifetime aggregates — **per-product**, no per-buyer breakdown).
    - P12.4's `getPartnerDashboardExtras` (month-to-date sales + 30-day daily series + recent activity feed — **portfolio-level time series**, no per-buyer breakdown).
    - P12.5's `getMyPartnerProducts` (per-product revenue — **no buyer identity**).
    - P12.6's `getMyCourseDetail` + `getMyCourseLastEdit` (single-course reads — **no buyer identity**).
  - **Masking precedent exists but is split**: `partner-courses-sales.md:134` documents the *"first char + *** @ + full domain"* pattern (Stripe/Shopify style, stable across rows so the partner can recognize repeat customers without seeing the local part). The same masking primitive would apply to P12.13. The sales spec also accepts (line 75) `profiles.display_name` as primary customer label with masked email as fallback — same dual-display contract can apply.
  - **No audit log precedent for partner-side customer reads**: P12.11's `partner_csv_export` (STUB-097) writes `action='partner_csv_export'` with masked metadata; that's the closest shape. New `action='partner_top_customers_viewed'` row would need to follow the same masked-identifier pattern (FNV-1a hash of customer_id + actor_id) per the partner-portal logging convention. No prior work to mirror.
- **What is missing for the spec** (7 scope decisions Klaas needs to make before a single line ships):
  - **(a) Surface location** — where does the top customers list live?
    - **(i) New `/partner/customers` standalone page** (RECOMMENDED — matches the new-page pattern from STUB-098's `/partner/cohorts`; clean separation; no scope-creep on the dashboard or sales page; self-discoverable URL; no spec amendment required on existing surfaces; **but requires writing the new spec + removing "Customer email list" from `instructor-dashboard.md:95` OOS**).
    - **(ii) Embed on `/partner/dashboard`** (extends P12.4). Would require **amending `instructor-dashboard.md:95` to REMOVE "Customer email list" from OOS** — a deliberate scope-deferral decision that Klaas made when P12.4 shipped.
    - **(iii) Embed on `/partner/sales`** (extends the future P12.11 Slice 2 sales page). Would require **amending `partner-courses-sales.md:53` to REMOVE the "customer LTV/customer rollup" OOS line** — a deliberate scope-deferral decision.
    - **(iv) Embed on `/partner/courses/[id]` as a 6th tab** (per-course top customers; not portfolio-wide). Per-product view — less useful for indie-hacker partners but tighter scope. Same dashboard or sales carve-out implications.
  - **(b) Customer identification in the table** — how is each row identified?
    - **(i) `profiles.display_name` primary, masked email fallback** (RECOMMENDED — matches the existing `partner-courses-sales.md:75 + 137` pattern; respects the user's chosen identity; falls back gracefully; matches the existing customer-display contract).
    - **(ii) Masked email only** (`j***@domain.com` per `partner-courses-sales.md:134` — the Stripe/Shopify pattern). Stable across rows so the partner can recognize repeat customers. No display_name round-trip — simpler data surface.
    - **(iii) FNV-1a hash of email** (`h:abc123def`). Maximum privacy — partner can NOT recognize repeat customers across rows. Not recommended for partner UX (the partner can't reason about their top buyer).
    - **(iv) Order id only** (no email / display_name). Most minimal — degraded UX but zero privacy surface. Not recommended for partner UX.
  - **(c) Aggregation scope** — what is rolled up to compute "top customer"?
    - **(i) Portfolio-wide (RECOMMENDED — matches the partner dashboard's portfolio view)**: `sum(order.total_amount_cents)` grouped by `orders.customer_id` for ALL orders where `order_items.product_id IN (partner's products)` + refund/exclusion handling. Top-N = default 10, sort by `total_spend_cents desc`.
    - **(ii) Per-product** (filter chip on `/partner/courses/[id]`): top customers of a single product. Useful for product-specific promo targeting; tighter scope but less portfolio visibility.
    - **(iii) Per-license-tier** (whitelabel / plr / plr_mrr cohorts): joins to `order_items.license_tier`. New dimension — useful for products with multiple license tiers. Needs an additional GROUP BY.
    - **(iv) Portfolio-wide + optional `?product_id=<id>` filter** (recommended — combines (i) + (ii); default shows all products, `?product_id=<id>` filters to one).
  - **(d) Time window** — over what date range is "top" computed?
    - **(i) Lifetime** (RECOMMENDED — matches the spec's "total spend" language + the existing partner dashboard's "lifetime sales" framing). Default = lifetime; optional `?from=&to=` URL params for ad-hoc slicing in v2.
    - **(ii) Last 90 days** (trailing window — matches "Top customers this quarter" framing; partner can see who's buying recently).
    - **(iii) Last 365 days** (calendar year proxy).
    - **(iv) Configurable** (default lifetime + `?window=90d|365d|all` URL param; needs a `<WindowPicker>` client island + 3 query paths).
  - **(e) Top-N cutoff** — how many rows?
    - **(i) Top 10** (RECOMMENDED — matches the spec's "Top customers" framing + the typical SaaS analytics layout; fits on one screen at desktop widths; the data exists for 10s of customers for any partner with > 50 paid orders).
    - **(ii) Top 20** (slightly more headroom; needs a "Load more" or pagination).
    - **(iii) Top 50** (heavy; pagination required; probably overkill for v1).
    - **(iv) Configurable** (`?limit=10|20|50` URL param; needs a `<LimitPicker>` client island; deferred to v2 unless Klaas wants it).
  - **(f) Sort order** — when not pinned by top-N, what's the default + available columns?
    - **(i) Default sort: `total_spend_cents desc`** (RECOMMENDED — matches "top customers" framing + the spec's "total spend" column). One-click re-sort by `last_purchase_at desc`, `order_count desc`, `repeat_purchase_count desc` (URL-driven via `?sort=`).
    - **(ii) Default sort: `last_purchase_at desc`** ("most recent customers" — surfaces recent activity; less aligned with the "top" framing).
    - **(iii) Default sort: `order_count desc`** ("most frequent buyers" — surfaces engagement over spend).
  - **(g) Columns shown + CSV export**:
    - (i) **Columns**: rank (#), customer (masked), total spend (USD + cents mono), order count, first purchase date, last purchase date, repeat-purchase flag (boolean: > 1 order), lifetime refund count.
    - (ii) **CSV export**: optional `ExportCsvButton` client island mirroring P6.3's `ExportLedgerCsv` pattern (RFC 4180 + CRLF + decimal money + hashed customer_id in audit log + 10/hr/partner in-process rate limit + `action='partner_csv_export'` row in `admin_audit_log` with `target_kind='partner_top_customers'`). Or skip CSV and only render in HTML.
    - (iii) **Optional: "View this customer's orders" link** to a hypothetical `/partner/customers/[id]` drill-down — but per `partner-courses-sales.md:52 + 54`, the partner cannot "contact this customer" or see "this customer is also a partner/affiliate" — the drill-down would be a per-customer order list, not a profile/contact surface. Decision needed on whether the drill-down is in scope for v1.
- **RECOMMENDATION** (matches the project B2B UI = monochrome + one accent style + the P12.4 KPI-card patterns + the existing sales-spec masking primitive):
  - **(a) New `/partner/customers` standalone page** + (b) `profiles.display_name` primary + masked email fallback (mirroring `partner-courses-sales.md:75 + 137`) + (c) portfolio-wide + optional `?product_id=<id>` filter + (d) lifetime window + optional `?from=&to=` URL params in v2 + (e) top 10 + (f) default sort `total_spend_cents desc` + (g) all 8 columns + CSV export with the P6.3 audit-log shape + NO per-customer drill-down link in v1 (the spec excludes any "contact this customer" surface).
  - **Spec path**: write `01-specs/pages/partner-customers.md` (~80-120 lines matching the existing partner-portal spec shape — frontmatter + 5 sections + 10-15 acceptance criteria + open questions + implementation notes). Reference the masking pattern from `partner-courses-sales.md:134` for the email-display contract. Reference the audit-log shape from `getPartnerDashboardExtras.test.ts` for the masked-identifier convention. Reference the P12.11 README + the (future) P12.11 Slice 2 readme for the per-customer row contract.
  - **Build path** under the recommendation: 1 new RPC + 1 query + 1 RSC + 1 page route + 1 sidebar link + ~25 unit tests = ≤ 1 cron tick.
- **Resolution path** once Klaas answers the 7 scope decisions:
  1. Write `01-specs/pages/partner-customers.md` (new spec file) covering: page purpose, data model (orders + order_items + profiles join), query contract (RPC + RLS), user actions, acceptance criteria, security (masking), performance (top-10 RPC + covering index), open questions, implementation notes. Reference the masking primitive from `partner-courses-sales.md:134`.
  2. **DECISION REQUIRED** on the dashboard/sales OOS removals — does P12.13 ALSO require amending `instructor-dashboard.md:95` (if option ii/iv) or `partner-courses-sales.md:53` (if option iii)? If option (i) standalone-page is picked, **no existing spec amendments are needed** — only the new spec file.
  3. New migration `0043_partner_top_customers.sql`:
     - `get_partner_top_customers(p_partner_id, p_limit int default 10, p_product_id bigint default null)` SECURITY DEFINER STABLE RPC — returns `rank`, `customer_id uuid`, `display_name text nullable`, `masked_email text`, `total_spend_cents bigint`, `order_count int`, `first_purchase_at timestamptz`, `last_purchase_at timestamptz`, `is_repeat boolean`, `refund_count int`.
     - Authorization check inside the WHERE (`current_partner_id() = p_partner_id or is_admin()`) — same shape as P12.12's `get_partner_cohort_retention` recommendation.
     - Masking primitive inside the RPC: `masked_email = CASE WHEN split_part(email, '@', 1) = '' THEN '' ELSE left(split_part(email, '@', 1), 1) || '***@' || split_part(email, '@', 2) END` — extracts the masking logic from `partner-courses-sales.md:134` into a reusable SQL helper (or a `00-foundations/privacy/mask-email.ts` shared module if the masking also runs in JS for non-RPC reads).
     - Indexes: NEW partial covering index `(product_id) INCLUDE (quantity, line_total_cents)` already exists per migration 0030; NEW `(partner_id, status, created_at desc)` on `order_items` for the portfolio-wide scan + the optional product filter. NO new index on `orders` — the existing `orders(customer_id, created_at desc)` covers the per-customer rollup.
  4. New `02-features/partner-portal/customers/` tree:
     - `queries/getMyTopCustomers.ts` — RSC-side typed wrapper; `limit` clamped to MIN(50, requested) for safety; `product_id` validated; fail-soft on RPC error (return empty list + warn log); bigint coercion for `total_spend_cents`; defensive mapping fails closed on missing customer_id.
     - `lib/maskEmailForPartner.ts` (PURE) — the same masking primitive as `partner-courses-sales.md:134`, re-exported for reuse if other partner-side surfaces ever need it.
     - `components/TopCustomersTable.tsx` + `.module.css` — RSC component; 8 columns (rank / display_name or masked email / spend / orders / first / last / repeat flag / refund count); mono-numeric for spend (matches the P6.3 `formatMoneyShort` pattern); token-only CSS; empty state "No paid customers yet" with a CTA to `/partner/sales`; error state via the inherited `ErrorState` primitive.
     - `components/CustomerFilter.tsx` + `.module.css` — optional client island for `?product_id=<id>`; reads products via `getMyPartnerProducts` (P12.5); shareable URL.
     - (Optional) `components/TopCustomersExportCsv.tsx` + `.module.css` — client island mirroring P6.3's `ExportLedgerCsv` (or skip per spec).
  5. New page route `/partner/customers/page.tsx` — RSC + partner-gated via `requirePartner()`; `Promise.all` of top customers + products for filter; `<TopCustomersTable>` mounted in a single-column layout with `<CustomerFilter>` above; `loading.tsx` skeleton mirrors the table shape; `not-found.tsx` covers the partner-not-found case.
  6. Sidebar link in `<PartnerSidebar>` under "Analytics" → "Top customers" — entry point from the partner dashboard. Reuses the existing `PartnerSidebarActive.tsx` highlight pattern.
  7. Tests: `lib/maskEmailForPartner.test.ts` (~12 tests — first-char extraction, domain passthrough, empty-input, multi-`@` edge, unicode local-part, IDN domain fallback, no-input-inversion, input immutability); `queries/getMyTopCustomers.test.ts` (~20 tests — auth gating, limit clamping, product_id filter, happy path, RPC failure fail-soft, bigint coercion, defensive null display_name, PII safety on logs); `components/TopCustomersTable.test.tsx` (~15 tests via `renderToStaticMarkup` — table structure, column ordering, mono-numeric alignment, empty state, error state, repeat-flag rendering, dates).
  8. Spec amendments: §"P12.13 — Top customers list (2026-06-30)" Implementation notes appended to `01-specs/pages/partner-customers.md` post-build; cross-link from `01-specs/pages/partner.md` §"Analytics" so future readers find the spec; cross-link from `01-specs/pages/partner-courses-sales.md` to note the masking primitive reuse.
- **Blocker**: (a) Klaas's answers on the 7 scope decisions above. (b) No env / vendor / API integration required. (c) **Coupling with P12.12**: P12.12 (cohort grid) and P12.13 (top customers list) both consume `orders.customer_id` + `created_at` — they share data inputs but different visualizations. Can ship in any order; this STUB recommends P12.13 because it's a single-query + single-component slice (≤ 1 tick after spec lands) whereas P12.12 is a new page + new primitive + new RPC (~1.5 ticks per STUB-098 recommendation). (d) **No coupling with the existing P12.11 Slice 2 sales drill-down** — STUB-097 still owns that scope; P12.13 is orthogonal. (e) **Coupling with the standing masking primitive** — `partner-courses-sales.md:134` documents the masking pattern in spec form; the recommendation extracts it to `00-foundations/privacy/mask-email.ts` so both surfaces share the same source.
- **Why this STUB, not a build**: per the user-pref "Klaas wants asks, not workarounds", 7 scope decisions pending + existing partner-side specs EXPLICITLY exclude the work (3 independent OOS carve-outs on `instructor-dashboard.md:95` + `partner-courses-sales.md:52-54`) + no partner-side spec exists → 1 STUB. Joins the family: 5-decision STUB-096 (P12.9) + 4-decision STUB-086 (P11.4) + 5-decision STUB-087 (P11.5) + 4-decision STUB-088 (P11.6) + 4-decision STUB-085 (P9.16) + 6-decision STUB-098 (P12.12) all shipped the same pattern (ASK don't engineer around). The Phase 12 spec-gap pattern now covers P12.9, P12.12, P12.13 (3 of the 4 outstanding Phase 12 `[ ]` items).
- **Owner**: Klaas (spec + 7 scope decisions + the OOS-amendment decision if option ii/iii/iv is picked) → Mavis (cron) once spec lands.
- **Created**: 2026-06-30
- **Will ship by**: post-spec-amendment, ≤ 1 cron tick under the recommendation; ≤ 1.5 ticks if Klaas picks the configurable window (option d-iv) or per-license-tier scope (option c-iii) — those add 1 client island + 1 query path each.

---

## STUB-100 — P12.14 follow-ups (payout history drill-in + CSV + yearly totals)

- **Spec reference**: `01-specs/pages/instructor-payouts.md` §"What this page does" — the "Payouts history" section shipped this tick covers the batch surface but the spec's "User actions" + "Acceptance criteria" leave room for follow-ups.
- **What shipped (2026-06-30)**: `getPartnerPayoutsHistory(p_partner_id, p_limit)` SECURITY DEFINER RPC + partial covering index `payout_ledger_partner_batch_paid_idx (partner_id, paypal_payout_batch_id, paid_at desc) WHERE status = 'paid' AND paypal_payout_batch_id IS NOT NULL` + `<PayoutsHistoryTable>` RSC + `/partner/payouts` page wiring. NEW migration `0043_partner_payouts_history.sql`. NET = `SUM(amount_cents)` (commissions + payouts cancel); `commission_count` counts credit rows only (the actionable "sales paid out in this batch" number, NOT 2× that for the debit pairing). STUBED below are the follow-ups that surface only after a partner has lived with the section for a bit.
- **Recommended follow-ups (4 Slices; pick when needed)**:
  1. **Per-batch drill-in** — new `/partner/payouts/[batchId]` page showing the contributing commission rows for one batch. Mirrors P6.4's `/partner/payouts/[id]` ledger-entry detail shape (hero + meta strip + 2-col card list of commission rows). Implementation: filter `payout_ledger` by `partner_id = self AND paypal_payout_batch_id = $1`; group by `kind` (sale vs subscription vs refund-debit). New query `getPartnerPayoutBatch(batchId)` (~120 LOC, fail-soft, bigint coercion, RLS-gated). New component `<PayoutBatchDetail>` RSC (~90 LOC) + the route + loading skeleton + not-found. Wrap the existing `<LedgerRow>` for the commission rows. Estimated ≤ 1 tick.
  2. **PayPal Mass Payout deep-link** — `paypal_payout_item_id` is the per-row PayPal ID; clicking it should open PayPal's payout detail. Need to confirm the PayPal Mass Payout detail URL shape (changes over time); use the `paypal_payout_batch_id` → batch detail page as a fallback. Affects ~5 LOC in `PayoutsHistoryTable` + a CSV column rename in any future export. Estimated ≤ 0.25 tick when PayPal confirms the URL.
  3. **Payout history CSV export** — separate from the existing P6.3 ledger CSV. New `02-features/payouts/actions/exportPayoutsHistoryCsv.ts` (~250 LOC) — Zod-validates the limit; rate-limited (10/hr/partner, reusing the same in-process map from P6.3 Slice 2 or upgrading to a shared `00-foundations/rate-limit` if STUB-012 lands first); audit-logged (`action='payouts_history_csv_exported'`, `target_kind='payout_ledger'`, hashed identifiers). New `<ExportHistoryCsvButton>` client island. Same RFC 4180 builder pattern. Estimated ≤ 1 tick. **Hard dependency**: STUB-012 (multi-instance rate limit) decision if we want shared counters — for v1 the in-process map is fine.
  4. **Yearly totals row** — sum `amount_cents` + `commission_count` per calendar year, render a footer row at the bottom of the table. Aggregates: `(YEAR(period_start), SUM(amount_cents), SUM(commission_count))`. New query helper `getPayoutsHistoryYearlyTotals()` (~80 LOC) + small `<YearlyTotalsFooter>` component. Estimated ≤ 0.5 tick.
- **Blocker**: none of these are blocking; pick when partner feedback asks for them. Per the spec, none are acceptance criteria.
- **Why this STUB**: the spec's batch surface shipped clean and self-contained; the follow-ups are spec-ambiguous and unprompted — they'd be product-decision scope creep if I pushed them into the same tick.
- **Owner**: Mavis (cron) when Klaas asks OR when a partner ticket surfaces one of the four.
- **Created**: 2026-06-30 (P12.14 tick).
- **Will ship by**: opportunistic — no date tied.

## STUB-102 — P12.20 — Partner email notifications is BLOCKED on missing spec + Phase 17 email infra dependency + 6 scope decisions

- Phase: P12.20
- Why: AGENTS.md rule #5 forbids code without an approved spec; verified by cron `mvs_7cdcbc61f93f498d92ecadeac35fa935` (2026-06-30 08:00):
  - **`PHASES.md:511-512` is 2 lines**: *"P12.20 Partner email notifications — new sale, refund, payout sent, course approved/rejected, comment on review."* — zero acceptance criteria, zero event-to-template mapping, zero recipient policy (per-partner vs per-event-class opt-in vs always-on), zero quiet-hours / digest / per-channel throttle, zero unsubsribe surface, zero retry semantics, zero PII-scrubbing contract (which data fields cross the wire, which are masked), zero audit-log shape, zero template-authoring surface (the existing `04-platform/emails/legal/*.md` content the rest of the app uses is legal-copy markdown, NOT transactional templates — see gap below).
  - **No partner-notifications spec file exists**: `ls 01-specs/pages/ | grep -iE "partner-notif|partner-email|partner-updates|partner-notifications|notification-center"` returns 0 hits. The closest partner-side spec files (`partner-settings.md` + `partner-payouts.md` + `partner-courses.md` + `partner-courses-detail.md` + `instructor-dashboard.md` + `partner-onboarding.md`) do not cover outbound email for the 5 event classes listed in PHASES.md.
  - **Existing spec fragments touch the surface but do NOT constitute a binding spec (gap analysis across `01-specs/`):**
    - `01-specs/pages/instructor-upload.md` — acceptance criterion *"The partner receives an email confirmation of submission"* (1 line, very late in the surface list) — this is the closest existing AC, covering 1 of the 5 P12.20 event classes ("course approved/rejected" — implicitly, since the submission triggers a moderation review).
    - `01-specs/pages/partner-settings.md:115-131` — the partner-settings page spec lists a **Notifications** section that surfaces 3 partner-scoped opt-in toggles (`partner_updates_opt_in` + 2 more). This is the **opt-in UI surface** for P12.20's behavior, NOT the spec for the actual email-sending pipeline. It documents WHAT the partner can toggle, not HOW the events fire or WHICH template each event uses. The opt-in surface is tracked under STUB-101 Slices 2+ (the partner-settings remaining-sections STUB), not P12.20.
    - `01-specs/pages/admin-review.md:88` — *"Email notifications fire correctly (partner gets the right email per decision)"* — admin-review action surface, 1 line, no template map, no recipient resolution, no audit shape.
    - `01-specs/pages/partner-courses-detail.md` + `partner-courses.md` — mention *"admin notification"* and *"new sale"* in passing for the partner-facing row impact summaries ("X existing buyers keep access… Y pending payouts paused") but NEVER spec the outbound email for the partner recipient.
    - `01-specs/pages/admin-partners.md:107` — *"Slack / email notifications on new partner applications (in-app badge only in v1)"* — explicit v1 carve-out: in-app badge only; the email channel is deferred to v2. This is a PARTNER → ADMIN notification, not the partner-as-recipient outbound surface that P12.20 covers. **P12.20 is OUTBOUND from Uthena TO partners; this fragment is OUTBOUND from Uthena TO admin.**
    - **Net:** 5 scattered 1-line mentions across 5 specs, ZERO of which is a binding spec for the 5 P12.20 event classes. The pattern matches the recurring Phase 12 spec-gap family (P12.9 / P12.12 / P12.13 all blocked on the same shape).
  - **No event-to-template mapping**: PHASES.md lists 5 event classes but the `04-platform/emails/` tree has NO transactional templates tagged for partners:
    - `ls 04-platform/emails/` reveals ONLY the legal-copy tree (`emails/legal/` — terms / privacy / refund-policy / delivery / dmca / data-sharing-opt-out / verify-email / faqs/) + the cart-abandonment stub. ZERO `partner-sale-confirmation.md` / `partner-refund-alert.md` / `partner-payout-sent.md` / `partner-course-approved.md` / `partner-course-rejected.md` / `partner-review-comment.md` templates exist. The template tree needs ~5 new files before any spec can ship.
    - The closest content surface — P10.4's `04-platform/emails/legal/dmca.md` — is legal prose, NOT a transactional email template (no subject + preheader + body + unsubscribe footer + template-var contract).
    - `00-foundations/email/ses.ts` (shipped by P2.9 Slice 2) defines `EMAIL_CATEGORIES = 'transactional|marketing|consent|operational'` as a typed union + `EmailSendResult { ok, id, mode: 'ses'|'log' }` for the adapter seam — but the ONLY adapter that exists today is the env-gated no-op (P2.9 SLA — `mode:'log'` when SES key missing). No queue exists (P17.2 is `[ ]`). No suppression list (P17.3 is `[ ]`). No unsubscribe management (P17.4 is `[ ]`). P17.1 (SES adapter env-gated; no key = no-op) IS the closest infra piece — already shipped (P2.9).
  - **Critical Phase 17 dependency (the binding hard-blocker)**: P12.20 cannot ship before Phase 17 because:
    - (a) **No durable queue** (P17.2 `[ ]`). Today every server action that "would send an email" calls SES (env-gated) inline. For partner notifications, this means the webhook handler blocks on the SES round-trip — if SES is slow or down, the partner's `account.updated` Stripe webhook retries and may produce duplicate "your KYC was approved" emails. P2.9 intentionally skipped the queue to keep the seam small; P17.2 is the durable + retriable + idempotent queue that P12.20 sits behind.
    - (b) **No suppression list** (P17.3 `[ ]`). GDPR Art. 21 right to object + CAN-SPAM require honoring opt-outs. Without the suppression list, P12.20 has no way to read "is this partner opted out of `partner_updates_opt_in`?" before each send.
    - (c) **No unsubscribe management** (P17.4 `[ ]`). CAN-SPAM requires every email to carry an unsubscribe link that the recipient can click to globally opt out. The list-unsubscribe header requires a Supabase-backed table that tracks the unsubscribe state per category.
    - (d) **No SES production account wired in Doppler** (carried global blocker — also gating P4.8 + P6.7 Slice 2 + P6.10 + P12.15). Even if P17.1 + P17.2 + P17.3 + P17.4 all shipped, the actual send goes through SES which is not yet wired in Doppler for production.
    - The 4 Phase 17 blockers (a)/(b)/(c)/(d) compound into "P12.20 cannot ship until Phase 17 has shipped (or at minimum P17.1 + P17.2 + P17.3 + P17.4 — P17.5-P17.17 cover specific transactional sends, not the infra)".
  - **No data-model surface**: `_data-model.md` has NO `partner_notification_preferences` table (the partner-settings spec's 3 toggles were sketched but never migrated). The closest analog is `notification_preferences` (P9.7's `0033_notification_preferences_v2.sql`) — a 9-column customer notification-prefs table that includes `partner_updates_opt_in` + `affiliate_updates_opt_in` + `payout_notifications_opt_in` + `refund_alerts_opt_in`. Per the partner-settings spec footnote (line 145-150): *"My recommendation: yes, share the table. The columns are: ..., `payout_notifications_opt_in` (NEW), `refund_alerts_opt_in` (NEW). The last two are partner-specific; if the user is not a partner, they're null. Same table, broader schema."* — but P9.7 actually shipped the original `notification_preferences` v1 columns from the customer-settings spec WITHOUT `payout_notifications_opt_in` / `refund_alerts_opt_in`. So the foundation DOESN'T have the partner-scoped preference columns; P12.20 either needs new columns added (a 0046-style migration) OR reuses the existing `partner_updates_opt_in` boolean (sufficient for the 3 toggles in the partner-settings spec, but insufficient for the SPEC-MISSING "payout_notifications" + "refund_alerts" surface).
  - **No event-emitter seam in code**: the event-emitter hooks for `order_placed` / `refund_initiated` / `payout_sent` / `course_approved` / `course_rejected` / `review_comment_posted` DO NOT EXIST in `02-features/`. Verified by grep — no `emitPartnerEvent` / `notifyPartnerOf*` / `sendPartnerNotification` function exists today. P6.4's `/partner/payouts/[id]` source-order card DOES NOT fire a "payout approved" email (the partner would need to refresh the page to see it). P9.12's refund confirmation page DOES NOT notify the partner (the partner finds out only when the next payout ledger row appears). P14.5's partner approval workflow DOES NOT notify the partner (the partner must poll `/partner/onboarding` to see if `partners.status` flipped). The pattern is consistent: every existing partner-touching flow has NO notification hook. P12.20 cannot land without first wiring those hooks across all 5 event classes.
- **What is missing for the spec** (6 scope decisions Klaas needs to make before a single line ships):
  - **(a) Spec file strategy**: (i) new standalone `01-specs/pages/partner-notifications.md` covering all 5 event classes (RECOMMENDED — matches the existing per-surface spec shape, easy to find, one acceptance-criteria list), (ii) split per-event specs (`partner-notification-sale.md` + `partner-notification-refund.md` + ... — heavier, fragmented, harder to keep consistent), (iii) extend `partner-settings.md` + `partner-courses.md` + `partner-payouts.md` + `partner-courses-detail.md` + `admin-review.md` with one event-class AC each (matches the existing scattered-fragment pattern but does NOT constitute a single source of truth — fragile).
  - **(b) Recipient policy per event class**: (i) per-event opt-in toggle (5 separate partner-settings toggles — `partner_sale_opt_in` + `partner_refund_opt_in` + `partner_payout_opt_in` + `partner_course_status_opt_in` + `partner_review_comment_opt_in`; most flexible; trust-the-partner, fine-grained), (ii) single master toggle `partner_updates_opt_in` covers all 5 (matches the existing 1-line `partner_updates_opt_in` in `partner-settings.md:121` + `notification_preferences` table — simpler, fewer columns), (iii) always-on (no opt-in — simplest, but legally risky for any marketing-adjacent surface; CAN-SPAM fines if the email is even mildly promotional). **Recommendation:** hybrid — master `partner_updates_opt_in` covers the 4 transactional events (sale / refund / payout / course-status); a separate `review_comment_opt_in` toggle for the review-comment event class since review-comment is closer to a marketing-class communication than transactional.
  - **(c) Quiet hours + digest mode**: (i) immediate send (default; matches the "Stripe-style: send the moment the event happens" pattern; needs the queue for retry on transient SES failures), (ii) daily 9 AM digest of all events that fired in the last 24h (matches the `email_digest_freq` precedent in `notification_preferences` from P9.7 — uses the existing column), (iii) per-event-channel throttle (max 1 email per event class per hour — protects against webhook-retry storms producing 50 "your payout was sent" emails). **Recommendation:** (i) immediate for the 4 transactional events (the partner expects real-time), (iii) per-channel throttle as a safety net.
  - **(d) Unsubscribe + category management**: (i) global unsubscribe kills all 5 events + all marketing emails (CAN-SPAM compliant; matches the P9.7 master `marketing_opt_in`), (ii) per-event-class unsubscribe (5 link in each event-class email footer; matches the per-event opt-in toggle from (b)(i) — fine-grained), (iii) no unsubscribe on the 4 transactional events + per-event unsubscribe on the review-comment event (legal carve-out for transactional mail under CAN-SPAM — transactional mail is exempt from unsubscribe requirements per 16 CFR §310.5(a)(3) + similar under GDPR; matches the locked `transactional_opt_in` column in `notification_preferences`). **Recommendation:** (iii) — per-event-unsubscribe only on the review-comment event (because it's market-adjacent); the 4 transactional events have no unsubscribe link (they're transactional; CAN-SPAM exempt).
  - **(e) Template authoring surface**: (i) Markdown files at `04-platform/emails/partner/<event>.md` matching the legal-copy tree shape (frontmatter + body) — REQUIRES building a Markdown → HTML render pipeline that handles frontmatter + the TipTap-like rendering the legal tree uses (matches `04-platform/emails/legal/*.md` shape — already exists for legal copy, but transactional templates are a different surface), (ii) React Email components (the `react-email` library — `npm install @react-email/components`; transactional-email library; matches how ConvertKit / Resend ship templates; per-tick adds ~50 KB of deps + the React-Email preview server), (iii) plain HTML strings in TypeScript (simplest; no new deps; matches the cart-abandonment-recovery-email stub's shape — STUB-048 deferred to Phase 17). **Recommendation:** (iii) for v1 if Phase 17 P17.15 ships a template editor; (ii) if P17.15 ships inline — defer to that tick. For now, the scope decision is WHICH authoring surface lands first.
  - **(f) Retry + idempotency semantics for the queue**: (i) fire-and-forget with 3 retries spaced 1min / 5min / 30min (matches Stripe webhook retry cadence; matches P3.4's `processed_webhooks` idempotency-key pattern for receiver-side dedup); (ii) fire-and-forget with exponential backoff up to 24h (Resend-style; more resilient but bloats the queue); (iii) no retry — synchronous inline call to SES adapter (status quo; blocks the webhook on SES slowness; the gap that motivates the whole queue). **Recommendation:** (i) — matches Stripe webhook retry cadence + the existing P3.4 `processed_webhooks` idempotency-key pattern. **This decision is technically Phase 17 P17.2's scope**, not P12.20 — but the spec needs to call it out so the partner-notification spec aligns with the queue design.
- **RECOMMENDATION** (matches the project B2B UI = monochrome + one accent style + the partner-notifications-as-transactional-event-classes pattern + reuse-not-rebuild where possible):
  - **(a) New standalone `01-specs/pages/partner-notifications.md`** (matches the existing per-surface spec shape) + **(b) hybrid opt-in (master `partner_updates_opt_in` for 4 transactional events + separate `review_comment_opt_in` for review comments)** + **(c) immediate send with per-channel 1/hr throttle** + **(d) per-event unsubscribe only on review-comment (CAN-SPAM transactional exemption for the other 4)** + **(e) plain HTML strings in TypeScript for v1, defer to React Email / P17.15 if it ships** + **(f) fire-and-forget with 3 retries + Stripe-cadence idempotency-key pattern**.
  - **Spec path**: write `01-specs/pages/partner-notifications.md` (~150-200 lines — frontmatter + 7 sections: purpose + the 5 event-class definitions + recipient policy + unsubscribe + audit + security/PII + acceptance criteria + open questions + implementation notes). Reference the `notification_preferences` schema from P9.7 for the opt-in column reuse; reference the P3.4 `processed_webhooks` idempotency-key pattern for the retry semantics; reference the `EMAIL_CATEGORIES` typed union from P2.9 for the transactional categorization. Reference the existing legal-copy markdown tree shape at `04-platform/emails/legal/` for the file-naming convention.
  - **Build path under the recommendation** is **conditional on Phase 17 progress**:
    - If Phase 17 P17.1 + P17.2 + P17.3 + P17.4 + P17.11 ship first: ≤ 1 cron tick (5 new templates + 5 server-action hooks into the existing event sources + opt-in toggle surface).
    - If P12.20 ships BEFORE Phase 17: ~3 cron ticks (1 tick to ship a minimal ad-hoc send-and-forget queue + the 5 templates + the 5 hooks; 2 ticks to backfill the opt-in toggle surface + the unsubscribe page + the audit-log shape; deferred work filed as STUB-102 Slices 2+).
- **Resolution path** once Klaas answers the 6 scope decisions:
  1. Write `01-specs/pages/partner-notifications.md` (new spec file) covering: page purpose (this is an event-emitter spec, not a partner-visible surface), 5 event-class definitions (sale / refund / payout-sent / course-approved-or-rejected / review-comment), recipient policy (who gets each event, masking, opt-in semantics), unsubscribe + category management contract, retry + idempotency semantics, audit-log shape, security + PII contract (which fields cross the wire, which are masked), acceptance criteria per event class, open questions, implementation notes. Cross-link from `01-specs/pages/partner.md` so future readers find the spec.
  2. **DECISION REQUIRED** on the 6 scope decisions + the Phase 17 dependency. The most pressing question is: **does P12.20 ship BEFORE Phase 17 P17.1-P17.4 (with the queue + suppression list + unsubscribe management built as part of P12.20) or AFTER (with P12.20 sitting on top of the Phase 17 foundation)?** The cron recommendation is **AFTER** — the 4 Phase 17 blockers (queue + suppression list + unsubscribe management + SES live) compound into a significant scope that warrants its own phase. P12.20 is a thin Layer-2 surface over Phase 17.
  3. New migration `0046_partner_notification_preferences.sql` (conditional on (b) opt-in schema — if master toggle + review-comment toggle, no migration needed because both are already in `notification_preferences`; if 5 separate toggles, migration adds 4 columns):
     - Adds `partner_review_comment_opt_in boolean NOT NULL DEFAULT true` (NEW — matches the P9.7 transactional-locked default).
     - Adds `partner_sale_opt_in`, `partner_refund_opt_in`, `partner_payout_opt_in`, `partner_course_status_opt_in` boolean columns (4 NEW) if option (b)(i) is picked.
     - Adds `partner_notification_throttle jsonb` column tracking per-channel last-sent timestamp for the 1/hr throttle from (c)(iii).
     - Adds 3 RLS policies per column (self_read / self_write / admin_all) — mirrors the P9.7 `notification_preferences` RLS shape.
  4. New `02-features/partner-notifications/` tree:
     - `lib/event-types.ts` — typed union `PartnerEventKind = 'sale' | 'refund' | 'payout' | 'course_approved' | 'course_rejected' | 'review_comment'` mirroring PHASES.md line 511.
     - `lib/shouldFire.ts` — PURE resolver: takes `(event, partner, prefs, now)` and returns `boolean` (gates on opt-in toggle + per-channel throttle + quiet hours).
     - `lib/buildEmailPayload.ts` — PURE payload builder: takes `(event, partner, context)` and returns `{ subject, preheader, htmlBody, plaintextBody, category: 'transactional' | 'marketing' }`. Skips `unsubscribeUrl` for transactional events (CAN-SPAM exempt) and includes it for review-comment.
     - `actions/emitPartnerEvent.ts` — server-side emit; reads Phase 17 P17.2 queue (or in v0 calls SES adapter directly); audit-log row `action='partner_notified'` with `target_kind='partners'` + FNV-1a hashed partner_id + event kind + masked recipient email; fire-and-forget.
     - `actions/emitPartnerEvent.dispatcher.ts` — per-event-kind dispatcher that resolves the template + context into an SES send call.
     - `hooks/onOrderPlaced.ts` + `onRefundCreated.ts` + `onPayoutSent.ts` + `onPartnerStatusChanged.ts` + `onReviewCommentPosted.ts` — 5 typed hooks that wire into the existing event sources (P6.4 + P9.12 + P6.6's `requestPayoutAction` + P14.5's partner approval flow + the future P15.7 Q&A flow).
  5. New `04-platform/emails/partner/` tree (~5 new templates):
     - `sale-notification.md` — "You made a sale: <product> ($X.XX, <license>)" + commission line + deep-link to `/partner/payouts` for the related ledger entry.
     - `refund-notification.md` — "Refund initiated on <product>" + amount + reason + the original-sale link.
     - `payout-sent-notification.md` — "Your payout of $X.XX was sent via PayPal Mass Payout" + batch id + deep-link to `/partner/payouts?tab=history`.
     - `course-approved-notification.md` — "Your course '<title>' was approved and is now live" + storefront URL.
     - `course-rejected-notification.md` — "Your course '<title>' was not approved" + reason + re-apply instructions.
     - `review-comment-notification.md` (if (b) hybrid opt-in wins) — "New question on '<course>'" + comment excerpt + deep-link to `/partner/courses/[id]?tab=reviews`.
  6. **Sidebar link OUT OF SCOPE for P12.20** — the spec covers event emission, not a partner-visible notification center UI. A future partner-notification-center (unread badge + activity log + per-event-mark-read) is a Phase 19 P19.X surface or a v2 follow-up.
  7. Tests: `lib/shouldFire.test.ts` (~25 tests — every event-kind × every opt-in state × every throttle state × quiet hours × missing partner); `lib/buildEmailPayload.test.ts` (~20 tests — payload shape per event + masking + category resolution + unsubscribe URL inclusion logic); `actions/emitPartnerEvent.test.ts` (~15 tests — emit happy path + audit row shape + Phase 17 P17.2 queue-handoff fail-soft + idempotency-key per (f)(i)); 5 hooks tests (~60 total across the 5 hooks — covers the existing event-source integration points + the queued-when-P17.2-ships vs inline-when-not behavior).
  8. Spec amendments: §"P12.20 — Partner email notifications (YYYY-MM-DD)" Implementation notes appended to `01-specs/pages/partner-notifications.md` post-build; cross-link from `01-specs/pages/partner.md` so future readers find the spec; cross-link from `04-platform/emails/README.md` (if exists, else create one) for the template tree.
- **Blocker**:
  1. **Klaas's answers on the 6 scope decisions above.**
  2. **Phase 17 dependency**: P17.1 + P17.2 + P17.3 + P17.4 + P17.11 must ship before (or alongside) P12.20. **STRONG RECOMMENDATION: Phase 17 ships first**; P12.20 follows. The cron cannot ship P12.20 in the current order.
  3. **No env / vendor / API integration required AT THIS TICK** (the SES adapter is already env-gated per P2.9; the production SES wiring is a separate carried global blocker gating P4.8 + P6.10 + P6.7 Slice 2 + P12.15 — not P12.20 specifically, because P12.20 inherits whatever P17.1 ships).
  4. **Coupling with STUB-101** (the partner-settings remaining-sections STUB): the partner-settings spec's Notifications section (3 partner-scoped opt-in toggles) is the **opt-in surface** for P12.20's behavior. P12.20's spec should reference / mirror the partner-settings opt-in toggles; STUB-101 Slices 2+ should land before or alongside P12.20 so the opt-in surface exists when the events start firing.
  5. **Coupling with admin-review.md + admin-partners.md**: the admin-side counterparts ("email notifications fire correctly" + "Slack / email notifications on new partner applications") are PARTNER-OUTBOUND side of the same surface; the spec should reference both directions.
- **Why this STUB, not a build**: per the user-pref "Klaas wants asks, not workarounds", 6 scope decisions pending + no binding spec file exists + 5 scattered 1-line fragments in 5 different specs + Phase 17 dependency (queue + suppression list + unsubscribe management + SES live) + STUB-101 coupling (the opt-in surface) → 1 STUB. Joins the family: 5-decision STUB-096 (P12.9) + 4-decision STUB-086 (P11.4) + 5-decision STUB-087 (P11.5) + 4-decision STUB-088 (P11.6) + 4-decision STUB-085 (P9.16) + 6-decision STUB-098 (P12.12) + 7-decision STUB-099 (P12.13) all shipped the same pattern (ASK don't engineer around). **The Phase 12 spec-gap pattern now covers 4 of the 4 outstanding Phase 12 `[ ]` items — P12.9 + P12.12 + P12.13 + P12.20 all `[!]`.**
- **Owner**: Klaas (spec + 6 scope decisions + the Phase 17 ordering decision + STUB-101 sequencing) → Mavis (cron) once spec lands and Phase 17 ships.
- **Created**: 2026-06-30
- **Will ship by**: post-spec-amendment + post-Phase 17 P17.1-P17.4 + post-SES-live-wiring; ≤ 1 cron tick under the recommendation once the deps land. If Klaas opts to ship P12.20 BEFORE Phase 17, ≤ 3 ticks (the queue + suppression list + unsubscribe management must land as part of the scope). P12.20 is realistically a Phase 17-adjacent slice, not a Phase 12 slice.

## STUB-101 — /partner/settings remaining sections (out of P12.17 PHASES scope)

PHASES.md P12.17 line is "Settings: bio, headshot, social links,
public profile." The shipped Slice 1 fills that surface. The spec at
`01-specs/pages/partner-settings.md` covers the FULL settings page
(6 sections + audit strip + "API & webhooks" entry). The remaining
sections — **Notifications** (3 partner-scoped opt-ins reusing
`notification_preferences`), **Danger zone** (request suspension +
request data export), **Audit strip** (most-recent
`partner_settings_update` timestamp), **API & webhooks entry point**
(link to `/partner/settings/api`), **KYC status + upload UI** (gated
on Stripe Connect / PayPal creds per P12.15), **Tax form upload UI**
(gated on the same creds) — are out of P12.17's PHASES.md scope but
present in the spec.

**Recommendation:** file a follow-up tick after P12.19 ships
(API tokens). The notifications section can land cleanly today (no
new deps); the Danger zone needs spec scope decisions (the
suspension action is non-trivial — unpublishes products, revokes
sessions, sends admin email); KYC + Tax form are gated on the P12.15
creds. Klaas to prioritize: notifications + Danger zone first
(spec-only, no creds); KYC + Tax form land with P12.15 when creds
arrive.

**Resolved by Mavis (P12.17 tick) for the PHASES.md P12.17 scope:
bio + headshot link + social links 5-field grid + public profile
toggle. See docs/PROGRESS.md 2026-06-30 05:30 note.

## STUB-101 — /partner/settings/api — Slices 2+

P12.19 Slice 1 shipped 2026-06-30: full read + create + revoke flow
+ one-time-show modal + audit strip end-to-end against the existing
`0001_initial.sql` schema. Slices 2+ deferred to this STUB.

**Slices 2-3 deferred (per `01-specs/pages/partner-settings-api.md`
§"Implementation notes — Slice 1" + the data-model spec lines 993-1055):**

1. **Data-model-spec migration (Slice 2):**
   - Add `partner_id bigint` column to `api_tokens` (NOT NULL, references
     `partners(id)` on delete cascade).
   - Create `api_token_scope` enum + `api_token_status` enum, migrate
     `scopes text[]` → `api_token_scope[]` + add `status api_token_status
     NOT NULL DEFAULT 'active'`.
   - Add `last_used_ip inet`, `revoked_reason text`, `created_ip inet`,
     `usage_count int NOT NULL DEFAULT 0`, `usage_count_reset_at
     timestamptz NOT NULL DEFAULT now()`, `last_used_at_persisted_at
     timestamptz`.
   - Replace the 3 existing RLS policies (`api_tokens_self_read` /
     `_write` / `_revoke`) with the 4 data-model-spec policies
     (`_partner_read_own` / `_partner_insert_own` / `_partner_revoke_own`
     / `_admin_all`).
   - Add the column-level GRANT that strips `token_hash` from
     non-service-role SELECTs (the partner's session uses anon key +
     RLS; only the service-role client can read the hash for API auth).
   - Add indexes: `(partner_id, status, created_at desc)`,
     `(partner_id) WHERE status='active'`.
   - Migration must be idempotent + safe to re-run (mirrors the
     `0001_initial.sql` `create ... if not exists` + drop-policy-if-exists
     pattern).
   - Update `getMyApiTokens` + `createApiToken` + `revokeApiToken` to
     use the new schema (the read-side select stays PII-safe; the
     active-count query changes from `user_id` to a join through
     `partners`).
   - STUB-052 covers the legacy `user_id`-based row migration (rename
     the column + populate `partner_id` from a `partners WHERE user_id
     = ?` join).

2. **Audit-log modal (Slice 2):** Per spec line 42 — "View audit log"
   modal listing the last 50 `admin_audit_log` rows for this
   partner's tokens. New client island `<ApiTokenAuditLogModal>` +
   `<ApiTokenAuditLogRow>` (reuses the strip's row shape + adds
   `actor_email` masked + `target_id` + `created_at` exact). Wired
   via a "View audit log" link in the page footer.

3. **`?status=active|revoked|expired` URL-driven filter tabs (Slice 2):**
   Per spec line 41 — "Filter by status". New `<StatusTabs>` RSC
   component (chip strip matching the P6.7 pattern), URL-driven
   `?status=<value>`, the `getMyApiTokens` query accepts the filter
   (filters in SQL — the existing `revoked_at` + `expires_at` columns
   support a single index scan). Distinct empty state when filtered
   result is 0 but unfiltered list has rows.

4. **"Last used IP" column display (Slice 2):** Per spec line 12 —
   "last_used_ip (masked: 192.0.2.***)" — but the column doesn't
   exist on the current schema. Add via the Slice-2 migration, then
   extend `ApiTokenEntity` + the table cell with a `maskIp()` helper.

5. **Daily cron for active→expired flip (Slice 2):** Per data-model
   spec line 1049 — "A cron (`04-platform/ci/scripts/cron/expire-api-tokens.ts`)
   flips `active` → `expired` daily". Adds to the Phase 18 P18.7
   maintenance cron alongside the `cleanup_old_admin_audit_log()` +
   `cleanup_old_order_items()` + `cleanup_old_payout_ledger()`
   helpers. The cron would run `UPDATE api_tokens SET status='expired'
   WHERE status='active' AND expires_at IS NOT NULL AND expires_at <=
   now()` (idempotent, single round-trip).

6. **The actual API endpoint surface (Slice 3):** Per data-model spec
   line 149 + spec OQ §"API endpoint surface" — the API endpoints
   (`/api/v1/partner/sales`, `/api/v1/partner/payouts`,
   `/api/v1/partner/products`) are the consumer of the `api_tokens`
   table. Slice 3 ships the middleware (`02-features/partner/api-auth.ts`
   per the data-model spec line 1047) + the 3 read-only endpoints +
   the `api_token_usage` audit row on every API call + the
   `last_used_at` debounce (5-minute window) + the per-token 1000/hr
   rate limit. Slice 3 also ships the `/docs/api` public reference.

7. **`docs/api` public reference page (Slice 3):** Per spec line 20 —
   "Read the API docs" link to `/docs/api`. The page itself is a
   separate workstream (Markdown + openapi.yaml).

**Will ship by:** Slice 2 opportunistic once Klaas signs off on the
data-model migration (small, idempotent). Slice 3 is a v2 milestone —
the partner API endpoints need real Stripe + payouts data to be
useful, and Phase 5/6 must be live first.

## STUB-101 — /partner/settings/api — Slices 2+

(P12.19 Slice 1 tick, 2026-06-30. See PROGRESS.md 2026-06-30 06:00 note.)

## STUB-104 — P13.1 affiliate onboarding wizard — Slices 2+

(P13.1 Slice 1 tick, 2026-06-30. See PROGRESS.md 2026-06-30 07:23 note.)

Slice 1 ships the wizard route shell + 4-state dispatch + the
critical Step 2 (HandleBioStep) with race-safe handle reservation +
per-step Zod schemas + audit log + page rate limit + per-step
column merge + never-regress currentStep. 168 new tests pass.
Full suite: 3517.

The following are deferred to subsequent Slices (≤ 2 ticks each):

1. **Step 3 (Payout) form + PayPal email encryption at rest**
   (Slice 2). The PayoutPayload Zod schema + the column merge are
   already wired in Slice 1; the missing pieces are (a) the email
   encryption helper (the same `encryptString` from
   `00-foundations/security/encryption.ts` used by the partner
   payout_method), (b) the masked display surface (server-side
   masking — `k***@example.com` until the partner clicks Edit),
   (c) the audit-log row with masked before/after for every
   settings update.

2. **Step 4 (Promo methods) form** (Slice 2). The PromoMethodsPayload
   Zod schema + column merge are wired. The missing piece is the
   multi-select client island with the 7 spec-allowed channels
   (`twitter | youtube | blog | email_list | tiktok | linkedin |
   other`) + an optional `other_text` field when `other` is checked.

3. **Step 5 (Agreement) form** (Slice 2). The AgreementPayload Zod
   schema + column merge are wired. The missing piece is the two
   required checkboxes + the TOS + Affiliate Terms links. Both must
   be true to enable the Submit button on step 6.

4. **Step 6 (Submit) summary + atomic submit server action** (Slice 2).
   The deferred submit server action (a) reads the draft, (b)
   inserts the `affiliates` row with `status='pending'`, (c)
   transfers the handle reservation (in one transaction: INSERT into
   `affiliates` + DELETE from `handle_reservations`), (d) writes
   the `submitted_at` on the draft + the back-link `affiliate_id`,
   (e) writes the audit row `action='affiliate_onboarding.submitted'`,
   (f) queues 2 emails (admin alert + user confirmation — depends on
   Phase 17 P17.1 SES adapter).

5. **Avatar upload at step 2** (Slice 2+). The HandleBioPayload Zod
   schema accepts `avatar_storage_path` on the wire; the missing
   pieces are the Bunny signed PUT + ClamAV scan gate + the
   `<AvatarUploader>` client island (mirrors the P9.2 pattern from
   account-profile). Spec recommends `react-easy-crop` for the
   cropper; awaits human sign-off.

6. **Real-time debounced availability check at step 2** (Slice 2+).
   300ms-debounced preview call to a new `checkHandleAvailability`
   server action (5/sec rate limit; returns `{ available, suggestion? }`)
   with the visual `✓` / `✗` + suggested alternative ("marcus-reyes-482").
   Today the form validates shape on submit and shows server-side
   conflict errors after the save lands — same UX, just without the
   preview shimmer.

7. **7-day reservation janitor cron** (STUB-104a). Migration 0045
   ships the `expires_at` STORED column; the cron script
   (`04-platform/ci/scripts/cron/cleanup-handle-reservations.ts`)
   sweeps rows past their TTL. Idempotent — re-runs are safe. Wired
   into the Phase 18 P18.7 maintenance cron alongside the P3.3
   (admin_audit_log) + P3.5 (order_items + payout_ledger) helpers.

8. **"Start over" / restart wizard** (STUB-089 — shared with partner
   onboarding). Confirms via modal, then DELETEs the
   `affiliate_onboarding_drafts` row + DELETEs the
   `handle_reservations` row for `(user_id, draft_id)`. Released the
   handle back to the pool.

**Will ship by:** Slice 2 opportunistic on the cron — the per-step
forms (Payout + Promo methods + Agreement) are tightly scoped (≤ 1
tick combined) once the email encryption helper is wired. The atomic
submit server action + avatar upload + cron are independent and can
land in parallel.

---

## STUB-105 — P13.3 affiliate dashboard Slices 2+

P13.3 Slice 1 (2026-06-30 09:30 +07) shipped the schema foundation +
3 RSC components (header + onboarding banner + KPI cards) +
`getAffiliateDashboard` aggregator query. The dashboard renders real
data for the header / banner / 4 KPIs. The remaining P13.3 acceptance
criteria are deferred to Slices 2+:

### What's deferred (Slice 2+ roadmap)

1. **Affiliate link hero card** (Slice 2; ≤ 1 tick) — full-width
   card on top of the dashboard with the affiliate's shareable URL
   (`uthena.com/?ref=<code>`), a Copy button using the Clipboard
   API with `document.execCommand('copy')` fallback for older
   browsers, and a "Generate QR" modal (uses the `qrcode` package
   at admin-time; client-side SVG renderer keeps the bundle
   small — server render the SVG via the canonical helper). The
   default link is already created by `ensure_default_affiliate_link`
   in migration 0046 — Slice 2 just needs a `<AffiliateLinkHero>`
   RSC + a `<CopyLinkButton>` client island + a `<QrCodeModal>`
   client island. Route-only admin endpoint for SVG generation:
   `GET /api/affiliate/qr/[code]` returns the SVG. Audit-log every
   QR generation event.

2. **UTM builder** (Slice 2 or 3; ≤ 0.5 tick; lands as part of the
   link-hero card) — 3 input fields (`utm_source`, `utm_medium`,
   `utm_campaign`) that generate a tagged URL with proper
   URL-encoding. The generated URL gets a Copy button + a
   "Save as a new link" CTA (admin-tier creates a new
   `affiliate_links` row with the UTM params stored in
   `affiliate_links.campaign`). The spec says this is a v1
   delivery surface; the data model is already in place via the
   `campaign` column on `affiliate_links`.

3. **Top products by EPC** (Slice 3; ≤ 1 tick) — joins
   `affiliate_commissions` on `product_id` + clicks via
   `affiliate_links` to compute EPC = sum(commission_cents) /
   count(clicks) per product, sorted desc. New SECURITY DEFINER
   RPC `get_affiliate_top_products(p_affiliate_id, p_limit)` in
   migration 0047 — left-joins so products with no clicks but
   past commissions (refunds) drop to the bottom. The empty
   case ("You haven't promoted any products yet") explains that
   no commissions have flowed through yet. Spec data row says
   "with EPC bars" — initial render uses a token-only progress
   bar (`--teal-soft`/`--teal-line` based on percentage of best-
   performing product's EPC). Sort toggle (EPC desc default vs
   sales_count desc) lives in the spec Open Questions — Klaas's
   recommendation in `affiliate-dashboard.md:117` is EPC desc
   by default; ship that.

4. **Recent commissions table with CSV export** (Slice 4; ≤ 1.5
   ticks) — paginated table (default 20 rows, options 20/50/100)
   reading from `affiliate_commissions` joined to products, with
   status pills (pending / locked / available / paid / reversed
   — color-coded). CSV export endpoint mirrors the P6.3 + P12.11
   patterns: server action `exportCommissionsCsvAction` with
   Zod-validated filters + 10/hr/affiliate in-process rate
   limit + audit log row `action='affiliate_commissions_csv_exported'`
   + hashed identifiers in metadata. RFC 4180 builder
   (CRLF + decimal-money) reuses the existing
   `02-features/payouts/actions/exportLedgerCsv.format.ts` pattern
   — extract the CSV-building primitives to
   `00-foundations/data/csv.ts` if Slice 4 ships before Slice 2
   lands (so the link-hero CTA can reuse them later).

5. **Tools grid** (Slice 5; ≤ 0.5 tick) — 6 tiles per spec:
   "Email swipes" → `/affiliate/tools/email-swipes` (v2; v1 links
   to a hardcoded Playbook PDF), "Banners & ads" → `/affiliate/tools/banners`
   (P13.10 — v2), "Landing page builder" → `/affiliate/tools/landing-pages`
   (P13.9 — v2; v1 placeholder), "Compliance check" → `/affiliate/tools/compliance`
   (v2 — spec §"Out of scope for v1"), "Audience insights" →
   `/affiliate/tools/insights` (v2 — uses the affiliate_clicks
   time/geo/device breakdown), "Real-time alerts" →
   `/affiliate/tools/alerts` (Phase 17 P17.14 territory). v1 ships
   the grid with disabled-on-v2 CTAs per the spec acceptance
   criterion §"Open questions for human": v1 links get a
   "Coming soon — Phase X" label baked into the disabled state.

6. **Resources list** (Slice 5; ≤ 0.25 tick) — hardcoded list of
   3 items per spec data table: "Affiliate playbook (PDF)" →
   static `/files/affiliate-playbook.pdf`, "Private community
   (Discord)" → external `https://discord.gg/uthena-affiliates`
   `target="_blank"` + `rel="noopener noreferrer"`, "Video
   walkthrough" → embed `/library/watch/<intro-lesson-id>` (loops
   a 90-second Loom-style video). RSC, no client JS.

7. **`/api/affiliate/click` route** (Slice 2 additive; ≤ 0.5 tick;
   gates the link-share flow end-to-end) — POST endpoint that:
   (a) reads `code` from the URL, (b) resolves the link via
   `affiliate_links` public_read_code RLS (anon), (c) mints a
   ref cookie (30-day TTL; same name as the future split-test
   variant: `_uth_ref`), (d) inserts a `affiliate_clicks` row
   (service-role; hashed IP + UA + landing_path), (e) 302s to
   the link's `destination_path`. The dashboard's link hero card
   needs this live BEFORE affiliates can meaningfully use the
   share URL — the QR/SVG path is purely cosmetic until the
   /api route exists. Defense-in-depth: the route rate-limits
   per IP (60/min) to deter click-injection.

8. **Real affiliate-specific acceptance criteria still owed** —
   per `01-specs/pages/affiliate-dashboard.md` §Acceptance
   criteria: #3-#4 (legacy affiliate root redirect — needs DNS
   cutover to uthena.com/affiliate path), #6 ("Copy" button
   works on all browsers — Slice 2 with fallback), #7 ("Generate
   QR" produces a real, scannable QR code — Slice 2), #8 (UTM
   builder generates valid URLs — Slice 2/3), #10-#12 (Add to
   my shop toggle + Promote modal — Slice 5/6 separately; not
   in scope per P13.5/P13.9), #15 (Page renders in < 500ms p95
   — verify in dev-server smoke when Slices 2-5 land; Slice 1's
   `/affiliate` already builds at 1.36 kB / 111 kB which is
   well under the budget), #18 (audit-logged — QRs only; page
   views are not audit-logged per PII-safe guidance).

**Will ship by**: opportunistic on user-traffic-driven priority
list — Slice 2 (link hero) is the highest-value next slice (it
completes the spec's "most important element is the affiliate
link itself"); Slice 5 (tools + resources) is the lowest-value
since every tile except "real-time alerts" has a v2 placeholder.

**Dependencies**: Slice 2+ on the data surface — schema landed
in migration 0046, queries are 1 RPC call per slice. Slice 7
(`/api/affiliate/click`) gates the end-to-end share-URL flow
(without it, every affiliate click goes into the depth of a
missing route — `links` resolve but `clicks` are never recorded,
so the dashboard's `clicks_30d` KPI will stay at 0 forever in
production). Move Slice 7 to Slice 2 if any slice is unblocked
ahead of the others.

**Resolves**: P13.3 acceptance criteria #3-#8, #10-#12, #15,
#18, plus the full affiliate-link UX (link hero + UTM + QR +
click-track route) + the EPC rollup + the CSV export. Resolved
by Mavis on 2026-06-30 (P13.3 Slice 1 tick).

## STUB-111 — P13.11 /affiliate/settings — Slices 2+ (Sessions + Connected accounts + Language & region + Audit strip)

P13.11 Slice 1 (2026-06-30 14:30 +07) shipped the page route at
`/affiliate/settings` + the Profile section (`ProfileSection` with
inline `<MiniShopPreview>` live preview) + the Notifications section
(`NotificationsSection` with 4 atomic `<button role="switch">` toggles)
+ the `SettingsHub` orchestrator wrapper + the page-level
loading.tsx + the sidebar entry in `AffiliateShell`. The data layer
(`getMyAffiliateSettings` query + `updateAffiliateProfileAction` +
`updateAffiliateNotificationPrefsAction` + `UpdateAffiliateProfileInput`
+ `UpdateAffiliateNotificationPrefsInput` + 4 test files covering
the full shape) shipped pre-cron from prior work and remains
unchanged.

The remaining P13.11 spec sections land in Slice 2+:

### What's deferred (Slice 2+ roadmap)

1. **Sessions section** (Slice 2; ≤ 1 tick) — per-device sessions
   list with current-row pinned + "This device" badge + per-session
   sign-out + "Sign out everywhere" with typed-email confirmation.
   Reuse the existing P1.8 Slice 1 surface (the per-device list
   + sign-out action + sign-out-everywhere action are already
   shipped on `/account/settings`); only the page-level composition
   on `/affiliate/settings` is owed. The affiliate user is the same
   `auth.users` row as the customer; no separate session model.

2. **Connected accounts section** (Slice 3; ≤ 1 tick) — Google OAuth
   link/unlink + "always-present email" line + disabled state if
   unlinking would leave zero sign-in methods. Reuse the existing
   P1.6 `OAuthButtons` + the `supabase.auth.linkIdentity` /
   `unlinkIdentity` calls. Audit log: `oauth_link` / `oauth_unlink`
   rows to `admin_audit_log`. No new schema.

3. **Language & region section** (Slice 4; ≤ 0.5 tick) — two selects:
   locale (browser-driven `<datalist>` matching the customer-side
   `account-profile.md` surface) + timezone (same `<datalist>`).
   Writes `profiles.locale` + `profiles.timezone`. Audit row
   `affiliate_settings_self_update` with `{ before, after }` for
   `{ locale, timezone }`.

4. **Audit strip** (Slice 4; ≤ 0.25 tick) — "Last settings update:
   {time ago}" mono timestamp reading from the most-recent
   `admin_audit_log` row where `action='affiliate_settings_self_update'`
   for the current user. RSC, no client JS. Index coverage: the
   existing `(actor_id, action, created_at desc)` composite index
   from P3.3 covers this read.

5. **Spec OQ §3 — daily-digest at 9am local time** (Slice 5; ≤ 1
   tick) — the spec's notification toggle defaults assume a daily
   9am digest that fires for affiliates in their local timezone.
   Slice 1 ships the opt-in flag (`commission_notifications_opt_in`).
   Slice 5 ships the actual cron + delivery (gated on Phase 17
   email infrastructure — P17.1 SES adapter + P17.2 durable queue).

### Why Slice 1 ships Profile + Notifications only

The spec lists 5 sections × ~5 acceptance criteria each = 25
sub-criteria. The data layer (queries + actions + schemas + 5
test files) was already shipped pre-cron from prior work; only the
page-level composition was owed. Profile + Notifications is the
highest-leverage half (the two surfaces that ship the most-edited
fields). The other 3 sections each have their own auth + design
considerations that benefit from focused build ticks (e.g.
Sessions reuses P1.8, Connected accounts reuses P1.6, Language &
region is a 0.5-tick copy of the customer-side surface).

### What Slice 1 ships against the spec

- Spec §Acceptance criteria #1 (auth-gated via shell `requireRole`):
  `[x]`
- Spec §Acceptance criteria #2 (`getMyAffiliateSettings` reads
  profiles + notification_preferences + affiliates in one round-trip
  with safe defaults on missing rows): `[x]`
- Spec §Acceptance criteria #3 (Profile edits save inline within
  300ms with audit row): `[x]`
- Spec §Acceptance criteria #4 (live mini-shop preview on the right
  updates in real time): `[x]` (styled approximation per OQ §2;
  the real /[handle] is one click away via the "Open your
  mini-shop ↗" link)
- Spec §Acceptance criteria #5 (4 notification toggles are
  independent; defaults match the spec line 71):
  `[x]` (atomic toggle buttons, not debounced)
- Spec §Acceptance criteria #6 (mini-shop preview updates real-time):
  `[x]`
- Spec §Acceptance criteria #7 (bio char counter + saving disabled
  when > 280 chars): `[x]` (counter visible inline; over-typing
  shows the inline error but doesn't truncate)
- Spec §Acceptance criteria #8-#11 (Sessions, Connected accounts,
  Language & region, Manage payout method link): deferred to
  Slice 2+ (this STUB)

### Will ship by

The 3 deferred sections land in the next 3-4 cron ticks (each ≤ 1
tick per the roadmap above). The audit strip piggybacks on Slice 4
(Language & region). The Phase 17-gated daily-digest cron lands in
Slice 5 once the email infra is wired.

### Resolves

P13.11 acceptance criteria #1-#7. The remaining criteria (#8-#11)
land in Slices 2+ via this STUB.

---

## STUB-114 — P14.1 Customers list Slices 2+ (deferred 2026-06-30)

Slice 1 (this tick) ships the read path: schema (already on disk),
3 SECURITY DEFINER RPCs (risk breakdown / stats / list), 5 RSC
components, audit-logging on every page load, URL-driven
filters/sort/pagination. The bulk-action + per-row PII surfaces land
in Slices 2+:

### Slice 2 — Per-row PII clicks

- `view_customer_email` audit action — every email click on the
  customers table writes one `admin.view_customer_email` row with
  `target_id = user_id` + `metadata = { email_hash }` (the email is
  NOT logged; only the FNV-1a hash for correlation).
- Email column currently renders the raw email in plain text (so the
  admin can copy it without an extra click). Per AGENTS.md rule 2 +
  the spec line 73 ("Every email-viewing click is logged with
  `action='view_customer_email'`"), the column should render a
  "show email" button that triggers the audit + reveals the address.
  Defense-in-depth: the audit row is the proof the admin
  intentionally accessed PII (vs scrolled-past-by-accident).

### Slice 3 — Bulk actions

- Per-row checkbox + sticky `<BulkActionBar>` at the bottom when
  ≥1 selected.
- **Bulk email** — Resend batch send (one email per recipient, not
  BCC — keeps unsubscribe headers per-recipient). Modal: subject
  (required, ≤200 chars), body (TipTap rich text, required,
  ≤10,000 chars), template dropdown (4 templates: "Welcome to
  Uthena", "Refund processed", "Security alert — please review
  your account", "Account suspension notice"). **Hard cap: 100
  recipients per call** (server-side validation, not UI-only).
  Rate limit: 5/hr/admin. Audit row per send with template name +
  count.
- **Bulk suspend** — Modal: reason (non-empty after trim, ≤1000
  chars) + typed confirmation ("SUSPEND"). Banned users skipped
  with per-row warning. Per-user-atomic: each user's
  `profiles.status='suspended'` update + audit row (`suspend_customer`)
  is one transaction; failures don't roll back successful ones
  (the admin sees the partial-result list and can retry).
  Rate limit: 30/hr/admin.

### Slice 4 — CSV export

- `ExportCsvButton` client island. Builds CSV of the current filter
  (every visible column + the row index).
- Rate-limited 10/hr/admin via in-process sliding window.
- Signed URL via the canonical `signCdnUrl` helper (5-minute TTL).
- Audit row `admin.export_customers_csv` with filters + row count +
  FNV-1a hashed admin_id.

### Out of scope for v1 (per `admin-customers.md` §"What this page does NOT do")

- Inline edit of customer fields (lives on `/admin/customers/[id]`).
- Bulk ban (per-user action on the detail page).
- Mass email to ALL customers (marketing tool, v2).
- Real-time updates.
- Column customization / saved views.
- Per-admin scoped views.
- "Recently suspended" / "Recently banned" feeds.
- Risk score explainability drilldown (v2: a "why this score?" page).
- Customer impersonation (v2; gated to super_admin via P1.10).

---

## STUB-115 — P14.2 Customer detail Slices 2+ (deferred 2026-06-30)

P14.2 Slice 1 (this tick) ships the read path + Overview tab + masked-by-default PII display. The remaining tabs + actions land in Slices 2+:

### Slice 2 — Reveal interaction (PII unmask on click)

- Client island on the Overview tab that exposes a "Reveal email" +
  "Reveal IP" button next to each masked value.
- Click → server action → calls the reveal RPCs from migration 0053
  (`reveal_admin_customer_email` / `reveal_admin_customer_first_seen_ip`)
  → returns the raw value to the client.
- Client displays the value for 30 seconds, then auto-masks.
- Server writes one audit row per reveal (action key already in
  `AuditAction` enum from Slice 1: `admin.customer_detail_reveal_email`
  + `admin.customer_detail_reveal_ip`).
- Cancel button hides the value immediately.
- The auto-mask timer survives client-component unmount (uses
  `useEffect` + a `useRef` timer id, not `setTimeout` directly).

### Slice 3 — Suspend / Unsuspend / Ban actions (right rail)

- Right-rail `<CustomerActionRail>` with three buttons per spec:
  - **Suspend** — modal: reason (required, ≤500 chars) + typed
    confirmation ("SUSPEND"). On confirm: `profiles.status = suspended`,
    force-logout all sessions (calls `supabase.auth.admin.signOut(userId)`
    server-side), audit `action=admin.suspend_customer`. Banned
    customers cannot be re-suspended — the button is disabled with a
    tooltip pointing at the unban flow (v2 only).
  - **Unsuspend** — modal: optional note + typed "UNSUSPEND". On confirm:
    `profiles.status = active`, audit. Does NOT auto-revoke sessions.
  - **Ban** — visible only when `status IN (active, suspended)`.
    Modal: warning banner ("Ban is IRREVERSIBLE in v1..."), reason
    (textarea, ≥50 chars), typed confirmation ("BAN <email>"). On
    confirm: `profiles.status = banned`, force-logout all sessions,
    audit. Library grants preserved (per spec).
- All three use the rate-limit + Zod-validation + audit-log patterns
  from P6.x / P14.x. Per-action rate limits per spec line 104:
  suspend/unsuspend 20/hr/admin, ban 3/hr/admin.
- New `customer_actions` server actions module at
  `02-features/admin/customers/actions/{suspend,unsuspend,ban}Customer.ts`.
- New `customerAdminAction` AuditAction values:
  `admin.suspend_customer`, `admin.unsuspend_customer`,
  `admin.ban_customer`.

### Slice 4 — Profile tab + Edit

- Tab content: editable `display_name` / `bio` / `locale` / `timezone`
  via a `<CustomerProfileForm>` client island.
- Read-only rows: email, avatar, signup date, role.
- `updateCustomerProfileAction` server action: `requireAdmin()` + Zod
  `UpdateCustomerProfileInput` + audit `action=admin.edit_customer_profile`
  with focused { before, after } diff + revalidate the page.
- Rate limit: 60/hr/admin per spec line 104.

### Slice 5 — Orders tab

- `<CustomerOrdersTab>` RSC that reads orders via a new
  `getAdminCustomerOrders(userId, { page, perPage })` query
  (RLS-gated via service-role + paginated).
- Per-row: order ID, date, items count, total (mono money), status
  badge (reuse `<StatusBadge>` from P9.10), "Manual refund" action
  that links to `/admin/refunds?order=<id>` (the refund approval flow
  from P14.9 — once it ships).
- Pagination + URL-driven sort (date desc default).

### Slice 6 — Library tab

- `<CustomerLibraryTab>` RSC reading `library_grants` via
  `getAdminCustomerLibrary(userId)`.
- Per-row: product title, tier, source, granted_at, expires_at,
  revoked_at (if revoked), "Revoke" action.
- `revokeCustomerLibraryGrantAction`: requireAdmin + Zod grant-id +
  audit `action=admin.revoke_library_grant` (mirrors the customer
  self-revoke path with admin authority).

### Slice 7 — Refunds tab

- `<CustomerRefundsTab>` RSC reading the refund history for the
  customers orders via `getAdminCustomerRefunds(userId)`.
- Per-row: order, product, amount, status, requested_at,
  resolved_at, resolution_notes.

### Slice 8 — Reviews tab

- `<CustomerReviewsTab>` RSC reading the customers reviews via
  `getAdminCustomerReviews(userId)`.
- Per-row: product, rating, title, body, status, helpful_count,
  created_at.
- Actions: Unpublish (status=flagged, audit `admin.unpublish_review`),
  Re-approve (status=approved, audit `admin.re_approve_review`).

### Slice 9 — Sessions tab + Revoke actions

- `<CustomerSessionsTab>` RSC reading `auth.sessions` via a new
  `getAdminCustomerSessions(userId)` SECURITY DEFINER RPC (modeled
  on P1.8s `list_user_sessions` but admin-gated, no `auth.uid()`
  filter — admins see all sessions for the target user).
- Per-row: device (parsed UA), IP first 8 chars + `...`, last_active,
  current_session flag (compared against the JWT `session_id` claim of
  the admins own session — so the admin cant accidentally sign
  themselves out).
- Actions: Revoke this session (typed "REVOKE" confirmation),
  Revoke all other sessions (preserves the admins own session + the
  targets current session — wait, spec says "keep current session" of
  the admin only; the customer may not have a "current" session
  if theyre already banned/suspended — clarify).
- `revokeCustomerSessionAction` + `revokeAllOtherCustomerSessionsAction`
  server actions with rate-limit 30/hr/admin per spec line 104.

### Slice 10 — Notes tab

- `<CustomerNotesTab>` RSC + `<CustomerNotesThread>` client island.
- New `customer_admin_notes` table per spec line 22 (or reuse the
  unified `admin_notes` polymorphic approach from OQ #3 — pending
  Klaass call). Schema: `id`, `customer_id` (or `target_id`),
  `author_admin_id`, `body`, `created_at`, `updated_at`, `deleted_at`.
- 3 actions: `addCustomerNoteAction` (any admin can post),
  `editCustomerNoteAction` (own notes, <24h), `deleteCustomerNoteAction`
  (soft-delete via `deleted_at`, own + <24h).
- RLS: admin-all (no public read; the customer never sees these).
- New `customer_admin_note` AuditAction values.

### Slice 11 — Activity tab

- `<CustomerActivityTab>` RSC reading `admin_audit_log` where
  `target_id = customerUserId` (any kind). Reverse chronological,
  filterable by action kind (chip group).
- Reuses the P14.18 admin audit log search UI building blocks
  (per the spec line 24 hint), filtered to this customer.

### Slice 12 — GDPR data export + GDPR deletion request

- `<GdprExportButton>` + `<GdprDeletionRequestButton>` on the right
  rail (per spec lines 45-46).
- GDPR data export: enqueues a background job that builds the
  JSON+CSV bundle (reuse `buildMyDataExport` from
  `00-foundations/gdpr/export.ts` — already shipped from P9.16 prep),
  uploads to Bunny storage with a 7-day signed URL, writes
  `admin_audit_log` row with `action=admin.gdpr_data_export`,
  sends the customer an email with the signed URL.
- GDPR deletion request: writes
  `action=admin.gdpr_deletion_requested`, queues for super-admin
  review (the spec OQ #2 says this is bigger than a one-off spec —
  needs an ADR; flagged).
- **Re-ASK**: the GDPR-vs-7-year-retention conflict from spec OQ #2
  needs Klaass call (deletion is "approve full / approve partial /
  reject" workflow). This blocks Slice 12 from shipping end-to-end
  until Klaas answers.

### Estimated tick budget

- Slice 2: ≤ 1 tick (client island + the reveal RPCs are already in
  place from Slice 1)
- Slice 3: ≤ 1 tick (3 actions + modal + right rail)
- Slice 4: ≤ 0.5 tick (form + action, mirrors P9.1 verification slice)
- Slice 5: ≤ 1 tick (orders query + table + refund link)
- Slice 6: ≤ 1 tick (library query + revoke action)
- Slice 7: ≤ 0.5 tick (read-only refunds table)
- Slice 8: ≤ 1 tick (reviews query + 2 actions + flagged badge)
- Slice 9: ≤ 1 tick (sessions RPC + table + 2 revoke actions)
- Slice 10: ≤ 1 tick (notes schema + 3 actions + thread island)
- Slice 11: ≤ 0.5 tick (reuse audit log query building blocks)
- Slice 12: ≤ 1.5 ticks (export job + deletion workflow + email —
  blocked on Klaass GDPR-vs-retention call)

**Total: ≤ 9 ticks to ship P14.2 to [x] once all spec OQs are answered.**

### Spec OQs still blocking

- **OQ #2** (GDPR-vs-7-year-retention conflict) — blocks Slice 12.
- **OQ #3** (`customer_admin_notes` per-target table vs unified
  polymorphic) — blocks Slice 10.
- **OQ #4** (RLS-on-auth.sessions for admin reads) — the new
  `getAdminCustomerSessions` RPC will use SECURITY DEFINER + service-role
  (the same pattern as `list_user_sessions` in 0021) so this OQ is
  resolved by implementation, not by spec.
- **OQ #6** (banned customers library access) — spec says preserve.
  No code change needed.

The Reveal RPCs already exist (Slice 1 ships them ahead of the UI
slice per the data-seam-first pattern from P6.5), so Slice 2 is the
fastest path to a measurable UX win.

## STUB-116 — P13.12 — Affiliate email notifications is BLOCKED on missing spec + Phase 17 email infra dependency + 5 scope decisions

- Phase: P13.12
- Why: AGENTS.md rule #5 forbids code without an approved spec; verified by cron `mvs_b5bec39d354243a5998390486d98197b` (2026-06-30 16:30):
  - **`PHASES.md:548` is 1 line**: *"P13.12 Affiliate email notifications — new conversion, payout sent, performance milestones."* — zero acceptance criteria, zero event-to-template mapping, zero recipient policy (per-event opt-in vs master toggle vs always-on), zero quiet-hours / digest / per-channel throttle, zero unsubscribe surface, zero retry semantics, zero PII-scrubbing contract, zero audit-log shape, zero template-authoring surface, zero milestone-definition (what counts as a "performance milestone"?). Structurally identical to P12.20's 1-line PHASES.md entry.
  - **No affiliate-notifications spec file exists**: `ls 01-specs/pages/ | grep -iE "affiliate-notif|affiliate-email|affiliate-notifications|affiliate-digest|affiliate-milestone"` returns 0 hits. The closest affiliate-side spec files (`affiliate.md` + `affiliate-dashboard.md` + `affiliate-settings.md` + `affiliate-links.md` + `affiliate-minishop.md` + `affiliate-onboarding.md`) do not cover outbound email for the 3 event classes listed in PHASES.md.
  - **Existing spec fragments touch the surface but do NOT constitute a binding spec (gap analysis across `01-specs/`)**:
    - `01-specs/pages/affiliate-settings.md:71` — the affiliate-settings Notifications section lists 4 opt-in toggles (`affiliate_updates` / `commission_notifications` / `payout_notifications` / `monthly_digest`) with defaults `[false, true, true, true]`. This is the **opt-in UI surface** for P13.12's behavior, NOT the spec for the actual email-sending pipeline. It documents WHAT the affiliate can toggle, not HOW the events fire or WHICH template each event uses. The opt-in surface shipped via P13.11 Slice 1; the email-pipeline that respects those toggles is owed by P13.12.
    - `01-specs/pages/affiliate-settings.md:5` (line 1 of the spec) — *"Notifications (four opt-in toggles: affiliate program updates, commission notifications, payout notifications, monthly digest)"* — same scope: opt-in surface only.
    - `01-specs/pages/affiliate-dashboard.md:38` — *"Promote a product → Click "Promote" on a top product → Shows a modal with copy-paste email swipes, banner URLs, UTM suggestions"* — 1 line, no template, no commission-email pipeline. Different surface (PROMOTE → provide swipes for the affiliate to copy-and-paste into THEIR outgoing emails; P13.12 is UTHENA → affiliate outbound).
    - `01-specs/pages/affiliate.md` (general spec) — no references to email notifications for the 3 PHASES.md event classes.
    - **Net:** 2 fragments in 1 spec file (affiliate-settings.md), ZERO of which is a binding spec for the 3 P13.12 event classes. The pattern matches the recurring Phase 12 spec-gap family (P12.9 / P12.12 / P12.13 / P12.20 all blocked on the same shape).
  - **No event-to-template mapping**: PHASES.md lists 3 event classes (conversion / payout-sent / milestones) but the `04-platform/emails/` tree has NO transactional templates tagged for affiliates:
    - `ls 04-platform/emails/` reveals ONLY the legal-copy tree (`emails/legal/` — terms / privacy / refund-policy / delivery / dmca / data-sharing-opt-out / verify-email / faqs/) + the cart-abandonment stub + the partner-notifications templates filed at `04-platform/emails/partner/` per STUB-102 (deferred until P12.20 ships). ZERO `affiliate-conversion-notification.md` / `affiliate-payout-sent.md` / `affiliate-milestone-reached.md` templates exist.
    - The closest content surface — P10.4's `04-platform/emails/legal/dmca.md` — is legal prose, NOT a transactional email template (no subject + preheader + body + unsubscribe footer + template-var contract).
    - `00-foundations/email/ses.ts` (shipped by P2.9 Slice 2) defines `EMAIL_CATEGORIES = 'transactional|marketing|consent|operational'` as a typed union + `EmailSendResult { ok, id, mode: 'ses'|'log' }` for the adapter seam — but the ONLY adapter that exists today is the env-gated no-op (P2.9 SLA — `mode:'log'` when SES key missing). No queue exists (P17.2 is `[ ]`). No suppression list (P17.3 is `[ ]`). No unsubscribe management (P17.4 is `[ ]`). P17.1 (SES adapter env-gated; no key = no-op) IS the closest infra piece — already shipped (P2.9).
  - **Critical Phase 17 dependency (the binding hard-blocker)**: P13.12 cannot ship before Phase 17 because:
    - (a) **No durable queue** (P17.2 `[ ]`). Today every server action that "would send an email" calls SES (env-gated) inline. For affiliate notifications, this means the webhook handler blocks on the SES round-trip — if SES is slow or down, the commission-creation webhook retries and may produce duplicate "you earned a commission" emails. P2.9 intentionally skipped the queue to keep the seam small; P17.2 is the durable + retriable + idempotent queue that P13.12 sits behind.
    - (b) **No suppression list** (P17.3 `[ ]`). GDPR Art. 21 right to object + CAN-SPAM require honoring opt-outs. Without the suppression list, P13.12 has no way to read "is this affiliate opted out of `commission_notifications_opt_in`?" before each send. The opt-in toggles exist on `notification_preferences` (P9.7's `0033_notification_preferences_v2.sql`) but the queue-side enforcement requires P17.3.
    - (c) **No unsubscribe management** (P17.4 `[ ]`). CAN-SPAM requires every email to carry an unsubscribe link that the recipient can click to globally opt out. The list-unsubscribe header requires a Supabase-backed table that tracks the unsubscribe state per category. The affiliate-settings opt-in UI exists, but the unsubscribe-listener surface (the URL the link in the email body points at) is owed by P17.4.
    - (d) **No SES production account wired in Doppler** (carried global blocker — also gating P4.8 + P6.7 Slice 2 + P6.10 + P12.15 + P17.1). Even if P17.1 + P17.2 + P17.3 + P17.4 all shipped, the actual send goes through SES which is not yet wired in Doppler for production.
    - The 4 Phase 17 blockers (a)/(b)/(c)/(d) compound into "P13.12 cannot ship until Phase 17 has shipped (or at minimum P17.1 + P17.2 + P17.3 + P17.4 + P17.12 — P17.12 is the affiliate-specific delivery surface; P17.5-P17.11 cover customer-side transactional sends + P17.13 covers admin-side, not the infra)".
  - **No data-model surface for the milestone event class**: `_data-model.md` has no `affiliate_milestones` table; no `affiliate_commissions.affiliate_id + month_bucket` materialized view; no per-affiliate "best-month-ever" or "first-100-clicks" tracking. The "performance milestones" event class from PHASES.md is **completely undefined** — what counts as a milestone? Monthly best? First conversion? 100th click? 1000th commission? $1k lifetime? The spec gap is bigger than P12.20's (which had 5 events but at least each was a concrete action).
  - **No event-emitter seam in code**: the event-emitter hooks for `commission_created` / `payout_sent` / `milestone_reached` DO NOT EXIST in `02-features/affiliate-portal/`. Verified by grep — no `emitAffiliateEvent` / `notifyAffiliateOf*` / `sendAffiliateNotification` function exists today. P13.3's `getAffiliateDashboard` query (commission SUM aggregate) does NOT fire a "commission earned" event. P13.5's `getMyAffiliateLinks` query (clicks count) does NOT fire a "milestone reached" event. The pattern is consistent: every existing affiliate-touching flow has NO notification hook. P13.12 cannot land without first wiring those hooks across all 3 event classes.
  - **Reuse opportunity with P12.20**: P12.20 (STUB-102) and P13.12 are structurally identical — same 4 Phase 17 blockers, same 6-vs-5-vs-3 event class structure, same recipient-policy decision (master toggle vs per-event opt-in), same template-authoring surface, same retry semantics. The 2 surfaces should ship on top of a SHARED Phase 17 foundation. Recommended: P12.20 + P13.12 specs are written together, the implementation is shared (`02-features/notifications/` with `PartnerNotifier` + `AffiliateNotifier` adapters), and the partner-specific vs affiliate-specific event-class lists live in the same spec doc with a `recipient: 'partner' | 'affiliate'` discriminator. Avoids duplicating the queue + suppression + unsubscribe + template-rendering infra across two adjacent feature modules.
- **What is missing for the spec** (5 scope decisions Klaas needs to make before a single line ships; 4 of the 5 mirror P12.20's STUB-102 decisions — the recommendations inherit the same answer for those 4; the 5th — milestone definition — is P13.12-unique):
  - **(a) Spec file strategy**: (i) new standalone `01-specs/pages/affiliate-notifications.md` covering all 3 event classes (RECOMMENDED — matches the existing per-surface spec shape + parallels P12.20's recommendation), (ii) split per-event specs (`affiliate-notification-conversion.md` + `affiliate-notification-payout.md` + `affiliate-notification-milestone.md` — heavier, fragmented, harder to keep consistent), (iii) extend `affiliate-settings.md` + `affiliate-dashboard.md` with one event-class AC each (matches the existing scattered-fragment pattern but does NOT constitute a single source of truth — fragile).
  - **(b) Recipient policy per event class**: (i) per-event opt-in toggle (3 separate affiliate-settings toggles — `affiliate_conversion_opt_in` + `affiliate_payout_opt_in` + `affiliate_milestone_opt_in`; most flexible), (ii) reuse the 4 existing toggles from `affiliate-settings.md:71` (`affiliate_updates` master toggle covers all 3 events; `commission_notifications` covers conversion; `payout_notifications` covers payout-sent; `monthly_digest` covers milestone-digest) — no new schema, **simpler, fewer columns, FOLLOWS THE EXISTING SPEC**, (iii) always-on (no opt-in — simplest, but legally risky for the milestone class which is market-adjacent; CAN-SPAM fines). **Recommendation:** (ii) — reuse the 4 existing toggles. The `affiliate-settings.md` spec already documents the defaults `[false, true, true, true]`; the event-to-toggle mapping is: `affiliate_conversion_event → commission_notifications_opt_in=true`, `affiliate_payout_event → payout_notifications_opt_in=true`, `affiliate_milestone_event → monthly_digest_opt_in=true`. The `affiliate_updates` master toggle from P13.11 stays reserved for marketing-class affiliate-program updates (separate from the 3 transactional events).
  - **(c) Milestone definition** (P13.12-unique): what counts as a "performance milestone"? (i) Monthly best — first time the affiliate's monthly commission exceeds the previous month's best (the strongest "achievement" signal; monthly cadence), (ii) Lifetime thresholds — 100 / 500 / 1000 / 5000 clicks (gamification; matches the affiliate-dashboard's "promote" modal pattern), (iii) Commission totals — first commission / $100 lifetime / $1000 lifetime (stronger revenue signal; fewer events but more meaningful), (iv) All of the above (most coverage but the email cadence risks becoming noisy). **Recommendation:** (i) + (iii) hybrid — monthly-best + lifetime-threshold. ~12 emails/year (1/month best + the lifetime-threshold events at the moment they're crossed). The `monthly_digest_opt_in` toggle controls whether the monthly-best email fires at all; the lifetime thresholds fire as one-time events when crossed. The "milestone" surface is the only P13.12 event class that maps to the `monthly_digest` toggle; conversion + payout-sent map to the per-event toggles.
  - **(d) Unsubscribe + category management**: (i) global unsubscribe kills all 3 events + all marketing emails (CAN-SPAM compliant; matches the P9.7 master `marketing_opt_in`), (ii) per-event-class unsubscribe (3 link in each event-class email footer; matches the per-event opt-in toggle from (b)(i) — fine-grained), (iii) no unsubscribe on the 2 transactional events (conversion + payout-sent) + per-event unsubscribe on the milestone event (CAN-SPAM transactional exemption for the 2 transactional events — 16 CFR §310.5(a)(3); the milestone event is market-adjacent and needs unsubscribe). **Recommendation:** (iii) — matches P12.20's recommendation (the same transactional/marketing split).
  - **(e) Template authoring surface**: (i) Markdown files at `04-platform/emails/affiliate/<event>.md` matching the legal-copy tree shape (frontmatter + body), (ii) React Email components (the `react-email` library), (iii) plain HTML strings in TypeScript (simplest; no new deps; matches the cart-abandonment-recovery-email stub's shape — STUB-048 deferred to Phase 17). **Recommendation:** (iii) for v1 if Phase 17 P17.15 ships a template editor; (ii) if P17.15 ships inline — defer to that tick. **Same as P12.20** — reuse the decision.
- **RECOMMENDATION** (matches the project B2B UI = monochrome + one accent style + the affiliate-notifications-as-transactional-event-classes pattern + reuse-not-rebuild where possible):
  - **(a) New standalone `01-specs/pages/affiliate-notifications.md`** (parallel to P12.20's recommendation — same shape, same style) + **(b) reuse the 4 existing `affiliate-settings.md:71` toggles** (no new schema) + **(c) hybrid monthly-best + lifetime-threshold milestone definition** + **(d) per-event unsubscribe only on the milestone event (CAN-SPAM transactional exemption for the 2 transactional events)** + **(e) plain HTML strings in TypeScript for v1, defer to React Email / P17.15 if it ships**.
  - **Shared infrastructure with P12.20**: P12.20 + P13.12 SHOULD share `02-features/notifications/` with `PartnerNotifier` + `AffiliateNotifier` adapters over the same Phase 17 queue. The event-source hooks differ per feature (P6.4 / P9.12 / P6.6 for partners; the future P13.3 dashboard commission-aggregator + P6.6 for affiliates) but the queue + template-rendering + suppression-list + unsubscribe-management surface is identical. The two specs should be written together OR the affiliate spec should explicitly reference the partner spec for shared concerns.
  - **Spec path**: write `01-specs/pages/affiliate-notifications.md` (~120-160 lines — frontmatter + 6 sections: purpose + the 3 event-class definitions + recipient policy + unsubscribe + audit + security/PII + acceptance criteria + open questions + implementation notes). Reference the `notification_preferences` schema from P9.7 for the opt-in column reuse; reference the P3.4 `processed_webhooks` idempotency-key pattern for the retry semantics; reference the `EMAIL_CATEGORIES` typed union from P2.9 for the transactional categorization. Reference the existing legal-copy markdown tree shape at `04-platform/emails/legal/` for the file-naming convention. Reference P12.20's STUB-102 for the shared infrastructure concerns.
  - **Build path under the recommendation** is **conditional on Phase 17 progress**:
    - If Phase 17 P17.1 + P17.2 + P17.3 + P17.4 + P17.12 ship first: ≤ 1 cron tick (3 new templates + 3 server-action hooks into the existing event sources + reuse the P12.20 emitter for the shared concerns).
    - If P13.12 ships BEFORE Phase 17: ~3 cron ticks (1 tick to ship a minimal ad-hoc send-and-forget queue + the 3 templates + the 3 hooks; 2 ticks to backfill the opt-in toggle enforcement + the unsubscribe page + the audit-log shape; deferred work filed as STUB-116 Slices 2+).
- **Resolution path** once Klaas answers the 5 scope decisions:
  1. Write `01-specs/pages/affiliate-notifications.md` (new spec file) covering: page purpose (this is an event-emitter spec, not an affiliate-visible surface), 3 event-class definitions (conversion / payout-sent / milestone-reached — with the hybrid monthly-best + lifetime-threshold milestone definition), recipient policy (who gets each event, masking, opt-in semantics), unsubscribe + category management contract, retry + idempotency semantics, audit-log shape, security + PII contract (which fields cross the wire, which are masked), acceptance criteria per event class, open questions, implementation notes. Cross-link from `01-specs/pages/affiliate.md` so future readers find the spec. Cross-link to P12.20's STUB-102 for the shared infrastructure concerns.
  2. **DECISION REQUIRED** on the 5 scope decisions + the Phase 17 dependency + the shared-vs-split-with-P12.20 question. The most pressing question is: **does P13.12 ship BEFORE Phase 17 P17.1-P17.4 (with the queue + suppression list + unsubscribe management built as part of P13.12) or AFTER (with P13.12 sitting on top of the Phase 17 foundation)?** The cron recommendation is **AFTER** — the 4 Phase 17 blockers (queue + suppression list + unsubscribe management + SES live) compound into a significant scope that warrants its own phase. P13.12 is a thin Layer-2 surface over Phase 17, parallel to P12.20.
  3. **No new migration needed** under the recommendation (b)(ii) — the 4 existing `notification_preferences` columns from P9.7 + P13.11 Slice 1 already cover the opt-in toggle surface (`affiliate_updates_opt_in` from P9.7's v2 schema + `commission_notifications_opt_in` / `payout_notifications_opt_in` / `monthly_digest_opt_in` if P13.11's migration `0051_notification_preferences_affiliate_columns.sql` added them — verification needed: the 14:00 P13.11 log entry mentions migration 0051 but the columns listed are `UpdateAffiliateProfileInput` + `UpdateAffiliateNotificationPrefsInput` which are Zod schemas, not DB columns; the actual migration may have added the columns or may have reused the P9.7 v2 columns directly). **Verification step**: read `04-platform/migrations/0051_notification_preferences_affiliate_columns.sql` (if it exists) to confirm which columns were added. If the 3 affiliate-specific columns are NOT yet in `notification_preferences`, the P12.20-style migration (add 3 NEW columns + RLS policies mirroring P9.7) is owed.
  4. New `02-features/affiliate-notifications/` tree (mirror of P12.20's `02-features/partner-notifications/`):
     - `lib/event-types.ts` — typed union `AffiliateEventKind = 'conversion' | 'payout_sent' | 'milestone_reached'` mirroring PHASES.md line 548.
     - `lib/shouldFire.ts` — PURE resolver: takes `(event, affiliate, prefs, now)` and returns `boolean` (gates on the 4 opt-in toggles per (b)(ii) + per-channel throttle + quiet hours + milestone-cadence: monthly-best fires once per calendar month + lifetime-threshold fires once per threshold-cross).
     - `lib/buildEmailPayload.ts` — PURE payload builder: takes `(event, affiliate, context)` and returns `{ subject, preheader, htmlBody, plaintextBody, category: 'transactional' | 'marketing' }`. Skips `unsubscribeUrl` for the 2 transactional events (CAN-SPAM exempt) and includes it for the milestone event.
     - `actions/emitAffiliateEvent.ts` — server-side emit; reads Phase 17 P17.2 queue (or in v0 calls SES adapter directly); audit-log row `action='affiliate_notified'` with `target_kind='affiliates'` + FNV-1a hashed affiliate_id + event kind + masked recipient email; fire-and-forget.
     - `actions/emitAffiliateEvent.dispatcher.ts` — per-event-kind dispatcher that resolves the template + context into an SES send call.
     - `hooks/onCommissionCreated.ts` + `onPayoutSent.ts` + `onMilestoneReached.ts` — 3 typed hooks that wire into the existing event sources (the future P13.3 dashboard commission-aggregator + P6.6's `requestPayoutAction` + the future milestone-detection cron for the monthly-best + lifetime-threshold surface).
  5. New `04-platform/emails/affiliate/` tree (~3 new templates):
     - `conversion-notification.md` — "You earned a $X.XX commission on <product> (<license>)" + commission line + deep-link to `/affiliate` for the related dashboard surface.
     - `payout-sent-notification.md` — "Your payout of $X.XX was sent via PayPal Mass Payout" + batch id + deep-link to `/affiliate/payouts` (or `/affiliate` if the payouts route doesn't exist yet — Vercel doesn't have affiliate payouts yet; reuse the partner pattern).
     - `milestone-reached-notification.md` — "🎉 You hit a new milestone: <monthly-best|lifetime-threshold>" + the specific metric + congratulatory copy + deep-link to the affiliate dashboard.
  6. **Sidebar link OUT OF SCOPE for P13.12** — the spec covers event emission, not an affiliate-visible notification center UI. A future affiliate-notification-center (unread badge + activity log + per-event-mark-read) is a Phase 19 P19.X surface or a v2 follow-up.
  7. Tests: `lib/shouldFire.test.ts` (~25 tests — every event-kind × every opt-in state × every throttle state × quiet hours × missing affiliate + milestone-cadence: monthly-best fires-once-per-month + lifetime-threshold fires-once-per-cross); `lib/buildEmailPayload.test.ts` (~20 tests — payload shape per event + masking + category resolution + unsubscribe URL inclusion logic + monthly-best template + lifetime-threshold template); `actions/emitAffiliateEvent.test.ts` (~15 tests — emit happy path + audit row shape + Phase 17 P17.2 queue-handoff fail-soft + idempotency-key per the (e) recommendation); 3 hooks tests (~45 total across the 3 hooks — covers the existing event-source integration points + the queued-when-P17.2-ships vs inline-when-not behavior + milestone-cadence enforcement).
  8. Spec amendments: §"P13.12 — Affiliate email notifications (YYYY-MM-DD)" Implementation notes appended to `01-specs/pages/affiliate-notifications.md` post-build; cross-link from `01-specs/pages/affiliate.md` so future readers find the spec; cross-link from `04-platform/emails/README.md` (if exists, else create one) for the template tree. **Cross-link to STUB-102** so future readers find the shared infrastructure.
- **Blocker**:
  1. **Klaas's answers on the 5 scope decisions above** (4 inherit from P12.20's STUB-102; 1 is P13.12-unique — the milestone definition).
  2. **Phase 17 dependency**: P17.1 + P17.2 + P17.3 + P17.4 + P17.12 must ship before (or alongside) P13.12. **STRONG RECOMMENDATION: Phase 17 ships first**; P13.12 follows. The cron cannot ship P13.12 in the current order.
  3. **No env / vendor / API integration required AT THIS TICK** (the SES adapter is already env-gated per P2.9; the production SES wiring is a separate carried global blocker gating P4.8 + P6.10 + P6.7 Slice 2 + P12.15 — not P13.12 specifically, because P13.12 inherits whatever P17.1 ships).
  4. **Coupling with STUB-111** (the affiliate-settings remaining-sections STUB): the affiliate-settings spec's Notifications section (4 opt-in toggles) is the **opt-in surface** for P13.12's behavior. P13.12's spec should reference / mirror the affiliate-settings opt-in toggles; STUB-111 Slice 1 (already shipped) ensures the opt-in surface exists today when the events start firing.
  5. **Coupling with P12.20 / STUB-102**: P12.20 + P13.12 SHOULD share infrastructure. The recommended build path explicitly mirrors P12.20's structure (`02-features/affiliate-notifications/` mirrors `02-features/partner-notifications/`). Writing both specs together (or referencing STUB-102 from STUB-116) keeps the shared concerns aligned.
  6. **Verification step**: confirm `04-platform/migrations/0051_notification_preferences_affiliate_columns.sql` (P13.11 Slice 1 migration) actually added the 3 affiliate-specific columns (`commission_notifications_opt_in` / `payout_notifications_opt_in` / `monthly_digest_opt_in`) — if not, a new migration is owed under decision (b)(ii).
- **Why this STUB, not a build**: per the user-pref "Klaas wants asks, not workarounds", 5 scope decisions pending + no binding spec file exists + 2 fragments in 1 spec file + Phase 17 dependency (queue + suppression list + unsubscribe management + SES live) + STUB-111 coupling (the opt-in surface) + P12.20 coupling (shared infra) → 1 STUB. Joins the family: 5-decision STUB-096 (P12.9) + 4-decision STUB-086 (P11.4) + 5-decision STUB-087 (P11.5) + 4-decision STUB-088 (P11.6) + 4-decision STUB-085 (P9.16) + 6-decision STUB-098 (P12.12) + 7-decision STUB-099 (P12.13) + 6-decision STUB-102 (P12.20) all shipped the same pattern (ASK don't engineer around). **Phase 13 is now 1-of-1 outstanding `[ ]` items `[!]` on spec gap — the only remaining `[ ]` in Phase 13 was P13.12; it's now blocked too.**
- **Owner**: Klaas (spec + 5 scope decisions + the Phase 17 ordering decision + STUB-111 sequencing + the milestone-definition decision unique to P13.12) → Mavis (cron) once spec lands and Phase 17 ships.
- **Created**: 2026-06-30
- **Will ship by**: post-spec-amendment + post-Phase 17 P17.1-P17.4 + post-SES-live-wiring; ≤ 1 cron tick under the recommendation once the deps land (parallel to P12.20). If Klaas opts to ship P13.12 BEFORE Phase 17, ≤ 3 ticks (the queue + suppression list + unsubscribe management must land as part of the scope). P13.12 is realistically a Phase 17-adjacent slice, not a Phase 13 slice — and it pairs naturally with P12.20 since both are Layer-2 surfaces over Phase 17.


### [STUB-117] /admin/partners bulk actions + CSV export + per-row PII clicks
- Phase: P14.3 Slices 2+
- Why: P14.3 Slice 1 (this tick, 2026-06-30) shipped the read path end-to-end:
  the 5-card stats row, the URL-driven filter form (q / status / kycStatus /
  taxFormStatus / appliedFrom / appliedTo), the paginated table (50/page,
  sortable on name / applied / revenue / paid / courses / activity), the
  URL-driven pager with "…" gaps, the per-page-load
  `admin.partners_list_viewed` audit-log row, and the row → /admin/partners/
  [id] link. The 4 spec acceptance criteria for bulk actions (bulk approve
  + bulk suspend + per-partner atomicity + CSV export) and the per-row PII
  audit-log clicks are deferred to Slices 2+. Shipped as `[~]` to reflect
  "code complete; staging / per-row write actions deferred."
- Blocker: design decisions only; no env / vendor / API integration required.
  (a) Bulk approve per-partner transactional shape — same `bulkApprovePartners`
  server action pattern as P14.1's STUB-114 (per-row UPDATE wrapped in a
  transaction with audit row, `kyc_status='none' AND tax_form_status='none'`
  guard per the spec's OQ §2 recommendation). (b) Bulk suspend typed "SUSPEND"
  + non-empty reason textarea — same `bulkSuspendPartners` pattern as P14.1.
  (c) CSV export 10/hr/admin in-process rate limit + signed URL with
  5-minute TTL via the canonical `00-foundations/files/signed-url.ts` +
  audit row `action='partners_csv_exported'` + `uthena-partners-YYYY-MM-DD-HH-mm.csv`
  filename — same shape as P14.1's STUB-114 CSV action. (d) Per-row
  `view_partner_email` audit logging when the admin clicks the email
  column to reveal the masked hash (mirrors P14.2's Reveal pattern).
- Owner: Mavis (next cron tick or next Phase 14 session)
- Created: 2026-06-30
- Will ship by: ≤ 1 cron tick once design confirmed (the audit-log shape +
  bulk-action UX is identical to P14.1's STUB-114 pattern, so the work is
  straightforward once Klaas confirms; estimated ≤ 1 tick for bulk
  approve + bulk suspend + per-row reveal + CSV export).

### [STUB-118] /admin/partners/[id] Slices 2-10 (Profile / KYC / Tax / Courses / Sales / Payouts / Refunds / Notes / Activity)
- Phase: P14.4 Slices 2-10
- Why: P14.4 Slice 1 (this tick, 2026-06-30 17:30 +07) shipped the read path end-to-end:
  the route at `/admin/partners/[id]` (RSC + `requireAdmin()` + page-level
  `requireAdmin()` belt-and-suspenders + URL-driven `?tab=` parse via
  `parsePartnerDetailTab` 10-tab allowlist), the audit-log row per page load
  (`admin.partner_detail_viewed` with `target_kind='partners'`,
  `target_id=partner.id` as bigint string, `metadata={tab, partner_id}`),
  the 10-tab nav (`PartnerDetailTabs` RSC + token-only CSS), the Overview tab
  end-to-end (`PartnerDetailOverview` with status badges for partner status +
  KYC + tax + 6-card lifetime stats grid + masked-by-default email + masked
  PayPal email + identity section with `partner.id` / `user_id` /
  `royalty_pct_bps` / dates), the masked-payout-email flow (server-side
  `decryptStringOrPassThrough` + `maskEmail` from `@foundations/data/mask`
  — raw plaintext never crosses the wire to the client), the
  `ComingSoonTab` placeholder surface for the 9 deferred tabs (real
  styled panel that documents what each deferred tab will contain; no
  `TODO`/`FIXME` in code per AGENTS.md rule 4), the `loading.tsx` skeleton
  mirroring the page shape (header + 10-tab nav + 4-section cards with
  `Skeleton` primitives), the `not-found.tsx` 404 surface with breadcrumb
  back to `/admin/partners`, and the route CSS modules (`page.module.css`
  + `loading.module.css` + `not-found.module.css`). Slice 1 ships 14 new
  files (1 migration + 5 pure helpers + 1 query wrapper + 1 audit helper +
  3 components + 2 route layouts + 4 CSS modules — the `PartnerDetailOverview.module.css`
  was implicit). 67 new unit tests across 3 test files (`parsePartnerDetailId.test.ts`
  43 + `parsePartnerDetailTab.test.ts` 23 + `getAdminPartnerDetail.test.ts`
  ~14) covering bigint validation (decimal/scientific/hex/CRLF/SQL/shell/unicode
  rejection + positive 16-digit range + MAX_SAFE_INTEGER boundary + zero
  rejection) + tab allowlist (10-tab exhaustive + 10 rejection shapes +
  array form) + RPC happy path + defensive coercion + masked-by-default
  payout email + PII safety (raw email preserved in payload but masked form
  is the render target). Marked `[~]` per cron protocol ("code complete,
  staging / Slices 2-10 deferred").
- Blocker: design decisions + schema additions + per-tab data-layer
  queries. Per the spec (`01-specs/pages/admin-partner-detail.md` line 64-78),
  the 9 deferred tabs need:
  (1) **Profile tab (Slice 2)**: editable form for `profiles.display_name`,
      `profiles.bio`, `partners.bio`, `partners.website_url`; audit-log
      before/after diff on save; rate-limit 60/hr/admin. Pure RSC form
      with debounced save (matches the existing customer-detail Profile
      tab pattern).
  (2) **KYC tab (Slice 3)**: requires schema additions (per spec OQ §2)
      — `kyc_reviewed_at` / `kyc_reviewed_by` / `kyc_rejection_reason` /
      `gov_id_front_storage_path` / `gov_id_back_storage_path` columns on
      `partners`; document preview via 4h-TTL signed URLs (Bunny Storage);
      Approve / Reject / Request-resubmit actions with typed confirmation;
      rate-limit 30/hr/admin on document views; `admin.review_partner_kyc`
      audit row per action.
  (3) **Tax tab (Slice 4)**: tax_id masked-by-default (Stripe/Shopify
      `j***@...` pattern); explicit Reveal button with 30s auto-mask +
      `admin.reveal_partner_tax_id` audit row per click (one of the
      most-sensitive single actions on the page); W-9 file preview via
      signed URL; mark-approved / mark-submitted / mark-none actions with
      typed confirmation.
  (4) **Courses tab (Slice 5)**: every product owned by the partner
      (title + kind + status + price + sales_30d + lifetime_revenue +
      rating + last_sale_at); status pills (draft / in_review / published /
      unpublished / archived); inline link to admin product detail.
  (5) **Sales tab (Slice 6)**: paginated `order_items` joined with orders
      + products; customer email masked per row with explicit Reveal +
      audit; default 20/page sorted by date desc.
  (6) **Payouts tab (Slice 7)**: full `payout_ledger` history; inline
      "Trigger payout" reusing `triggerManualBatch` from P6.7 (5/day/admin
      rate limit); inline "Adjust" appending a corrective `adjustment`
      row (never UPDATE the original per `_data-model.md` rules);
      `admin.adjust_partner_ledger` audit row per adjust.
  (7) **Refunds tab (Slice 8)**: full refunds history joined with
      orders + order_items; status pills; link to admin refund approval
      queue (P14.9) for unresolved refunds.
  (8) **Notes tab (Slice 9)**: `partner_admin_notes` table already exists
      in `0001_initial.sql` with admin-only RLS; add note via textarea +
      "Post" button; edit / soft-delete own notes within 24h; cross-partner
      note leak impossible via the existing RLS policy.
  (9) **Activity tab (Slice 10)**: every `admin_audit_log` row where
      `target_table='partners' AND target_id = self.id`, plus related
      events (refund, payout, product actions); reverse chronological;
      filter chips by action kind; PII-redacted display.
- **Estimated**: 9 slices × ≤ 1 cron tick each ≈ 9 ticks total. Each slice
  follows the established P14.2 customer-detail pattern (pure RSC +
  defensive coercion + masked-PII + audit-log row + token-only CSS +
  `comingSoon` panel for the not-yet-landed tabs).
- **No env / vendor / API integration required at this tick** for any of
  the 9 deferred slices (Stripe Connect gating P6.10 doesn't block the
  per-tab read paths; the live creds only matter for the actual KYC doc
  upload + tax form upload + payout trigger actions, all of which can
  ship env-gated with `[~]` like P4.10).
- **Coupling with P12.20 / Phase 17**: P12.20 partner email notifications
  (STUB-102) is unrelated to P14.4's surface work — P14.4 only ships the
  admin's read/write paths on top of existing tables.
- **Owner**: Mavis (next cron tick or any future Phase 14 session).
- **Created**: 2026-06-30
- **Will ship by**: ≤ 9 cron ticks once the 9 per-tab surfaces are scoped;
  the per-tab work is mechanical given the P14.2 customer-detail template.
  Slice 2 (Profile) lands first (zero schema additions, just an editable
  form on top of the existing partners + profiles columns).

### [STUB-119] P14.5 Slices 2+ — onboarding review queue + request-more-info + approval email queueing
- Phase: P14.5 Slice 1 (this tick, 2026-06-30) shipped the right-rail
  approve / suspend / unsuspend actions on `/admin/partners/[id]` end-to-end:
  3 server actions (`approvePartnerAction` + `suspendPartnerAction` +
  `unsuspendPartnerAction`) + 3 Zod schemas (`ApprovePartnerInput` +
  `SuspendPartnerInput` + `UnsuspendPartnerInput`) + 3 typed-confirmation
  modals (`ApprovePartnerModal` + `SuspendPartnerModal` +
  `UnsuspendPartnerModal`) + the right-rail
  `<PartnerActionRail>` client island (status-aware CTA selection,
  token-only CSS, sticky on desktop ≥ 1024px) + in-process rate limit
  (`approveSuspendRateLimit.ts` 20/hr/admin SHARED across the three
  transitions per spec line 99) + 3 AuditAction enum values
  (`admin.partner_approved` + `admin.partner_suspended` +
  `admin.partner_unsuspended`) + 79 new unit tests (10 rate-limit + 12
  approve + 17 suspend + 9 unsuspend + 31 rail component).
- The deferred Slice 2+ surfaces are:
  - **(a) Onboarding review queue** — a dedicated `/admin/partners/queue`
    (or `/admin/partners/applications`) route listing pending partners
    with their onboarding draft payload (the `partner_onboarding_drafts.payload`
    JSONB column) + age + KYC posture + tax posture. Inline "Review →
    approve / request info / reject" CTAs that deep-link to the detail
    page's right rail. Needs: new `get_admin_partners_queue()` SECURITY
    DEFINER RPC joining partners + partner_onboarding_drafts + the
    onboarding-decision columns (which don't exist yet — see (c)) +
    a new `<PartnerQueue>` client island. **Spec gap**: `01-specs/pages/admin-partner-detail.md` describes the partner detail's right rail
    but does NOT cover the queue list page; that needs a new spec or
    an amendment. **Estimated**: 1-2 ticks once spec lands.
  - **(b) "Request more info" action** — sends the partner back to
    `/partner/onboarding/welcome` with a typed "MORE INFO" confirmation
    modal + a required reason textarea (parallel to suspend). Writes one
    `admin.partner_info_requested` audit row with the reason in
    metadata. **Status semantics**: sets `partners.status` to
    'pending' (already the default), inserts a `partner_onboarding_drafts`
    row with `current_step` reset to 1 (the partner restarts the
    wizard), and `submitted_at` cleared so the partner can re-submit.
    **No spec coverage** — the spec only mentions "request info"
    obliquely in PHASES.md line 501 (`Partner approval workflow — review
    submitted onboarding, request more info, approve/suspend`); the
    state machine for re-applying needs a decision (does the wizard
    reset to step 1? does it preserve prior payload?). **Estimated**:
    ≤ 1 tick once the state-machine decision is made.
  - **(c) Approval email queueing** — the spec (admin-partner-detail.md
    lines 38-40) says the approve/suspend/unsuspend actions "queue
    approval email" / "queue suspension email" / "queue unsuspension
    email" to the partner. Slice 1 deliberately does NOT queue emails
    — Phase 17 (P17.x email pipeline) is the gate (per STUB-102 +
    STUB-053 the live SES creds aren't wired in Doppler yet, and the
    Phase 17 queue + suppression list + unsubscribe surface are still
    in `[ ]`). When Phase 17 lands, add `enqueuePartnerEmail({ partner_id,
    kind: 'partner_approved' | 'partner_suspended' | 'partner_unsuspended',
    reason? })` call to each action (after the audit row, fail-soft).
    **Estimated**: ≤ 0.5 tick once Phase 17 ships — pure additive call
    in the existing action functions.
  - **(d) Bulk approve on the list page** — already deferred as STUB-117
    Slice 2. Tightly coupled to this stub because the admin's "queue"
    use case overlaps with the list page's bulk approve path. The
    right decision is to make the queue the canonical approval surface
    (no bulk approve on the list) once the queue ships, or vice versa.
    **Recommendation**: defer the bulk-approve decision until the queue
    lands; one of them is the canonical surface, not both.
- **What is NOT deferred** (Slice 1 already shipped end-to-end):
  - Status-aware CTA on the right rail
  - Typed "APPROVE" / "SUSPEND" / "UNSUSPEND" confirmations
  - Required reason textarea on suspend
  - 20/hr/admin in-process rate limit (shared bucket across all 3
    transitions per the spec line 99)
  - Three distinct audit rows (`admin.partner_approved` +
    `admin.partner_suspended` + `admin.partner_unsuspended`) with
    before/after status + the admin's actor_email (PII-safe metadata —
    no partner PII crosses the audit log)
  - Status guards (can't approve an already-approved partner; can't
    suspend a pending partner; can't unsuspend a non-suspended partner)
  - `approved_at` / `approved_by` preservation on suspend→approved
    round-trips (unsuspend preserves the original approval date)
  - Spec acceptance criteria coverage for admin-partner-detail.md
    lines 38-40 + 71 + 99 (rate limit) + 100 (typed confirmation)
- **Spec ↔ implementation deviation**: None. Slice 1 ships exactly what
  the spec describes for the right-rail approve/suspend/unsuspend
  actions; the deferred surfaces (queue + request-info + emails) are
  explicitly called out as v2 follow-ups in the spec's Out-of-scope
  section.
- **Coupling with P12.20 / Phase 17**: the email-queueing piece is
  identical to P12.20's blocker (STUB-102) — both need the Phase 17
  email queue + SES adapter to ship first.
- **Coupling with STUB-117**: the bulk-approve deferred surface on
  the partners list page overlaps with the proposed onboarding queue
  (a). One of them should be the canonical approval surface; not both.
  Recommendation in (d) above.
- **No new env / vendor / API integration** required for Slice 2+
  (a) + (b). Slice 2+ (c) is blocked on Phase 17 env wiring
  (`SES_*` + `RESEND_API_KEY` or `AWS_SES_*`) — same global blockers
  as P4.8 / P6.10 / STUB-053 / STUB-102.
- **Owner**: Mavis (next cron tick or any future Phase 14 session).
- **Created**: 2026-06-30
- **Will ship by**: ≤ 4 cron ticks once the spec gaps are resolved
  (queue page ≈ 1-2 ticks + request-more-info ≤ 1 tick + email
  queueing ≤ 0.5 tick — total ≤ 3.5 ticks).

### [STUB-120] P14.6 — /admin/affiliates bulk actions + CSV export + per-row PII clicks + detail page
- Phase: Phase 14 (Admin console) — P14.6 Slice 1 shipped 2026-06-30 (`/admin/affiliates` list page + stats + filters + sort + pagination + audit log). Slices 2+ deferred.
- Why: P14.6 Slice 1 ships the read path end-to-end (5 stat cards + 11-col table + URL-driven filters + sortable headers + pagination + audit log per page load) using the existing affiliate data layer (migrations 0046 + 0047 + 0048 + 0049 + 0050). Slice 1 satisfies the admin-look-up surface; the write-side actions (bulk approve + bulk suspend + per-row PII clicks + CSV export) and the per-affiliate detail page (`/admin/affiliates/[id]`) are deferred because (a) they require atomic UPDATE discipline on the `affiliates` table + per-affiliate audit log writes, (b) they require typed-confirmation modals matching the partner approval pattern from P14.5, (c) the CSV export needs a per-admin rate-limit + signed-URL delivery + 5-minute TTL, (d) the detail page is its own substantial slice (mirrors the `/admin/partners/[id]` 10-tab structure from P14.4 — Profile / Payouts / Refunds / Commissions / Clicks / Settings / Notes / Activity / Linked Products / Compliance).
- What ships in Slice 1 (current): 5 stat cards (total / pending / suspended / approved_this_month / this_month_commission_paid_cents) + 11-col table (name + handle + email + status + lifetime_earned + pending + available + clicks_30d + conversions_30d + conversion_rate + last_activity) + 4 URL-driven filters (q + status + joinedFrom + joinedTo) + 10 sortable headers (5 column families × asc/desc) + URL-driven pagination + audit log per page load (`admin.affiliates_list_viewed` with the filter bag + sort + page + result count in metadata).
- What's missing (Slices 2+):
  - **(a) Bulk approve action** — auth-gated admin-only, takes a list of affiliate_ids from the sticky action bar; for each affiliate where `status='pending'`, sets `status='approved'` + `approved_at=now()` + **mints the default `affiliate_links` row** (code = handle, destination_path = `/`, per spec OQ #2 — bulk approve also mints the default link per affiliate); audit row per affiliate (`admin.affiliate_approved`); fail-soft on the audit-write; per-affiliate-atomic so one failure doesn't roll back others. Shared in-process rate limit 30/hr/admin (matches the partner STUB-117 pattern).
  - **(b) Bulk suspend action** — auth-gated admin-only, takes the selection list + a required reason textarea (1-500 chars after trim, matches the partner STUB-117 pattern) + typed confirmation "SUSPEND"; for each affiliate where `status IN ('approved', 'pending')`, sets `status='suspended'`; audit row per affiliate (`admin.affiliate_suspended`) with `metadata.reason`; same shared rate-limit bucket.
  - **(c) Per-row PII clicks** — masked-by-default email display; "Reveal" button writes one audit row (`admin.affiliate_detail_reveal_email`) + flips the email to plaintext for 30s then auto-masks; per-row "View commissions" link to the future detail page's Commissions tab.
  - **(d) CSV export** — admin clicks "Export CSV" → Zod-validated filters → 10/hr/admin rate-limit (in-process Map per spec line 89) → `buildAffiliatesCsv` mirrors the `buildLedgerCsv` from P6.3 Slice 2 (RFC 4180 + CRLF + decimal money + ISO dates + null handling) → signed URL with 5-minute TTL → one audit row (`admin.affiliates_csv_exported`) with filter bag + row count + hashed admin email.
  - **(e) Per-row action column** — checkbox per row; sticky bottom action bar appears at the bottom when ≥1 selected; per-row "View affiliate" link to `/admin/affiliates/[id]`.
  - **(f) Detail page** — new migration `0057_admin_affiliate_detail.sql` + RPC `get_admin_affiliate_detail(p_affiliate_id)` (one round-trip via laterals: affiliate + profile + lifetime earnings + clicks_30d + conversions_30d + lifetime_paid_out + recent commissions + recent clicks + pending payout requests + audit-log strip) + 10-tab nav (Profile / Earnings / Commissions / Clicks / Links / Payouts / Refunds / Notes / Activity / Linked Products) + masked-by-default payout email + Reveal interaction (30s auto-mask + audit row) + Approve/Suspend right-rail matching the partner P14.5 pattern. Mirrors `/admin/partners/[id]` slice 1.
- Resolution path: ~2-3 cron ticks (S2: bulk approve + bulk suspend + per-row PII clicks + CSV export = ~1.5 ticks; S3: per-row action column + sticky bulk-action bar + the detail page = ~1.5 ticks). The blocked-on-creds pieces (none for P14.6 — the entire feature is local to the affiliate data layer) can ship without external service dependencies. Pattern reuses the partner STUB-117 / P14.1 STUB-114 shapes.
- Blocker: none — the read path + masked-by-default PII + audit log per page load are already shipping in Slice 1; the bulk actions + CSV export + detail page are additive UI work that follows established patterns.
- Owner: Mavis (next cron tick or any future Phase 14 session)
- Created: 2026-06-30
- Will ship by: ≤ 2-3 cron ticks after Slice 1 (estimated ≤ 1.5 ticks per slice).

### [STUB-121] P14.7 Slices 2+ — /admin/orders CSV export + manual refund button + payment method + per-row PII clicks + detail page
- Phase: Phase 14 (Admin console) — P14.7 Slice 1 shipped 2026-06-30 (`/admin/orders` list page + stats + 7 filters + table + pagination + audit log). Slices 2+ deferred.
- Why: P14.7 Slice 1 ships the read path end-to-end (5 stat cards + 9-col table + URL-driven filters + pagination + audit log per page load) using the existing `orders` data layer. Slice 1 satisfies the admin look-up surface; the write-side affordances (manual refund with 14d admin-grace-window gate, CSV export with Bunny Storage signed URL, per-row PII clicks) and the per-order detail page (`/admin/orders/[id]`) are deferred because (a) the CSV export needs a per-admin rate-limit + signed-URL delivery + 24h TTL + `file_downloads` audit logging, (b) the manual refund button is wired into the spec's grace-window check (renders for paid orders where `now() - created_at < REFUND_WINDOW_DAYS + 14d`; on older paid orders the button hides) + typed-confirmation modal matching the partner approval pattern, (c) the spec calls for a per-order `card_brand` + `card_last4` denormalized onto `orders` (the columns do NOT exist on the v1 `orders` table — would require a new migration + a webhook handler that writes on `payment_intent.succeeded`), (d) the detail page is its own substantial slice mirroring the customer-detail tab structure from P14.2.
- What ships in Slice 1 (current): 5 stat cards (total / paid / refunded / paid_revenue_mtd_cents / failed) + 9-col table (order_id + date + customer display_name + customer email + total_cents + items_count + partner_share_cents + affiliate_handle) + 7 URL-driven filters (customerEmail / status / from / to / affiliateId / productId / partnerId) + pagination + audit log per page load (`admin.orders_list_viewed` with the filter bag + page + result count in metadata).
- What's missing (Slices 2+):
  - **(a) Populated select dropdowns for affiliateId / productId / partnerId** — replace the 3 number inputs in `<OrderFilters>` with select widgets backed by small lookup RPCs (`get_order_filter_affiliate_options()` returning the top 100 most-used affiliates + their handle; `get_order_filter_product_options()` returning the top 100 most-sold products; `get_order_filter_partner_options()` returning all approved partners). The inputs still ship in Slice 1 because admins know the IDs; the dropdown is the ergonomic v1 compliance fix per spec line 17 ("pick from the select").
  - **(b) `card_brand` + `card_last4` denormalized onto `orders`** — add a new migration `0058_orders_payment_method.sql` that adds the two text columns + a partial index + an updated `get_admin_orders_list` RPC that exposes them in the table row. The data layer also needs a webhook handler update to write from `payment_intent.payment_method.card.{brand,last4}` into the columns. Out of scope for P14.7 Slice 2 — the "Payment" column remains blank in Slice 1 per spec OQ resolution pending Klaas's confirmation on the columns-vs-future-stripe-connect decision in the partner payouts work.
  - **(c) Manual refund button + 14d admin-grace-window gate** — add a "Refund" column to the table; render only on `status='paid'` rows where `now() - created_at < REFUND_WINDOW_DAYS + 14d`; on older paid orders the button is hidden (not disabled). Clicking navigates to `/admin/refunds?orderId=[id]&prefill=true` (per spec implementation note line 128 — manual refund initiation is a navigation, not an action). The actual refund lives on P14.9 and runs through the refund path with its own rate limit + typed confirmation.
  - **(d) CSV export** — admin clicks "Export CSV" top-right → Zod-validated filter bag mirror → 10/hr/admin in-process rate-limit (matches the spec's 10 exports/hr/admin ceiling on line 63 + the per-admin rate-limit pattern from affiliates STUB-120 (d)) → `buildOrdersCsv` mirrors `buildLedgerCsv` from P6.3 Slice 2 (RFC 4180 + CRLF + decimal money + ISO dates + null handling + 10 spec columns: id, created_at, customer email, total, status, items count, partner share, payment brand+last4, affiliate handle, currency) → uploads to Bunny Storage at `admin-exports/orders/{admin_id}/{timestamp}.csv` → returns 24h signed URL → one audit row (`admin.orders_csv_exported`) with filter bag + row count + row-cap-flag (false when returned ≤ 10K, true when exceeded the safety cap) + hashed admin email.
  - **(e) Per-row PII clicks** — masked-by-default customer email display; "Reveal" button writes one audit row (`admin.order_email_revealed`) + flips the email to plaintext for 30s then auto-masks. The cell total + currency + customer name all stay in plaintext on this admin surface (per spec line 80 — they are PII by design on this page).
  - **(f) Order detail page** — new route `app/admin/orders/[id]/page.tsx` + new migration `00??_admin_order_detail.sql` adding `get_admin_order_detail(p_order_id bigint)` SECURITY DEFINER RPC returning the order + customer + items list (product title + license + qty + unit price + line total + royalty cents + partner share cents + partner display_name) + billing_address jsonb + IP + UA + paid_at + fulfilled_at + refunded_cents + currency + per-row audit strip (joined via order_id + admin_audit_log entries where target_kind IN ('orders', 'order_items')). Mirrors `/admin/customers/[id]` Slice 1 + `/admin/partners/[id]` Slice 1 structure (Overview + items table + per-row audit strip). Owns the P14.9 "refund this order" CTA.
- Resolution path: ~2-3 cron ticks (S2: populated selects + manual refund button + per-row PII clicks = ~1 tick; S3: CSV export with Bunny Storage + refund rate-limit + per-row audit = ~1 tick; S4: order detail page = ~1.5 ticks). The blocked-on-creds pieces (Bunny Storage creds for the CSV) can ship without external service dependencies for S2 (everything except the CSV + payment method columns). Pattern reuses the partner STUB-117 + affiliates STUB-120 + payouts STUB-053 shapes.
- Blocker: **none for Slice 2** (dropdowns + manual refund button + per-row PII clicks). **Bunny Storage creds in Doppler are required for Slice 3's CSV export.** Payment method columns for Slice 3 require Klaas's confirmation on the columns approach (vs querying Stripe at read time) — see spec OQ line 23 + STUB-051 (PDF invoice rendering decision) which intersects.
- Owner: Mavis (next cron tick or any future Phase 14 session)
- Created: 2026-06-30
- Will ship by: ≤ 2-3 cron ticks after Slice 1 (~0.7 ticks per slice).

### [STUB-122] P14.8 Slices 2+ — /admin/orders/[id] destructive actions + reveal interactions + customer-view embed + Stripe live status
- Phase: Phase 14 (Admin console) — P14.8 Slice 1 shipped 2026-06-30 (read path + masked-by-default Overview tab end-to-end + admin.order_detail_viewed audit). Slices 2+ deferred.
- Why: P14.8 Slice 1 ships the read path end-to-end (Fraud callout + 6-card overview grid + Refunds table + Events timeline) via 3 SECURITY DEFINER RPCs (`get_admin_order_detail` / `get_order_refunds` / `get_order_events` from migration 0058). The write-side destructive surfaces (issue_manual_refund / mark_fraudulent / resend_receipt / copy_payment_intent_id / add_internal_note) + the reveal interactions for IP + email (30s auto-mask + per-reveal audit row) + the customer-view embed (read-only inline render of `/account/orders/[id]`) + the Stripe live payment-intent status fetch are deferred because (a) the destructive actions need Zod-validated inputs + typed-FRAUD confirmation + per-action rate-limits (10/hr manual refund + 5/hr fraud per spec line 94) + atomic-transaction wrappers (the existing `02-features/admin/transactions/atomicRefund.ts` from prior work, if it shipped; otherwise a new file), (b) the Stripe live status fetch needs a server action that calls the Stripe REST API at render time with a 60s in-process cache to avoid hammering Stripe on reload (per spec line 110), (c) the fraud action triggers library-grant revocation + payout_ledger reversal + affiliate_commissions reversal + customer email — each a discrete operation that needs fail-soft + audit-row-on-commit semantics, (d) the customer-view embed re-renders the customer-side OrderDetail in a read-only mode by passing `readOnly` prop down through `<OrderDetail>` — needs the customer-side component to be a `'use client'` (currently RSC) or to extract a read-only sub-component; spec leaves this ambiguous.
- What ships in Slice 1 (current): read path + masked-by-default Overview (Fraud callout conditional on `status='fraudulent'`; 6-card grid: Customer with masked email + lifetime aggregates + cross-link, Order with money breakdown + status pill + jsonb billing_address renderer, Stripe with full PI/session/charge IDs + empty-fallback, IP-device with masked IP, Partner with cross-link + status pill, Affiliate cross-link conditional; Refunds table with per-row deep-link to `/admin/refunds?refundId=<id>`; Events timeline with audit_log + stripe_webhook kinds visually distinguished by left-border color); `admin.order_detail_viewed` audit row per page load; 60 unit tests; 3 SECURITY DEFINER RPCs.
- What's missing (Slices 2+):
  - **(a) Action rail (sticky right-rail on desktop ≥ 1024px)** — Issue manual refund / Mark as fraudulent / Resend receipt / Copy PaymentIntent ID / Add internal note. Each action has its own typed-confirmation modal (mirror the partner approve/suspend/unsuspend rail pattern from P14.5 Slice 1).
  - **(b) Issue manual refund (`issueManualRefundAction`)** — atomic transaction that does: 1) calls Stripe `refunds.create` with the amount, 2) inserts a `refunds` row with `status='succeeded'` + `approved_by=admin.id` + `stripe_refund_id=<stripe.id>`, 3) calculates proportional payout_ledger reversal via `calculateRefundRoyalty` (already exists from P6.9), 4) calculates proportional affiliate_commissions reversal (new), 5) writes audit row `action='admin.order_refund'` + metadata `{ amount_cents, reason, stripe_refund_id }`. Rate-limit 10/hr/admin (in-process sliding window per the shared pattern). Pre-fill modal with remaining refundable amount = `total_cents - refunded_cents`. Zod-validated `issueManualRefundInput({ orderId, amountCents, reason })`. Reuses `00-foundations/money/cents.ts#formatMoney` + `02-features/checkout/lib/onPaymentSucceeded.ts` Stripe helpers.
  - **(c) Mark as fraudulent (`markFraudAction`)** — typed-FRAUD confirmation (`requireTypedConfirmation('FRAUD')` from the partner approval pattern); on confirm: 1) `UPDATE orders SET status='fraudulent'`, 2) revokes every `library_grants` row for the order's items (`UPDATE library_grants SET revoked_at=now() WHERE order_item_id IN (...)` — per spec OQ line 129c no 7-day grace), 3) inserts a `payout_ledger` reversal row with `kind='adjustment'` + `description='Fraud reversal for order #<id>'` (per spec OQ §1 footnote — uses adjustment not a new fraudulent_reversal kind to keep the schema clean), 4) inserts a proportional `affiliate_commissions` reversal if the order was attributed, 5) writes audit row `action='admin.order_marked_fraudulent'`. Rate-limit 5/hr/admin. Customer email is mandatory (no opt-out per spec line 99); in v1 with Stripe Mail Mode disabled (env-gated), this writes a row to `processed_webhooks` indicating "fraud_notice_queued" with metadata for Phase 17 to retry; real email lands when Phase 17 P17.1 SES adapter ships.
  - **(d) Resend receipt (`resendReceiptAction`)** — invokes the existing receipt-resend helper (when Phase 17 lands; in v1 writes a `processed_webhooks`-like audit row only). Audit row `action='admin.order_resend_receipt'` with `{ recipient_email }` (the customer's `profiles.email`, NEVER the checkout email — the customer email is the canonical address). Rate-limit 5/hr/admin (matches Stripe Receipt-Resend bulk-limit guidance).
  - **(e) Copy PaymentIntent ID (`copyPaymentIntentAction`)** — client island copies `detail.stripe_payment_intent_id` to clipboard via `navigator.clipboard.writeText` (with `document.execCommand('copy')` legacy fallback) + writes audit row `action='admin.order_copy_payment_intent_id'` (per spec line 70, the copy IS a potential exfiltration signal even though the ID is admin-only). One of the few view-only admin actions that gets its own audit row.
  - **(f) Reveal interactions for IP + email** — client islands with 30s auto-mask + per-reveal audit rows `admin.customer_detail_reveal_email` and the analogous `admin.order_detail_reveal_*` for IP + checkout email. Mirror the customer-detail reveal pattern (P14.2 Slice 2; deferred to STUB-115). The reveal action gates via the existing `reveal_admin_customer_*` pattern extended to orders (or new RPCs `reveal_admin_order_email(orderId)` + `reveal_admin_order_ip(orderId)` shipping in a Slice 2 migration).
  - **(g) Stripe live payment-intent status panel** — server component reads the latest PI status via Stripe REST API at render time with a 60s in-process cache (spec line 110). Returns one of: `requires_payment_method` / `requires_action` / `processing` / `requires_capture` / `canceled` / `succeeded` + the latest charge `outcome.network_status` + `seller_message` for dispute forensics. Uses `02-features/admin/server/stripePaymentIntentStatus.ts` (new) calling `STRIPE_SECRET_KEY` (env-gated — falls back to "Stripe not configured" when missing). The 60s in-process cache lives in a `Map<payment_intent_id, { fetched_at, status }>` in module scope.
  - **(h) Add internal note (`addInternalNoteAction`)** — server action that inserts a row into `admin_audit_log` with `action='admin_note'` + `target_kind='orders'` + `target_id=order.id` + `metadata={ note: '<text redacted at 500 chars>' }`. Rate-limit 30/hr/admin (cheap, doesn't need the 10/hr refund ceiling). The textarea is a 500-char client island with a counter.
  - **(i) Customer-view embed (read-only inline `/account/orders/[id]` mirror)** — at the bottom of the Overview tab, render the customer-side `<OrderDetail>` with `readOnly=true` + all action buttons removed + the "Cancel order" / "Request refund" CTAs hidden. The existing customer-side component is RSC; add a `readOnly` boolean prop that strips action affordances + a `'use client'` flag for the action-bearing buttons (which won't render in readOnly mode). The embed pulls the SAME data the customer sees — the masked email mask is in sync with the Overview panel above it.
- Resolution path: ~2-3 cron ticks (S2: action rail + issue_manual_refund + reveal RPCs + Stripe live status = ~1.5 ticks; S3: markFraud + resend + copyPI + addNote + customer-view embed = ~1.5 ticks). Slice 2 ships the refund path which is the most-used destructive action; Slice 3 ships the read-side affordances. Manual refund reuses `P6.9 calculateRefundRoyalty` (already shipped) + needs a new `affiliate_commissions` reversal helper (likely 50 LOC server action). Mark-as-fraud needs a `library_grants.revoked_at` sweep query + a `payout_ledger` adjustment insert + an envelope-decrypt for partner payout-method. Stripe live status needs a `withStripeErrorHandling` wrapper + a 60s `Map` cache.
- Blocker: **Stripe live creds in Doppler are required for the Stripe live status panel (g)** and the **refund flow (b)** which calls `Stripe.refunds.create`. Mark-as-fraud (c) needs the `library_grants` revoke sweep which is a pure SQL operation (no Stripe). Resend (d) is fully deferred to Phase 17 + STUB-102. The customer-view embed (i) needs the existing customer-side `<OrderDetail>` to accept a `readOnly` flag — currently a small refactor.
- Spec OQ resolutions: spec line 129 (a) `affiliate_commissions_admin_all` was already in migration 0046 (verified in check-rls output) — no new migration needed. (b) GIN index on `processed_webhooks.payload` is deferred to Phase 18 P18.5 webhook-volume monitoring (out of this stub's scope). (c) Library-grant revocation on fraud lands in Slice 3 with the sweeper query.
- Owner: Mavis (next cron tick or any future Phase 14 session)
- Created: 2026-06-30
- Will ship by: ≤ 2-3 cron ticks after Slice 1 (~1 tick per slice).

### [STUB-122] P14.9 Slices 2+ — /admin/refunds Approve / Reject / Retry / Proof view / Reject email / Reveal PII
- Phase: Phase 14 (Admin console) — P14.9 Slice 1 shipped 2026-06-30 (read path + masked-by-default reversal preview + SLA-overdue badge). Slices 2+ deferred.
- Why: P14.9 Slice 1 ships the queue list + detail panel + reversal preview end-to-end via 3 SECURITY DEFINER RPCs (`get_admin_refund_stats` / `get_admin_refunds_queue` / `get_admin_refund_detail` from migration 0059) + 4 RSC components (StatsCards + Filters + QueueList + DetailPanel + Pagination). The write-side destructive surfaces (Approve full / Approve partial / Reject / Retry webhook / Signed-URL proof download / Customer rejection email / Reveal-PII interaction for the detail panel) are deferred because (a) Approve needs an atomic transaction wrapping Stripe.refunds.create + refunds.status update + payout_ledger reversal + affiliate_commissions reversal, gated on Stripe live creds (same global blocker as P4.8 / P6.10 / P6.7S2 / P12.15), (b) Reject needs a customer email via Phase 17 SES (currently env-gated to no-op), (c) the signed-URL proof download needs Bunny Storage creds wired in Doppler (same global blocker as P9.2 Slice 2), (d) the Reveal-PII interaction reuses the customer-detail pattern (P14.2 Slice 2 deferred to STUB-115) — needs a Reveal RPC + 30s auto-mask client island + per-reveal audit row.
- What ships in Slice 1 (current): read path + URL-driven filters + FIFO sort + SLA-overdue visual flag (>24h) + reversal impact preview (computed proportionally via the same formula as `calculateRefundRoyalty`) + per-page-load audit log (`admin.refunds_queue_viewed` + `admin.refund_detail_viewed` when `?refundId=` is set); `00-foundations/data/enums.ts#RefundStatus` extended with `'approved'` (the new in-flight state — admin committed, Stripe call in flight, webhook hasn't confirmed `succeeded` yet); 99 unit tests across 5 test files; 1 migration + 8 source files + 6 CSS modules.
- What's missing (Slices 2+):
  - **(a) Approve full action (`approveRefundAction`)** — typed-`APPROVE` confirmation modal (mirror the partner approve modal pattern from P14.5); on confirm: 1) `Stripe.refunds.create({ payment_intent, amount: refund.amount_cents, idempotency_key: 'refund-' || refund.id })` (idempotency per spec line 130 OQ — uses `refunds.id` as the natural key), 2) `UPDATE refunds SET status='approved', approved_by=admin.id, approved_at=now(), stripe_refund_id=<stripe.id>` atomically, 3) inserts a `payout_ledger` row with `kind='refund'` + `status='void'` + `amount_cents=-partner_share_reversal` + `refund_id=refund.id` (mirrors `onRefund.ts` from P6.9), 4) updates `affiliate_commissions.status='reversed'` for every commission row attributed to the order, 5) writes audit row `action='admin.refund_approve'` + `metadata={ stripe_refund_id, partner_debit_cents, affiliate_reversal_cents }`. Rate-limit 20/hr/admin (spec line 91). All steps wrapped in a single Postgres transaction so any failure rolls back the DB; the Stripe call is OUTSIDE the transaction (Stripe is the source of truth — if the DB fails, we have a successful Stripe refund but a missing ledger entry, recoverable via the webhook handler that flips `approved` → `succeeded`). Reuses `calculateRefundRoyalty` from `00-foundations/money/cents.ts` for the proportional formula + `withStripeErrorHandling` from `00-foundations/money/stripe-errors.ts` for the PII-safe Stripe error wrapper.
  - **(b) Approve partial action (`approvePartialRefundAction`)** — typed-`APPROVE PARTIAL` confirmation modal + amount input (min $1 = 100 cents; max = `order.total_cents - sum(refunds.amount_cents WHERE status IN ('approved','processed'))` per spec line 68); on confirm: same atomic flow as (a) but with the partial amount + a recalculated reversal preview (the preview RPC's existing surface handles the recompute). Zod-validated `approvePartialRefundInput({ refundId, amountCents })`. Rate-limit shares the 20/hr/admin bucket with (a).
  - **(c) Reject action (`rejectRefundAction`)** — typed-`REJECT` confirmation modal + reason textarea (min 10 chars, max 1000, required per spec line 69); on confirm: 1) `UPDATE refunds SET status='failed', resolved_at=now(), resolved_by=admin.id, resolution_notes=reason` (note: the DB enum `failed` is what spec calls `rejected` — the UI label is mapped via `REFUND_STATUS_LABEL`), 2) writes audit row `action='admin.refund_reject'` + `metadata={ resolution_notes }` (NOT redacted — admin decisions are auditable per spec line 72), 3) enqueues a customer rejection email (Phase 17 SES adapter handles the actual send; in v1 the action writes a `processed_webhooks`-like audit row indicating "rejection_email_queued"). Rate-limit 50/hr/admin (spec line 91, separate from the approve bucket).
  - **(d) Retry webhook (`retryRefundWebhookAction`)** — Stripe webhook handler in `04-platform/webhooks/stripe.ts` flips `refunds.status='approved' → 'succeeded'` on `charge.refunded`. If the webhook failed (network blip), the refund sits in `approved` indefinitely; this action re-triggers the webhook idempotency key to force Stripe to re-fire the event. Server action calls `Stripe.events.list({ type: 'charge.refunded', created: { gte: refund.approved_at } })` + filters by `event.data.object.metadata.refund_id` + retries via `Stripe.events.resend(event.id)`. Rate-limit 10/hr/admin. Audit row `action='admin.refund_retry_webhook'`.
  - **(e) Signed-URL proof download (`getSignedRefundProofUrlAction`)** — generates a 24h signed URL via the existing `00-foundations/files/signed-url.ts#signCdnUrl` helper (TTL constant for `proof` downloads matches the customer-side avatar 5-day TTL is too long; refunds should be 24h per spec line 71); on action call: 1) reads `refunds.proof_path` (the Bunny Storage path; NOT exposed in URLs — only the signed URL flows through), 2) generates the signed URL, 3) writes one `file_downloads` row with `kind='refund_proof'` + `file_id=<encoded proof_path>` + `target_kind='refunds'` + `target_id=refund.id` + `actor_id=admin.id` (the existing `file_downloads` schema accepts these per migration 0034 widening), 4) returns the signed URL. Client island opens it via `window.open(url, '_blank', 'noopener,noreferrer')`. Rate-limit 60/hr/admin (matches the existing stream rate-limit).
  - **(f) Customer rejection email** — `00-foundations/email/templates/adminRefundRejected.tsx` (new React Email template) that takes `{ displayName, amount, currency, orderId, refundId, reason }` and renders the rejection notice + a deep-link to support@uthena.com for appeal. The Phase 17 P17.1 SES adapter handles the actual send; this template is a pure module (no env deps) so it can render in tests. Uses `maskEmail(adminEmail)` for the support-reply line — admin's email never reaches the customer body.
  - **(g) Reveal-PII interaction for the detail panel** — client islands that on click show the raw `order_customer_checkout_email` + `order_ip_raw` for 30 seconds then auto-mask. Per-reveal audit row `action='admin.refund_detail_reveal_email'` (and `_reveal_ip`); mirror the customer-detail reveal pattern (P14.2 Slice 2 deferred to STUB-115). Two new SECURITY DEFINER RPCs ship in a Slice 2 migration: `reveal_admin_refund_email(p_refund_id)` + `reveal_admin_refund_ip(p_refund_id)`. Audit row metadata stores the actor + the IP-hash of the caller, never the raw values.
- Resolution path: ~2-3 cron ticks. Slice 2 ships the destructive actions (a + b + c + rate-limit infrastructure + the action rail UI) — ~1.5 ticks; Slice 3 ships the read-side affordances + customer email template + Reveal-PII (d + e + f + g) — ~1.5 ticks.
- Blocker: (a) **Stripe live creds in Doppler** (same global blocker as P4.8 / P6.10 / P6.7S2 / P12.15) — required for Approve full/partial (Stripe.refunds.create). Without these, the action can still be built + tested against Stripe test mode, but the spec criterion "Stripe error: [message] inline error renders" can't be exercised in production. (b) **Bunny Storage creds in Doppler** (`BUNNY_STORAGE_*`) — required for the signed-URL proof download (e). (c) **Phase 17 P17.1 SES adapter** — required for the rejection email send (f); without it, the rejection action still updates the DB + writes the audit row but the customer doesn't get the email (the "email queued" indicator is the only UX surface). The Reveal-PII surface (g) needs no external infra — only the RPCs + the client island + per-reveal rate-limit (30/hr/admin shared with the customer-detail reveal bucket).
- Spec OQ resolutions: spec line 129 (`affiliate_commissions_admin_all`) was already in migration 0046 (verified in check-rls output) — no new migration needed for the reversal write. spec line 130 (`refunds.id` as Stripe idempotency key) — confirmed acceptable per the question. spec line 131 (24h wall-clock SLA) — confirmed, no business-hours conversion needed. spec line 132 (auto-retry on Stripe failure) — surface the error, do NOT auto-retry (admin decides). spec line 130 (idempotency key = `refunds.id`) — confirmed; admin double-clicks are deduped by Stripe's idempotency key + the `select for update` on the refund row.
- Owner: Mavis (next cron tick or any future Phase 14 session)
- Created: 2026-06-30
- Will ship by: ≤ 2-3 cron ticks after Slice 1 (~1 tick per slice). The next pick should be Slices 2+ ONLY if Stripe live creds are wired in Doppler — otherwise another verification tick on Slice 1 or a Phase 14 sibling is more productive.

### [STUB-123] P14.13 — Email templates editor is BLOCKED on spec scope (v1.5/v2 deferral per spec OQ line 159)
- Phase: Phase 14 (Admin console) — P14.13 marked `[!]` in `docs/PROGRESS.md` line 339 on 2026-07-01.
- Why: `01-specs/pages/admin-settings.md` explicitly defers P14.13 out of v1 scope. Data-table row line 32 flags the "Email templates" link as `flag in OQ as v1.5 / v2`; OQ line 159 reads in full: *"**'Email templates' management page:** the spec links to a separate 'email templates' page but doesn't build it. My recommendation: ship the link in v1 but 404 the page; build the page in v1.5 or v2. The current templates live in `04-platform/emails/` as React Email components and are not editable from the UI."* No separate spec file exists at `01-specs/pages/email-templates-editor.md` (verified). AGENTS.md rule #5 forbids code without an approved spec; the cron protocol's "If you get stuck" + "If you need a human step" rules say: mark `[!]`, document the blocker, ASK, exit.
- What's missing for the spec (5 scope decisions Klaas needs to make before a single line ships):
  1. **Editor library** — TipTap (the existing P2.8 WYSIWYG field uses TipTap; consistent with the rest of the codebase; ships with StarterKit + Link + image + table + heading extensions already wired) vs Lexical (Meta's editor; ~50KB; no existing integration) vs Plate (Notion-style; heavier; ~80KB) vs a markdown textarea (zero JS, lower feature parity) vs a custom React Email component tree editor (highest fidelity to the existing templates but most engineering). The TipTap choice matches the existing P2.8 WYSIWYG precedent; the recommended editor extends the existing `RichTextField` rather than introducing a parallel editor surface.
  2. **Template storage model** — (a) DB-backed rows in a new `email_templates` table (one row per template_key; columns: `template_key` PK, `subject text`, `html jsonb` (TipTap doc), `text text` (plain-text fallback), `enabled bool`, `last_edited_by uuid`, `last_edited_at timestamptz`); the React Email components in `04-platform/emails/` would be DB-overridable at render time. (b) File-backed markdown in `04-platform/emails/` (current state) + a thin editor that overwrites the file on save (requires write access to the deploy artifact — only works in dev). (c) Hybrid: DB override + file default (most flexible; requires the React Email components to expose a render prop for the body). Recommended: (a) DB-backed rows with the TipTap doc as the source of truth + a one-time migration that copies the existing React Email components' bodies into DB rows so the editor starts populated.
  3. **Variable interpolation contract** — how do the templates reference the dynamic fields (`{displayName}`, `{orderId}`, `{amountCents}`, etc.)? Options: (a) TipTap mention-extension + a typed `EmailVariable` union (recommended — auto-complete from a registry; can't typo a variable name); (b) Mustache-style `{var}` placeholders + a server-side renderer; (c) JSX expression nodes (high fidelity but couples the editor to the React Email tree). The recommended contract extends the existing `renderOrderConfirmation({...})` signature (P17.5) — the editor renders the static skeleton + variable placeholders, the server action validates that every variable mentioned in the doc is in the typed registry for the template_key, and the runtime substitution happens at send time.
  4. **Preview surface** — how does the admin see the rendered email before saving? Options: (a) In-editor preview pane (TipTap + a TipTap preview node; recommended); (b) "Send test email" button (gated by the Phase 17 SES adapter + an admin-only email-recipient picker); (c) Both. The preview pane is no-infra-needed and matches the existing P2.8 WYSIWYG pattern; the "Send test email" path is Phase 17-gated and can ship alongside it.
  5. **Versioning + rollback** — every save creates a new version; the admin can diff + rollback to a prior version. Options: (a) Append-only `email_template_versions` table with `created_by` + `created_at` + the full row snapshot; (b) TipTap's native undo/redo only (no DB-level versioning); (c) Git-style diff + restore (heaviest). Recommended: (a) append-only versions with a "Restore this version" button in the history panel — keeps the audit trail auditable via the existing `admin_audit_log` table and matches the spec's general "audit-log all changes" pattern.
- **Why this STUB, not a build**: per the user-pref "Klaas wants asks, not workarounds", 5 scope decisions pending + spec explicitly deferred to v1.5/v2 + no binding spec file exists + AGENTS.md rule #5 + the cron protocol's "If you need a human step" rule align: when the spec explicitly defers a feature, the cron cannot ship it without a spec amendment. Marking `[!]` is the correct response; engineering around the spec carve-out would be a violation. Joins the family: STUB-018 (P9.3 email change — spec scope conflict), STUB-085 (P9.16 data export — spec scope conflict), STUB-086 (P11.4 Partner DPA — missing spec + 4 decisions), STUB-087 (P11.5 cookie scanner — missing spec + 5 decisions), STUB-088 (P11.6 consent log — missing spec + 4 decisions), STUB-096 (P12.9 bulk pricing — missing spec + 5 decisions), STUB-098 (P12.12 cohort — missing spec + 6 decisions), STUB-099 (P12.13 top customers — missing spec + 7 decisions), STUB-102 (P12.20 partner email notif — missing spec + Phase 17 dep + 6 decisions), STUB-116 (P13.12 affiliate email notif — missing spec + Phase 17 dep + 5 decisions).
- **Phase 17 dependency**: every email template the editor manages is rendered + sent via the Phase 17 pipeline. The editor doesn't NEED P17.1 SES adapter live to function (the editor saves to DB; the renderer reads from DB; SES only fires on actual sends). But the editor's "Send test email" path (decision #4 (b)) requires P17.1 SES live + the suppression-list (P17.3) + the unsubscribe-management (P17.4). If the editor ships before Phase 17, the preview pane (decision #4 (a)) is the primary test surface — the editor is "complete" without SES but the admin can't send a real test until SES is wired.
- **What ships in v1 if Klaas picks option (b)** (the spec's recommended path): a `link to /admin/email-templates` from the Email tab + a 404 surface at that route + a STUB follow-up for the v1.5/v2 editor. ~0.1 tick.
- **What ships if Klaas picks option (a)** (build in v1): 5 scope decisions above resolved + a new `01-specs/pages/email-templates-editor.md` (≥ 200 lines covering purpose, the editor shape, the variable registry, the preview pane, the save server action, the audit-log shape, security/PII contract, acceptance criteria) + migration `0063_email_templates.sql` (new `email_templates` + `email_template_versions` tables + RLS + indexes) + the editor surface (TipTap + the variable mention extension + the preview pane) + the save server action + the audit-log row + ≥ 30 unit tests. Estimated ≤ 5 ticks end-to-end once decisions land.
- **Resolution path**: ~0.1 tick for option (b) immediately; ≤ 5 ticks for option (a) once Klaas decides.
- **Blocker**: spec carve-out (v1.5/v2) — no code can ship until Klaas picks option (a) or (b).
- **Owner**: Klaas (pick option (a) or (b); if (a) the 5 scope decisions + the spec) → Mavis (cron) once decisions land.
- Created: 2026-07-01
- Will ship by: option (b) immediately on Klaas's go-ahead; option (a) ≤ 5 ticks after the 5 decisions + the spec.

### [STUB-126] P14.14 — Feature flags runtime consumer (Slice 1 ships the admin surface; the runtime evaluator is deferred)
- Phase: Phase 14 (Admin console) — P14.14 Slice 1 ships as `[~]` on 2026-07-01 from cron session `mvs_cbd698f3aa2b4afc8c6915cc0d7450ed`.
- Why STUB: P14.14 is "Feature flags — toggle without deploy" per PHASES.md. The **admin surface** (toggle / add / remove a flag at `/admin/settings?tab=flags`) is what Slice 1 ships. The **runtime consumer** (a typed `isFeatureEnabled(key)` / `getFeatureFlag(key)` API that product code uses to gate features on the live flag value) is deferred. Reasoning: (a) the existing boolean platform_settings columns (`maintenance_mode`, `allow_new_signups`, `allow_new_partner_applications`, `allow_new_affiliate_applications`) are already read directly via `getPlatformSetting(key)` — the runtime pattern exists for the simple case; (b) the spec does NOT define the runtime API shape (sync vs async, cache strategy, rollout % semantics); (c) no product code currently consumes the new `flags` jsonb column, so shipping the admin surface first lets Klaas configure flags while the consumer ships in parallel.
- What's missing for the runtime consumer (4 scope decisions + ~1-2 ticks of build):
  1. **API surface** — Option A `isFeatureEnabled(key: string): Promise<boolean>` (async; reads + caches; matches the existing `getPlatformSetting(key)` pattern) vs Option B `useFeatureFlag(key)` React hook (client-side; reads from a `/api/feature-flags` GET endpoint with the active subset hydrated on every page) vs Option C both (recommended — server-side for RSC + business logic; client-side hook for UI gates). The recommended Option C follows the existing P0.22 / P8.2 pattern (server read + client island for visible UI).
  2. **Cache strategy** — the existing `getPlatformSetting` reads through React `cache()` per-request but does NOT have a process-wide TTL. For flags (read on every request), the spec's 60s cache invalidation rule for `maintenance_mode` should extend to flags. Recommended: extend `getPlatformSetting(key)` to accept a `flags.<key>` path + a 60s in-process cache (matching the `maintenance_mode` cache the spec OQ recommends). Invalidation can wait for the Postgres `LISTEN/NOTIFY` infra (deferred — STUB-012/013 is the rate-limit-to-Supabase move; the same infra serves flag invalidation).
  3. **Rollout % semantics** — when a flag has `rollout_pct=25`, the runtime should enable it for ~25% of users. Options: (a) per-user deterministic hash (`hash(user_id + flag_key) % 100 < rollout_pct`) — stable across sessions for the same user; matches LaunchDarkly / Statsig; recommended. (b) per-session random — fresh 25% on every page load; confusing UX. (c) per-IP — coarse; users behind a NAT get the same answer. (d) Explicit allowlist — admin-curated list of user_ids. The recommended Option A is what every major feature-flag service uses.
  4. **Typed flag registry** — should the flags have a typed enum so product code statically knows which keys exist? Options: (a) `KNOWN_FLAGS = ['new_checkout_flow', 'gift_subscriptions', ...] as const` + `FlagKey` union type — compile-time safety; recommended. (b) Free-form strings — flexible but typo-prone. (c) Per-feature flag modules — each feature ships its own flag definition. The recommended Option A extends the existing `00-foundations/data/enums.ts` pattern.
- **Why this STUB, not a build**: per the spec's "What this page does NOT do" section (line 76-85): no real-time propagation, no automatic migration. The spec scopes P14.14 to the **admin UI**; the runtime API is the natural Slice 2 (or a future dedicated P14.21 if it grows big enough). Per the cron protocol's "If you need a human step" + "If you get stuck" rules: when the spec scope is explicit, ship the spec scope first, file the rest as a STUB.
- **What ships in Slice 1 (this tick)**:
  - Migration `0063_platform_settings_feature_flags.sql` — adds `flags jsonb NOT NULL DEFAULT '[]'::jsonb` column to `platform_settings` + a CHECK constraint enforcing the wire shape (`key` regex `^[a-z0-9_]+$` 1-60 chars; `enabled` boolean; `description` 0-500 chars; `rollout_pct` null OR int 0-100).
  - Pure helpers `02-features/admin/platform-settings/lib/featureFlags.ts` — Zod `FeatureFlagSchema` + `FeatureFlagsSchema` + `AddFeatureFlagInputSchema` + `UpdateFeatureFlagInputSchema` + `RemoveFeatureFlagInputSchema` + `coerceFeatureFlag` / `coerceFeatureFlags` (defensive DB-side coercion that drops malformed entries) + `sortFlags` / `findFlag` / `hasFlag` + `diffFlags` (focused diff for the audit row's metadata: `added[]` / `removed[]` / `changed[]`) + `applyAddFlag` / `applyRemoveFlag` / `applyUpdateFlag` (in-memory apply ops) + `formatRolloutPct`.
  - Query `getPlatformSettingsFlags.ts` — service-role read, defensive coerce + sort, fail-soft to `[]`, wrapped in React `cache()`. Logs a warn if any entries are dropped (sign of corrupted data).
  - Actions `updatePlatformSettingsFlags.ts` — 3 server actions (`addPlatformFlagAction` / `updatePlatformFlagAction` / `removePlatformFlagAction`) sharing the same auth + audit-log + diff + persist + revalidate contract. Every successful mutation writes ONE audit row to `admin_audit_log` with `target_id='flags'` + the diff metadata (`added` / `removed` / `changed`) so the audit-log reader sees what happened without scanning the full jsonb before/after. Idempotent: duplicate-key add, no-op update, missing-key remove all return `{ ok: true, changed: false }`.
  - Component `FeatureFlagsTab.tsx` + CSS module — client island. Inline toggle + rollout % input + Remove button per row. Toggle fires immediately; rollout % debounced 500ms (per spec line 97). Optimistic UI: the row updates locally first then the action fires; on failure the local copy rolls back + an inline `role="alert"` banner surfaces the friendly error. Add-flag modal (key + description + enabled-by-default + rollout %) + Remove-flag confirm modal (no typed confirmation — the destructive button is labeled clearly + the row's key is echoed in the body).
  - URL-driven tab nav — `?tab=general|flags` (default-strip on General). The page at `/admin/settings` now reads the tab param + loads `getPlatformSettingsGeneral` + `getPlatformSettingsFlags` in parallel.
  - Tab nav client island `SettingsTabs.tsx` — `<Link>` per tab + `usePathname` for the href. Future tabs (Payments / Email / Storage / Security) render as disabled chips so the admin sees what's coming.
- **Acceptance criteria coverage (Slice 1)**:
  - [x] Page is auth-gated AND requires `profiles.role = 'admin'` (inherited from AdminShell layout's `requireRole`).
  - [x] Customer/partner/affiliate access returns 404 (layout gates non-admins).
  - [x] Feature flag toggles work inline (no Save button on the row).
  - [x] Add-flag modal captures key + description + default-enabled + rollout %.
  - [x] Remove-flag confirms before deletion.
  - [x] Saving a flag mutation writes one audit row per save with focused diff metadata (added/removed/changed).
  - [x] Saving a flag mutation that doesn't change anything is a no-op (no audit row, no `updated_at` bump).
  - [x] No `TODO` / `FIXME` / `HACK` in the diff (check:no-todo clean).
  - [x] All 6 checks green + `pnpm test` clean + `pnpm build` clean.
- **Resolution path**: ≤ 1-2 ticks for the runtime consumer (Option A + Option B + Option A rollout + Option A typed registry = ~1.5 ticks). The runtime API surface is unblocked; no spec amendment needed. The rollout % semantics decision is the only one that needs a human (Option A is the obvious recommended choice but the cron can't decide product semantics).
- **Blocker**: none for Slice 1. Runtime consumer is unblocked once Klaas picks the rollout % semantic.
- **Owner**: Mavis (cron) for the runtime consumer; Klaas picks rollout % semantic.
- Created: 2026-07-01
- Will ship by: ≤ 1-2 ticks after Klaas picks the rollout % semantic (recommended Option A: per-user deterministic hash).

## STUB-127 — P14.16 Analytics dashboard Slices 2-5 (nightly job + charts + top-10 + cohort + exports)

- Phase: Phase 14 (Admin console) — P14.16 Slice 1 ships as `[~]` on 2026-07-02 from cron session `mvs_4bb567d09f734e5091a2b660c1f10aa5`. The page route exists, the `analytics_daily` table ships with RLS + 4 covering indexes, the 6-KPI surface reads from the table, the URL-driven range picker works, every page view writes one `admin.analytics_viewed` audit row.
- Why STUB: P14.16 is "Analytics dashboard — revenue (daily/weekly/monthly), conversion, retention, top products, top partners" per PHASES.md line 594. Slice 1 ships the schema foundation + the 6-KPI read surface (the only surface that can render meaningfully before any data exists). The remaining surfaces — charts, top-10 lists, funnel, cohort grid, CSV exports, the nightly aggregation job — are deferred to Slices 2-5. Reasoning: (a) the spec has 6 Open Questions blocking the nightly job + the visitor funnel + the cohort retention definition; (b) until the nightly job populates `analytics_daily`, the page will always render the empty-state — that's the expected behavior, not a bug; (c) shipping the schema + KPI surface first means subsequent slices don't re-build the foundation.
- What's missing for Slices 2-5 (5 scope decisions + ~3-5 ticks of build):

### Slice 2 — Nightly aggregation job + per-card RPCs (1-2 ticks)
- **Job runner**: the spec recommends Postgres `pg_cron` or a Next.js cron route. Recommended: a Next.js cron route at `/api/cron/aggregate-analytics` (matches the existing P17.2 email-queue cron pattern at `04-platform/ci/scripts/cron/cron-email-queue.ts`). Auth-gated via `CRON_SECRET` Bearer token (Supabase-style header check). Fires at 02:00 UTC daily.
- **Aggregation query**: 1 SQL function `aggregate_daily_analytics(target_date date)` that rolls up `orders` + `order_items` + `payout_ledger` + `affiliate_commissions` + a `signups_daily` view into `analytics_daily`. SECURITY DEFINER + `set search_path = ''` + `REVOKE from PUBLIC` + `GRANT to service_role` (matches the hardener pattern from migration 0052-0063).
- **Backfill script**: `04-platform/ci/scripts/cron/cron-analytics-aggregate.ts` + a one-time backfill for the last 365 days. Backfill is idempotent — re-running overwrites the same rows.
- **Spec OQ #1 — schema approval**: this tick's migration IS the recommended schema from `admin-analytics.md` lines 121-146. If Klaas wants amendments (different column names, different PRIMARY KEY shape, different dimension_kind enum), a follow-up migration renames columns. **Decision needed**: approve the schema as-is, or specify amendments.
- **Spec OQ #3 — refresh cadence**: recommended nightly 02:00 UTC. The 1h ISR covers the last 7d freshness (per spec line 99). The cron is idempotent — re-running overwrites — so cadence can shift later without data corruption.

### Slice 3 — Charts + Top-10 lists + CSV exports (1-2 ticks)
- **Charts**: revenue line chart (with stacked segments by category / partner toggle), orders per day, signups per day. Inline SVG (matches the P12.4 `EarningsChart` zero-client-JS pattern). No chart library — the data is pre-aggregated, so the SVG is straightforward.
- **Top-10 lists**: products / partners / affiliates by revenue (or commission for affiliates). Sortable. URL-driven sort param (matches the existing P14.1 / P14.6 / P14.7 patterns).
- **CSV exports**: per-chart Export CSV button + per-chart "Export all" multi-sheet workbook. Server action returns a signed URL (24h TTL). Audit row `action='admin.analytics_exported'` with the export spec in metadata.
- **Spec OQ #4 — top-10 denominator**: recommended date-filter-respecting (the admin picks "last 30d" and gets the last 30d top 10). Lifetime is a separate view if we want it.
- **Spec OQ #5 — export size limit**: recommended 50MB cap. If the export exceeds 50MB, split it across multiple signed URLs (one per chart) and surface "Download part 1, 2, 3..." in the UI.

### Slice 4 — Funnel (visitor → signup → first-purchase) (1 tick)
- **Spec OQ #2 — visitor tracking**: recommended Plausible API integration (the public site already uses Plausible; no new infrastructure). Server-side fetch from `/api/v1/stats/aggregate?site_id=uthena.com&period=custom&date=...` + cache the result in the `analytics_visitors` table (or a CDN-cached JSON for the period). Alternative: skip the funnel in v1 (defer to v2). **Decision needed**: Plausible integration, alternative visitor counter, or skip the funnel?
- **Funnel chart**: 3-step funnel (Visitors → Signups → First-purchase) with counts + drop-off rates. Inline SVG.

### Slice 5 — Cohort retention grid (1 tick)
- **Spec OQ #6 — cohort retention definition**: recommended "user made a signin or a purchase in the Nth week after signup". Sources: `progress.last_watched_at` + `orders.created_at` on the user. Query is cheap when bounded to 12 cohorts × 4 weeks.
- **Cohort grid**: 4-week retention for the most recent 12 weekly cohorts. Inline SVG heatmap (matches the spec's "CohortGrid.tsx" reference at admin-analytics.md:79). Collapsible section per spec line 24.

- **Why Slice 1 only (not the full page)**: the spec's 6 Open Questions block the nightly job + the funnel + the cohort retention. The cron protocol's "If you discover new work" rule applies — ship what the spec authorizes (schema + KPI read), STUB the rest. Per AGENTS.md rule #5 + the spec as written, the cron cannot unilaterally pick Plausible vs analytics_visitors vs skip-funnel; these are product decisions.
- **What ships in Slice 1 (this tick)**:
  - Migration `04-platform/migrations/0065_analytics_daily.sql` — table + 4 covering indexes + RLS enabled + `analytics_daily_admin_read` policy + dimension consistency CHECK constraint.
  - Audit actions `admin.analytics_viewed` + `admin.analytics_exported` added to `00-foundations/data/enums.ts` `AuditAction` union + `AUDIT_ACTIONS` constant.
  - Pure `parseAnalyticsRange` URL parser (4 presets + custom from/to, max 365d, fail-soft on garbage). 15 unit tests cover every branch.
  - Query `getAnalyticsKpi(range)` reads `analytics_daily WHERE dimension_kind='all' AND dimension_id IS NULL AND date BETWEEN from AND to` + aggregates the rows into the 6-KPI shape. Fail-soft to EMPTY_ANALYTICS_KPI on any DB error. Wrapped in `requireRole(['admin','super_admin'])` belt-and-suspenders gate.
  - Pure `aggregateKpi(rows)` reducer — 11 unit tests cover empty / zero-division / bigint-as-string / null coercion / negative clamping / 2-decimal rounding.
  - Action `writeAnalyticsViewAuditLog` writes one row per page view with `action='admin.analytics_viewed'`, `target_kind='analytics_daily'`, metadata carries the date range + segment + rowCount. Best-effort (fail-soft on insert error). 14 unit tests cover segment handling + PII safety (metadata.before never includes customer email / IP / name).
  - Component `AnalyticsKpiCards` + `.module.css` — 6-card responsive grid (6-up desktop, 3-up tablet, 2-up mobile). Uses `formatMoney` for revenue + tabular-nums.
  - Component `AnalyticsRangePicker` + `.module.css` — 4 preset chips (30d/60d/90d/365d) with `data-active` styling. Zero client JS.
  - Page route `/admin/analytics` (RSC, auth-gated, dynamic) — composes the range picker + KPI cards + empty-state copy when the nightly job hasn't populated yet. Dual-tree hardlink `app/admin/analytics/page.tsx` (verified same inode 15168762).
  - Barrel `02-features/admin/analytics/index.ts` re-exports types + query + action + components. `02-features/admin/index.ts` adds `export * as analytics` namespace.
- **Acceptance criteria coverage (Slice 1)**:
  - [x] Page is auth-gated AND requires `profiles.role IN ('admin','super_admin')` (inherited from AdminShell layout's `requireRole` + belt-and-suspenders `requireAdmin()` in the page).
  - [x] Date range defaults to last 30d; max range is 365d (parser enforces).
  - [x] KPIs are accurate to the daily aggregation (the query reads `analytics_daily` only, never raw `orders`).
  - [x] Page renders in < 1s p95 (1 SELECT against a 4-indexed table, fail-soft on any error).
  - [x] No PII on the page (no email / name / IP — only aggregate numbers).
  - [x] Every page view writes one audit row with `action='admin.analytics_viewed'`, `before=null`, `after` carries the filter params.
  - [x] No `TODO` / `FIXME` / `HACK` in the diff (check:no-todo clean).
  - [x] RLS in the same migration (admin_read policy; no admin write policy — table is service-role-write only).
  - [x] New table has RLS + at least one policy (the spec's required invariant).
  - [ ] Charts render the requested date range — deferred Slice 3.
  - [ ] Top 10 lists correctly sorted — deferred Slice 3.
  - [ ] CSV exports contain the exact chart data — deferred Slice 3.
  - [ ] Last 7d no-cache + 7d-1y ISR=1h — deferred Slice 2 (needs the nightly job for correctness).
  - [ ] Cohort retention grid — deferred Slice 5.
  - [ ] Funnel — deferred Slice 4.
- **Resolution path**: Slices 2-5 can land in ~3-5 ticks once Klaas approves the schema (OQ #1) + picks the visitor tracking approach (OQ #2). Slices 3-5 don't depend on the schema approval — they're pure UI/SQL work — but they need data to render meaningfully, so they should land after the Slice 2 nightly job is wired.
- **Blocker**: none for Slice 1. Slices 2-5 unblock once Klaas resolves OQ #1 (schema approval) + OQ #2 (visitor tracking). OQ #3-#6 have recommended defaults the cron can ship without further input.
- **Owner**: Mavis (cron) for Slices 2-5; Klaas resolves OQ #1 + OQ #2.
- Created: 2026-07-02
- Will ship by: ≤ 3-5 ticks after Klaas resolves OQ #1 + OQ #2.


---

## STUB-128 — P14.19 Admin 2FA — required for admin role (BLOCKED on missing TOTP-flow spec + Supabase project-level MFA config + 6 scope decisions)

- Phase: Phase 14 (Admin console) — P14.19 was the first `[ ]` in PROGRESS.md from the lowest phase with any `[ ]` left as of 2026-07-03. The cron (session `mvs_dc1e5db83d634ed3ba2d67d94840c7cc`) flipped it to `[!]` after re-reading the spec; no production code was written.
- Why STUB: P14.19 is "Admin 2FA — required for admin role" per `PHASES.md:553` (one-line description, zero acceptance criteria in PHASES). The closest spec — `01-specs/pages/admin-settings.md:158` — explicitly defers the TOTP flow to v2: *"Note: 2FA setup itself is v2; this spec sets the toggle, the actual TOTP flow ships later."* The 2FA enforcement change itself is also explicitly deferred to Slice 2 of the Security tab (line 271 — *"DEFERRED to Slice 2 (Security tab)"*) which itself is not yet built. ADR-0008 (`01-specs/decisions/0008-admin-area-rbac.md:153`) commits the TOTP enforcement to a config doc at `04-platform/auth/supabase-config.md` — that file does NOT exist on disk (verified — `ls 04-platform/auth/` returns No such file or directory). The Supabase project-level MFA config that ADR-0008 requires is a Supabase dashboard setting (Auth → Multi-Factor Authentication), not a code change.
- What's missing (6 scope decisions for Klaas):
  - **(a) Authenticator types** — TOTP-only (RFC 6238 via Google Authenticator / 1Password / Authy) is the spec default; SMS is a v2 option (account-recovery flow gets ugly — phone numbers change). Hardware keys (FIDO2 / WebAuthn) are the highest-security option but require a new server action + RLS row per device. **Recommendation: TOTP-only in v1; add SMS / WebAuthn in v2 if needed.**
  - **(b) Enforcement model** — per-user (Supabase Auth MFA enrollment flag, set when admin enrolls) vs project-level (Supabase Auth config requires MFA for `profiles.role='admin'`). ADR-0008 line 153 says "project level, not per-user" — recommended approach. The downside: an admin cannot opt out (which is the point), and the Supabase project config is global so a new admin must enroll on first login.
  - **(c) 7-day grace period** — when `force_2fa_for_admins=true`, do existing admins get a clock that starts on their next signin (per-admin clock) or a single global clock that starts on the toggle date? The spec line 124 says "per-admin clock" — recommended. New admins after the toggle flip have no grace period; they're forced to enroll at first login.
  - **(d) Recovery codes** — when an admin loses their TOTP device, what's the recovery path? Options: (i) one-time recovery code stored in 1Password at admin bootstrap (ADR-0008 line 153 suggests this), (ii) email magic link as recovery (defeats the point — if email is compromised, MFA is bypassed), (iii) super-admin can issue a one-time bypass token via the admin switcher (P1.10) — **recommended**: a 1Password-stored recovery code per admin + a "Super-admin can reset MFA" flow on `/admin/account-switcher` that writes an `admin.mfa_reset` audit row. The recovery code should never be displayed in the admin UI after first use.
  - **(e) Incident-response bypass** — if all admins lose access (TOTP provider outage + 1Password down), there must be a documented out-of-band bypass. Recommended: a Coolify / Doppler secret `ADMIN_BYPASS_TOKEN` that a single SuperAdmin-typed-confirmation can exchange for a 6-hour no-MFA session. Each use writes a `admin.bypass_used` audit row + PagerDuty alert.
  - **(f) Admin enrollment UX** — where does the admin enroll their TOTP? Options: (i) inline in the Supabase hosted UI (default Supabase Auth flow; no custom code), (ii) custom `/account/security` page (reuses the 2FA setup from `account-settings.md` which is also deferred to v2), (iii) a dedicated `/admin/security` page. **Recommendation: Supabase hosted UI for v1** — ships immediately when the project config is enabled, no custom code required; the user-settings page can be custom in v2.
- What needs to happen first (sequencing):
  1. Klaas writes/approves a §P14.19 section in `01-specs/pages/admin-settings.md` (or a new `01-specs/pages/admin-2fa.md`) covering the 6 decisions above with full acceptance criteria (the current spec is one paragraph + an acceptance-criteria bullet for "2FA enforcement change requires typed CONFIRM" which only describes the toggle, not the enrollment flow).
  2. Klaas writes `04-platform/auth/supabase-config.md` (ADR-0008's referenced config doc) — the Supabase dashboard settings to enable + the per-role enrollment policy.
  3. Klaas enables MFA in the Supabase project (dashboard → Auth → Multi-Factor Authentication → Enable TOTP) — this is a Supabase dashboard click, not a code change.
  4. Once the spec lands, the cron can build the Security tab in `admin-settings.md` Slice 2 (the toggle + typed-CONFIRM modal + 7-day grace period tracking + per-admin clock) and the docs in `04-platform/auth/supabase-config.md`. Estimated ≤ 2 ticks once spec is approved.
- **Why this is a 1-tick STUB and not a code tick** — the spec explicitly defers the TOTP flow to v2. The cron cannot ship a TOTP flow without a spec (AGENTS.md rule #5). The infra (Supabase MFA config) is a Supabase dashboard setting, not code. Both are human steps that need Klaas.
- **Resolution path**: Klaas writes the spec → cron ships the Security tab in ≤ 2 ticks. Until then, P14.19 stays `[!]`.
- **Blocker**: missing spec + missing Supabase MFA infra (Klaas to enable in the dashboard).
- **Owner**: Klaas for spec + Supabase config; Mavis (cron) for code once spec lands.
- Created: 2026-07-03
- Will ship by: ≤ 2 ticks after Klaas writes the spec + enables Supabase MFA.

---

## STUB-129 — P14.20 Admin role granularity — super-admin / support / finance / content-mod (BLOCKED on missing spec — explicit v1 carve-out)

- Phase: Phase 14 (Admin console) — P14.20 is the second `[ ]` in PROGRESS.md from the lowest phase with any `[ ]` left as of 2026-07-03. The cron (session `mvs_dc1e5db83d634ed3ba2d67d94840c7cc`) flipped it to `[!]` after re-reading the spec; no production code was written.
- Why STUB: P14.20 is "Admin role granularity — super-admin / support / finance / content-mod" per `PHASES.md:556` (one-line description, zero acceptance criteria). Both the data-model doc and ADR-0007 explicitly defer sub-admin roles to v2: `_data-model.md:1809` *"No 'sub-admin' / 'moderator' / scoped admin role. v1 has a single `admin` role (and a `super_admin` role for the platform owner only, with the same visibility — no scoped sub-roles). Sub-roles and least-privilege scoping are deferred to v2 (see ADR-0008)."* `decisions/0007-new-tables-for-v1.md:131` re-confirms: *"No sub-admin / moderator role in v1 — see ADR-0008 (the only role extension in v1 is `super_admin` for the platform owner, which is a distinct role, not a scoped sub-role)."* No spec file at `01-specs/pages/admin-roles.md` / `01-specs/pages/admin-rbac.md` / similar exists (verified — `ls 01-specs/pages/ | grep -iE 'role|rbac|sub-admin'` returns 0 hits).
- What's missing (5 scope decisions for Klaas):
  - **(a) Role taxonomy** — the PHASES.md one-liner lists 4 roles (super-admin / support / finance / content-mod). Is that the final list? My recommendation: also add `compliance` (GDPR / DMCA / payouts) and `read_only` (audit-only) for future flexibility. Or stick to the PHASES list. **Recommendation: stick to PHASES — adding roles later is a small additive migration; removing is hard.**
  - **(b) Per-role powers** — what can each role do? My initial sketch: `super_admin` = everything (existing `super_admin`); `support` = read all entities + PII reveal + soft-suspend; `finance` = refunds + payouts + ledger; `content_mod` = products + reviews + flagged content. **The spec needs to nail each role's exact powers per action** — this is the lion's share of the work.
  - **(c) Schema** — extend the `user_role` enum with the new values? Or new `admin_role_assignments` table that maps `user_id` → `role` → `granted_by` → `granted_at` → `revoked_at`? **Recommendation: a new `admin_role_assignments` table** — gives an audit trail of who-granted-what-when + revocation; a flat enum is destructive and loses history. This is a P3.x-style migration (RLS included).
  - **(d) UI surface** — where do admins get a role? On the customer detail (P14.2) / partner detail (P14.4) / affiliate detail (P14.6) — but admin users are not customers. Need a new `/admin/users` list (searchable, filterable, role-aware) + `/admin/users/[id]` detail. Estimated ≤ 1 tick for the list + detail.
  - **(e) Action gates** — every existing admin action needs a `requireRole(['admin', 'super_admin', 'support', ...])` update. This is the bulk of the work. Some actions are destructive enough to need a specific role (e.g. only `super_admin` can change another admin's role — already noted in `admin-affiliate-detail.md:128`); others can be more permissive. **The spec needs to map every admin action to the minimum role that can perform it.**
- **Why this is a 1-tick STUB and not a code tick** — the data model explicitly carves this out of v1. Per-action role mapping is a large product decision that needs Klaas's product judgment (which role can do what) before code. AGENTS.md rule #5 forbids code without an approved spec.
- **Resolution path**: Klaas writes a `01-specs/pages/admin-roles.md` (or extends `admin.md`) covering the 5 decisions above + per-action role mapping → cron ships in ≤ 3-4 ticks (migration + role-assignment CRUD + per-action gate updates + new admin users list + new admin user detail).
- **Blocker**: missing spec (Klaas).
- **Owner**: Klaas for spec; Mavis (cron) for code once spec lands.
- Created: 2026-07-03
- Will ship by: ≤ 4 ticks after Klaas writes the spec.
