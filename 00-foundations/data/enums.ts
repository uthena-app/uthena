// Centralized enum types — single source of truth for every string-literal
// union that mirrors a Postgres enum or a CHECK constraint.
//
// Why this file exists:
//   - The Postgres enums live in 04-platform/migrations/0001_initial.sql
//     (and follow-on migrations). They're surfaced to TypeScript as
//     string-literal unions, but the union used to be inlined in
//     each consumer (the types.ts placeholders, the Zod schemas,
//     the action files). Inlining creates 3 sources of truth that
//     drift the moment a migration adds a new variant.
//   - Centralizing here gives the project one canonical place to
//     check "what values can status take?" — answer: import
//     `OrderStatus` from `@foundations/data/enums`.
//   - The data/README.md originally mentioned this file but it
//     was never written. P2.2 Slice 1 ships it. P3.8 expands it to
//     cover every CHECK constraint + add runtime arrays for every enum.
//
// Conventions:
//   - The enum name matches the Postgres enum name in snake_case
//     (e.g. `product_status`). The TS type is the same name in
//     PascalCase (e.g. `ProductStatus`).
//   - For CHECK-constraint-as-text columns (where the DB stores a
//     `text` column with a CHECK), the TS type still lives here
//     (e.g. `AffiliateStatus`, `ReviewStatus`).
//   - Every enum that mirrors a DB enum / CHECK constraint has a
//     matching `<NAME>_STATUSES` / `<NAME>_KINDS` / `<NAME>_SOURCES` /
//     etc. runtime array, typed as `readonly T[]` with `as const`.
//     The `as const satisfies` pattern (TS 4.9+) catches drift at
//     compile time: add a value to the type without the array → build
//     error; add to the array without the type → build error.
//   - When a Postgres enum changes, update the migration, then
//     update this file to match. The Zod schemas import from here
//     so they pick up the change automatically.
//   - The CHECK script `04-platform/ci/scripts/check-enum-coverage.sh`
//     enforces bi-directional coverage on every CI run: every value
//     in a migration must be in the TS enum, and every value in the
//     TS enum must be in some migration.
//
// Naming: do NOT prefix with `T` or `I` — the rest of the codebase
// uses bare PascalCase (`OrderStatus`, not `TOrderStatus`).
//
// Deprecation policy: see `04-platform/migrations/ENUM-AUDIT.md`
// "Deprecation strategy" section. The rule is: never drop an enum
// value. Forward-only via ALTER TYPE ADD VALUE. The TS counterpart
// picks up the new value, the runtime array grows, and the check
// script's bi-directional comparison enforces that nothing was lost.

// ---------------------------------------------------------------------------
// User / role / status
// ---------------------------------------------------------------------------

/** Postgres `user_role` enum. */
export type UserRole = 'customer' | 'partner' | 'affiliate' | 'admin' | 'super_admin'

export const USER_ROLES: readonly UserRole[] = [
  'customer',
  'partner',
  'affiliate',
  'admin',
  'super_admin',
] as const

/** Postgres `user_status` enum. */
export type UserStatus = 'active' | 'suspended' | 'banned'

export const USER_STATUSES: readonly UserStatus[] = [
  'active',
  'suspended',
  'banned',
] as const

/** Postgres `partner_status` enum. */
export type PartnerStatus = 'pending' | 'approved' | 'suspended'

export const PARTNER_STATUSES: readonly PartnerStatus[] = [
  'pending',
  'approved',
  'suspended',
] as const

/** CHECK constraint on `partners.tax_form_status` (text column, migration 0001). */
export type PartnerTaxFormStatus = 'none' | 'pending' | 'submitted' | 'approved'

export const PARTNER_TAX_FORM_STATUSES: readonly PartnerTaxFormStatus[] = [
  'none',
  'pending',
  'submitted',
  'approved',
] as const

/** CHECK constraint on `partners.kyc_status` (text column, migration 0001). */
export type PartnerKycStatus = 'none' | 'pending' | 'approved' | 'rejected'

export const PARTNER_KYC_STATUSES: readonly PartnerKycStatus[] = [
  'none',
  'pending',
  'approved',
  'rejected',
] as const

/** CHECK constraint on `affiliates.status` (text column, migration 0001). */
export type AffiliateStatus = 'pending' | 'approved' | 'suspended'

export const AFFILIATE_STATUSES: readonly AffiliateStatus[] = [
  'pending',
  'approved',
  'suspended',
] as const

// ---------------------------------------------------------------------------
// Product / pricing / images / files
// ---------------------------------------------------------------------------

/** Postgres `product_kind` enum. */
export type ProductKind =
  | 'video_course'
  | 'ebook'
  | 'template_pack'
  | 'audio_course'
  | 'bundle'
  | 'asset_pack'

export const PRODUCT_KINDS: readonly ProductKind[] = [
  'video_course',
  'ebook',
  'template_pack',
  'audio_course',
  'bundle',
  'asset_pack',
] as const

/** Postgres `product_status` enum. */
export type ProductStatus = 'draft' | 'in_review' | 'published' | 'unpublished' | 'archived'

export const PRODUCT_STATUSES: readonly ProductStatus[] = [
  'draft',
  'in_review',
  'published',
  'unpublished',
  'archived',
] as const

/** Postgres `license_type` enum. */
export type LicenseTier = 'plr' | 'mrr' | 'rr' | 'personal'

export const LICENSE_TIERS: readonly LicenseTier[] = [
  'plr',
  'mrr',
  'rr',
  'personal',
] as const

/** Postgres `file_kind` enum. */
export type FileKind =
  | 'video'
  | 'slides'
  | 'transcript'
  | 'graphics'
  | 'audio'
  | 'document'
  | 'archive'
  | 'other'

export const FILE_KINDS: readonly FileKind[] = [
  'video',
  'slides',
  'transcript',
  'graphics',
  'audio',
  'document',
  'archive',
  'other',
] as const

/** Postgres `scan_status` enum. */
export type ScanStatus = 'pending' | 'clean' | 'infected' | 'failed'

export const SCAN_STATUSES: readonly ScanStatus[] = [
  'pending',
  'clean',
  'infected',
  'failed',
] as const

/** Postgres `encoding_status` enum. */
export type EncodingStatus = 'pending' | 'processing' | 'ready' | 'failed'

export const ENCODING_STATUSES: readonly EncodingStatus[] = [
  'pending',
  'processing',
  'ready',
  'failed',
] as const

/** `product_images.kind` text column with CHECK (migration 0012). */
export type ProductImageKind = 'gallery' | 'preview_video_thumb'

export const PRODUCT_IMAGE_KINDS: readonly ProductImageKind[] = [
  'gallery',
  'preview_video_thumb',
] as const

// ---------------------------------------------------------------------------
// Cart / order / refund / subscription
// ---------------------------------------------------------------------------

/** Postgres `cart_status` enum. */
export type CartStatus = 'active' | 'converted' | 'abandoned' | 'expired'

export const CART_STATUSES: readonly CartStatus[] = [
  'active',
  'converted',
  'abandoned',
  'expired',
] as const

/** Postgres `order_status` enum. */
export type OrderStatus =
  | 'pending'
  | 'awaiting_payment'
  | 'paid'
  | 'fulfilled'
  | 'refunded'
  | 'partially_refunded'
  | 'failed'
  | 'canceled'
  | 'fraudulent'

export const ORDER_STATUSES: readonly OrderStatus[] = [
  'pending',
  'awaiting_payment',
  'paid',
  'fulfilled',
  'refunded',
  'partially_refunded',
  'failed',
  'canceled',
  'fraudulent',
] as const

/** Postgres `refund_status` enum.
 *
 * NOTE on spec/DB vocabulary (P14.9): the spec
 * (`01-specs/pages/admin-refunds.md` line 7) uses
 * `requested / approved / processed / rejected`. The DB enum is
 * `pending / approved / succeeded / failed / canceled`. The spec
 * vocabulary maps to the DB at the query/UI layer via the
 * `REFUND_STATUS_LABEL` map in
 * `02-features/admin/refunds/types.ts`:
 *   spec `requested` ↔ DB `pending`
 *   spec `approved` ↔ DB `approved` (added in migration 0086 —
 *     "admin committed, Stripe call in flight, webhook hasn't confirmed
 *     `succeeded` yet")
 *   spec `processed` ↔ DB `succeeded`
 *   spec `rejected` ↔ DB `failed`
 *   DB `canceled` is legacy (predates the admin flow; surfaces in the
 *     stats card for transparency).
 */
export type RefundStatus = 'pending' | 'approved' | 'succeeded' | 'failed' | 'canceled'

export const REFUND_STATUSES: readonly RefundStatus[] = [
  'pending',
  'approved',
  'succeeded',
  'failed',
  'canceled',
] as const

/** CHECK constraint on `refunds.reason` (the user-facing refund reason set). */
export type RefundReason =
  | 'duplicate'
  | 'fraudulent'
  | 'requested_by_customer'
  | 'product_not_received'
  | 'product_unacceptable'
  | 'other'

export const REFUND_REASONS: readonly RefundReason[] = [
  'duplicate',
  'fraudulent',
  'requested_by_customer',
  'product_not_received',
  'product_unacceptable',
  'other',
] as const

/** Postgres `subscription_status` enum (migration 0002). */
export type SubscriptionStatus =
  | 'incomplete'
  | 'incomplete_expired'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'paused'

export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
] as const

/** CHECK constraint on `library_grants.source` (text column, migration 0001). */
export type LibraryGrantSource =
  | 'purchase'
  | 'subscription'
  | 'admin_grant'
  | 'free_promo'

export const LIBRARY_GRANT_SOURCES: readonly LibraryGrantSource[] = [
  'purchase',
  'subscription',
  'admin_grant',
  'free_promo',
] as const

/** CHECK constraint on `file_downloads.kind` (text column, migration 0001). */
export type FileDownloadKind = 'download' | 'stream'

export const FILE_DOWNLOAD_KINDS: readonly FileDownloadKind[] = [
  'download',
  'stream',
] as const

// ---------------------------------------------------------------------------
// Reviews / collections / payouts
// ---------------------------------------------------------------------------

/** CHECK constraint on `reviews.status` (text column, migration 0001). */
export type ReviewStatus = 'pending' | 'published' | 'hidden' | 'flagged'

export const REVIEW_STATUSES: readonly ReviewStatus[] = [
  'pending',
  'published',
  'hidden',
  'flagged',
] as const

/** `collections.status` text column with CHECK (migration 0015). */
export type CollectionStatus = 'draft' | 'published' | 'archived'

export const COLLECTION_STATUSES: readonly CollectionStatus[] = [
  'draft',
  'published',
  'archived',
] as const

/**
 * Postgres `payout_ledger_kind` enum.
 * Mirrors migration 0001 (baseline) + migration 0072 (STUB-061 added
 * 'dispute' for the charge.dispute.closed/lost clawback row).
 */
export type PayoutLedgerKind =
  | 'order_sale'
  | 'subscription'
  | 'refund'
  | 'adjustment'
  | 'payout'
  | 'clawback'
  | 'dispute'

export const PAYOUT_LEDGER_KINDS: readonly PayoutLedgerKind[] = [
  'order_sale',
  'subscription',
  'refund',
  'adjustment',
  'payout',
  'clawback',
  'dispute',
] as const

/**
 * Postgres `payout_ledger_status` enum.
 * Mirrors migration 0001 (baseline) + migration 0005 (the
 * release-locked-balances cron added 'locked' and 'available') +
 * migration 0072 (STUB-061 added 'pending_dispute' — freezes a
 * payout_ledger row while a Stripe dispute is open).
 */
export type PayoutLedgerStatus =
  | 'accruing'
  | 'pending_payout'
  | 'paid'
  | 'void'
  | 'locked'
  | 'available'
  | 'pending_dispute'

export const PAYOUT_LEDGER_STATUSES: readonly PayoutLedgerStatus[] = [
  'accruing',
  'pending_payout',
  'paid',
  'void',
  'locked',
  'available',
  'pending_dispute',
] as const

// ---------------------------------------------------------------------------
// Moderation / DMCA / risk / webhooks / audit
// ---------------------------------------------------------------------------

/** CHECK constraint on `webhooks.source` (text column, migration 0001). */
export type WebhookSource =
  | 'stripe'
  | 'paypal'
  | 'bunny'
  | 'ses'
  | 'clerk'
  | 'supabase'

export const WEBHOOK_SOURCES: readonly WebhookSource[] = [
  'stripe',
  'paypal',
  'bunny',
  'ses',
  'clerk',
  'supabase',
] as const

/** CHECK constraint on `webhooks.result` (text column, migration 0001). */
export type WebhookResult = 'processed' | 'skipped' | 'failed'

export const WEBHOOK_RESULTS: readonly WebhookResult[] = [
  'processed',
  'skipped',
  'failed',
] as const

/** CHECK constraint on `risk_signals.severity` (text column, migration 0001). */
export type RiskSignalSeverity = 'info' | 'warn' | 'block'

export const RISK_SIGNAL_SEVERITIES: readonly RiskSignalSeverity[] = [
  'info',
  'warn',
  'block',
] as const

/** CHECK constraint on `content_moderation.target_kind` (text column, migration 0001). */
export type ModerationTargetKind = 'product' | 'review' | 'user' | 'comment'

export const MODERATION_TARGET_KINDS: readonly ModerationTargetKind[] = [
  'product',
  'review',
  'user',
  'comment',
] as const

/** CHECK constraint on `content_moderation.status` (text column, migration 0001). */
export type ModerationStatus = 'open' | 'reviewing' | 'actioned' | 'dismissed'

export const MODERATION_STATUSES: readonly ModerationStatus[] = [
  'open',
  'reviewing',
  'actioned',
  'dismissed',
] as const

/** CHECK constraint on `reports.reason` (text column, migration 0001). */
export type ModerationReason =
  | 'copyright'
  | 'spam'
  | 'fraud'
  | 'harassment'
  | 'illegal'
  | 'other'

export const MODERATION_REASONS: readonly ModerationReason[] = [
  'copyright',
  'spam',
  'fraud',
  'harassment',
  'illegal',
  'other',
] as const

/** CHECK constraint on `dmca.target_kind` (text column, migration 0001). */
export type DmcaTargetKind = 'product' | 'product_file' | 'review'

export const DMCA_TARGET_KINDS: readonly DmcaTargetKind[] = [
  'product',
  'product_file',
  'review',
] as const

/**
 * CHECK constraint on `dmca.status` (text column, migration 0001).
 * Follows the DMCA takedown lifecycle: received → reviewed → actioned
 * (or dismissed). A counter-notice may escalate back into the
 * workflow. Court action is the terminal state.
 */
export type DmcaStatus =
  | 'received'
  | 'acknowledged'
  | 'product_removed'
  | 'counter_notice_filed'
  | 'restored'
  | 'rejected'
  | 'court_action'

export const DMCA_STATUSES: readonly DmcaStatus[] = [
  'received',
  'acknowledged',
  'product_removed',
  'counter_notice_filed',
  'restored',
  'rejected',
  'court_action',
] as const

// ---------------------------------------------------------------------------
// Auth failure tracking — the auth_failed_attempts table
// (extends across migrations 0017, 0018, 0019, 0020, 0022)
// ---------------------------------------------------------------------------

/**
 * CHECK constraint on `auth_failed_attempts.kind` (text column).
 * Baseline in 0017 (`signin`, `signup`, `reset_password`); extended
 * by 0018 (`update_password`), 0019 (`email_verification`),
 * 0020 (`oauth_signin`), and 0022 (`oauth_callback`). The check
 * script unions the value sets across migrations before comparing
 * with this array.
 */
export type AuthFailureKind =
  | 'signin'
  | 'signup'
  | 'reset_password'
  | 'update_password'
  | 'email_verification'
  | 'oauth_signin'
  | 'oauth_callback'

export const AUTH_FAILURE_KINDS: readonly AuthFailureKind[] = [
  'signin',
  'signup',
  'reset_password',
  'update_password',
  'email_verification',
  'oauth_signin',
  'oauth_callback',
] as const

/**
 * CHECK constraint on `auth_failed_attempts.reason` (text column).
 * Baseline in 0017 (the six failure modes); extended by 0022
 * (`success`) so the suspicious-pattern detector can count
 * successful flows per IP per window. The check script unions
 * the value sets across migrations before comparing.
 */
export type AuthFailureReason =
  | 'invalid_credentials'
  | 'rate_limited'
  | 'email_not_verified'
  | 'unknown_user'
  | 'malformed_input'
  | 'server_error'
  | 'success'

export const AUTH_FAILURE_REASONS: readonly AuthFailureReason[] = [
  'invalid_credentials',
  'rate_limited',
  'email_not_verified',
  'unknown_user',
  'malformed_input',
  'server_error',
  'success',
] as const

// ---------------------------------------------------------------------------
// Audit log actions — text column with NO CHECK on `admin_audit_log.action`
// (and the parallel `auth_audit_log` table when STUB-038 lands).
//
// These are NOT Postgres enums — they're free-form text. The check
// script intentionally ignores this section (it scans for
// `CREATE TYPE ... AS ENUM` + `CHECK (... IN (...))` only).
// ---------------------------------------------------------------------------

/**
 * The canonical admin_audit_log.action values used by server actions.
 * Not a Postgres enum — it's a free-form text column with no CHECK.
 * Centralizing here gives the project one place to grep when a new
 * audit-logged action is added. The `satisfies` clause catches
 * accidental typos at compile time.
 */
export type AuditAction =
  // Auth (failed_attempts family)
  | 'signin_rate_limited'
  | 'signup_rate_limited'
  | 'password_reset_rate_limited'
  | 'password_update_rate_limited'
  | 'email_verification_rate_limited'
  | 'oauth_signin_rate_limited'
  // Auth (success path — written on signup completion)
  | 'auth_signup_success'
  // Auth (session management)
  | 'session_signout_one'
  | 'session_signout_all'
  // Self-service (audit log writes from the user's own actions)
  | 'profile_self_update'
  | 'settings_self_update'
  | 'avatar_upload_requested'
  | 'refund_proof_upload_requested'
  | 'consent_self_update'
  // Cookie banner (P11.2) — surfaces the GPC auto-decline path +
  // the three banner-driven user actions + the auto-default branch.
  | 'banner_gpc_auto_decline'
  | 'banner_accept_all'
  | 'banner_decline_non_essential'
  | 'banner_save_preferences'
  // Admin (categories)
  | 'admin.category_create'
  | 'admin.category_update'
  | 'admin.category_delete'
  | 'admin.category_reorder'
  // Admin (account switcher)
  | 'admin.account_switch_initiated'
  // Admin (refunds)
  | 'admin.refund_approve'
  | 'admin.refund_deny'
  // Admin (payouts)
  | 'admin.payout_approve'
  | 'admin.payout_deny'
  // Partner-initiated (payouts) — P6.6 requestPayoutAction
  | 'payout_requested'
  // Admin (orders)
  | 'admin.order_refund'
  // Admin (platform settings)
  | 'admin.settings_update'
  // Partner onboarding (P12.2) — every step save writes one of these.
  // The `target_kind` is 'partner_onboarding_drafts' and the `target_id`
  // is the user's UUID; `metadata.step` is the saved step number.
  | 'partner_onboarding.step_saved'
  // Partner upload wizard (P12.7) — every step autosave writes one of
  // these. `target_kind` is 'partner_upload_drafts' and `target_id` is
  // the user's UUID; `metadata` carries `{ step, next_step,
  // fields_changed }` — NEVER the payload body (the future curriculum
  // + files step payloads include Bunny storage paths + third-party IDs
  // that must not be logged).
  | 'partner_upload.step_saved'
  // Partner upload pipeline (P12.8) — every file registered for upload
  // writes one of these. `target_kind` is 'partner_uploads' and
  // `target_id` is the partner_uploads row id. `metadata` carries
  // `{ upload_kind, mime, size_bytes, storage_path }` — size is
  // recorded (cheap aggregate) but the file body never is (Bunny owns
  // the bytes; we only know the path + size + kind).
  | 'partner_upload.file_registered'
  // Partner upload pipeline (P12.8) — client-reported upload failure
  // (network / aborted / oversized). `target_kind` is 'partner_uploads',
  // `target_id` is the row id, `metadata` carries `{ failure_kind,
  // failure_reason }` (kind from the typed enum, reason is the raw
  // error string client passed; ≤ 200 chars so the audit row is bounded).
  | 'partner_upload.file_failed'
  // Bunny webhook surface (P12.8) — fired by handleBunnyWebhook when the
  // signature verifies and the dispatched event updated a
  // partner_uploads row. `target_kind` is 'partner_uploads' or
  // 'processed_webhooks' depending on the event type, `target_id` is
  // the row id. `metadata` carries `{ webhook_event, storage_path,
  // scan_status?, encoding_status? }` — PII-free because Bunny never
  // sends user-identifying fields.
  | 'partner_upload.webhook_received'
  // Partner API tokens (P12.19) — every create writes one of these.
  // `target_kind` is 'api_tokens', `target_id` is the new row's id
  // (bigint). `metadata` carries `{ name, scopes, expiration }` —
  // NEVER the token hash, NEVER the plaintext. The plaintext is
  // returned to the caller ONCE and not retained anywhere else.
  | 'api_token_created'
  // Partner API tokens (P12.19) — every revoke writes one of these.
  // `target_kind` is 'api_tokens', `target_id` is the row id,
  // `metadata` carries `{ revoked_at }` (the timestamp only; not
  // the prior scopes, not the token hash).
  | 'api_token_revoked'
  // Affiliate onboarding (P13.1) — every step save writes one of
  // these. `target_kind` is 'affiliate_onboarding_drafts' and
  // `target_id` is the user's UUID; `metadata` carries `{ step,
  // next_step }` — NEVER the payload body (the handle_bio payload
  // has the user's chosen handle + bio, and the payout payload has
  // the PayPal email — both PII).
  | 'affiliate_onboarding.step_saved'
  // Affiliate settings (P13.11) — every profile / notification-prefs
  // self-update writes one of these. `target_kind` is either
  // 'profiles' (display_name / bio edits) or
  // 'notification_preferences' (the 4 affiliate-specific toggles);
  // `target_id` is the user's UUID; `metadata` is the focused
  // { before, after } diff of just the keys that actually changed.
  | 'affiliate_settings_self_update'
  // Admin customers list (P14.1) — every page load writes one of
  // these. `target_kind` is 'profiles' (the table being read),
  // `target_id` is null (it's a list view, not a single-row read),
  // `metadata` carries `{ sort, page, resultCount, before: <filter
  // bag> }` — the filter bag mirrors the URL params so an audit-log
  // reader can reconstruct the admin's view. Per-row PII access
  // (email click, bulk suspend, CSV export) lives on its own audit
  // actions in Slice 2.
  | 'admin.customers_list_viewed'
  // Admin customer detail (P14.2) — every page load on
  // /admin/customers/[id] writes one of these. `target_kind` is
  // 'profiles', `target_id` is the customer's user_id (uuid string),
  // `metadata` carries `{ tab, ip_first_seen? }` — the active tab
  // for the audit-log reader; ip_first_seen is OPTIONAL and only
  // populated when the masked IP was revealed (separate action). The
  // PII-safe masked-email view is NOT a reveal event — the masked
  // hash is logged for traceability but not the raw email.
  | 'admin.customer_detail_viewed'
  // Admin customer detail (P14.2) — explicit reveal of the
  // customer's email. `target_kind` is 'profiles', `target_id` is
  // the user_id, `metadata` is empty (the email is the reason this
  // row was written; carrying it again is double-PII). The 30s
  // client-side auto-mask lives on the page; this row is the
  // audit-trail marker that an explicit reveal happened.
  | 'admin.customer_detail_reveal_email'
  // Admin customer detail (P14.2) — explicit reveal of the
  // customer's first-seen IP (from their earliest paid order).
  // `target_kind` is 'profiles', `target_id` is the user_id,
  // `metadata` is empty for the same reason as the email reveal.
  | 'admin.customer_detail_reveal_ip'
  // Admin partners list (P14.3) — every page load writes one of
  // these. `target_kind` is 'partners' (the table being read),
  // `target_id` is null (it's a list view, not a single-row read),
  // `metadata` carries `{ sort, page, resultCount, before: <filter
  // bag> }` — the filter bag mirrors the URL params so an
  // audit-log reader can reconstruct the admin's view. Per-row PII
  // access (email click, bulk approve, bulk suspend, CSV export)
  // lives on its own audit actions in Slice 2.
  | 'admin.partners_list_viewed'
  // Admin partner detail (P14.4) — every page load on
  // /admin/partners/[id] writes one of these. `target_kind` is
  // 'partners', `target_id` is the partner.id (bigint as string),
  // `metadata` carries `{ tab }` — the active tab for the audit-log
  // reader. The PII-safe masked-email + masked-payout-email view is
  // NOT a reveal event; explicit reveal actions for tax_id + KYC
  // document + KYC image + customer email + payout email land in
  // Slice 2 (separate audit actions per the spec).
  | 'admin.partner_detail_viewed'
  // Admin partner approval workflow (P14.5) — the right-rail action
  // on /admin/partners/[id] writes one of these on success.
  // `target_kind` is 'partners', `target_id` is the partner.id
  // (bigint as string). `metadata` carries `{ before_status,
  // after_status, reason? }` so the audit-log reader can correlate
  // the state transition without inspecting the partners row
  // (defense-in-depth — the row may have moved on since).
  //
  // Suspend requires a typed "SUSPEND" confirmation + a non-empty
  // reason textarea; the reason is stored in `metadata.reason` but
  // only when present (the absence is meaningful too — it means the
  // reason was empty, which the action would have rejected before
  // the audit row was written). The rate limit (20/hr/admin) lives
  // in the actions/approveSuspendRateLimit.ts pure module.
  //
  // Unsuspend sets status back to 'approved' (not 'pending') — once
  // a partner has been approved, they're an approved partner who
  // happened to be suspended. The reverse transition doesn't lose
  // their prior approval timestamp (the column is preserved unless
  // explicitly cleared).
  | 'admin.partner_approved'
  | 'admin.partner_suspended'
  | 'admin.partner_unsuspended'
  // Admin affiliates list (P14.6) — every page load on
  // /admin/affiliates writes one of these. `target_kind` is
  // 'affiliates', `target_id` is null (it's a list view), `metadata`
  // carries `{ filters, sort, page, resultCount }` — the filter bag
  // mirrors the URL params so an audit-log reader can reconstruct
  // the admin's view. Per-row PII access (email click, bulk
  // approve, bulk suspend, CSV export) lives on its own audit actions
  // in Slice 2.
  | 'admin.affiliates_list_viewed'
  // Admin orders list (P14.7) — every page load on /admin/orders
  // writes one of these. `target_kind` is 'orders', `target_id` is
  // null (list view), `metadata` carries `{ filters, page, resultCount }`
  // mirroring the URL contract so an audit-log reader can reconstruct
  // the admin's view. Per-row PII clicks + CSV export + manual refund
  // button live on their own audit actions in Slice 2.
  | 'admin.orders_list_viewed'
  // Admin order detail (P14.8) — every page load on
  // /admin/orders/[id] writes one of these. `target_kind` is 'orders',
  // `target_id` is the order.id (bigint as string). `metadata` carries
  // `{ tab, has_customer_view_embed? }` — the active tab for the
  // audit-log reader. The destructive actions (issue_manual_refund /
  // mark_fraudulent / resend_receipt / admin_note / copy_payment_intent_id)
  // are filed as their own audit-action values and ship in Slice 2.
  | 'admin.order_detail_viewed'
  // P14.16 — Admin Analytics page view (filter bag in metadata).
  // PII-safety: the filter bag carries IDs + date ranges + segments,
  // NEVER customer emails / names / raw IDs. The audit row tells us
  // "what was the admin looking at" without leaking customer PII.
  | 'admin.analytics_viewed'
  // P14.16 Slice 4 — CSV export action. Reserved here so the enum
  // doesn't churn when the export action lands.
  | 'admin.analytics_exported'

export const AUDIT_ACTIONS: readonly AuditAction[] = [
  'signin_rate_limited',
  'signup_rate_limited',
  'password_reset_rate_limited',
  'password_update_rate_limited',
  'email_verification_rate_limited',
  'oauth_signin_rate_limited',
  'auth_signup_success',
  'session_signout_one',
  'session_signout_all',
  'profile_self_update',
  'settings_self_update',
  'avatar_upload_requested',
  'refund_proof_upload_requested',
  'consent_self_update',
  'banner_gpc_auto_decline',
  'banner_accept_all',
  'banner_decline_non_essential',
  'banner_save_preferences',
  'admin.category_create',
  'admin.category_update',
  'admin.category_delete',
  'admin.category_reorder',
  'admin.account_switch_initiated',
  'admin.refund_approve',
  'admin.refund_deny',
  'admin.payout_approve',
  'admin.payout_deny',
  'payout_requested',
  'admin.order_refund',
  'admin.settings_update',
  'partner_onboarding.step_saved',
  'partner_upload.step_saved',
  'partner_upload.file_registered',
  'partner_upload.file_failed',
  'partner_upload.webhook_received',
  'api_token_created',
  'api_token_revoked',
  'affiliate_onboarding.step_saved',
  'affiliate_settings_self_update',
  'admin.customers_list_viewed',
  'admin.customer_detail_viewed',
  'admin.customer_detail_reveal_email',
  'admin.customer_detail_reveal_ip',
  'admin.partners_list_viewed',
  'admin.partner_detail_viewed',
  'admin.partner_approved',
  'admin.partner_suspended',
  'admin.partner_unsuspended',
  'admin.affiliates_list_viewed',
  'admin.orders_list_viewed',
  'admin.order_detail_viewed',
  'admin.analytics_viewed',
  'admin.analytics_exported',
] as const

// ---------------------------------------------------------------------------
// Sort / filter keys for the catalog (the values the URL params accept).
// These are NOT Postgres enums — they're URL contract values. They live
// here because the parsers and the schema both need them.
// ---------------------------------------------------------------------------

/** Catalog sort key — `/browse?sort=...`. */
export type CatalogSortKey = 'newest' | 'popular' | 'price-asc' | 'price-desc'

/** Catalog price bucket — `/browse?price=...`. */
export type PriceBucket = 'any' | 'free' | 'under-50' | 'under-100'

/** Catalog density toggle — `/browse?density=...`. */
export type BrowseDensity = 'comfortable' | 'compact'

// ---------------------------------------------------------------------------
// Partner upload pipeline (P12.8) — UploadKind + FailureKind.
//
// UploadKind discriminates the three upload zones a partner can drop
// files into: video files route to Bunny Stream (tus protocol +
// post-upload HLS transcoding), source files route to Bunny Storage
// (PUT with AccessKey), and sales_material is the same Storage zone
// but with a different partner-visible label (PDF swipes, marketing
// assets, etc). The kind drives which mime-allowlist + size cap is
// enforced AND which storage backend mints the upload URL.
//
// FailureKind is the typed discriminator for client + server upload
// failures. Used by the P12.7 Slice 3 Files UI to render a
// partner-friendly error message ("You cancelled this — Click to retry"
// vs "Connection lost mid-upload — We saved what was uploaded" vs
// "File too large — 50GB limit"). Persisted on partner_uploads
// .failure_kind (text + CHECK constraint, not a Postgres enum — see
// migration 0041 header for the rationale; matches the AGENTS.md +
// ENUM-AUDIT.md forward-only policy).
// ---------------------------------------------------------------------------

/** Partner upload zone — drives the mime allowlist + size cap + the
 *  Bunny backend (Stream tus vs Storage PUT). */
export type UploadKind = 'video' | 'source' | 'sales_material'

export const UPLOAD_KINDS: readonly UploadKind[] = [
  'video',
  'source',
  'sales_material',
] as const

/** Typed partner-upload failure discriminator. Stored as text + CHECK
 *  on partner_uploads.failure_kind (migration 0041). */
export type FailureKind =
  | 'network'
  | 'aborted'
  | 'rejected'
  | 'oversized'
  | 'unscanned'
  | 'other'

export const FAILURE_KINDS: readonly FailureKind[] = [
  'network',
  'aborted',
  'rejected',
  'oversized',
  'unscanned',
  'other',
] as const