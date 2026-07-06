// Zod — the source of truth for input validation. Every server action
// and every API route validates input with one of these schemas before
// touching the DB. Adding a new field? Add it here first.
//
// Layout of this file:
//   1. Primitives (Cents, Bps, Slug, Uuid, …) — the building blocks
//   2. Entity input schemas — what server actions and API routes accept
//      (AddToCartInput, UpdateProfileInput, …)
//   3. Entity read schemas — mirror the types.ts placeholders so a
//      `JSON.parse(...)` or service-role read can be validated the same
//      way (used by webhooks, admin tooling, cron jobs).
//   4. WYSIWYG (TipTap) content shape
//
// Naming convention: `<EntityName>Input` for action inputs,
// `<EntityName>EntitySchema` for read shapes (so they don't collide
// with the TS types in types.ts).

import { z } from 'zod'
import {
  AffiliateStatus,
  AFFILIATE_STATUSES,
  AuditAction,
  AUTH_FAILURE_KINDS,
  AUTH_FAILURE_REASONS,
  AuthFailureKind,
  AuthFailureReason,
  BrowseDensity,
  CART_STATUSES,
  CartStatus,
  CatalogSortKey,
  COLLECTION_STATUSES,
  CollectionStatus,
  DMCA_STATUSES,
  DMCA_TARGET_KINDS,
  DmcaStatus,
  DmcaTargetKind,
  ENCODING_STATUSES,
  EncodingStatus,
  FILE_DOWNLOAD_KINDS,
  FILE_KINDS,
  FileDownloadKind,
  FileKind,
  LIBRARY_GRANT_SOURCES,
  LICENSE_TIERS,
  LibraryGrantSource,
  LicenseTier,
  MODERATION_STATUSES,
  MODERATION_TARGET_KINDS,
  ModerationStatus,
  ModerationTargetKind,
  ORDER_STATUSES,
  OrderStatus,
  PARTNER_KYC_STATUSES,
  PARTNER_STATUSES,
  PARTNER_TAX_FORM_STATUSES,
  PartnerKycStatus,
  PartnerStatus,
  PartnerTaxFormStatus,
  PAYOUT_LEDGER_KINDS,
  PAYOUT_LEDGER_STATUSES,
  PayoutLedgerKind,
  PayoutLedgerStatus,
  PriceBucket,
  PRODUCT_IMAGE_KINDS,
  PRODUCT_KINDS,
  PRODUCT_STATUSES,
  ProductImageKind,
  ProductKind,
  ProductStatus,
  REFUND_REASONS,
  REFUND_STATUSES,
  RefundReason,
  RefundStatus,
  REVIEW_STATUSES,
  ReviewStatus,
  RISK_SIGNAL_SEVERITIES,
  RiskSignalSeverity,
  SCAN_STATUSES,
  ScanStatus,
  SUBSCRIPTION_STATUSES,
  SubscriptionStatus,
  USER_ROLES,
  USER_STATUSES,
  UserRole,
  UserStatus,
  WEBHOOK_RESULTS,
  WEBHOOK_SOURCES,
  WebhookResult,
  WebhookSource,
} from './enums'

// ===========================================================================
// 1. Primitives
// ===========================================================================

/** Money as integer cents. */
export const Cents = z.number().int().nonnegative()

/** Basis points (1/100th of a percent). 0..10000. */
export const Bps = z.number().int().min(0).max(10000)

/** Slug — lowercase, hyphenated, 2..100 chars. */
export const Slug = z
  .string()
  .min(2)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase, hyphenated, alphanumeric')

/** UUID v4-ish (Supabase uses uuid). */
export const Uuid = z.string().uuid()

/** E.164-ish phone, optional. */
export const PhoneE164 = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, 'must be E.164 format (+1234567890)')
  .optional()

/** ISO 3166-1 alpha-2 country code, optional. */
export const CountryCode = z
  .string()
  .length(2)
  .regex(/^[A-Z]{2}$/)
  .optional()

/** URL — used for partner website, avatar, social.
 *
 *  Stricter than `z.string().url()`: only `http:` and `https:` schemes
 *  are allowed. The default `.url()` validator in Zod accepts any RFC
 *  3986 URL including `javascript:alert(1)`, `data:text/html,...`,
 *  `vbscript:msgbox(1)`, `file:///etc/passwd`, etc. — none of which
 *  we want as a stored URL that may end up in an `<a href=...>` or
 *  `<img src=...>`.
 *
 *  Defense in depth: even if the URL is later validated before
 *  rendering, never storing a `javascript:` URL in the first place
 *  is the right call.
 */
export const SafeUrl = z
  .string()
  .max(2000)
  .regex(
    /^https?:\/\/[^\s<>"']+$/i,
    'must be a http(s) URL',
  )

/**
 * Optional URL. Same shape as SafeUrl but explicitly `.nullable().optional()`
 * so callers can pass `null` to clear an avatar / thumbnail.
 */
export const NullableSafeUrl = SafeUrl.nullable().optional()

/** Positive integer cents (for prices — NOT refundable to 0). */
export const PositiveCents = z.number().int().positive()

/** Non-empty string with bounded length. */
export const ShortText = (max: number) => z.string().trim().min(1).max(max)

/** Optional non-empty string with bounded length. */
export const OptionalShortText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === undefined || v === '' ? undefined : v))

// ===========================================================================
// 2. Entity INPUT schemas — what server actions accept
// ===========================================================================

// --- Cart ----------------------------------------------------------------

/** Add a product to the cart (or upsert if the line already exists). */
export const AddToCartInput = z.object({
  product_id: z.coerce.number().int().positive(),
  license: z.enum(['plr', 'mrr', 'rr', 'personal'] as const satisfies readonly LicenseTier[]),
  quantity: z.coerce.number().int().min(1).max(99).default(1),
})

/** Change the license on an existing cart line (atomic).
 *  P4.2 — `cart_item_id` accepts either a positive integer (auth-DB
 *  `cart_items.id`) OR the synthesized `anon:<product_id>:<license>`
 *  string for cookie-backed anon cart lines. The action layer
 *  branches on the type to pick the right mutation path. */
export const UpdateCartLineLicenseInput = z.object({
  cart_item_id: z.union([
    z.coerce.number().int().positive(),
    z.string().regex(/^anon:\d+:(plr|mrr|rr|personal)$/, 'Invalid anon line id'),
  ]),
  license: z.enum(['plr', 'mrr', 'rr', 'personal'] as const satisfies readonly LicenseTier[]),
})

/** Change the quantity on an existing cart line.
 *  P4.2 — `cart_item_id` accepts either a positive integer OR the
 *  synthesized `anon:<product_id>:<license>` string (see above). */
export const UpdateCartLineQuantityInput = z.object({
  cart_item_id: z.union([
    z.coerce.number().int().positive(),
    z.string().regex(/^anon:\d+:(plr|mrr|rr|personal)$/, 'Invalid anon line id'),
  ]),
  quantity: z.coerce.number().int().min(1).max(99),
})

/** Remove a cart line.
 *  P4.2 — `cart_item_id` accepts either a positive integer OR the
 *  synthesized `anon:<product_id>:<license>` string (see above). */
export const RemoveCartLineInput = z.object({
  cart_item_id: z.union([
    z.coerce.number().int().positive(),
    z.string().regex(/^anon:\d+:(plr|mrr|rr|personal)$/, 'Invalid anon line id'),
  ]),
})

/** Apply a coupon to the cart. The code is uppercased before storage
 *  so users can type `winter20` or `WINTER20` and both work. */
export const ApplyCouponInput = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'Coupon code must be at least 2 characters')
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, 'Coupon codes are letters, digits, underscores, and hyphens only')
    .transform((s) => s.toUpperCase()),
})

/** Cart line input — primitive, used by CartUpdate below. */
export const CartLineInput = z.object({
  product_id: z.coerce.number().int().positive(),
  quantity: z.number().int().min(1).max(99),
})

/** Cart update — bulk line replacement. */
export const CartUpdate = z.object({
  lines: z.array(CartLineInput).max(50),
})

/** Clear cart — sets all active lines to `abandoned` (or `converted` when
 *  invoked from the order-success path). `reason` is required at the
 *  schema layer; the user-facing "clear cart" button passes
 *  `{ reason: 'abandoned' }` explicitly so the schema doesn't need a
 *  default (which would weaken the inferred type). */
export const ClearCartInput = z.object({
  reason: z.enum(['abandoned', 'converted']),
})

// --- Checkout ------------------------------------------------------------

/** Checkout — what the user submits at /checkout. */
export const CheckoutInput = z.object({
  email: z.string().email(),
  lines: z.array(CartLineInput).min(1).max(50),
  coupon_code: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[A-Z0-9_-]+$/)
    .optional(),
  // Discount engine signal — applied server-side, never trust client.
  has_active_subscription: z.boolean().default(false),
  affiliate_handle: Slug.optional(),
  success_url: z.string().url().optional(),
  cancel_url: z.string().url().optional(),
})

/** Internal helper — checkout query string parse (the page reads these). */
export const AffiliateHandleQuery = z.object({
  affiliate_handle: z.string().min(1).max(80).optional(),
})

// --- Subscriptions -------------------------------------------------------

/** Subscription — what we send to Stripe. */
export const SubscriptionStartInput = z.object({
  price_id: z.string().min(3),
  success_url: z.string().url(),
  cancel_url: z.string().url(),
})

/** Cancel-at-period-end — confirms the user wants to cancel at period end. */
export const CancelSubscriptionInput = z.object({
  subscription_id: z.coerce.number().int().positive(),
  /** Typed confirmation per the spec — user must type the word "cancel". */
  confirmation: z.literal('cancel'),
})

/** Resume a subscription that was set to cancel at period end. */
export const ResumeSubscriptionInput = z.object({
  subscription_id: z.coerce.number().int().positive(),
})

/** Open Stripe Billing Portal — returns the portal URL. */
export const OpenBillingPortalInput = z.object({
  return_url: z.string().url().optional(),
})

// --- Library (file access) -----------------------------------------------

/** Mint a download URL for a single file the user has access to. */
export const MintDownloadInput = z.object({
  file_id: z.coerce.number().int().positive(),
})

/** Mint a stream URL for a single lesson the user has access to. */
export const MintStreamInput = z.object({
  lesson_id: z.coerce.number().int().positive(),
})

// --- Library — bulk download (P7.4) --------------------------------------

/**
 * Bulk-download request shape (P7.4). The route handler reads this from
 * `request.formData()` where the vault checkboxes submit
 * `file_ids=<id>&file_ids=<id>&...` — so the parsed shape is a
 * (deduped) array of positive integers.
 *
 * The cap of 50 entries mirrors the in-form contract: the vault form
 * caps the checkbox list at 50. Anything over 50 is rejected at the
 * boundary as `too_many_files` rather than silently truncated.
 *
 * 0 entries is also rejected — the form must not submit when no
 * checkbox is selected (the client island disables the button). The
 * handler enforces this defensively because a no-JS POST with 0
 * checkboxes is technically a valid (empty) submission.
 */
export const BulkDownloadInput = z.object({
  file_ids: z
    .array(z.coerce.number().int().positive())
    .min(1, 'Select at least one file to download.')
    .max(50, 'Select no more than 50 files at once.')
    .transform((ids) => Array.from(new Set(ids))),
})

// --- Account / profile / settings ---------------------------------------

/** Update the user's own profile. */
export const UpdateProfileInput = z.object({
  display_name: z.string().trim().min(1, 'Required').max(80, 'Max 80 characters'),
  bio: z.string().max(280, 'Max 280 characters').optional().default(''),
  locale: z.string().min(2).max(10),
  timezone: z.string().min(1).max(64),
  // SafeUrl (http(s) only) — `z.string().url()` accepts `javascript:` and
  // `data:` schemes, which would store a malicious URL in the user's
  // profile and execute on next render. Reject at parse time (defense in
  // depth — the rendered <img src> would refuse `javascript:` too, but
  // we don't want the malicious payload in the DB at all).
  avatar_url: SafeUrl.nullable().optional(),
})

/**
 * Profile update — the broader entity-update shape used by admin tools
 * (where role + user_id + ban flags may be in scope too). Application-
 * level schemas should prefer UpdateProfileInput above.
 */
export const ProfileUpdate = z.object({
  display_name: z.string().min(1).max(80).optional(),
  bio: z.string().max(2000).optional(),
  avatar_url: SafeUrl.optional(),
  locale: z.string().min(2).max(10).optional(),
  timezone: z.string().min(2).max(80).optional(),
})

/** Notification preferences (v2 — P9.7 spec).
 *
 *  Matches the schema in `01-specs/pages/account-settings.md` §Open Questions
 *  and the columns added by migration `0033_notification_preferences_v2.sql`.
 *  All fields optional so a caller can patch a single field at a time.
 *
 *  Note: `transactional_opt_in` is intentionally NOT exposed — it's a
 *  locked badge in the UI (transactional emails are required for the
 *  service to function). The action ignores any value passed for it.
 */
export const EmailDigestFreqSchema = z.enum(['off', 'daily', 'weekly', 'monthly'])
export type EmailDigestFreq = z.infer<typeof EmailDigestFreqSchema>

export const UpdatePrefsInput = z
  .object({
    email_digest_freq: EmailDigestFreqSchema.optional(),
    marketing_opt_in: z.boolean().optional(),
    newsletter_opt_in: z.boolean().optional(),
    partner_updates_opt_in: z.boolean().optional(),
    affiliate_updates_opt_in: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one preference must be provided.',
  })

/** Locale + timezone update. */
export const UpdateLocaleTzInput = z.object({
  locale: z.string().min(2).max(10),
  timezone: z.string().min(1).max(64),
})

/**
 * Affiliate profile update (P13.11 Slice 1) — strict subset of the
 * customer's `UpdateProfileInput`. The affiliate surface in v1 only
 * edits display_name + bio (the spec explicitly defers avatar upload
 * to /account/profile per `affiliate-settings.md:62`). The display_name
 * cap is 60 chars per spec line 13 (not the customer's 80) because the
 * affiliate's display_name is rendered in the mini-shop hero + the
 * `Person` JSON-LD `name` field where 60 is the platform-wide UX cap.
 *
 * `.strict()` rejects unknown keys (defense in depth against a future
 * copy-paste of the customer schema leaking avatar_url into the
 * affiliate surface).
 *
 * `bio` is nullable because the customer surface allows an empty
 * bio (renders as "no bio yet"). The action layer maps `''` ↔ `null`
 * to keep the column clean.
 */
export const UpdateAffiliateProfileInput = z
  .object({
    display_name: z
      .string()
      .trim()
      .min(2, 'At least 2 characters')
      .max(60, 'Max 60 characters'),
    bio: z
      .string()
      .max(280, 'Max 280 characters')
      .nullable()
      .optional()
      .default(''),
  })
  .strict()

/**
 * Affiliate notification preferences update (P13.11 Slice 1) — the
 * 4 toggles the affiliate surface owns. Matches the spec at
 * `affiliate-settings.md` §Data + §Acceptance §5. All fields optional
 * so a caller can patch a single toggle at a time.
 *
 * Per spec line 71, the defaults are:
 *   affiliate_updates = false (marketing opt-in)
 *   commission_notifications = true (transactional event)
 *   payout_notifications = true (transactional event)
 *   monthly_digest = true (transactional summary)
 *
 * `.strict()` rejects unknown keys. `.refine` requires at least one
 * field so an empty patch call returns a friendly error.
 */
export const UpdateAffiliateNotificationPrefsInput = z
  .object({
    affiliate_updates_opt_in: z.boolean().optional(),
    commission_notifications_opt_in: z.boolean().optional(),
    payout_notifications_opt_in: z.boolean().optional(),
    monthly_digest_opt_in: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one preference must be provided.',
  })

// --- Account / reviews --------------------------------------------------

/** Create a product review (the user must have an active grant). */
export const CreateReviewInput = z.object({
  productId: z.coerce.number().int().positive(),
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().max(80).optional().default(''),
  body: z.string().trim().min(50, 'At least 50 characters').max(2000, 'Max 2000 characters'),
})

/** Update an existing review (re-moderates). */
export const UpdateReviewInput = z.object({
  reviewId: z.coerce.number().int().positive(),
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().max(80).optional().default(''),
  body: z.string().trim().min(50).max(2000),
})

/** Soft-delete a review (sets status='hidden', wipes body). */
export const DeleteReviewInput = z.object({
  reviewId: z.coerce.number().int().positive(),
})

// --- Account / refunds --------------------------------------------------

/** Refund request from a user on a paid order. */
export const RefundRequestInput = z.object({
  order_id: z.coerce.number().int().positive(),
  reason: z.enum([
    'duplicate',
    'fraudulent',
    'requested_by_customer',
    'product_not_received',
    'product_unacceptable',
    'other',
  ] as const satisfies readonly RefundReason[]),
  notes: z.string().max(2000).optional(),
  amount_cents: PositiveCents,
  /**
   * Client-generated idempotency key (UUID). Bound to a single form
   * submission; the same key submitted twice (e.g. on a network
   * retry) returns the existing refund row instead of inserting a
   * duplicate. Optional: a missing/empty string disables the
   * idempotency check (the unique partial index on
   * `refunds.client_request_id` is still the safety net for
   * race-condition inserts with a key).
   */
  client_request_id: z.string().min(1).max(100).optional(),
  /** Bunny Storage path of the user-uploaded proof of issue. Optional
   *  (the file upload is optional per spec). When present, must
   *  match the server-minted path under `refund-proofs/{userId}/...`
   *  so admins can't be tricked into reading a user-controlled path. */
  proof_path: z.string().min(1).max(500).optional(),
  /** Original (sanitized) filename of the proof upload. Stored so
   *  admins see what the user uploaded. Optional. */
  proof_filename: z.string().min(1).max(200).optional(),
})

/** Admin-side: approve / deny a refund request. */
export const RefundDecisionInput = z.object({
  refund_id: z.coerce.number().int().positive(),
  decision: z.enum(['approve', 'deny']),
  notes: z.string().max(2000).optional(),
})

// --- Admin / categories --------------------------------------------------

/** Add a new category (admin). */
export const AddCategoryInput = z.object({
  name: z.string().min(1, 'Name is required').max(120),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .max(120)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Lowercase letters, digits, and hyphens only'),
  description: z.string().max(2000).optional().default(''),
  parent_id: z.coerce.number().int().positive().nullable().optional(),
})

/** Update a category (admin). */
export const UpdateCategoryInput = z.object({
  id: z.coerce.number().int().positive(),
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
  description: z.string().max(2000).optional(),
  parent_id: z.coerce.number().int().positive().nullable().optional(),
  display_order: z.coerce.number().int().min(0).max(100000).default(0),
})

/** Delete a category (admin). */
export const DeleteCategoryInput = z.object({
  id: z.coerce.number().int().positive(),
})

/** Reorder a category (admin) — moves a node under a new parent with a new display_order.
 *  The client also sends `sibling_ids` (the full set of sibling ids in
 *  the new order, INCLUDING the dragged node's slot) so the action can
 *  rewrite display_order for the whole sibling set in one round. */
export const ReorderCategoryInput = z.object({
  id: z.coerce.number().int().positive(),
  new_parent_id: z.coerce.number().int().positive().nullable(),
  new_display_order: z.coerce.number().int().min(0).max(100000),
  sibling_ids: z.array(z.coerce.number().int().positive()).max(500),
})

// --- Admin / account switcher --------------------------------------------

/** Start impersonation — super_admin only. */
export const ImpersonationInput = z.object({
  target_user_id: Uuid,
  reason: z
    .string()
    .trim()
    .min(20, 'Reason must be at least 20 characters (audit-log readable)')
    .max(500, 'Reason must be at most 500 characters'),
})

// --- Admin / partner settings --------------------------------------------

/** DMCA designated-agent contact — admin write. The same 4-field shape
 *  is read publicly by `02-features/legal/queries/getDmcaAgent.ts`.
 *  `phone` is optional per spec (a phone is not required by § 512(c),
 *  just email + postal address). `email` is RFC-5322-light validated
 *  (matches the patterns used by the rest of the admin area). The form
 *  rejects `javascript:` / `data:` etc. via the SafeUrl guard below —
 *  we don't URL-encode here, we just sanity-check the string shape. */
export const UpdateDmcaAgentInput = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name is required.')
    .max(120, 'Name is too long.'),
  email: z
    .string()
    .trim()
    .min(3, 'Email is required.')
    .max(254, 'Email is too long.')
    .email('Please enter a valid email address.'),
  mailing_address: z
    .string()
    .trim()
    .min(10, 'Mailing address is required (at least 10 characters).')
    .max(500, 'Mailing address is too long.'),
  phone: z
    .string()
    .trim()
    .max(40, 'Phone is too long.')
    .optional()
    .or(z.literal('')),
})

// --- P14.12 — Platform settings general editor (Slice 1) ------------------
//
// The 3 PHASES.md-resolves-STUB fields that Klaas can edit from
// `/admin/settings`. All 3 fields are required (the form uses
// .strict() + .min(1) so a partial save is impossible). Bounds match
// the Postgres CHECK constraints added in migration 0062 + 0001.
export const UpdatePlatformSettingsGeneralInput = z
  .object({
    default_royalty_pct_bps: z
      .number({ invalid_type_error: 'Royalty must be a number.' })
      .int('Royalty must be a whole number of basis points.')
      .min(0, 'Royalty cannot be negative.')
      .max(10000, 'Royalty cannot exceed 100% (10000 bps).'),
    plr_subscriber_discount_pct_bps: z
      .number({ invalid_type_error: 'Subscriber discount must be a number.' })
      .int('Subscriber discount must be a whole number of basis points.')
      .min(0, 'Subscriber discount cannot be negative.')
      .max(10000, 'Subscriber discount cannot exceed 100% (10000 bps).'),
    default_refund_window_days: z
      .number({ invalid_type_error: 'Refund window must be a number.' })
      .int('Refund window must be a whole number of days.')
      .min(1, 'Refund window must be at least 1 day.')
      .max(365, 'Refund window cannot exceed 365 days.'),
  })
  .strict()

// --- P14.15 — Maintenance mode toggle (General tab) -------------------------
//
// Per `01-specs/pages/admin-settings.md` line 19 + 64: the maintenance
// toggle requires a typed "CONFIRM" confirmation. The literal constant
// is exported so the modal + the action can never drift.
//
// `message` is optional (empty string allowed → fallback to default).
// Length cap matches the DB column's 1000-char ceiling; the action
// layer re-caps at 500 to match the spec's "single-screen" UX bound.

/** Typed confirmation string the admin must type to flip maintenance mode. */
export const MAINTENANCE_CONFIRM_STRING = 'CONFIRM'

/** Hard cap on the maintenance message (single-screen friendly). */
export const MAINTENANCE_MESSAGE_MAX_LENGTH = 500

/** Hard cap on the maintenance message at the DB layer (headroom). */
export const MAINTENANCE_MESSAGE_DB_MAX_LENGTH = 1000

export const UpdateMaintenanceActionInput = z
  .object({
    enabled: z.boolean({
      invalid_type_error: 'enabled must be a boolean.',
    }),
    message: z
      .string({ invalid_type_error: 'Message must be text.' })
      .max(
        MAINTENANCE_MESSAGE_MAX_LENGTH,
        `Message must be ${MAINTENANCE_MESSAGE_MAX_LENGTH} characters or fewer.`,
      ),
    confirm: z.literal(MAINTENANCE_CONFIRM_STRING, {
      errorMap: () => ({
        message: `Type ${MAINTENANCE_CONFIRM_STRING} to confirm.`,
      }),
    }),
  })
  .strict()

/** Partner updates their own public profile. */
export const UpdatePartnerSettingsInput = z.object({
  bio: z.string().max(2000).optional(),
  public_slug: Slug.optional(),
  // Social handles — optional, not strict (we accept anything that
  // looks like a handle and let the admin editor validate further).
  social_twitter: z.string().trim().max(80).optional(),
  social_linkedin: z.string().trim().max(200).optional(),
  social_youtube: z.string().trim().max(200).optional(),
})

// --- Admin / partner approval workflow (P14.5) ----------------------------
//
// The right-rail approve / suspend / unsuspend actions on
// /admin/partners/[id]. Each action requires a typed confirmation
// string per spec line 71 ("Every approve / suspend / unsuspend
// requires a typed confirmation in a modal; the action button is
// disabled until the typed string matches"). The literal constants
// below are the canonical contract — the matching modal components
// import these same values so the user-visible prompt and the
// server-side check can never drift.
//
// Suspend additionally requires a non-empty reason textarea
// (spec line 39). The reason is captured in the audit row's
// `metadata.reason` so the audit-log reader can correlate the
// action with the stated rationale.

/** Typed confirmation string for the approve action. */
export const APPROVE_PARTNER_CONFIRM = 'APPROVE'

/** Typed confirmation string for the suspend action. */
export const SUSPEND_PARTNER_CONFIRM = 'SUSPEND'

/** Typed confirmation string for the unsuspend action. */
export const UNSUSPEND_PARTNER_CONFIRM = 'UNSUSPEND'

/** Approve a pending partner (admin). Requires only the partner id —
 *  no typed confirmation string is sent over the wire (the modal
 *  keeps it client-side), but the action re-checks that the typed
 *  confirmation matches by reading the request body's `confirm`
 *  field. */
export const ApprovePartnerInput = z.object({
  id: z.coerce.number().int().positive(),
  confirm: z.literal(APPROVE_PARTNER_CONFIRM),
})

/** Suspend an approved partner (admin). The reason is required
 *  (1-500 chars after trim) — the action rejects an empty reason
 *  before the audit row is written. */
export const SuspendPartnerInput = z
  .object({
    id: z.coerce.number().int().positive(),
    confirm: z.literal(SUSPEND_PARTNER_CONFIRM),
    reason: z.string().trim().min(1, 'A reason is required.').max(500),
  })
  .strict()

/** Unsuspend a suspended partner (admin). Resets `status` to
 *  `'approved'` (not `'pending'` — once a partner has been
 *  approved they're an approved partner who happened to be
 *  suspended). The pre-suspension `approved_at` / `approved_by`
 *  are preserved. */
export const UnsuspendPartnerInput = z.object({
  id: z.coerce.number().int().positive(),
  confirm: z.literal(UNSUSPEND_PARTNER_CONFIRM),
})

// --- Partner / course create + update ------------------------------------

/** Product create/update — admin/partner form. */
export const ProductUpsert = z.object({
  slug: Slug,
  title: z.string().min(3).max(200),
  short_description: z.string().min(10).max(500),
  long_description: z.unknown(), // TipTap JSON; validated against tiptap schema separately
  kind: z.enum([
    'video_course',
    'ebook',
    'template_pack',
    'audio_course',
    'bundle',
    'asset_pack',
  ] as const satisfies readonly ProductKind[]),
  category_id: z.coerce.number().int().positive(),
  status: z
    .enum(['draft', 'in_review', 'published', 'unpublished', 'archived'] as const satisfies readonly ProductStatus[])
    .default('draft'),
  thumbnail_url: SafeUrl.optional(),
  // pricing
  price_cents: Cents,
  compare_at_cents: Cents.optional(),
  // royalty — optional override; default comes from platform_settings
  royalty_pct_bps: Bps.optional(),
})

/** Product file attach — Bunny storage reference. */
export const ProductFileAttach = z.object({
  product_id: z.coerce.number().int().positive(),
  kind: z.enum([
    'video',
    'slides',
    'transcript',
    'graphics',
    'audio',
    'document',
    'archive',
    'other',
  ] as const satisfies readonly FileKind[]),
  original_filename: z.string().min(1).max(255),
  storage_path: z.string().min(1).max(500),
  size_bytes: z.coerce.number().int().nonnegative(),
  duration_seconds: z.coerce.number().int().nonnegative().optional(),
  mime_type: z.string().min(2).max(200),
  checksum_sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
})

// --- FAQ -----------------------------------------------------------------

/** FAQ entry. */
export const FaqEntryInput = z.object({
  question: z.string().min(3).max(300),
  answer: z.unknown(), // TipTap JSON
  display_order: z.number().int().min(0).max(10000).default(0),
  is_published: z.boolean().default(false),
})

// --- Browse URL params (consumed by /browse + /search) -------------------

/** /browse + /search URL params — used by the parseX helpers in
 *  02-features/catalog/format.ts. Kept here as a single source of
 *  truth for the values the URL accepts. */
export const BrowseUrlParams = z.object({
  category: z.string().trim().max(120).optional(),
  sort: z
    .enum(['newest', 'popular', 'price-asc', 'price-desc'] as const satisfies readonly CatalogSortKey[])
    .optional(),
  price: z
    .enum(['any', 'free', 'under-50', 'under-100'] as const satisfies readonly PriceBucket[])
    .optional(),
  density: z
    .enum(['comfortable', 'compact'] as const satisfies readonly BrowseDensity[])
    .optional(),
})

/** Granular cookie-consent state — the input shape for the P11.1
 *  `/cookie-preferences` server action. `essential` is intentionally
 *  absent: that category is locked ON at every layer (the cookie banner
 *  uses / cart uses / Supabase auth uses / etc. all depend on it) so we
 *  don't let the wire format represent "essential: false". `analytics`
 *  covers PostHog + pageview / time-on-page / scroll-depth. `marketing`
 *  is reserved — no marketing pixels or scripts are loaded today, but
 *  the category is preserved so the consent log is forward-compatible
 *  with future integrations (Meta Pixel, Google Ads, affiliate redirect
 *  tracking, etc.). */
export const ConsentStateInput = z.object({
  analytics: z.boolean(),
  marketing: z.boolean(),
})
export type ConsentStateInputT = z.infer<typeof ConsentStateInput>

/** P11.2: the cookie-banner decision input. Same toggle surface as
 *  ConsentStateInput (essential is locked on, schema-omitted) but
 *  carries an explicit `source` so the consent_log audit row can
 *  attribute the decision to the banner (vs. the /cookie-preferences
 *  page). The `source` MUST match one of the values typed in the
 *  `ConsentSource` union (in 00-foundations/gdpr/consent.ts) — the
 *  foundation's audit log + analytics paths read this verbatim.
 *
 *  Defensive max-length on the string is `source.length <= 64` which
 *  fits all six typed sources with room to grow; an unknown value
 *  would fail the enum check rather than land in the DB. */
export const RecordBannerDecisionInput = z.object({
  analytics: z.boolean(),
  marketing: z.boolean(),
  source: z.enum([
    'banner_accept_all',
    'banner_decline_non_essential',
    'banner_save_preferences',
    'page_save_preferences',
    'gpc_auto_decline',
    'auto_default',
  ]),
})
export type RecordBannerDecisionInputT = z.infer<typeof RecordBannerDecisionInput>

// ===========================================================================
// 3. Entity READ schemas — mirror types.ts placeholders. Used by webhooks,
// admin tooling, cron jobs, and the few places where the application
// reads from the service-role client and wants a typed assertion that
// the shape matches the DB.
// ===========================================================================

/** Profile — read shape (mirror of types.ts ProfileRow + a few more columns). */
export const ProfileEntitySchema = z.object({
  id: z.number().int().positive(),
  user_id: Uuid,
  display_name: z.string().min(1).max(80),
  avatar_url: z.string().url().nullable(),
  bio: z.string().max(2000).nullable().optional(),
  locale: z.string().min(2).max(10).optional(),
  timezone: z.string().min(1).max(80).optional(),
  role: z.enum(['customer', 'partner', 'affiliate', 'admin', 'super_admin'] as const satisfies readonly UserRole[]),
  status: z.enum(['active', 'suspended', 'banned'] as const satisfies readonly UserStatus[]),
})

/** Partner — read shape. */
export const PartnerEntitySchema = z.object({
  id: z.number().int().positive(),
  user_id: Uuid,
  public_slug: z.string().nullable(),
  bio: z.string().max(2000).nullable(),
  royalty_pct_bps: Bps.nullable(),
  status: z.enum(['pending', 'approved', 'suspended'] as const satisfies readonly PartnerStatus[]),
  kyc_status: z.enum(['none', 'pending', 'approved', 'rejected']),
  tax_form_status: z.enum(['none', 'pending', 'submitted', 'approved']),
})

/** Product pricing tier — read shape. */
export const ProductPricingEntitySchema = z.object({
  id: z.number().int().positive(),
  product_id: z.number().int().positive(),
  license: z.enum(['plr', 'mrr', 'rr', 'personal'] as const satisfies readonly LicenseTier[]),
  price_cents: PositiveCents,
  compare_at_cents: Cents.nullable().optional(),
  is_active: z.boolean(),
  subscriber_discount_bps: Bps.optional(),
  display_order: z.number().int().min(0).max(100),
})

/** Product file — read shape (mirror of product_files table). */
export const ProductFileEntitySchema = z.object({
  id: z.number().int().positive(),
  product_id: z.number().int().positive(),
  kind: z.enum([
    'video',
    'slides',
    'transcript',
    'graphics',
    'audio',
    'document',
    'archive',
    'other',
  ] as const satisfies readonly FileKind[]),
  original_filename: z.string().min(1).max(255),
  storage_path: z.string().min(1).max(500),
  size_bytes: z.coerce.number().int().nonnegative(),
  duration_seconds: z.coerce.number().int().nonnegative().nullable().optional(),
  mime_type: z.string().min(2).max(200),
  scan_status: z.enum(['pending', 'clean', 'infected', 'failed'] as const satisfies readonly ScanStatus[]),
  encoding_status: z
    .enum(['pending', 'processing', 'ready', 'failed'] as const satisfies readonly EncodingStatus[])
    .nullable()
    .optional(),
})

/** Order — read shape. */
export const OrderEntitySchema = z.object({
  id: z.number().int().positive(),
  user_id: Uuid,
  email: z.string().email(),
  status: z.enum([
    'pending',
    'awaiting_payment',
    'paid',
    'fulfilled',
    'refunded',
    'partially_refunded',
    'failed',
    'canceled',
    'fraudulent',
  ] as const satisfies readonly OrderStatus[]),
  subtotal_cents: Cents,
  discount_cents: Cents,
  subscriber_discount_cents: Cents,
  tax_cents: Cents,
  total_cents: Cents,
  refunded_cents: Cents,
  currency: z.enum(['USD', 'EUR', 'GBP']),
  stripe_payment_intent_id: z.string().nullable().optional(),
  stripe_checkout_session_id: z.string().nullable().optional(),
  affiliate_id: z.number().int().positive().nullable().optional(),
  affiliate_handle: z.string().nullable().optional(),
  coupon_id: z.number().int().positive().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
  created_at: z.string(),
  updated_at: z.string(),
})

/** Order item — read shape. */
export const OrderItemEntitySchema = z.object({
  id: z.number().int().positive(),
  order_id: z.number().int().positive(),
  product_id: z.number().int().positive(),
  partner_id: z.number().int().positive().nullable(),
  license: z.enum(['plr', 'mrr', 'rr', 'personal'] as const satisfies readonly LicenseTier[]),
  quantity: z.number().int().min(1).max(99),
  unit_price_cents: PositiveCents,
  line_total_cents: Cents,
  subscriber_discount_cents: Cents,
  royalty_pct_bps: Bps,
  royalty_cents: Cents,
})

/** Subscription — read shape (mirror of subscriptions table). */
export const SubscriptionEntitySchema = z.object({
  id: z.number().int().positive(),
  user_id: Uuid,
  stripe_subscription_id: z.string(),
  status: z.enum([
    'incomplete',
    'incomplete_expired',
    'trialing',
    'active',
    'past_due',
    'canceled',
    'unpaid',
    'paused',
  ] as const satisfies readonly SubscriptionStatus[]),
  stripe_price_id: z.string(),
  current_period_start: z.string().nullable(),
  current_period_end: z.string().nullable(),
  cancel_at_period_end: z.boolean(),
  canceled_at: z.string().nullable().optional(),
  started_at: z.string().nullable().optional(),
  ended_at: z.string().nullable().optional(),
})

/** Library grant — read shape. */
export const LibraryGrantEntitySchema = z.object({
  id: z.number().int().positive(),
  user_id: Uuid,
  product_id: z.number().int().positive(),
  license: z.enum(['plr', 'mrr', 'rr', 'personal'] as const satisfies readonly LicenseTier[]),
  source: z.enum(['order', 'subscription', 'admin_grant', 'refund']),
  order_id: z.number().int().positive().nullable().optional(),
  subscription_id: z.number().int().positive().nullable().optional(),
  granted_at: z.string(),
  expires_at: z.string().nullable().optional(),
  revoked_at: z.string().nullable().optional(),
})

/** Payout ledger entry — read shape. */
export const PayoutLedgerEntitySchema = z.object({
  id: z.number().int().positive(),
  partner_id: z.number().int().positive(),
  kind: z.enum([
    'order_sale',
    'subscription',
    'refund',
    'adjustment',
    'payout',
    'clawback',
  ] as const satisfies readonly PayoutLedgerKind[]),
  status: z.enum([
    'accruing',
    'pending_payout',
    'paid',
    'void',
    'locked',
    'available',
  ] as const satisfies readonly PayoutLedgerStatus[]),
  amount_cents: z.number().int(), // can be negative (clawbacks)
  currency: z.enum(['USD', 'EUR', 'GBP']),
  order_id: z.number().int().positive().nullable().optional(),
  subscription_id: z.number().int().positive().nullable().optional(),
  payout_id: z.number().int().positive().nullable().optional(),
  locked_until: z.string().nullable().optional(),
  stripe_invoice_id: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
  created_at: z.string(),
})

/** Coupon — read shape. */
export const CouponEntitySchema = z.object({
  id: z.number().int().positive(),
  code: z.string().min(2).max(40),
  discount_bps: Bps,
  starts_at: z.string().nullable().optional(),
  ends_at: z.string().nullable().optional(),
  max_redemptions: z.number().int().positive().nullable().optional(),
  redemptions_count: z.number().int().nonnegative(),
  is_active: z.boolean(),
})

/** Refund — read shape. */
export const RefundEntitySchema = z.object({
  id: z.number().int().positive(),
  order_id: z.number().int().positive(),
  amount_cents: PositiveCents,
  reason: z.enum([
    'duplicate',
    'fraudulent',
    'requested_by_customer',
    'product_not_received',
    'product_unacceptable',
    'other',
  ] as const satisfies readonly RefundReason[]),
  notes: z.string().max(2000).nullable().optional(),
  status: z.enum(['pending', 'succeeded', 'failed', 'canceled'] as const satisfies readonly RefundStatus[]),
  requested_by: Uuid,
  reviewed_by: Uuid.nullable().optional(),
  reviewed_at: z.string().nullable().optional(),
  stripe_refund_id: z.string().nullable().optional(),
  created_at: z.string(),
})

/** Review — read shape (mirror of types.ts ReviewRow + a few more columns). */
export const ReviewEntitySchema = z.object({
  id: z.number().int().positive(),
  user_id: Uuid,
  product_id: z.number().int().positive(),
  rating: z.number().int().min(1).max(5),
  title: z.string().max(80).nullable().optional(),
  body: z.string().min(10).max(5000),
  status: z.enum(['pending', 'published', 'hidden', 'flagged'] as const satisfies readonly ReviewStatus[]),
  helpful_count: z.number().int().nonnegative(),
  created_at: z.string(),
  updated_at: z.string(),
})

/** Category — read shape. */
export const CategoryEntitySchema = z.object({
  id: z.number().int().positive(),
  slug: Slug,
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  parent_id: z.number().int().positive().nullable().optional(),
  display_order: z.number().int().nonnegative(),
  product_count_cache: z.number().int().nonnegative(),
})

/** Product image — read shape (mirror of types.ts ProductImageRow). */
export const ProductImageEntitySchema = z.object({
  id: z.number().int().positive(),
  product_id: z.number().int().positive(),
  url: SafeUrl,
  alt: z.string().max(300),
  kind: z.enum(['gallery', 'preview_video_thumb'] as const satisfies readonly ProductImageKind[]),
  display_order: z.number().int().nonnegative(),
  created_at: z.string(),
})

/** Collection — read shape (mirror of types.ts CollectionRow). */
export const CollectionEntitySchema = z.object({
  id: z.number().int().positive(),
  slug: Slug,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  hero_image_url: SafeUrl.nullable().optional(),
  is_featured: z.boolean(),
  display_order: z.number().int().nonnegative(),
  status: z.enum(['draft', 'published', 'archived'] as const satisfies readonly CollectionStatus[]),
  published_at: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
})

/** Bundle item — read shape (mirror of bundle_items table). */
export const BundleItemEntitySchema = z.object({
  id: z.number().int().positive(),
  bundle_product_id: z.number().int().positive(),
  included_product_id: z.number().int().positive(),
  display_order: z.number().int().nonnegative(),
  note: z.string().max(280).nullable().optional(),
})

/** Affiliate — read shape. */
export const AffiliateEntitySchema = z.object({
  id: z.number().int().positive(),
  user_id: Uuid,
  handle: Slug,
  status: z.enum(['pending', 'approved', 'suspended'] as const satisfies readonly AffiliateStatus[]),
  bio: z.string().max(2000).nullable().optional(),
  commission_pct_bps: Bps.nullable().optional(),
  approved_at: z.string().nullable().optional(),
})

/** Affiliate click — read shape. */
export const AffiliateClickEntitySchema = z.object({
  id: z.number().int().positive(),
  affiliate_id: z.number().int().positive(),
  product_id: z.number().int().positive().nullable().optional(),
  url_path: z.string().max(500),
  ip_hash: z.string().regex(/^[a-f0-9]{64}$/i).nullable().optional(),
  user_agent: z.string().max(500).nullable().optional(),
  referrer: z.string().max(500).nullable().optional(),
  converted: z.boolean(),
  created_at: z.string(),
})

/** Notification preferences — read shape. */
export const NotificationPreferencesEntitySchema = z.object({
  user_id: Uuid,
  weekly_digest_email: z.boolean(),
  marketing_email: z.boolean(),
  updated_at: z.string(),
})

/** Platform settings — read shape (singleton row). */
export const PlatformSettingsEntitySchema = z.object({
  id: z.literal(1),
  default_royalty_pct_bps: Bps,
  default_currency: z.enum(['USD', 'EUR', 'GBP']),
  // Subscriber discount defaults (0..10000 bps)
  default_subscriber_discount_bps: Bps,
  refund_window_days: z.number().int().min(0).max(365),
  updated_at: z.string(),
})

/** Impersonation session — read shape. */
export const ImpersonationSessionEntitySchema = z.object({
  id: Uuid,
  admin_id: Uuid,
  target_user_id: Uuid,
  reason: z.string().min(20).max(500),
  started_at: z.string(),
  ended_at: z.string().nullable().optional(),
  expires_at: z.string(),
  action_link: z.string().url().nullable().optional(),
})

/** Cart item — read shape. */
export const CartItemEntitySchema = z.object({
  id: z.number().int().positive(),
  user_id: Uuid,
  product_id: z.number().int().positive(),
  license: z.enum(['plr', 'mrr', 'rr', 'personal'] as const satisfies readonly LicenseTier[]),
  quantity: z.number().int().min(1).max(99),
  status: z.enum(['active', 'converted', 'abandoned', 'expired'] as const satisfies readonly CartStatus[]),
  coupon_id: z.number().int().positive().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
})

/** File download record — read shape. */
export const FileDownloadEntitySchema = z.object({
  id: z.number().int().positive(),
  user_id: Uuid,
  file_id: z.number().int().positive(),
  product_id: z.number().int().positive(),
  kind: z.enum(['download', 'stream']),
  url_expires_at: z.string(),
  ip_hash: z.string().nullable().optional(),
  ip_raw: z.string().nullable().optional(),
  user_agent: z.string().nullable().optional(),
  created_at: z.string(),
})

/** Audit log entry — read shape (admin_audit_log + future auth_audit_log). */
export const AuditLogEntitySchema = z.object({
  id: z.number().int().positive(),
  actor_id: Uuid,
  actor_email_hash: z.string().nullable().optional(),
  action: z.string().min(1).max(120), // free-form text in the DB
  target_kind: z.string().max(60).nullable().optional(),
  target_id: z.string().max(120).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
  ip_hash: z.string().nullable().optional(),
  user_agent: z.string().nullable().optional(),
  created_at: z.string(),
})

// ===========================================================================
// 4. WYSIWYG (TipTap) content shape
// ===========================================================================
//
// This is the canonical contract for what `00-foundations/ui/forms/RichTextField`
// (the TipTap editor) produces and what `02-features/product/renderTipTap` (the
// pure-JSX renderer) consumes. Server actions accept it as input, and the
// renderer also validates the DB read defensively via `parseTipTapDoc()` so a
// bad / legacy / corrupt row degrades to the empty fragment instead of throwing.
//
// **Two defensive caps** prevent an attacker / accidental paste-bomb from
// sending a malicious doc that blows up the renderer or pegs CPU on parse:
//
//   - `TIP_TAP_MAX_DOC_NODES` (5000) caps the total node count across the
//     whole tree (not per content array). Enforced in `.superRefine` because
//     a per-array cap doesn't catch the recursive accumulation.
//   - `TIP_TAP_MAX_DOC_DEPTH` (64) caps the nesting depth. Matches the
//     `MAX_DEPTH = 64` cap inside `renderTipTap.tsx`.
//
// **Node / mark allowlist is permissive** — the schema validates the SHAPE
// (every node has `type` + optional `attrs`/`content`/`text`/`marks`) and lets
// the `type` string be anything. The renderer is also permissive: unknown
// node types render their children as a fallback (so a forward-compat node
// added in a later version still renders something instead of vanishing).
//
// **The one place we DO type-restrict is the `link` mark's `href`**, which is
// an XSS-defending surface. The allowlist rejects `javascript:`, `data:`,
// `vbscript:`, and `file:` schemes. (The renderer's `safeHref()` enforces the
// same allowlist at render time as defense in depth.)
//
// **To add a new node or mark type**:
//
//   1. Add it to `TipTapNode` / `TipTapMark` (no schema change needed — the
//      `type` field is free-form).
//   2. Add the corresponding `case` to `renderTipTap.tsx`.
//   3. If it has type-specific attrs that need strict validation (like
//      `image.src` or `heading.level`), extend the `.superRefine` block.
//   4. Add tests in `schemas.test.ts`.

/** Defensive cap on total node count across the whole doc tree. */
export const TIP_TAP_MAX_DOC_NODES = 5000

/** Defensive cap on max nesting depth — matches the renderer's cap. */
export const TIP_TAP_MAX_DOC_DEPTH = 64

/** Schemes that are always rejected in a `link` mark's `href` (XSS defense). */
const UNSAFE_HREF_RE = /^(?:javascript|data|vbscript|file):/i

/** Shape of a non-link TipTap mark. The `type` allowlist is the v2 editor's set. */
const TipTapPlainMark = z
  .object({
    type: z.enum(['bold', 'italic', 'strike', 'underline', 'code']),
    attrs: z.record(z.unknown()).optional(),
  })
  .passthrough()

/**
 * TipTap link mark — `attrs.href` is allowlist-validated.
 * Accepts `http://`, `https://`, `mailto:`, `tel:`, `/#anchor`, and relative
 * URLs. Rejects `javascript:`, `data:`, `vbscript:`, `file:` (XSS defense —
 * the same allowlist as `safeHref()` in `02-features/product/renderTipTap.tsx`,
 * enforced at parse time so a corrupt doc never reaches the renderer).
 */
const TipTapLinkMark = z
  .object({
    type: z.literal('link'),
    attrs: z
      .object({
        href: z
          .string()
          .trim()
          .min(1)
          .max(2048)
          .refine((s) => !UNSAFE_HREF_RE.test(s), {
            message:
              'link href cannot use a dangerous scheme (javascript:, data:, vbscript:, file:)',
          }),
        target: z.string().max(40).optional(),
        rel: z.string().max(200).optional(),
      })
      .passthrough(),
  })
  .passthrough()

/**
 * A TipTap mark — discriminated by `type` so a `type: 'link'` input MUST
 * match `TipTapLinkMark` (with the strict href allowlist), not the loose
 * `TipTapPlainMark` branch. A `z.union` would let the first match win
 * silently; a `discriminatedUnion` is strict.
 */
export const TipTapMarkSchema = z.discriminatedUnion('type', [
  TipTapLinkMark,
  TipTapPlainMark,
])

/** Recursive node type — explicit `| undefined` for optional fields to match
 *  Zod's inferred output type under `exactOptionalPropertyTypes: true`. */
type TipTapNodeInput = {
  type: string
  attrs?: Record<string, unknown> | undefined
  content?: TipTapNodeInput[] | undefined
  text?: string | undefined
  marks?: z.infer<typeof TipTapMarkSchema>[] | undefined
}

/**
 * The full recursive TipTap JSON tree. Every node has a `type` (free-form
 * string, max 40 chars — caps typos / paste-bombs). `text` is capped at
 * 100,000 chars (defensive — one pasted essay, not the entire GitHub archive).
 *
 * Cast through `z.ZodType<TipTapNodeInput, any, any>` so the recursive
 * `z.lazy` resolves to our explicit type without the `exactOptionalPropertyTypes`
 * mismatch between `attrs?: T` and `T | undefined`.
 */
const TipTapNodeSchemaInternal: z.ZodType<TipTapNodeInput, any, any> = z.lazy(() =>
  z
    .object({
      type: z.string().min(1).max(40),
      attrs: z.record(z.unknown()).optional(),
      content: z.array(TipTapNodeSchemaInternal).optional(),
      text: z.string().max(100_000).optional(),
      marks: z.array(TipTapMarkSchema).max(50).optional(),
    })
    .passthrough(),
)

/** Public type — used by the renderer and consumers. */
export type TipTapNode = TipTapNodeInput

/**
 * Walk a parsed TipTap node and return total node count + max depth seen.
 * Used by `TipTapDocSchema`'s `.superRefine` to enforce global caps.
 */
function measureDocTree(node: unknown, depth = 0): { count: number; maxDepth: number } {
  if (!node || typeof node !== 'object') return { count: 0, maxDepth: depth }
  const n = node as TipTapNode
  let count = 1
  let maxDepth = depth
  if (Array.isArray(n.content)) {
    for (const child of n.content) {
      const c = measureDocTree(child, depth + 1)
      count += c.count
      if (c.maxDepth > maxDepth) maxDepth = c.maxDepth
    }
  }
  return { count, maxDepth }
}

/**
 * Per-type attrs validation. Only the node types with strict attrs get
 * checked — unknown node types are accepted as-is (forward compat).
 * Returns an issue if any node in the tree has invalid attrs.
 */
function validateNodeAttrs(
  node: unknown,
  ctx: z.RefinementCtx,
  pathPrefix: (string | number)[] = [],
): void {
  if (!node || typeof node !== 'object') return
  const n = node as TipTapNode
  const attrs = (n.attrs ?? {}) as Record<string, unknown>
  switch (n.type) {
    case 'heading': {
      // Level must be 2 or 3 (per the v2 editor config). Anything else is a
      // forward-compat node — accept (the renderer also handles 1/4/5/6 by
      // coercing to h2 or h3 anyway). But the editor's h1 must never reach
      // us through the schema.
      const level = attrs.level
      if (level !== 2 && level !== 3) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `heading.level must be 2 or 3 (got ${JSON.stringify(level)})`,
          path: [...pathPrefix, 'attrs', 'level'],
        })
      }
      break
    }
    case 'codeBlock': {
      if (attrs.language != null && typeof attrs.language !== 'string') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'codeBlock.language must be a string',
          path: [...pathPrefix, 'attrs', 'language'],
        })
      }
      break
    }
    case 'image': {
      if (typeof attrs.src !== 'string' || attrs.src.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'image.src must be a non-empty string',
          path: [...pathPrefix, 'attrs', 'src'],
        })
      } else if (UNSAFE_HREF_RE.test(String(attrs.src).trim())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'image.src cannot use a dangerous scheme (javascript:, data:, vbscript:, file:)',
          path: [...pathPrefix, 'attrs', 'src'],
        })
      }
      break
    }
    default:
      // Unknown node type — let it through (forward compat). The renderer
      // falls back to "render children" for unknown types.
      break
  }
  if (Array.isArray(n.content)) {
    n.content.forEach((child, i) => {
      validateNodeAttrs(child, ctx, [...pathPrefix, 'content', i])
    })
  }
}

/**
 * WYSIWYG (TipTap) content shape. The contract between the editor and the
 * renderer; see the file-level comment for how to extend.
 */
export const TipTapDocSchema = z
  .object({
    type: z.literal('doc'),
    content: z.array(TipTapNodeSchemaInternal).max(TIP_TAP_MAX_DOC_NODES).default([]),
  })
  .passthrough()
  .superRefine((doc, ctx) => {
    const { count, maxDepth } = measureDocTree(doc)
    if (count > TIP_TAP_MAX_DOC_NODES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Doc has ${count} nodes (max ${TIP_TAP_MAX_DOC_NODES})`,
        path: ['content'],
      })
    }
    if (maxDepth > TIP_TAP_MAX_DOC_DEPTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Doc depth ${maxDepth} exceeds max ${TIP_TAP_MAX_DOC_DEPTH}`,
        path: ['content'],
      })
    }
    // Walk the tree and validate per-type attrs (heading.level,
    // codeBlock.language, image.src, …).
    if (Array.isArray((doc as TipTapNode).content)) {
      ;(doc as TipTapNode).content!.forEach((child, i) => {
        validateNodeAttrs(child, ctx, ['content', i])
      })
    }
  })

/**
 * Parse an arbitrary input as a TipTap doc. Returns the validated doc on
 * success, or `null` on any validation failure. Use this for **graceful
 * degradation** at read time (renderer-side): if the DB row is corrupt
 * or the legacy column has a pre-v2 shape, the renderer gets `null` and
 * the caller can fall back to an empty fragment.
 *
 * For **strict validation** at the action boundary (server-side input from
 * a form post), use `TipTapDocSchema.safeParse(input)` directly and surface
 * the failure to the user.
 */
export function parseTipTapDoc(input: unknown): TipTapNode | null {
  const result = TipTapDocSchema.safeParse(input)
  if (!result.success) return null
  return result.data as TipTapNode
}
