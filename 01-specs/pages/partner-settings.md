# Partner Settings — `/partner/settings`

## What this page does

The partner's settings hub. Six sections, each with its own card and save model: **Profile** (partner-public fields), **Payout** (PayPal email + next-payout preview), **Tax** (country, tax id, W-9 status), **KYC** (gov id upload + status), **Notifications** (marketing opt-ins scoped to partner concerns), and **Danger zone** (request suspension, request data export). A "API & webhooks" entry point links to `/partner/settings/api` (separate spec). The page does NOT duplicate account-profile.md's customer fields (display name, avatar, bio, locale, timezone); those live on `/account/profile` and the two pages never edit the same field. Every preference change on this page is audit-logged with before/after JSON; the audit goes to a partner-scoped table (see Open Questions for the table choice).

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Page header | `display_name` (greeting), `partner.status` badge, `partner.kyc_status` badge, `partner.tax_form_status` badge | profiles + partners | greeting + status badges |
| **Profile** | `partners.bio` (public partner bio) | `partners` | textarea (max 500 chars) |
| Profile | `partners.website_url` | `partners` | text input (URL-validated) |
| Profile | (display_name, avatar, locale, timezone) | (link to /account/profile) | link, not editable here |
| **Payout** | PayPal email (masked: `k***@paypal.com`, edit on click) | `partners.payout_method` (encrypted at app layer) | masked + edit pencil |
| Payout | `minimum_payout_cleared` (true/false) | derived from available balance | badge |
| Payout | `next_payout_date` | payout_ledger aggregate + cron schedule | mono date |
| Payout | `next_payout_amount_cents` | payout_ledger aggregate | mono number |
| **Tax** | `partners.tax_country` (ISO-3166-1 alpha-2) | `partners` (NEW column, see OQ) | select |
| Tax | `partners.tax_id` (masked, edit on click) | `partners` (NEW column, encrypted) | masked + edit pencil |
| Tax | `partners.tax_form_status` (none / pending / submitted / approved) | `partners` | read-only badge |
| Tax | "Upload W-9 / W-8BEN" CTA | server action returning signed PUT URL | button |
| **KYC** | `partners.kyc_status` (none / pending / approved / rejected) | `partners` | read-only badge |
| KYC | "Upload gov id front" | server action | button + thumbnail |
| KYC | "Upload gov id back" | server action | button + thumbnail |
| KYC | "Why is this needed?" | hard-coded | expandable help text |
| **Notifications** | `partner_updates_opt_in` (product review notifications, sales milestones) | NEW: `notification_preferences` (see account-settings.md OQ for schema; this page reuses the same table) | toggle |
| Notifications | `payout_notifications_opt_in` | same | toggle |
| Notifications | `refund_alerts_opt_in` | same | toggle |
| Notifications | (Transactional opt-in is locked, not rendered) | same | locked badge |
| **Danger zone** | "Request account suspension" | server action: sets `partners.status='suspended'` (we don't allow self-un-suspend in v1, admin only) | destructive button + confirm modal |
| Danger zone | "Request data export" | server action enqueues export job, success toast | button |
| Audit strip | "Last settings update: {time ago}" | most-recent `partner_audit_log` row for this partner where action='partner_settings_update' | mono timestamp |

**Queries / actions (all in `02-features/partner-portal/`):**
- `getMyPartnerSettings()` — RSC, joins `profiles` + `partners` + `notification_preferences` (left join, fallback to defaults)
- `updatePartnerProfile(input)` — server action, Zod-validated, writes `partners.bio` + `partners.website_url`
- `updatePayoutMethod(input)` — server action, encrypts PayPal email at app layer, writes `partners.payout_method`
- `updateTaxInfo(input)` — server action, writes `partners.tax_country` + `partners.tax_id` (encrypted)
- `uploadTaxForm()` — server action returning a Bunny signed PUT URL (5 min TTL, 10 MB cap, mime allowlist: `application/pdf`, `image/jpeg`, `image/png`)
- `uploadKycDocument(side)` — server action returning a Bunny signed PUT URL (5 min TTL, 5 MB cap, image/*)
- `updateNotificationPrefs(input)` — server action, writes `notification_preferences` (shared with `/account/settings`)
- `requestAccountSuspension()` — server action, sets `partners.status='suspended'`, sends admin notification email
- `requestDataExport()` — server action, enqueues the same export job as `/account/settings`

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Edit bio | Type in the bio textarea (500-char limit) | Local form state, dirty flag set | partner (self) |
| Edit website URL | Type in the URL field | Local form state | partner (self) |
| Save profile | Click "Save profile" | Server action runs, success toast, audit row | partner (self) |
| Edit PayPal email | Click the edit pencil, type new email | Local form state, email-validated | partner (self) |
| Save payout method | Click "Save payout method" | Server action runs, encrypts at app layer, audit row | partner (self) |
| Edit tax country | Open select, pick a value | Local form state | partner (self) |
| Edit tax id | Click the edit pencil, type new id | Local form state, format-validated per country | partner (self) |
| Upload tax form | Click "Upload W-9" → file picker | Client posts to Bunny signed URL, then updates `partners.tax_form_status='pending'` | partner (self) |
| Upload KYC front | Click "Upload gov id front" → file picker | Same flow, sets `partners.kyc_status='pending'` (only if currently 'none') | partner (self) |
| Upload KYC back | Click "Upload gov id back" → file picker | Same flow | partner (self) |
| Toggle a notification | Click the toggle | Inline save, success toast, audit row | partner (self) |
| Navigate to API settings | Click "API & webhooks" in the section header | Navigate to `/partner/settings/api` | partner (self) |
| Navigate to public profile | Click "Edit public profile (display name, avatar, bio)" | Navigate to `/account/profile` | partner (self) |
| Request account suspension | Click "Request account suspension" | Confirmation modal (type email to confirm), server action sets `partners.status='suspended'`, all products unpublished, admin notified, all sessions revoked, redirect to `/` | partner (self) |
| Request data export | Click "Request data export" | Server enqueues export job, success toast ("we'll email you a link within 10 minutes"), button shows cooldown (60s), rate-limited 1/hour | partner (self) |
| Open keyboard shortcut panel | Press `?` | Modal shows page shortcuts (none for v1) | partner (self) |

## What this page does NOT do

- No edit of display_name / avatar / locale / timezone (those are on `/account/profile`)
- No edit of partner's email (the email lives on `auth.users`; changing it is a Supabase Auth flow, not a form)
- No edit of `partners.user_id` or `partners.status` (status is admin-controlled)
- No 2FA setup (lives on `/account/settings` in v2)
- No "view as customer" toggle (a partner is also a customer via the same `auth.users`; they can log out and back in as a customer if they want)
- No payout-schedule customization (we ship one schedule in v1: monthly on the 1st)
- No per-payout-method change (PayPal only in v1; multi-method is v2)
- No tax-document generation (1099s, etc.; the partner gets a CSV from `/partner/payouts`)
- No multi-currency display (USD only)
- No public profile preview (the public partner surface is the partner bio shown on the product page; no separate public profile in v1)
- No "withdraw tax form" or "withdraw KYC" (once submitted, the form is in review with the admin; partner can ask the admin to reset)
- No API/webhook management on this page (separate spec at `/partner/settings/api`)
- No per-product notification settings (the notifications on this page are partner-account-wide)

## Acceptance criteria

- [ ] Page is auth-gated AND requires `profiles.role IN ('partner')`
- [ ] Customer-only / affiliate / admin access returns 404 (we use 404 to avoid leaking the partner surface)
- [ ] Bio input enforces 500-char limit (client + server Zod)
- [ ] Website URL is validated as a URL (http/https only; reject javascript:, data:, file:)
- [ ] PayPal email is encrypted at the app layer BEFORE writing to `partners.payout_method` (never stored plaintext)
- [ ] PayPal email is masked in the rendered HTML (`k***@paypal.com`); clicking edit unmasks the input
- [ ] Tax id is encrypted at the app layer BEFORE writing
- [ ] Tax form upload accepts only `application/pdf`, `image/jpeg`, `image/png`; max 10 MB; server-validated at the signed-URL mint step
- [ ] KYC upload accepts only image/*; max 5 MB per side
- [ ] Notification toggles are saved inline (no Save button on the section) within 300ms
- [ ] Every preference change writes a `partner_settings_update` row to `partner_audit_log` (or `admin_audit_log` — see OQ) with before/after JSON
- [ ] "Request account suspension" requires typed email confirmation; on success, `partners.status='suspended'`, all products unpublished, all sessions revoked, admin notification email sent, redirect to `/`
- [ ] "Request data export" enqueues a server-side export job, shows a success toast, rate-limits to 1 request per partner per hour, sends the email link to the verified email only
- [ ] "API & webhooks" link in the section header navigates correctly to `/partner/settings/api`
- [ ] Status badges (kyc, tax, partner.status) reflect the current DB state on every load
- [ ] The page renders in < 350ms p95 (RSC; one row read on `partners`, one left-join on `notification_preferences`)
- [ ] All inputs are keyboard-navigable with `--border-3` focus rings; mobile responsive at 360px, 768px, 1280px
- [ ] No PII in URLs, no `TODO` / `FIXME` / `HACK` in the diff, no console errors in dev or prod

## Design reference

- Mockup: not yet built — to be created during the partner portal build
- Design tokens: `00-foundations/design/tokens.css`
- Theme: both (dark default, light for users who toggle)
- Reference patterns: `mockups/library.html` (section header + card density, mono timestamps, hairline borders)

## Security

- **Auth required:** YES
- **Allowed roles:** partner (any status; suspended partners can view the page but cannot edit)
- **RBAC enforcement:** server actions check `user_id = auth.uid()` before any write. RLS is the second line of defense.
- **RLS policies that apply:**
  - `partners` — `partners_self_read`, `partners_self_update` (writes to bio/website/payout_method/tax fields go through this policy)
  - `notification_preferences` — see account-settings.md OQ for the schema; this page shares the same table
  - `payout_ledger` — `payout_ledger_partner_read_own` (for the next-payout preview)
- **PII displayed:** the partner's own data (bio, website, masked PayPal email, masked tax id). We do NOT display the raw PayPal email or raw tax id; they are masked in the rendered HTML and never returned in plaintext via the API.
- **PII in URLs:** no
- **Encryption at app layer:** PayPal email and tax id are encrypted with `00-foundations/money/encryption.ts` (AES-256-GCM, key from env). The DB stores the ciphertext; the API never returns the plaintext. Masking is server-side, derived from the ciphertext.
- **Upload security:**
  - Tax form: mime allowlist (pdf/jpeg/png), size cap 10 MB, server-side mime re-validation after upload
  - KYC: mime allowlist (image/*), size cap 5 MB per side, server-side re-validation
  - Storage paths: `/partner-kyc/{partner_id}/{side}.{ext}` and `/partner-tax/{partner_id}/{form_id}.pdf` — namespaced by partner, no overwrite possible
  - Signed PUT URLs: Bunny, 5 min TTL, bound to partner's id
- **CSRF:** server actions use Next.js's built-in origin check + Supabase Auth session cookie
- **Rate limiting:** 100 setting saves per partner per hour; 1 data export per partner per hour; 1 account suspension request per partner per 24h
- **Suspension atomicity:** the suspension action runs inside a Postgres serializable transaction. Status flip, product unpublish, session revoke, admin notification either all succeed or all fail.
- **Audit logged:** every preference change writes a `partner_settings_update` row to the partner-audit-log table (see OQ) with `before`/`after` JSON. The PayPal email and tax id are NEVER in the audit row payload — only the fact that they changed.
- **Third-party scripts:** none

## Performance

- **Target p95:** < 350ms (RSC; one row read on `partners`, one left-join on `notification_preferences`, one aggregate on `payout_ledger`)
- **Render strategy:** RSC (no client-side data fetching for the initial render)
- **Cache:** none — page is user-specific
- **DB indexes:** implicit `partners_user_id_unique`; NEW: `partners (status, updated_at desc)` for the partner-status-based filtering the admin needs
- **Bundle size budget:** < 40KB added to client bundle (six section cards + inline-save toggles + two confirmation modals + the upload manager). Toggles use the platform `<Switch>` primitive.

## Out of scope for v1

- Edit of display_name / avatar / locale / timezone (on /account/profile)
- Email change
- 2FA setup
- Payout-schedule customization
- Multi-method payouts
- Tax-document generation (1099s)
- Multi-currency display
- Public profile preview
- Per-product notification settings
- Per-payout-method routing
- API/webhook management (separate spec)
- Re-submission of tax form after rejection (the partner can ask the admin to reset; in v2 we add a self-serve reset)

## Open questions for human

- **KYC and tax columns:** the data model has `partners.tax_form_status` and `partners.kyc_status` but no columns for `tax_country`, `tax_id`, or the actual document storage path. My recommendation: add `tax_country text`, `tax_id_encrypted bytea` (ciphertext), `tax_form_storage_path text`, `kyc_front_storage_path text`, `kyc_back_storage_path text` to the `partners` table. New migration. Approve or amend.
- **PII encryption approach:** the data model implies "encrypted at app layer" for `partners.payout_method` (PayPal email). My recommendation: extend this to `tax_id_encrypted` and any other sensitive column. Use AES-256-GCM with a key from env (Doppler). The encryption helper is `00-foundations/money/encryption.ts` (extend to a generic `00-foundations/security/encryption.ts` in v2). For v1, the encryption is consistent across payout_method and tax_id.
- **Partner audit log:** partner-initiated settings changes need a log. Options: (a) reuse `admin_audit_log` with `admin_id` set to the partner's id (slight abuse of the table name), (b) create a new `partner_audit_log` table (parallel structure, separate retention), (c) add a `partner_id` column to `admin_audit_log` and make `admin_id` nullable. My recommendation: (c) — extend the existing table; partners ARE admins-of-their-own-data, and the audit log is "who did what to whose data", not "admin-only". The table name is mildly misleading but the data shape is right. v2 rename if it bothers us.
- **Suspension effect on products:** when a partner self-suspends, what happens to their published products? My recommendation: unpublish (status='unpublished'), so the storefront stops selling them. Existing buyers keep their `library_grants` (we don't yank content from existing customers — see ARCHITECTURE.md §8). The partner can ask the admin to reinstate, which republishes.
- **Self-suspension reversibility:** my recommendation: partners CANNOT self-unsuspend. The action is one-way in v1; reversal is admin-only (via `/admin/partners/[id]` v2). This is a deliberate safety choice — accidental self-suspension is recoverable (admin reset), but a partner who is mid-crisis and clicks "suspend" is not in a state to make a second rational decision.
- **Tax form versioning:** if a partner uploads a new W-9, do we keep the old one? My recommendation: yes, soft-versioned. New column `partners.tax_form_history jsonb` (array of `{storage_path, uploaded_at, reviewed_at, reviewed_by, status}`). The current form is the latest entry; the history is for audit. Or use a separate `partner_documents` table — cleaner but one more table. My recommendation: jsonb array for v1 (small, append-only), table in v2 if it grows.
- **Notification preferences scope:** this spec reuses the `notification_preferences` table from `/account/settings` (per the OQ in that spec). My recommendation: yes, share the table. The columns are: `email_digest_freq`, `transactional_opt_in` (locked), `marketing_opt_in` (master), `newsletter_opt_in`, `partner_updates_opt_in`, `affiliate_updates_opt_in`, `payout_notifications_opt_in` (NEW), `refund_alerts_opt_in` (NEW). The last two are partner-specific; if the user is not a partner, they're null. Same table, broader schema.

---

## Implementation notes

### P6.5 Slice 1 — PayPal email encryption + masking + audit (2026-06-26)

**Scope of this slice:** wire PayPal email through the existing
`00-foundations/security/encryption.ts` module (AES-256-GCM,
application-layer envelope `<iv>.<tag>.<ct>`). Add masking helpers for
display, audit logging for the existing `updatePartnerSettingsAction`
(no audit row was being written before — that was a gap), and legacy
plaintext support via `decryptStringOrPassThrough` so the rollout
doesn't break existing partner rows. **Bank details + micro-deposit
verification are NOT in this slice** — they're P6.5 Slice 2 (filed as
a follow-up below).

**Files (3 new + 6 modified + 2 docs):**
- **NEW** `02-features/partner-portal/format.ts` — pure helpers
  (`maskEmail` returning `"k***@example.com"`, `maskRoutingNumber`
  returning `"****1234"`, `maskAccountNumber` returning `"*****6789"`).
  The masking is presentation-only — the form holds the plaintext in
  local state and renders the masked form via these helpers when the
  field is read-only. The 3 future helpers (routing, account) live
  alongside so the bank's masking lands in one place when Slice 2
  ships.
- **NEW** `02-features/partner-portal/format.test.ts` — 24 unit tests
  covering the masking edge cases (empty, no `@`, multi-`@`, very
  short local part, IDN domains, length caps, number masking).
- **NEW** `02-features/partner-portal/queries/decryptPayoutMethod.ts` —
  pure helper that takes the raw `payout_method` JSONB and returns a
  typed shape `{ paypal_email: string | null, paypal_email_masked:
  string | null, payout_method_kind: 'paypal' | null }`. Handles three
  shapes transparently: (1) new encrypted envelope → decrypt + mask,
  (2) legacy plaintext `paypal_email` field → use as-is + mask, (3)
  null/empty/missing → all nulls. Never throws (a corrupted envelope
  is logged + returns null, not a crash).
- **NEW** `02-features/partner-portal/queries/decryptPayoutMethod.test.ts`
  — 18 unit tests covering the 3 input shapes + the corruption /
  edge-case paths + the masking output shape.
- **MODIFIED** `02-features/partner-portal/actions/updatePartnerSettings.ts`
  — encrypts `paypal_email` via `encryptString` before writing the
  `payout_method` JSONB column (stores under the new
  `paypal_email_encrypted` key — legacy `paypal_email` key is
  abandoned). Writes one `admin_audit_log` row on every successful
  update with `action='settings_self_update'` + `target_kind='partners'`
  + `target_id=<partner_id>` + `metadata={ before, after, fields_changed, target_table: 'partners' }` — the
  before/after JSON contains ONLY the field names + masked values
  (the plaintext PayPal email NEVER appears in the audit row, per
  the spec's Security §"Audit logged"). The audit write is best-effort
  (a failed audit doesn't abort the update) — same pattern as the
  P6.3 CSV-export's `admin_audit_log` write.
- **MODIFIED** `02-features/partner-portal/queries/getMyPartnerProfile.ts`
  — the returned `PartnerProfile.payout_method` shape changed from
  `Record<string, unknown> | null` to a typed
  `PartnerPayoutMethod` (`{ paypal_email: string | null,
  paypal_email_masked: string | null, payout_method_kind: 'paypal' |
  null }`). The shape is computed via the new
  `decryptPayoutMethod` helper. Callers (the settings form) now
  read `payout_method.paypal_email` directly instead of digging into
  a `Record`.
- **MODIFIED** `02-features/partner-portal/queries/getMyPartnerProfile.test.ts`
  — adds 7 new test cases: legacy plaintext shape decrypts to the
  plaintext value, new envelope shape decrypts to the plaintext
  value, null returns all-nulls, corrupted envelope returns
  plaintext=null but doesn't crash, `paypal_email_masked` is the
  masked form of the plaintext, `payout_method_kind` is `'paypal'`
  when an email is set + null otherwise.
- **MODIFIED** `02-features/partner-portal/components/PartnerSettingsForm.tsx`
  — adds the read-only/edit affordance pattern from the spec: when
  the section is in "view" state, the email displays as
  `paypal_email_masked` (e.g. `k***@example.com`); a pencil icon
  reveals the input pre-filled with `paypal_email`. The dirty-flag
  check now compares against `paypal_email` instead of digging into
  the JSONB. Same pattern for `tax_id` (added the masking helper
  but the field stays plaintext — encryption of tax_id is a
  separate slice per the spec's open question on PII encryption
  scope; STUB-054).
- **MODIFIED** `02-features/account/profile/actions/writeSelfAuditLog.ts`
  — extended the `targetKind` union from `'profiles' | 'auth.sessions'
  | 'orders' | 'refunds'` to `'profiles' | 'auth.sessions' | 'orders'
  | 'refunds' | 'partners' | 'payout_method'`. The two new kinds
  are documented as the partner-settings / partner-payout-method
  audit surfaces. The existing self-audit-log calls are
  unaffected.
- **MODIFIED** `02-features/partner-portal/README.md` — Status bumped
  to include P6.5 Slice 1. File map updated. Hot-path section
  extended with the masking + encryption decisions.

**Design decisions (worth remembering):**

1. **Encryption key envelope over inline ciphertext.** The existing
   `00-foundations/security/encryption.ts` helper produces
   `<iv>.<tag>.<ct>` base64url segments, which is what we store in
   the JSONB. Storing the envelope (not the raw ciphertext + side
   IV/tag columns) keeps the schema unchanged — the encryption is
   truly application-layer. No migration needed for this slice.

2. **Legacy plaintext support via `decryptStringOrPassThrough`.**
   The existing partner rows (if any) have `payout_method =
   { paypal_email: 'plaintext' }`. The decrypt helper detects the
   shape via `isEncryptedEnvelope` (regex strict-match on the
   3-segment base64url pattern) and passes plaintext through
   unchanged. New writes go through `encryptString` — so any
   partner who saves their payout method post-Slice 1 ships an
   encrypted envelope. The legacy plaintext rows are eventually
   re-encrypted by STUB-052 (backfill cron).

3. **Masking in the data layer, not the form.** The query returns
   `paypal_email` (plaintext, for the form's input value) AND
   `paypal_email_masked` (for read-only display). Putting the
   masking in the data layer means the form never has to import
   the mask helper just to render — the typed shape carries both.
   When Slice 2 adds bank fields, the same shape extends with
   `bank_routing_masked` / `bank_account_masked` — one
   decryption site, one masking site, one place to audit PII
   flow.

4. **Audit log target_kind = 'partners', not 'payout_method'.**
   The audit row describes "a partner settings update happened",
   not "a payout method changed". `metadata.target_table` is
   `'partners'` so the admin can filter by table; the spec's
   `metadata.fields_changed` array tells the admin WHICH fields
   changed (so a bio change and a PayPal email change are both
   distinguishable). The decision: the audit row is per-PARTNER
   (so the target_id is the partner id, not the user id), and
   the change details are in metadata. This matches the existing
   `admin_audit_log` model.

5. **Plaintext PayPal email in the audit row's `before/after` is
   FORBIDDEN.** The metadata's `before` / `after` objects contain
   ONLY `{ field_name: { masked: 'k***@example.com' } }` for the
   PayPal field — never the plaintext. The spec's Security §"Audit
   logged" is explicit on this. The test for the action asserts
   this via the captured audit payload (regression catches any
   future leak).

6. **Best-effort audit write.** A failed audit insert doesn't
   abort the partner's settings update — same fail-soft pattern
   as the P6.3 CSV-export's audit row. The audit failure is logged
   as `audit_write_failed` warn (via the existing
   `writeSelfAuditLog` helper). The partner still gets their
   `Saved.` toast; ops catches the audit-log volume metrics to
   detect silent drops.

7. **The `tax_id` field stays plaintext for this slice.** The
   spec's open question on PII encryption scope allows PayPal +
   bank as the v1 scope, with tax_id deferred to a follow-up
   (STUB-054). The masking helper for tax_id IS added (so the
   read-only display masks it like PayPal), but no encryption
   at rest yet. The masking is a UX win even without encryption.

8. **The `tax_id` field is NOT in the partner-settings Payout
   section.** It lives in the Tax section of the form. The
   masking helper is added to the same `format.ts` module so
   when Slice 2 wires tax_id encryption, the helper is one
   import away. The mask format for tax_id is
   `***-**-{last4}` (e.g. `***-**-6789`) — matches the spec's
   "masked in rendered HTML" requirement.

9. **`payout_method_kind` field is the forward-compat hook.**
   The current shape only supports PayPal (per spec: "No
   per-payout-method change (PayPal only in v1; multi-method is
   v2)"). But the `payout_method_kind` discriminator on the
   typed shape lets Slice 2 add `'bank'` without changing the
   partner settings query — only the format helper + the form
   component grow new branches.

**Open questions for human (carried from the spec):**
- Tax ID encryption scope (STUB-054) — same AES-256-GCM helper,
  but a separate slice. Approve when ready.
- Bank details UI + storage (Slice 2) — needs micro-deposit
  verification flow + Stripe Connect or Plaid integration. Not
  shippable until those decisions land.
- Re-encrypt legacy plaintext rows (STUB-052) — scheduled as
  one-off cron at next deploy, or on first-write by the partner
  (already handled by the write path; the cron is for rows that
  never get re-saved).


### P12.17 Slice 1 — bio + headshot + social links + public profile toggle (2026-06-30)

**Scope of this slice:** wire the four PHASES.md P12.17 surfaces
("bio, headshot, social links, public profile") onto the existing
`/partner/settings` form. Bio was already shipped (P6.5 Slice 1). The
new pieces are headshot (link), social links (5-field grid), and the
public profile toggle (opt-in). The form was already 95% shipped from
prior work; this slice fills the remaining gaps.

**Schema (migration `0044_partner_social_links_public.sql`):**
- New `partners.social_links jsonb NOT NULL DEFAULT '{}'::jsonb` —
  stores the 5 public handle fields (twitter / linkedin / youtube /
  github / website) as a flat jsonb object. Default `'{}'::jsonb` so
  the read path never sees NULL.
- New `partners.is_public boolean NOT NULL DEFAULT false` — opt-in
  toggle for the future standalone `/partner/[slug]` public profile
  surface. Default `false` (no auto-opt-in for existing partners).
- No new RLS policies: the existing `partners_self_update` policy
  already covers writes to the new columns (user_id = auth.uid()
  check); the future public-profile page adds a new
  `partners_public_read_is_public` policy in its own migration when
  it ships.

**Type surface (`02-features/partner-portal/queries/getMyPartnerProfile.ts`):**
- New `PartnerSocialLinks` type — flat object with 5 nullable string
  fields.
- `PartnerProfile` extended with `social_links: PartnerSocialLinks`
  + `is_public: boolean`.
- `normalizeSocialLinks(raw)` — defensive coercion (null / non-object
  / partial / non-string values all collapse to all-nulls). Always
  returns the full shape so the form never defends against undefined
  keys.

**Action (`02-features/partner-portal/actions/updatePartnerSettings.ts`):**
- `PartnerSettingsSchema` extended with:
  - `social_links: z.object({ twitter, linkedin, youtube, github,
    website }).strict()` — each field has its own Zod regex (Twitter
    1-15 alnum + underscore, LinkedIn slug, YouTube handle/URL,
    GitHub 1-39 alnum + hyphen, website https URL). `.strict()`
    rejects unknown keys at the parse boundary.
  - `is_public: z.boolean().optional().default(false)` — always sent
    from the form (true or false) so the action can distinguish
    "user toggled OFF" from "user didn't visit the field".
- Field-error path now uses `i.path.join('.')` instead of
  `i.path[0]?.toString()` so nested errors (e.g.
  `social_links.twitter`) surface under the right key in the
  fieldErrors map the form reads.
- Snapshot now reads `social_links + is_public` alongside the
  existing audited fields. Audit diff coverage extended to the new
  fields (JSON.stringify deep-equality for `social_links`; plain
  boolean compare for `is_public`).
- New `compactSocialLinks(input)` — strips null / empty / whitespace-
  only fields before writing so the DB only stores set fields. Always
  returns `{}` (never null) when no fields are set.
- PayPal email + tax_id masking preserved: the plaintext never appears
  in the audit row.

**Form (`02-features/partner-portal/components/PartnerSettingsForm.tsx`):**
- New "Profile" sub-section: bio (existing) + website_url (existing)
  + headshot link card → `/account/profile` (where the P9.2 avatar
  uploader lives; per spec, headshot does NOT duplicate on this
  surface).
- New "Social links" sub-section: 5-input 2-column grid (collapses
  to 1 column at ≤540px), each input bound to a per-platform local
  state with maxLength caps. Empty inputs → compact-stripped before
  write.
- New "Public profile" sub-section: opt-in toggle rendered as a
  `<button role="switch" aria-checked>` with a token-only "On / Off"
  pill. Disabled with a `--warn` notice when `partner.status !==
  'approved'` (an unapproved partner cannot have a public profile).
- Saved-state feedback switched from the inline `.submitOk` paragraph
  to a real toast via `useToast()` (P9.1's Toast primitive; the
  provider is mounted in the root layout so any client surface can
  call it). Error path also surfaces via `toast.error(...)`.

**Tests:**
- `02-features/partner-portal/queries/getMyPartnerProfile.test.ts` —
  PARTNER_ROW mock updated; +8 tests covering social_links jsonb
  normalization (empty / full / partial / corrupted / non-object
  shapes) + is_public default / true / coerced-false defensive paths.
- `02-features/partner-portal/actions/updatePartnerSettings.test.ts`
  (NEW, 16 tests, 5ms) — Zod validation (every platform regex
  acceptance + rejection path + `.strict()` unknown keys + is_public
  boolean coercion) + DB write shape (compact-stripped social_links
  with only set fields, is_public always written) + audit-log diff
  coverage (changes detected, masked PII preserved in audit row,
  no audit row when nothing changed).

**Checklist:**
- All 6 static checks green + `pnpm check:enum-coverage` (no new
  enums — partners.social_links is jsonb, partners.is_public is
  boolean).
- `pnpm test` 3242/3242 (was 3218, +24: 16 action + 8 query).
- `pnpm build` clean (58 routes; `/partner/settings` is 5.83 kB /
  116 kB first-load — was 460 B / ~114 kB, +5.4 kB from the new
  form surface + the toast primitive; shared first-load JS
  unchanged at 101 kB).

**Spec divergence flagged (no code change, awaiting Klaas):**
The PHASES.md P12.17 line is "Settings: bio, headshot, social links,
public profile." The spec at `partner-settings.md` covers the FULL
settings page (6 sections). The shipped P12.17 Slice 1 fills the
PHASES.md surface (bio + headshot link + social links + public
profile toggle). The remaining spec sections (Notifications,
Danger zone, Audit strip, "API & webhooks" entry point, KYC + Tax
form UI gated on Bunny creds) are out of P12.17's PHASES.md scope
and land in Phase 12 follow-ups once the surface plans are decided.
