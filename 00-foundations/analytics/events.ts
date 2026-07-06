// PostHog event shapes — typed catalog of every analytics event the
// app emits. Both server-side (`trackPosthogServer` if/when a Node
// SDK is wired) and the existing client-side `trackEvent` import
// from here so the contract is in one place.
//
// Adding an event: add it to `POSTHOG_EVENTS` (the source-of-truth
// list) + add a matching entry in `PostHogEventProps` so the call
// site gets a typed `props`. Drift between the two fails
// typecheck.

import { z } from 'zod'

/**
 * The canonical PostHog event catalog. Every `posthog.capture(event)`
 * call MUST use a name from this list — the event name is the primary
 * key for downstream dashboards and feature-flag rollouts.
 *
 * The list is grouped by surface:
 * - `page_*` — page-view-equivalent events
 * - `cta_*` — CTA clicks
 * - `auth_*` — auth surface events
 * - `catalog_*` — catalog interaction events
 * - `cart_*` — cart interaction events
 * - `checkout_*` — checkout funnel events
 * - `library_*` — post-purchase library events
 * - `partner_*` — partner portal events (Phase 12 wires the calls)
 * - `affiliate_*` — affiliate portal events (Phase 13)
 * - `admin_*` — admin console events (Phase 14)
 * - `lms_*` — LMS player events (Phase 15)
 * - `search_*` — search surface events
 * - `rec_*` — recommendation surface events
 * - `gdpr_*` — privacy / consent events
 */
export const POSTHOG_EVENTS = [
  // Page views
  'page_viewed',

  // CTA clicks
  'cta_clicked',

  // Auth
  'auth_signup_started',
  'auth_signup_succeeded',
  'auth_signup_failed',
  'auth_signin_succeeded',
  'auth_signin_failed',
  'auth_password_reset_requested',
  'auth_password_reset_completed',
  'auth_email_verified',
  'auth_oauth_started',
  'auth_oauth_completed',

  // Catalog
  'catalog_product_viewed',
  'catalog_product_added_to_cart',
  'catalog_filter_changed',
  'catalog_sort_changed',
  'catalog_search_submitted',

  // Cart
  'cart_viewed',
  'cart_line_edited',
  'cart_coupon_applied',
  'cart_coupon_failed',
  'cart_cleared',
  'cart_abandoned',

  // Checkout
  'checkout_started',
  'checkout_payment_method_selected',
  'checkout_completed',
  'checkout_failed',
  'checkout_canceled',

  // Library
  'library_product_opened',
  'library_download_started',
  'library_stream_started',

  // Partner
  'partner_dashboard_viewed',
  'partner_course_created',
  'partner_course_published',
  'partner_payout_requested',

  // Affiliate
  'affiliate_dashboard_viewed',
  'affiliate_link_created',
  'affiliate_click_tracked',

  // Admin
  'admin_customer_viewed',
  'admin_refund_approved',
  'admin_payout_processed',

  // LMS
  'lms_lesson_started',
  'lms_lesson_completed',
  'lms_certificate_issued',

  // Search
  'search_query_submitted',
  'search_result_clicked',
  'search_zero_results',

  // Recommendations
  'rec_rail_viewed',
  'rec_item_clicked',

  // GDPR / consent
  'gdpr_consent_granted',
  'gdpr_consent_withdrawn',
  'gdpr_data_export_requested',
  'gdpr_account_deletion_requested',
] as const satisfies readonly string[]

/**
 * The PostHogEvent union. Adding a string literal to `POSTHOG_EVENTS`
 * without also handling it in `PostHogEventProps` is allowed (the
 * event is a generic capture); the inverse (props without event) is
 * a typecheck error.
 */
export type PostHogEvent = (typeof POSTHOG_EVENTS)[number]

/**
 * Per-event props schema. Use a discriminated lookup: the event name
 * maps to a Zod schema describing the expected props. Call sites pass
 * `{ event, props }` and the schema validates at the boundary.
 *
 * Unknown event names fall through to a permissive `z.record(z.unknown())`
 * so the seam never throws on an event the catalog hasn't been updated
 * for yet — failures are silent (PostHog is opt-in analytics).
 */
export const POSTHOG_EVENT_PROPS: {
  [E in PostHogEvent]: z.ZodType
} = {
  // Pages + CTAs
  page_viewed: z.object({
    path: z.string(),
    referrer: z.string().optional(),
  }),
  cta_clicked: z.object({
    cta_id: z.string(),
    cta_label: z.string().optional(),
    surface: z.string().optional(),
  }),

  // Auth
  auth_signup_started: z.object({ surface: z.enum(['web', 'oauth_google', 'oauth_apple']) }),
  auth_signup_succeeded: z.object({ user_id_hash: z.string() }),
  auth_signup_failed: z.object({ reason: z.string() }),
  auth_signin_succeeded: z.object({ user_id_hash: z.string(), method: z.enum(['password', 'oauth_google', 'oauth_apple', 'magiclink']) }),
  auth_signin_failed: z.object({ reason: z.string() }),
  auth_password_reset_requested: z.object({}),
  auth_password_reset_completed: z.object({}),
  auth_email_verified: z.object({}),
  auth_oauth_started: z.object({ provider: z.enum(['google', 'apple']) }),
  auth_oauth_completed: z.object({ provider: z.enum(['google', 'apple']) }),

  // Catalog
  catalog_product_viewed: z.object({ product_id: z.string(), slug: z.string() }),
  catalog_product_added_to_cart: z.object({ product_id: z.string(), license: z.string() }),
  catalog_filter_changed: z.object({ filter: z.string(), value: z.string() }),
  catalog_sort_changed: z.object({ sort: z.string() }),
  catalog_search_submitted: z.object({ query_length: z.number().int().nonnegative() }),

  // Cart
  cart_viewed: z.object({ line_count: z.number().int().nonnegative() }),
  cart_line_edited: z.object({ product_id: z.string(), action: z.enum(['change_license', 'change_quantity', 'remove']) }),
  cart_coupon_applied: z.object({ coupon_id_hash: z.string() }),
  cart_coupon_failed: z.object({ reason: z.string() }),
  cart_cleared: z.object({}),
  // P4.6 — emitted by the daily `detect-abandoned-carts` cron. The
  // event fires once per affected user (rows are aggregated by
  // user_id in JS before the capture). `line_count` is the sum of
  // cart_items.quantity across the user's abandoned rows;
  // `subtotal_cents` is the sum of unit_price_cents * quantity
  // (joined via product_pricing at the time of detection);
  // `days_idle_max` is the oldest updated_at in the user's
  // abandoned rows (in whole days). The user_id is hashed via
  // the same `AUDIT_HASH_SALT` pattern used elsewhere — the
  // `user_id_hash` is the `distinct_id` PostHog sees, so the
  // event can be associated with the user profile without ever
  // shipping the raw UUID.
  cart_abandoned: z.object({
    user_id_hash: z.string(),
    line_count: z.number().int().positive(),
    subtotal_cents: z.number().int().nonnegative(),
    days_idle_max: z.number().int().positive(),
  }),

  // Checkout
  checkout_started: z.object({ line_count: z.number().int().nonnegative(), subtotal_cents: z.number().int().nonnegative() }),
  checkout_payment_method_selected: z.object({ method: z.enum(['card', 'apple_pay', 'google_pay', 'link']) }),
  checkout_completed: z.object({ order_id_hash: z.string(), total_cents: z.number().int().nonnegative() }),
  checkout_failed: z.object({ reason: z.string() }),
  checkout_canceled: z.object({}),

  // Library
  library_product_opened: z.object({ product_id: z.string() }),
  library_download_started: z.object({ product_id: z.string(), file_id: z.string() }),
  library_stream_started: z.object({ product_id: z.string(), lesson_id: z.string() }),

  // Partner
  partner_dashboard_viewed: z.object({}),
  partner_course_created: z.object({ course_id_hash: z.string() }),
  partner_course_published: z.object({ course_id_hash: z.string() }),
  partner_payout_requested: z.object({ amount_cents: z.number().int().nonnegative() }),

  // Affiliate
  affiliate_dashboard_viewed: z.object({}),
  affiliate_link_created: z.object({}),
  affiliate_click_tracked: z.object({ link_id_hash: z.string() }),

  // Admin
  admin_customer_viewed: z.object({}),
  admin_refund_approved: z.object({ refund_id_hash: z.string() }),
  admin_payout_processed: z.object({ payout_id_hash: z.string() }),

  // LMS
  lms_lesson_started: z.object({ lesson_id: z.string() }),
  lms_lesson_completed: z.object({ lesson_id: z.string() }),
  lms_certificate_issued: z.object({ certificate_id_hash: z.string() }),

  // Search
  search_query_submitted: z.object({ query_length: z.number().int().nonnegative() }),
  search_result_clicked: z.object({ product_id: z.string(), rank: z.number().int().nonnegative() }),
  search_zero_results: z.object({ query_length: z.number().int().nonnegative() }),

  // Recommendations
  rec_rail_viewed: z.object({ rail: z.string(), item_count: z.number().int().nonnegative() }),
  rec_item_clicked: z.object({ rail: z.string(), product_id: z.string(), rank: z.number().int().nonnegative() }),

  // GDPR / consent
  gdpr_consent_granted: z.object({ categories: z.array(z.enum(['essential', 'analytics', 'marketing'])) }),
  gdpr_consent_withdrawn: z.object({ categories: z.array(z.enum(['essential', 'analytics', 'marketing'])) }),
  gdpr_data_export_requested: z.object({}),
  gdpr_account_deletion_requested: z.object({}),
}

/**
 * Discriminated union of valid PostHogEvent + its props shape.
 * Use this to type the args of a tracking call site:
 *
 *   function track<E extends PostHogEvent>(event: E, props: PostHogEventProps<E>) { ... }
 *
 * Or pass the schema directly to validate at the boundary:
 *
 *   POSTHOG_EVENT_PROPS[event].safeParse(props)
 */
export type PostHogEventProps<E extends PostHogEvent> = z.infer<(typeof POSTHOG_EVENT_PROPS)[E]>

/** Concrete props type for the `cart_abandoned` event. Re-exported
 *  as a named type so the cart-abandonment helpers
 *  (`02-features/cart/cartAbandonment.ts`) and the cron script
 *  (`04-platform/ci/scripts/cron/detect-abandoned-carts.ts`) can
 *  import it without going through the generic
 *  `PostHogEventProps<'cart_abandoned'>` indirection at every
 *  call site. */
export type CartAbandonedEventProps = PostHogEventProps<'cart_abandoned'>

/**
 * The default PostHog host (EU). Matches the env default in env.ts
 * so dashboards don't drift across environments.
 */
export const DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com'

/**
 * Whether the PostHog seam is configured (i.e. NEXT_PUBLIC_POSTHOG_KEY
 * is non-empty). The client init short-circuits when this returns
 * false. Use this as the gate in any UI that wants to render
 * PostHog-specific surfaces (e.g. a "view analytics dashboard"
 * admin link).
 */
import { getEnv } from '@foundations/env'

export function isPostHogConfigured(): boolean {
  return Boolean(getEnv().NEXT_PUBLIC_POSTHOG_KEY)
}