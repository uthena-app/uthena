// Structured log schema — the documented contract every `log.info|warn|error`
// call follows. Per PHASES.md P2.10: "structured schema (`event`, `actor`,
// `subject`, `context`), redactors for PII, request ID middleware."
//
// Every log line in the codebase carries FOUR pieces of structured context:
//
//   - `event`   — what happened (canonical verb, machine-readable)
//   - `actor`   — who did it (user / anon / system / admin)
//   - `subject` — what was acted upon (product / order / cart / file / ...)
//   - `context` — request-scoped metadata (req_id, component, surface)
//
// Conventions:
//   - `event` is required for `info` + `warn` + `error`. `debug` may omit it.
//   - `actor` is always present — `{kind: 'system'}` when there's no human.
//   - `subject` may be omitted for events without a target (e.g. server boot).
//   - `context.req_id` is set automatically by `loggerForRequest()` — never
//     hand-write it.
//   - The pino redact list (see `pino.ts`) catches `email`, `password`,
//     `token`, `secret`, `apiKey`, `card`, `ssn`, `authorization`, etc.
//     This module does NOT re-redact — it relies on pino's redact at write time.
//
// Future phases (P14.18, P17, P18.6) consume these keys for the audit log
// search UI, the dashboard, and PostHog funnels. Adding a new event name?
// Add it to `LogEventName` below + write the call site + ship the consumer
// in the same PR.

/**
 * Canonical event names. Lowercase, dot-namespaced, past tense verb.
 *
 * Format: `<surface>.<verb>` where surface = the system surface that
 * originated the event (auth, cart, checkout, library, partner, ...).
 *
 * Adding a new event: (1) add the name here, (2) write the call site
 * with `logEvent(...)` or the structured object form, (3) the consumer
 * (P14 audit log search, P17 send log, P18 dashboards) ships in a later
 * phase — but the name is reserved from this PR onward.
 */
export const LOG_EVENTS = [
  // Auth (P1 + P9.16/P9.17)
  'auth.signup',
  'auth.login',
  'auth.logout',
  'auth.password_reset_request',
  'auth.password_reset_complete',
  'auth.email_verification_sent',
  'auth.email_verified',
  'auth.session_revoked',
  'auth.account_deleted',
  'auth.data_exported',

  // Cart (P4)
  'cart.added',
  'cart.removed',
  'cart.quantity_changed',
  'cart.license_changed',
  'cart.coupon_applied',
  'cart.coupon_rejected',
  'cart.cleared',
  'cart.abandoned',

  // Checkout (P4)
  'checkout.started',
  'checkout.payment_method_selected',
  'checkout.payment_succeeded',
  'checkout.payment_failed',
  'checkout.completed',
  'checkout.canceled',

  // Subscriptions (P5)
  'subscription.started',
  'subscription.trial_started',
  'subscription.cancel_at_period_end',
  'subscription.resumed',
  'subscription.payment_failed',
  'subscription.payment_recovered',
  'subscription.deleted',

  // Library + files (P7)
  'library.download_minted',
  'library.stream_minted',
  'library.access_granted',
  'library.access_revoked',
  'file.virus_detected',
  'file.encode_completed',
  'file.encode_failed',

  // Partner portal (P12)
  'partner.course_created',
  'partner.course_published',
  'partner.course_updated',
  'partner.course_deleted',
  'partner.payout_requested',
  'partner.payout_method_changed',
  'partner.api_token_created',
  'partner.api_token_revoked',

  // Affiliate (P13)
  'affiliate.signup',
  'affiliate.link_clicked',
  'affiliate.conversion',
  'affiliate.payout_requested',

  // Admin (P14)
  'admin.user_impersonated',
  'admin.user_banned',
  'admin.user_unbanned',
  'admin.partner_approved',
  'admin.partner_suspended',
  'admin.refund_issued',
  'admin.payout_approved',
  'admin.payout_denied',
  'admin.content_flagged',
  'admin.content_removed',
  'admin.feature_flag_toggled',
  'admin.maintenance_mode_changed',

  // LMS (P15)
  'lms.lesson_started',
  'lms.lesson_completed',
  'lms.course_completed',
  'lms.certificate_issued',
  'lms.bookmark_added',
  'lms.bookmark_removed',

  // Recommendations (P16)
  'rec.feedback_recorded',
  'rec.bandit_arm_selected',

  // Email (P17)
  'email.queued',
  'email.sent',
  'email.delivered',
  'email.bounced',
  'email.complained',
  'email.suppressed',
  'email.unsubscribed',

  // Webhooks (P4/P5/P6)
  'webhook.stripe_received',
  'webhook.stripe_processed',
  'webhook.stripe_failed',
  'webhook.paypal_received',
  'webhook.paypal_processed',

  // GDPR + consent (P9/P11)
  'gdpr.consent_granted',
  'gdpr.consent_withdrawn',
  'gdpr.export_requested',
  'gdpr.delete_requested',

  // Errors (P2.11 + cross-cutting)
  'error.unhandled',
  'error.webhook_signature_invalid',
  'error.rate_limited',
  'error.unauthorized',
  'error.validation_failed',
] as const

export type LogEventName = (typeof LOG_EVENTS)[number]

/**
 * Who performed the action.
 *
 * - `user`    — authenticated buyer/partner/affiliate (P1+).
 * - `admin`   — authenticated admin acting on behalf of someone else.
 * - `anon`    — unauthenticated request (only `ip_hash` is retained; the
 *               raw IP never enters the log; the daily IP-hash bucket
 *               is what the audit-log search uses to correlate).
 * - `system`  — no human; cron job, server boot, webhook handler.
 *
 * `user_id` is the Supabase auth user UUID. The audit log search UI
 * (P14.18) joins it against the `profiles` table; it is NEVER logged
 * as PII (the audit-log search is super-admin-only + audit-logged
 * itself per AGENTS.md §2).
 */
// LogActor is declared below as `z.infer<typeof LogActorSchema>` — the
// schema is the source of truth, the type is derived from it.

/**
 * What was acted upon. Discriminated union — adding a new `kind` here
 * requires adding the corresponding shape (and documenting the ID type).
 *
 * ID type notes:
 * - `product` + `lesson` + `file` use Supabase bigint ids.
 * - `order` + `cart` + `subscription` use Supabase UUIDs.
 * - `partner` + `affiliate` use the public_slug (URL-safe, non-PII).
 * - `user` + `session` use the Supabase auth UUID.
 */
// LogSubject is declared below as `z.infer<typeof LogSubjectSchema>`.

/**
 * Request-scoped metadata. `req_id` is auto-populated by
 * `loggerForRequest()` (see `pino.ts`); everything else is per-call.
 *
 * Conventions:
 * - `component` is REQUIRED. It mirrors the existing
 *   `loggerFor({ component: 'cart.addToCart' })` shape so the migration
 *   to `loggerForRequest` is a no-op for `component`.
 * - `surface` is OPTIONAL. Use it when the same component logs from
 *   multiple UI surfaces (e.g. `surface: 'pdp'` for product detail
 *   vs `surface: 'cart'` for cart drawer).
 * - `duration_ms` is OPTIONAL — use for operations you can measure
 *   end-to-end (signed URL mints, webhook handlers, RPC calls).
 */
// LogContext is declared below as `z.infer<typeof LogContextSchema>` —
// the schema's `.passthrough()` lets call sites add their own extras
// (correlation keys, custom metrics, etc.) without breaking the
// runtime contract.

/**
 * The canonical log shape. Every `log.info|warn|error` call should pass
 * an object matching this shape (or at minimum: `{ event, context }`).
 *
 * `actor` and `subject` are optional for events that don't have them
 * (e.g. `error.unhandled` from an unhandled rejection during boot).
 */
// LogEntry is declared below as `z.infer<typeof LogEntrySchema>`.

/**
 * Validate a log entry shape at runtime. Used by tests + by any
 * code path that builds a `LogEntry` from user input (none today, but
 * the helper exists so future call sites can validate cheaply).
 *
 * Returns the entry if valid; throws otherwise. The Zod schema is the
 * canonical contract — the type is derived from it.
 */
import { z } from 'zod'

export const LogActorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), user_id: z.string().uuid() }),
  z.object({ kind: z.literal('admin'), user_id: z.string().uuid(), admin_id: z.string().uuid() }),
  z.object({ kind: z.literal('anon'), ip_hash: z.string().length(64) }),
  z.object({ kind: z.literal('system') }),
])

export const LogSubjectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('product'), product_id: z.number().int().positive() }),
  z.object({ kind: z.literal('product_file'), file_id: z.number().int().positive() }),
  z.object({
    kind: z.literal('lesson'),
    lesson_id: z.number().int().positive(),
    course_id: z.number().int().positive(),
  }),
  z.object({ kind: z.literal('order'), order_id: z.string().uuid() }),
  z.object({ kind: z.literal('cart'), cart_id: z.string().uuid() }),
  z.object({
    kind: z.literal('cart_line'),
    cart_id: z.string().uuid(),
    product_id: z.number().int().positive(),
    license: z.string(),
  }),
  z.object({ kind: z.literal('subscription'), subscription_id: z.string().uuid() }),
  z.object({
    kind: z.literal('refund'),
    refund_id: z.string().uuid(),
    order_id: z.string().uuid(),
  }),
  z.object({
    kind: z.literal('payout'),
    payout_id: z.string().uuid(),
    partner_slug: z.string(),
  }),
  z.object({ kind: z.literal('partner'), partner_slug: z.string() }),
  z.object({ kind: z.literal('affiliate'), affiliate_slug: z.string() }),
  z.object({
    kind: z.literal('review'),
    review_id: z.string().uuid(),
    product_id: z.number().int().positive(),
  }),
  z.object({ kind: z.literal('certificate'), certificate_code: z.string() }),
  z.object({
    kind: z.literal('webhook'),
    provider: z.string(),
    event_id: z.string(),
  }),
  z.object({ kind: z.literal('user'), user_id: z.string().uuid() }),
  z.object({
    kind: z.literal('session'),
    session_id: z.string().uuid(),
    user_id: z.string().uuid(),
  }),
])

export const LogContextSchema = z
  .object({
    req_id: z.string().uuid().optional(),
    component: z.string().min(1),
    surface: z.string().optional(),
    duration_ms: z.number().nonnegative().optional(),
  })
  .passthrough()

export const LogEntrySchema = z.object({
  event: z.enum(LOG_EVENTS),
  actor: LogActorSchema.optional(),
  subject: LogSubjectSchema.optional(),
  context: LogContextSchema,
})

// Re-export the inferred types — these are derived FROM the schemas
// (the schema is the source of truth, not the documentation interfaces
// above). The doc comments stay for context; if you change a shape,
// change the schema. The type will follow.
export type LogActor = z.infer<typeof LogActorSchema>
export type LogSubject = z.infer<typeof LogSubjectSchema>
export type LogContext = z.infer<typeof LogContextSchema>
export type LogEntry = z.infer<typeof LogEntrySchema>