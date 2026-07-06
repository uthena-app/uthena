# Feature: partner-portal

Everything a partner (instructor) does: onboarding, dashboard, course upload wizard, sales, payouts, settings. (Some specs use the older "instructor-*" naming — same feature.)

- **Specs:** `01-specs/pages/partner-onboarding.md` (+ welcome/thanks), `instructor-dashboard.md`, `instructor-upload.md`, `instructor-payouts.md`, `partner-courses-detail.md`, `partner-courses-sales.md`, `partner-settings.md`, `partner-settings-api.md`
- **Owner:** unassigned — claimed by the implementing agent at build start
- **Depends on:** `auth`, `00-foundations/files` (uploads + malware scan), `00-foundations/money` (payouts), `00-foundations/data`, `00-foundations/security` (encryption)
- **Depended on by:** `admin` (partner review/approval)
- **Status:**
  - Phase 12 dashboard shell shipped (PH13a, 2026-06-17)
  - **P6.1 partner lifetime-sales KPI (2026-06-26)**
  - **P6.2 per-product revenue aggregates (2026-06-26)**
  - **P6.3 partner payouts page + CSV export (2026-06-26)** — full page + Slices 1+2 done
  - **P6.4 partner ledger detail (2026-06-26)**
  - **P6.5 Slice 1 partner payout method — PayPal email encryption + masking + audit (2026-06-26)** — PayPal email is now encrypted at rest via `00-foundations/security/encryption.ts`; legacy plaintext rows pass through transparently via `decryptStringOrPassThrough`. UI shows masked `k***@example.com` until the partner clicks Edit; tax_id gets a masked read-only display. Audit log row now writes on every settings update with masked before/after. Bank details + micro-deposit verification are P6.5 Slice 2 (filed as STUB-053).
  - **P12.1 onboarding wizard route shell (2026-06-29)** — 7-step wizard dispatch + stepper shell + Welcome step + 6 placeholder bodies (Slice 2-7 deferred to STUB-089)
  - **P12.2 onboarding draft persistence (2026-06-29)** — `saveStep` server action + 60/min/user rate limit + `<ContinueButton>` client island + audit row per save
  - **P12.3 onboarding welcome + thanks pages (2026-06-29)** — `/partner/onboarding/welcome` + `/partner/onboarding/thanks` (auth-gated, page-rate-limited, idempotent)
  - **P12.4 dashboard refinements (2026-06-29)** — "This month" KPI (5th card), earnings 30-day bar chart (inline SVG, zero client JS), recent activity feed (last 10 events from payout_ledger ∪ order_items). New SQL: `get_partner_month_sales_cents` + `get_partner_daily_sales_series` + `get_partner_recent_activity` in migration 0038.
  - **P12.11 Slice 1 sales summary (2026-06-30)** — Sales tab on `/partner/courses/[id]?tab=sales` now reads real per-course lifetime aggregates (revenue, units, refund rate, average rating) via SECURITY DEFINER RPC `get_partner_course_sales_summary(partner_id, product_id)` in migration 0042. Drill-down link to `/partner/courses/[id]/sales` lands in Slices 2+ (STUB-097).
- **Test locally:** `pnpm test 02-features/partner-portal`; resumable upload needs the docker-compose Bunny mock
- **Open follow-ups:** STUB-052 (legacy plaintext backfill), STUB-053 (P6.5 Slice 2 — bank + micro-deposit verification), STUB-054 (tax_id encryption scope) — see `STUBS.md` and `01-specs/pages/_followups.md`

## Layout

```
02-features/partner-portal/
├── PartnerShell.tsx           # RSC partner-portal layout shell (sidebar + main)
├── PartnerShell.module.css
├── PartnerSidebarActive.tsx   # tiny client island for active link highlighting
├── README.md
├── format.ts                  # PURE masking helpers (maskEmail, maskRoutingNumber, maskAccountNumber, maskTaxId) — P6.5 Slice 1
├── format.test.ts             # 24 unit tests for the masking helpers
├── actions/
│   └── updatePartnerSettings.ts   # 'use server' — encrypts PayPal email + writes audit row — P6.5 Slice 1
├── components/
│   ├── PartnerSettingsForm.tsx   # client form — masked display + Edit pattern — P6.5 Slice 1
│   ├── PartnerSettingsForm.module.css
│   ├── StatusBadge.tsx
│   ├── StatusBadge.module.css
│   ├── ActivityFeed.tsx          # P12.4 — RSC timeline of recent partner events (zero client JS)
│   ├── ActivityFeed.module.css
│   ├── EarningsChart.tsx         # P12.4 — RSC inline-SVG bar chart (zero client JS)
│   └── EarningsChart.module.css
└── queries/
    ├── getMyPartnerProfile.ts        # RSC — decrypts payout_method + 5-way parallel summary (3 product counts + lifetime RPC + month RPC) — P6.5 + P6.1 + P12.4
    ├── getMyPartnerProfile.test.ts
    ├── getMyPartnerProducts.ts       # per-product revenue aggregates (P6.2)
    ├── getMyPartnerProducts.test.ts
    ├── getPartnerDashboardExtras.ts  # P12.4 — getPartnerRecentActivity + getPartnerDailySalesSeries
    ├── getPartnerDashboardExtras.test.ts
    ├── decryptPayoutMethod.ts        # PURE — typed shape with plaintext + masked — P6.5 Slice 1
    └── decryptPayoutMethod.test.ts
```

## Hot paths

### P6.5 Slice 1 — PayPal email encryption + masking + audit (2026-06-26)

**Encryption at rest.** The `paypal_email` value is encrypted via the
existing `00-foundations/security/encryption.ts` helper (AES-256-GCM,
envelope `<iv>.<tag>.<ct>`) BEFORE writing to `partners.payout_method`.
The DB never sees plaintext. Legacy rows that were written before
P6.5 (with `payout_method = { paypal_email: 'plaintext' }`) keep
rendering correctly via `decryptStringOrPassThrough` — it detects the
shape via `isEncryptedEnvelope`'s strict 3-segment regex and passes
plaintext through unchanged. A future backfill cron (STUB-052)
re-encrypts legacy rows on first-write by the partner OR via a
scheduled sweep.

**Masking in the data layer.** `getMyPartnerProfile` returns a typed
`PartnerPayoutMethod` shape with both `paypal_email` (plaintext, for
the form's input value) and `paypal_email_masked` (for read-only
display). The form's view state shows the masked form with an Edit
button; clicking Edit reveals the input pre-filled with the
plaintext. Same pattern applies to `tax_id` (masked display, plaintext
input — encryption of `tax_id` is a separate slice, STUB-054).

**Audit logging.** Every successful `updatePartnerSettingsAction`
writes one `admin_audit_log` row via `writeSelfAuditLog`. The
metadata contains `target_table: 'partners'`, `fields_changed` (array
of which audited fields actually changed), and a `diff` object with
`{ field_name: { before: { masked }, after: { masked } } }` per
changed field. **The plaintext PayPal email and tax_id NEVER appear
in the audit row** — only masked forms. The unit test asserts this
via the captured insert payload.

**Payout method discriminator.** The typed `PartnerPayoutMethod` shape
includes `payout_method_kind: 'paypal' | null`. This is the
forward-compat hook for P6.5 Slice 2's `'bank'` value — adding bank
support is a query/form extension, not a schema migration.
