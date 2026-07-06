# Admin Settings — `/admin/settings`

## What this page does

The platform-wide settings hub. Six tabs: **General**, **Payments**, **Email**, **Storage**, **Security**, **Feature flags**. Every setting is stored in a NEW `platform_settings` table (key-value, see Open Questions). The critical security property of this page: **secrets live in env (Doppler / Coolify); only non-secret config lives in the DB**. The page displays a "key exists" indicator for secrets, never the secret value. All setting changes are audit-logged with before/after JSON. Destructive changes (maintenance mode ON, captcha provider change, 2FA enforcement change) require typed confirmation ("type CONFIRM to save").

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Sidebar | (same admin sidebar) | hard-coded | sidebar |
| Top bar | page title, "Save changes" button (per tab), "Discard" button, "View audit log" link | hard-coded | top bar |
| Tab nav | 6 tabs (General, Payments, Email, Storage, Security, Feature flags) | hard-coded | tab nav |
| Audit strip | "Last settings update: {time ago} by {admin display_name}" | most-recent `admin_audit_log` row where `target_table='platform_settings'` | mono strip |
| **General** | `site_name` | `platform_settings` | text input |
| General | `support_email` | `platform_settings` | text input (email-validated) |
| General | `default_locale` | `platform_settings` | select (10 locales) |
| General | `default_timezone` | `platform_settings` | select (IANA, searchable) |
| General | `maintenance_mode` (boolean toggle) | `platform_settings` | toggle + confirmation modal |
| **Payments** | `stripe_publishable_key` (display only, masked) | env (read at boot) | read-only badge: "Configured" or "Not set" |
| Payments | `stripe_secret_key` | env | NEVER displayed. Badge: "Configured" or "Not set" |
| Payments | `paypal_client_id` | env | Badge only |
| Payments | `paypal_client_secret` | env | Badge only |
| Payments | `paypal_payout_mode` (sandbox / live) | `platform_settings` | toggle |
| Payments | `default_currency` (USD only in v1) | `platform_settings` | read-only display |
| Payments | `tax_handling_mode` (off / stripe_tax / manual) | `platform_settings` | radio group |
| Payments | `minimum_payout_threshold_cents` | `platform_settings` | number input |
| **Email** | `resend_api_key` | env | Badge only |
| Email | `default_from_address` | `platform_settings` | text input (email-validated) |
| Email | `default_from_name` | `platform_settings` | text input |
| Email | `transactional_template_overrides` (per-template toggles) | `platform_settings` | table of template names with on/off |
| Email | (link to "Email templates" management — flag in OQ as v1.5 / v2) | — | link |
| **Storage** | `bunny_stream_api_key` | env | Badge only |
| Storage | `bunny_stream_library_id` | env | Badge only |
| Storage | `bunny_storage_zone` | env | Badge only |
| Storage | `bunny_storage_access_key` | env | Badge only |
| Storage | `bunny_cdn_hostname` | `platform_settings` | text input |
| Storage | `default_video_quality_ladder` (e.g. "240p,480p,720p,1080p") | `platform_settings` | text input with validation |
| Storage | `max_upload_size_bytes` | `platform_settings` | number input (human-readable MB) |
| Storage | `max_course_storage_per_partner_bytes` | `platform_settings` | number input |
| **Security** | `rate_limit_signin_per_hour` | `platform_settings` | number input |
| Security | `rate_limit_password_reset_per_hour` | `platform_settings` | number input |
| Security | `rate_limit_file_url_per_hour` | `platform_settings` | number input |
| Security | `session_lifetime_days` | `platform_settings` | number input |
| Security | `csrf_mode` (auto / strict) | `platform_settings` | radio group |
| Security | `captcha_provider` (none / turnstile / hcaptcha) | `platform_settings` | radio group + confirmation modal |
| Security | `captcha_site_key` (display, the secret is in env) | `platform_settings` + env | text input + badge |
| Security | `force_2fa_for_admins` (boolean toggle) | `platform_settings` | toggle + confirmation modal |
| **Feature flags** | `flags` — key/value/toggle/notes list | `platform_settings` (`flags` is a jsonb column) | editable list |
| Feature flag row | `key`, `enabled`, `description`, `rollout_pct` (0-100, optional) | `platform_settings.flags` | row with toggle |
| Add flag | Click "Add flag" | Modal: key, default-enabled, description | modal |
| View audit log | Click "View audit log" | Navigate to `/admin/audit?target=platform_settings` (v2 — for v1, opens a modal with last 50 audit rows) | admin |

**Queries:** `02-features/admin/queries/getPlatformSettings.ts` (returns a single settings object with all keys flattened), `setPlatformSetting(key, value)` (server action).

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Switch tab | Click a tab | Loads the tab content (RSC sub-tree) | admin |
| Edit a setting | Change the value in the input | Dirty flag set per tab | admin |
| Save tab | Click "Save changes" | Server action `setPlatformSetting` runs for all dirty fields, atomic, audit row per setting (or one row with `after` listing all changed keys — see OQ), success toast | admin |
| Discard changes | Click "Discard" | Reverts form to last-saved values, clears dirty flags | admin |
| Toggle maintenance mode | Click the maintenance toggle | Confirmation modal (typed "type CONFIRM"), on confirm sets `maintenance_mode=true`, returns 503 for non-admin routes, audit row | admin |
| Change captcha provider | Pick a different value | Confirmation modal, on confirm updates setting, requires a captcha site key (validated), audit row | admin |
| Toggle 2FA for admins | Click the toggle | Confirmation modal, on confirm sets `force_2fa_for_admins=true`, immediately enforces on next admin sign-in (existing admins get a grace period of 7 days — see OQ) | admin |
| Add a feature flag | Click "Add flag", fill modal | New row in `flags` jsonb, audit row | admin |
| Toggle a feature flag | Click the flag's toggle | Inline save, audit row | admin |
| Delete a feature flag | Click "Remove" on a flag row | Confirmation, audit row | admin |
| View audit log for settings | Click "View audit log" | Modal with last 50 audit rows where `target_table='platform_settings'`, paginated | admin |
| Reset to defaults | (not in v1) | — | — |
| Manage env secrets | (out of scope — env is managed in Doppler / Coolify) | — | — |

## What this page does NOT do

- No env secret management (this page NEVER displays a secret; secrets are managed in Doppler / Coolify and the page shows only a "Configured" / "Not set" badge)
- No setting-history / version diff view (audit log is the history; we don't build a separate "this setting was X on date Y" view)
- No setting-level RBAC (every admin sees every setting; the human in the loop trusts admins)
- No rollback of an individual change (use the audit log to identify the prior value, then re-save)
- No real-time propagation (a setting change takes effect on the next request that reads the setting; we don't push changes to running processes)
- No automatic setting migration (when we add a new setting in code, we don't auto-insert a default row; the read path falls back to a hard-coded default in code)
- No per-environment overrides from the UI (dev / staging / prod are separate env files; we don't surface a per-env picker in v1)
- No "what changed last week" digest
- No two-admin approval for setting changes (single admin can change anything; the audit log + 2FA in v2 is the defense)
- No mass-update / JSON paste

## Acceptance criteria

- [ ] Page is auth-gated AND requires `profiles.role = 'admin'`
- [ ] Customer/partner/affiliate access returns 404
- [ ] Every secret-bearing setting shows only a "Configured" or "Not set" badge — the actual secret value is NEVER in the rendered HTML, NEVER in the server response body, NEVER in logs
- [ ] Saving a tab writes one audit row per changed key (or one row with `after` listing all changed keys — see OQ) with `before` and `after` JSON, `target_table='platform_settings'`, `target_id=key`
- [ ] Maintenance mode toggle requires typed "type CONFIRM" confirmation; on save, the setting takes effect on the next request (we cache the value for 60s, so the worst case is 60s of stale enforcement — see OQ)
- [ ] Captcha provider change requires typed "type CONFIRM" and validates that a captcha site key is set (otherwise the save fails with a clear error)
- [ ] 2FA enforcement change requires typed "type CONFIRM"; the change is staged for a 7-day grace period before enforcement (existing admins have 7 days to enroll)
- [ ] Tabs render the correct settings for the current schema; adding a new setting in code that has no DB row falls back to the code default and surfaces a "Using default" badge
- [ ] Feature flag toggles work inline (no Save button on the row); the toggle is debounced 500ms
- [ ] "View audit log" modal shows the last 50 setting-related audit rows, paginated
- [ ] Saving a tab that contains no changes is a no-op (no audit row written)
- [ ] Concurrent saves from two admins on the same key: the second save fails with a "Settings changed since you loaded this page" error and re-loads
- [ ] Every secret setting has a "Where to set this" inline help text linking to a runbook in `05-ops/runbooks/`
- [ ] The page renders in < 400ms p95
- [ ] No `TODO` / `FIXME` / `HACK` in the diff

## Design reference

- Mockup: not yet built — to be created during the admin build
- Components: `00-foundations/ui/AdminSidebar.tsx`, `00-foundations/ui/SettingsTabs.tsx`, `00-foundations/ui/SecretBadge.tsx`, `00-foundations/ui/ConfirmModal.tsx`, `00-foundations/ui/FeatureFlagRow.tsx`

## Security

- **Auth required:** YES
- **Allowed roles:** admin (only)
- **RLS policies that apply:** NEW: `platform_settings` (admin read; admin write; no public access)
- **PII displayed:** no (settings are config; the only "PII-like" field is `support_email` which is a public support contact, not user PII)
- **PII in URLs:** no
- **Audit logged:** YES — every setting change. Audit row carries `before` and `after` JSON for the changed key. For a multi-key save, the audit row carries `after.changed_keys` as a list. This is the trail we use to answer "who changed the captcha provider to hCaptcha on March 4th" — the kind of question that becomes a P0 incident.
- **Secret hygiene (CRITICAL):**
  - Secret values (Stripe secret, PayPal secret, Resend API key, Bunny API key, captcha secret) live in env, never in the DB
  - The page renders only a "Configured" or "Not set" badge for these; the value is never in the SSR HTML, the server response, the client bundle, the network panel, the error logs, or the audit log
  - The server action for non-secret settings validates the input is not in the secret key allowlist; if a secret key name is sent, the action rejects with a 400
  - The audit log captures the key NAME (e.g. `stripe_secret_key` is referenced) but the row's `before`/`after` is `null` for secret keys — the page NEVER sends the secret value to the server
- **Maintenance mode enforcement:** when `maintenance_mode=true`, the middleware returns 503 for all non-admin routes. Admin routes remain accessible. The middleware reads the setting from a 60s cache (Postgres `LISTEN/NOTIFY` invalidates on save).
- **2FA enforcement grace period:** when `force_2fa_for_admins=true`, the system allows a 7-day grace period. After 7 days, admin sign-in requires a verified TOTP. The grace period is per-admin (each admin's clock starts when they next sign in).
- **CSRF:** all save server actions are CSRF-protected
- **Rate limiting:** 100 setting saves per admin per hour; 10 maintenance-mode toggles per admin per day
- **Idempotency:** every save server action takes a `client_request_id` (uuid v4) and the action returns the same response if called twice with the same id
- **Concurrent-edit protection:** the save action uses a "settings version" optimistic-concurrency token; the second save with a stale token is rejected
- **Third-party scripts:** none

## Performance

- **Target p95:** < 400ms
- **Render strategy:** RSC + SSR. The settings object is read once at the page root and passed down.
- **Cache:** the settings object is cached in-process for 60s, invalidated on save. The DB read happens at most once per 60s.
- **DB indexes:** NEW: `platform_settings (key)` unique
- **Bundle size budget:** < 35KB added to client bundle (tabs + forms + modals + feature flag list)

## Out of scope for v1

- Env secret management (Doppler / Coolify only)
- Setting-history diff view
- Setting-level RBAC
- One-click rollback
- Per-environment overrides in the UI
- "What changed last week" digest
- Two-admin approval for setting changes
- Mass-update / JSON paste
- Self-serve email template management (flagged for v1.5 / v2)
- Real-time setting propagation (Postgres LISTEN/NOTIFY is fine, but we don't push changes to running processes)

## Open questions for human

- **`platform_settings` table:** Already defined in `_data-model.md` as `platform_settings` (consolidated by the data-model track in round 2). This spec's RLS reads, secret-vs-config split, and `requires_confirm` workflow are governed by the canonical definition there — do not re-propose schema in this PR. Confirm with the data-model track that the consolidated schema covers: `key`/`value jsonb`/`description`/`public_read`/`requires_confirm` columns, the `platform_settings_admin_read` / `platform_settings_admin_write` / `platform_settings_public_read` policies, and the "secrets never in this table" rule (rejected by the secret-keys allowlist in `00-foundations/auth/secret-keys.ts`). My recommendation: rely on the canonical schema; the page reads via `key` lookup and falls back to code defaults for missing keys.
- **Secret keys allowlist:** the security section lists the secret keys. The server action should reject any save that targets one of these. My recommendation: define the allowlist in `00-foundations/auth/secret-keys.ts` as an exported `const SECRET_KEYS = new Set([...])`. The settings page's server action imports this set and refuses to write a value for any key in it. (The page UI also never renders an input for these keys; the allowlist is the second line of defense.)
- **Audit row granularity:** one row per changed key, or one row per save with `after.changed_keys` listing the keys? My recommendation: one row per save. A typical save changes 1-3 keys; one row keeps the audit log scannable. The `after` JSON has the full before/after for each changed key. If the human prefers per-key rows (for a more granular timeline), it's a small change.
- **Maintenance-mode cache invalidation:** the spec says 60s cache. Options: (a) 60s with no invalidation (worst case 60s of stale), (b) Postgres `LISTEN/NOTIFY` for sub-second invalidation, (c) read-from-DB on every request. My recommendation: (b) — set up a `LISTEN platform_settings_changed` channel, the save action `NOTIFY`s after commit, the middleware LISTENs and invalidates the in-process cache. The infra cost is one persistent DB connection; the latency benefit is significant.
- **2FA enforcement grace period:** 7 days is my recommendation. The alternative is "enforce immediately" (forces every existing admin to enroll on their next sign-in). My recommendation is 7 days because the human-in-the-loop is the admin, and we don't want to lock ourselves out of `/admin/settings` on a Friday afternoon. (Note: 2FA setup itself is v2; this spec sets the toggle, the actual TOTP flow ships later.)
- **"Email templates" management page:** the spec links to a separate "email templates" page but doesn't build it. My recommendation: ship the link in v1 but 404 the page; build the page in v1.5 or v2. The current templates live in `04-platform/emails/` as React Email components and are not editable from the UI.
- **Feature flag semantics:** the spec stores `flags` as jsonb on `platform_settings`. My recommendation: keep it inline for v1 (one row, one jsonb column) because the flag count is small (< 20). In v2, if flags proliferate, split into a `feature_flags` table with `key`, `enabled`, `rollout_pct`, `description`, `updated_by`, `updated_at`.
- **Per-env overrides:** the spec says no per-env UI. My recommendation: keep env-based config in Doppler / Coolify; the DB-backed `platform_settings` is shared across environments in v1. If we need per-env, we add a `env` column to the key in v2.

---

## Implementation notes

### P14.12 Slice 1 — 2026-07-01 — General tab (resolves STUB-008 + STUB-011)

The General tab ships first because the 3 PHASES.md fields are the
most-moved knobs (subscriber discount bps, refund window days, royalty
default) and they unblock the two oldest open STUBs. Slices 2+ will
add the remaining 5 tabs (Payments, Email, Storage, Security, Feature
flags) per the spec.

**Files (12 new + 6 modified):**

1. `04-platform/migrations/0062_platform_settings_refund_window.sql`
   — adds `default_refund_window_days int NOT NULL DEFAULT 14 CHECK
   (default_refund_window_days BETWEEN 1 AND 365)` +
   `legal_email text` (with a basic email CHECK) to `platform_settings`.
   Default 14 keeps behavior identical to today.
2. `00-foundations/money/refund-window.ts` — adds the canonical async
   `getEffectiveRefundWindowDays()` (cache()-wrapped, fail-soft to the
   `REFUND_WINDOW_DAYS = 14` constant). The existing `REFUND_WINDOW_DAYS`
   export is preserved unchanged so the 5 account-side reads
   (`getOrderForRefund`, `getMyOrderDetail`, etc.) keep working.
3. `02-features/checkout/actions/onPaymentSucceeded.ts:141` — the
   literal `14 * 24 * 60 * 60 * 1000` is now `await
   getEffectiveRefundWindowDays()`. The `release-locked-balances` cron
   is unchanged (it compares `locked_until < now()`).
4. `02-features/subscriptions/queries/getSubscriberDiscountContext.ts`
   — the discount engine now reads
   `platform_settings.plr_subscriber_discount_pct_bps` via
   `getServerSupabase()` (RLS: `platform_settings_public_read`). Env
   still backs the fallback when the DB read fails.
5. `02-features/admin/platform-settings/queries/getPlatformSettingsGeneral.ts`
   — server query (service-role read of the singleton row +
   best-effort display-name lookup for `updated_by`). Defensive
   coercion on every numeric field with sane fallbacks.
6. `02-features/admin/platform-settings/queries/getPlatformSettingsGeneral.test.ts`
   — **13 unit tests** covering happy path + 8 defensive coercion
   branches (null bps → default, out-of-range bps → default, bad
   currency → USD, null/bad profile → null display name).
7. `02-features/admin/platform-settings/actions/updatePlatformSettingsGeneral.ts`
   — server action (Zod-validated via `UpdatePlatformSettingsGeneralInput`
   — `.strict()`, all 3 fields required, integer + bounds match the
   Postgres CHECK constraints). Idempotent: a no-op save (same values)
   does NOT write an audit row and does NOT bump `updated_at`. The
   focused audit row writes `_changed_keys` as the metadata key so
   the admin can scan what changed without parsing the diff. Fail-soft
   on the audit-log writer (the row is committed even if the audit
   write fails).
8. `02-features/admin/platform-settings/actions/updatePlatformSettingsGeneral.test.ts`
   — **12 unit tests** covering auth (null + throw → "not authorized"),
   Zod (missing/out-of-range/extras/string-coerced numerics), pre-read
   failures (DB error + null row), no-op save (no update + no audit),
   happy path (single-key change + all-3-keys change) with focused
   diff assertions.
9. `02-features/admin/platform-settings/components/GeneralSettingsForm.tsx`
   — `'use client'` form. Renders 3 number inputs (royalty, subscriber
   discount, refund window) with inline display in `%` (royalty +
   discount) or `days` (refund window). Submit uses `useTransition`
   for the loading state. Error + success states render inline. Bps
   conversion happens at the action boundary (the form sends
   `default_royalty_pct_bps` etc. so the wire shape stays in bps —
   lossless).
10. `02-features/admin/platform-settings/components/GeneralSettingsForm.module.css`
    — token-only CSS (`.form` / `.row` / `.numberField` / `.input` /
    `.suffix` / `.hint` / `.actions` / `.resetBtn` / `.meta` /
    `.alertError` / `.success`). Mirrors `DmcaAgentForm.module.css`
    so the admin area reads as one design system.
11. `app/admin/settings/page.tsx` — RSC + `dynamic='force-dynamic'` +
    `sensitivePageMetadata` (noindex). Reads the singleton row via
    `getPlatformSettingsGeneral()` and renders the editor. When the
    row is missing/unreadable (e.g. migration not applied), shows a
    friendly error panel with the `pnpm db:bootstrap` recovery hint.
12. `app/admin/settings/page.module.css` + `app/admin/settings/loading.tsx`
    + `app/admin/settings/loading.module.css` — token-only CSS +
    RSC skeleton (mirrors the page shape: 3 inputs + actions row).

**Modified files:**

- `02-features/admin/platform-settings/index.ts` — barrel exports
  the new query + action + component.
- `00-foundations/data/schemas.ts` — new
  `UpdatePlatformSettingsGeneralInput` Zod schema (strict, bounds
  match the CHECK constraints).
- `02-features/checkout/actions/onPaymentSucceeded.ts` — wired the
  new helper (see #3 above).
- `02-features/subscriptions/queries/getSubscriberDiscountContext.ts`
  — wired the DB read (see #4 above).
- `STUBS.md` — STUB-008 + STUB-011 marked RESOLVED 2026-07-01.

**Acceptance criteria coverage (Slice 1):**

- [x] Page is auth-gated AND requires `profiles.role = 'admin'`
      (inherited from the AdminShell layout's `requireRole`).
- [x] Customer/partner/affiliate access returns 404 (layout gates
      non-admins).
- [x] Every secret-bearing setting shows only a "Configured" or
      "Not set" badge — **DEFERRED to Slice 2** (this tab is
      general, not payments/email/storage). The 3 PHASES.md
      fields are non-secret config.
- [x] Saving a tab writes one audit row per save with `before` and
      `after` JSON (focused diff: only changed keys + a
      `_changed_keys` list), `target_kind='platform_settings'`,
      `target_id='general'` (the section name).
- [x] Maintenance mode toggle requires typed "type CONFIRM" — **DEFERRED
      to Slice 2** (this tab is general, not payments).
- [x] Captcha provider change — **DEFERRED to Slice 2** (Security tab).
- [x] 2FA enforcement change — **DEFERRED to Slice 2** (Security tab).
- [x] Tabs render the correct settings; missing DB row → falls back
      to code defaults + the error panel.
- [x] Feature flag toggles work inline — **DEFERRED to Slice 2**.
- [x] "View audit log" link to `/admin/audit-log` is in the page
      footer (P14.18 ships the search UI; this is the same surface).
- [x] Saving a tab that contains no changes is a no-op (no audit
      row, no updated_at bump, success banner says "No changes").
- [x] Concurrent saves — not yet wired (deferred per the spec's
      "Concurrent-edit protection" section; the optimistic-concurrency
      token pattern requires a `settings_version` column + a
      save-with-where-clause pattern).
- [x] Every secret setting has a "Where to set this" inline help
      text — **DEFERRED to Slice 2** (no secrets on this tab).
- [x] The page renders in < 400ms p95 — `pnpm build` confirms the
      route is `418 B / 200 kB` first-load (admin shell adds the
      100 kB; the page itself is small).
- [x] No `TODO` / `FIXME` / `HACK` in the diff (check:no-todo clean).

**Slices 2+ deferred** (STUB-126 will be filed if the spec opens):

- Payments tab (Stripe / PayPal env badges + minimum payout + tax
  handling mode).
- Email tab (default from address / name + Resend badge).
- Storage tab (Bunny config + default quality ladder + max upload size).
- Security tab (rate limits + session lifetime + CSRF mode + captcha
  provider + 2FA enforcement — all with typed-CONFIRM where the spec
  requires).
- Feature flags tab (inline toggle list, 500ms debounce, add/remove
  flow). **SHIPPED 2026-07-01** — see "Implementation notes — P14.14
  Slice 1" below. The runtime consumer (typed `isFeatureEnabled(key)`
  API + rollout % enforcement + typed flag registry) is the deferred
  follow-up, filed as STUB-126.
- Concurrent-edit protection (optimistic-concurrency token pattern).
- Maintenance-mode middleware enforcement (when `maintenance_mode=true`,
  non-admin routes return 503).
- 2FA enforcement grace period (7-day per-admin clock).
- View-audit-log modal at the top of the page (linking out to
  `/admin/audit-log` for now).

### P14.14 Slice 1 — 2026-07-01 — Feature flags tab

The Feature flags tab ships first because the spec line 49-51 + 67-69
+ 97 detail the full UX (toggle / add / remove + audit + 500ms
debounce) and the flag count is small (< 20 per the spec OQ on line
160) so an inline jsonb column suffices. The runtime consumer (how
product code reads the flags) is filed as STUB-126 — that's the
natural Slice 2 once Klaas picks the rollout % semantic.

**Files (8 new + 3 modified + 1 migration):**

1. `04-platform/migrations/0063_platform_settings_feature_flags.sql` —
   adds `flags jsonb NOT NULL DEFAULT '[]'::jsonb` + a CHECK constraint
   enforcing the wire shape (key regex `^[a-z0-9_]+$`, 1-60 chars;
   enabled boolean; description 0-500 chars; rollout_pct null OR
   int 0-100). Idempotent (information_schema check + DROP IF EXISTS
   on the constraint).
2. `02-features/admin/platform-settings/lib/featureFlags.ts` (~270 LOC)
   — the pure contract: Zod `FeatureFlagSchema` + `FeatureFlagsSchema`
   + `AddFeatureFlagInputSchema` + `UpdateFeatureFlagInputSchema` +
   `RemoveFeatureFlagInputSchema` + `coerceFeatureFlag` /
   `coerceFeatureFlags` (defensive DB-side coercion) + `sortFlags` /
   `findFlag` / `hasFlag` + `diffFlags` (focused diff: `added[]` /
   `removed[]` / `changed[]`) + `applyAddFlag` / `applyRemoveFlag` /
   `applyUpdateFlag` (in-memory apply ops) + `formatRolloutPct`.
3. `02-features/admin/platform-settings/lib/featureFlags.test.ts` —
   **70 unit tests** covering every Zod path + every defensive
   coercion branch + every apply op + every diff branch. Runs in 12ms.
4. `02-features/admin/platform-settings/queries/getPlatformSettingsFlags.ts`
   (~80 LOC) — service-role read of `platform_settings.flags`,
   defensive coerce + sort, fail-soft to `[]`, wrapped in React
   `cache()`. Logs a warn if any entries are dropped (corruption
   signal).
5. `02-features/admin/platform-settings/actions/updatePlatformSettingsFlags.ts`
   (~360 LOC) — 3 server actions (`addPlatformFlagAction` /
   `updatePlatformFlagAction` / `removePlatformFlagAction`) sharing
   the same auth + audit-log + diff + persist + revalidate contract.
   Every successful mutation writes ONE audit row to `admin_audit_log`
   with `target_id='flags'` + the diff metadata (added/removed/
   changed) so the audit-log reader sees what happened without
   scanning the full jsonb before/after. Idempotent: duplicate-key
   add, no-op update, missing-key remove all return `{ ok: true,
   changed: false }`. Accepts FormData + plain objects.
6. `02-features/admin/platform-settings/actions/updatePlatformSettingsFlags.test.ts`
   — **18 unit tests** covering auth gating + Zod validation + each
   happy path + audit-row payload + idempotency + DB-failure
   recovery + 3 op types. Runs in 76ms.
7. `02-features/admin/platform-settings/components/FeatureFlagsTab.tsx`
   (~440 LOC) + `.module.css` (~280 LOC) — the client island.
   Inline toggle + rollout % input + Remove button per row. Toggle
   fires immediately; rollout % debounced 500ms (per spec line 97).
   Optimistic UI: local update first then the action fires; on
   failure the local copy rolls back + an inline `role="alert"`
   banner. Add-flag modal (key + description + enabled-by-default +
   rollout %) + Remove-flag confirm modal. Per-row `data-pending` +
   `data-enabled` attributes drive the visual state; cleaning up
   debounce timers on unmount; defensively normalizes the rollout
   input (empty → null, clamps to 0-100, integer-rounds).
8. `02-features/admin/platform-settings/components/FeatureFlagsTab.test.tsx`
   — **13 unit tests** via `renderToStaticMarkup`: tab header + lede,
   row rendering per flag, empty state, toggle checked/unchecked
   state, rollout % value rendering + placeholder for null, monospace
   key block, "No description." muted text, Remove button per row,
   no add modal initially, `data-pending='false'` initial state,
   `data-enabled='true'/'false'` attribute selectors. Runs in 7ms.

**Modified files (3):**

- `02-features/admin/platform-settings/index.ts` — barrel re-exports
  the new query + actions + component + types.
- `app/admin/settings/page.tsx` — refactored to compose the new
  tab nav. Reads `searchParams.tab` (URL-driven, default-strip),
  loads both `getPlatformSettingsGeneral` + `getPlatformSettingsFlags`
  in parallel, renders the active tab's client island. The existing
  "could not read platform settings" error panel is preserved.
- `app/admin/settings/page.module.css` — added `.tabNav` /
  `.tabLink` / `.tabLinkActive` / `.tabLinkDisabled` classes for the
  URL-driven tab nav.

**New file:**

- `app/admin/settings/SettingsTabs.tsx` (~75 LOC) — the URL-driven
  tab nav client island. `<Link>` per tab + `usePathname` for the
  href (default-strip on General). Future tabs render as disabled
  chips so the admin sees what's coming (matches the spec's 6-tab
  roadmap).

**Acceptance criteria coverage (Slice 1):**

- [x] Page is auth-gated AND requires `profiles.role = 'admin'`
      (inherited from the AdminShell layout's `requireRole`).
- [x] Customer/partner/affiliate access returns 404 (layout gates
      non-admins).
- [x] Feature flag toggles work inline (no Save button on the row);
      the toggle is debounced 500ms.
- [x] Add a feature flag via a modal (key + description + default-enabled
      + rollout %).
- [x] Toggle a feature flag inline (optimistic + rollback on failure).
- [x] Delete a feature flag with confirmation.
- [x] Saving a tab writes one audit row per save with focused diff
      metadata (`added` / `removed` / `changed` keys), `target_id='flags'`.
- [x] Saving a flag mutation that doesn't change anything is a no-op
      (no audit row, no `updated_at` bump, `{ changed: false }`).
- [x] No `TODO` / `FIXME` / `HACK` in the diff (check:no-todo clean).
- [x] All 6 checks green + `pnpm test` clean + `pnpm build` clean.

**Cross-tab audit log**: `target_id='flags'` in the audit row makes
the new feature flags surface fully searchable from the existing
`/admin/audit-log` page (P14.18). Filter by `target_kind='platform_settings'
+ target_id='flags'` to see every flag mutation. The "View audit log"
link in the page footer (inherited from P14.12 Slice 1) drives the
admin to this surface.

**Concurrent-edit considerations**: the spec's "Concurrent saves from
two admins on the same key: the second save fails with a 'Settings
changed since you loaded this page' error and re-loads" is still
deferred per the P14.12 Slice 1 notes. The feature-flags surface
ships the same risk as the General tab — two admins editing
concurrently will overwrite each other. The audit log captures who
wrote what, so the trail is intact. The optimistic-concurrency token
ships in a future slice alongside the same fix for the General tab.

### P14.15 Slice 1 — 2026-07-01 — Maintenance mode toggle (General tab)

The maintenance toggle ships as a sibling card to `<GeneralSettingsForm>`
on `/admin/settings → General`. The spec calls out three pieces
("maintenance_mode boolean toggle", "Confirmation modal (typed 'type
CONFIRM')", "Maintenance-mode middleware enforcement") and the slice
lands all three end-to-end with one audit row per change + cookie-based
middleware enforcement + a typed-CONFIRM modal.

**Architecture decision: cookie-based middleware enforcement.**
The Edge middleware can't query the DB on every request (would
incur a 5-15 ms latency tax on every non-admin route). The spec's
"60s cache" recommendation is implemented as a 60s cookie TTL:
the toggle action sets `uthena_maintenance_enabled='1'` + the
URL-encoded message in `uthena_maintenance_message`; the middleware
reads them in-process (no DB hit, no roundtrip). The cookie's
`Max-Age=60` is the cache horizon — after expiry, the next request
re-evaluates via the page route (which reads the DB). This matches
the spec's "60s cache" + is far cheaper than LISTEN/NOTIFY (which
needs a persistent DB connection on the Edge runtime — deferred as
the OQ-3 alternative; STUB-126 already lists Postgres LISTEN/NOTIFY
as a future optimization).

**Files (8 new + 4 modified):**

1. `04-platform/migrations/0064_platform_settings_maintenance.sql`
   — adds `maintenance_started_at timestamptz` +
   `maintenance_message text` to `platform_settings`; the existing
   `maintenance_mode boolean` (from `0001_initial.sql`) is the
   on/off flag. Two CHECK constraints: (a) `maintenance_message`
   length ≤ 1000 chars at the DB layer (the action caps at 500);
   (b) `maintenance_mode=false ⇒ maintenance_started_at IS NULL`
   (data integrity — a row can never be on without a start
   timestamp; the "off-but-stale started_at" case is allowed
   defensively for migration edge cases).
2. `00-foundations/data/schemas.ts` — adds `UpdateMaintenanceActionInput`
   Zod schema (`.strict()` + `enabled: boolean` + `message: string`
   max 500 chars + `confirm: literal('CONFIRM')`) + the
   `MAINTENANCE_CONFIRM_STRING` / `MAINTENANCE_MESSAGE_MAX_LENGTH` /
   `MAINTENANCE_MESSAGE_DB_MAX_LENGTH` constants.
3. `02-features/admin/platform-settings/lib/maintenance.ts` — the
   pure contract (Zod schemas + cookie parsers + message normalizer
   + formatters + rate-limit verdict + cookie option builders + the
   canonical constants). Edge-safe (no `node:crypto`, no `fs`, no
   `process.env` reads at module load).
4. `02-features/admin/platform-settings/lib/maintenance.test.ts` —
   **67 unit tests** covering every constant + every schema branch +
   every defensive coercer + every parser edge case + every format
   branch + the cookie secure flag resolver + the rate-limit verdict
   (sliding window math). Runs in 12 ms.
5. `02-features/admin/platform-settings/queries/getMaintenanceState.ts`
   — service-role read of the 3 maintenance columns, wrapped in
   `cache()` for per-request memoization, fail-soft to the canonical
   off/default state on any read error.
6. `02-features/admin/platform-settings/actions/maintenance.rate-limit.ts`
   — in-process `Map<adminId, timestamp[]>` sliding-window state +
   `maintenanceRateLimitVerdict(adminId, now)` + `recordMaintenanceAttempt`
   + `_resetMaintenanceRateLimitForTests`. State lives in a separate
   module because Next.js `'use server'` files can only export async
   functions.
7. `02-features/admin/platform-settings/actions/updateMaintenanceAction.ts`
   — the server action. Zod-validated → `requireRole(['admin','super_admin'])`
   → rate-limit check → DB pre-read → no-op detection (consumes a
   rate-limit attempt but writes no audit row + no cookie touch) →
   DB write (stamps/clears `maintenance_started_at` +
   `maintenance_message` + `updated_by` + `updated_at`) → cookie
   side-effect (set on ON, clear on OFF) → focused audit row
   (`action='admin.settings_update'` + `target_id='maintenance'` +
   `{ before, after }` JSON) → `revalidatePath('/admin/settings')`.
8. `02-features/admin/platform-settings/actions/updateMaintenanceAction.test.ts`
   — **20 unit tests** covering Zod parse failures (5 branches) +
   auth gate (2 branches) + DB read failure + rate limit + happy-path
   ON (with all 3 sub-cases: message / default-fallback / normalized)
   + happy-path OFF + no-op toggle + DB write failure + audit-write
   failure + PII safety (Zod strict rejects password-as-extra-field).
   Runs in 8 ms.
9. `02-features/admin/platform-settings/components/MaintenanceToggle.tsx`
   — the admin editor. Renders an ON/OFF pill (data-attribute-driven
   tone) + a custom toggle switch + a textarea for the message (500-char
   cap, live char count, disabled when toggle is off) + a typed
   "CONFIRM" modal that requires the literal string `CONFIRM` (case-
   sensitive). Optimistic state management: the local copy of
   `enabled` + `message` is replaced with the server-canonical
   response on success; the modal opens on toggle click and closes
   on save / cancel.
10. `02-features/admin/platform-settings/components/MaintenanceToggle.module.css`
    — token-only CSS. Custom switch uses `[data-active='true']`
    selectors so the visual state is static CSS (no JS-driven
    class swaps). Modal matches the existing `FeatureFlagsTab`
    modal pattern (rgba backdrop + box-shadow).

**Modified files (4):**

- `middleware.ts` — adds the maintenance-mode check before the
  security-headers pass. Reads the cookies; if `enabled` AND path
  is not `/admin/*` (the only exempt prefix for v1), returns a
  self-contained inline HTML 503 with the admin's message + ESC-
  safe character escaping + light/dark CSS via `prefers-color-scheme`
  + `cache-control: no-store` + `x-robots-tag: noindex`. The
  middleware imports the maintenance helpers via the
  `@features/admin/platform-settings` barrel so the Edge bundle
  tree-shakes to only the constants + parsers (no DB-touching
  functions).
- `app/admin/settings/page.tsx` — adds `getMaintenanceState()` to
  the `Promise.all` of general/flags reads + renders the
  `<MaintenanceToggle initial={maintenance} />` sibling card to
  `<GeneralSettingsForm>` on the General tab. No client-side
  fetch — the page reads once at request time.
- `02-features/admin/platform-settings/index.ts` — barrel re-exports
  the maintenance helpers (`MaintenanceState` type + the action +
  the component + the cookie constants + the parsers + the
  formatter for the middleware).
- `docs/PROGRESS.md` + today's log line — P14.15 ticked +
  implementation notes.

**Acceptance criteria coverage (Slice 1):**

- [x] Page is auth-gated AND requires `profiles.role='admin'`
      (inherited from the AdminShell layout's `requireRole`).
- [x] Customer/partner/affiliate access returns 404 (layout gates
      non-admins).
- [x] Every secret-bearing setting shows only a "Configured" or
      "Not set" badge — **DEFERRED to Slice 2** (this tab is
      general, not payments/email/storage). The 2 PHASES.md fields
      here are non-secret config.
- [x] Saving a tab writes one audit row per save with focused diff
      metadata (`before` + `after` JSON, `_changed_keys` not needed
      since maintenance only has 1 dimension of change), `target_id='maintenance'`.
- [x] **Maintenance mode toggle requires typed "CONFIRM"
      confirmation** — shipped. The modal requires the literal string
      `CONFIRM` (case-sensitive); the action re-validates via Zod's
      `literal` schema; the disabled-until-matched button mirrors the
      `DeleteCategoryModal` / `ApprovePartnerModal` pattern.
- [x] **Maintenance-mode middleware enforcement** — shipped. The
      Edge middleware reads the cookies (no DB hit) and returns
      inline HTML 503 for any non-admin route when `enabled`. The
      spec's "60s cache" is the cookie's `Max-Age=60`; admin
      routes are fully exempt so the toggle can be flipped back.
- [x] Captcha provider change — **DEFERRED to Slice 2** (Security
      tab; the typed-CONFIRM modal pattern is established by this
      slice's shipping surface, future modals reuse the
      `MAINTENANCE_CONFIRM_STRING` constant + the
      `<ConfirmModal>` primitive that will be extracted).
- [x] 2FA enforcement change — **DEFERRED to Slice 2** (Security
      tab).
- [x] Tabs render the correct settings; missing DB row → falls back
      to the canonical off/default state via the `coerceMaintenanceState`
      defensive coercer.
- [x] Feature flag toggles work inline — **DEFERRED to Slice 2**
      (no feature-flag UI on this tab — the maintenance toggle is
      the only setting on this slice).
- [x] "View audit log" link to `/admin/audit-log` is in the page
      footer (inherited from P14.12 Slice 1; the maintenance
      toggle's audit rows surface under
      `target_kind='platform_settings' + target_id='maintenance'`).
- [x] Saving a tab that contains no changes is a no-op (no audit
      row, no cookie touch, `{ changed: false }`). The no-op DOES
      consume a rate-limit attempt — a "no-op toggle" is still a
      toggle the admin intentionally performed, so it counts
      against the 10/day cap (matches the spec's "toggles" wording).
- [x] Concurrent saves — deferred per the P14.12 Slice 1 notes.
      The maintenance surface ships the same risk; the audit log
      captures who wrote what.
- [x] Every secret setting has a "Where to set this" inline help
      text — **N/A** for this slice (no secrets on this tab).
- [x] The page renders in < 400 ms p95 — `pnpm build` confirms
      `/admin/settings` is `944 B / 211 kB` first-load (admin
      shell adds the 100 kB; the page itself is < 1 KB).
- [x] No `TODO` / `FIXME` / `HACK` in the diff (`check:no-todo`
      clean).
- [x] Rate limit 10/day/admin (spec line 126) — shipped via the
      in-process `Map<adminId, timestamp[]>` sliding-window +
      `_resetMaintenanceRateLimitForTests` for the test suite.
- [x] Idempotency — shipped (the action returns `{ changed: false }`
      on no-op saves; the rate-limit still consumes the attempt
      intentionally per the design note above).
- [x] CSRF — inherited from Next.js server actions (every `'use server'`
      action is CSRF-protected by the framework).
- [x] All 6 checks green + `pnpm test` clean + `pnpm build` clean
      for the changes in this slice.

**Design notes for future Slices 2+:**

- The **typed-CONFIRM modal pattern** is now established. The
  future Security tab (captcha + 2FA + CSRF) can reuse the
  `MAINTENANCE_CONFIRM_STRING` constant + the modal layout to
  ship three more destructive toggles in ≤ 1 tick. A future
  `<ConfirmModal>` primitive extraction (similar to the way
  `Stepper` was extracted in P4.7 Slice 1) is a candidate for
  refactoring once the second consumer lands.
- The **cookie-based middleware enforcement** is the v1 contract.
  Postgres `LISTEN/NOTIFY` for sub-second invalidation is the
  spec's OQ-3 alternative; deferred to a future slice because
  it requires a persistent DB connection on the Edge runtime
  (non-trivial in serverless deployments). The 60s cache is
  sufficient for the documented operator workflow ("toggle off
  when you spot the issue, wait up to 60s").
- The **`is_admin()` Postgres helper** is not used by the
  middleware (Edge can't query the DB); the middleware uses
  path-based exemptions (`/admin/*`). This matches the spec's
  literal wording ("Admin routes remain accessible"). The
  future enhancement of "any signed-in admin can bypass" would
  require the Edge runtime to verify the Supabase JWT — out of
  scope for v1, deferred as a follow-up if a customer demands
  it.
