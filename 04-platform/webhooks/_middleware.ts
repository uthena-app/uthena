// _middleware.ts — shared helpers for all inbound webhooks in
// 04-platform/webhooks/. Today this is just the Stripe handler; when
// PayPal / Bunny / Resend land they'll share this.
//
// The contract (P3.4 hardening):
//   1. claimWebhookEvent — INSERT a row with result=NULL. The unique
//      constraint on (source, event_id) is the race-safety boundary.
//      Returns { claimed: true, payload } on first call, { claimed: false }
//      on duplicate (the existing event is being processed by another
//      request, or has already been processed — caller should return 200).
//   2. finalizeWebhookEvent — UPDATE the row to set `result` (+ optional
//      `error_message` + `processed_at`). Called by the handler on
//      success (result='processed') or permanent failure (result='failed').
//      This is the "happy path" — the row stays so the support team
//      can audit "did event X arrive? what happened?".
//   3. releaseWebhookEvent — DELETE the row. Called by the handler on
//      TRANSIENT failure (Stripe's 3-day retry window will reprocess).
//      The row disappears so the next attempt starts clean. The
//      processed_at / result columns stay NULL because the row is gone.

import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'webhooks.middleware' })

/** Outcome values for `processed_webhooks.result`. Mirrors the SQL CHECK
 *  constraint in 04-platform/migrations/0001_initial.sql + extended by
 *  0025_processed_webhooks_hardening.sql (result is now nullable). */
export type WebhookOutcome = 'processed' | 'skipped' | 'failed'

export type ClaimResult =
  | { claimed: true; payload: unknown }
  | { claimed: false }

/** Maximum size of the stored `payload` JSONB column, in bytes.
 *  Webhook payloads are typically 1–10 KB; we cap at 64 KB defensively
 *  to bound the row size. Anything larger is replaced with a
 *  truncation marker that carries the event_id + type + original
 *  size so the support team can still correlate the row. The full
 *  payload is logged to pino (with PII redacted by the upstream
 *  logger) for forensic analysis — we just don't store it in the
 *  row. */
const WEBHOOK_MAX_PAYLOAD_BYTES = 64 * 1024

/** Idempotency claim for a webhook event. Inserts into processed_webhooks
 *  and returns whether the event is new (true) or already-processed (false).
 *  When the event is new, the caller processes and then either finalizes
 *  (success/permanent fail) or releases (transient fail). On failure
 *  the caller releases the row so a retry can reprocess.
 *
 *  The unique constraint on (source, event_id) is the race-safety
 *  boundary: two concurrent deliveries of the same event will not both
 *  process (one hits the unique constraint and the call returns
 *  { claimed: false }).
 */
export async function claimWebhookEvent(
  source: 'stripe' | 'paypal' | 'bunny',
  eventId: string,
  eventType: string,
  payload: unknown,
): Promise<ClaimResult> {
  const service = getServiceSupabase()

  // Defensive cap on payload size. Stripe's payment_intent.succeeded
  // payload is ~2 KB; we never need 64 KB. If the payload is larger
  // than the cap, store a truncation marker instead of the body —
  // a half-JSON blob is useless for replay, and slicing mid-string
  // produces invalid JSON. The marker carries the correlation
  // metadata that matters for debugging.
  const safePayload = payload ?? {}
  const payloadJson = JSON.stringify(safePayload)
  const storedPayload =
    payloadJson.length <= WEBHOOK_MAX_PAYLOAD_BYTES
      ? safePayload
      : {
          __uthena_truncated: true,
          event_id: eventId,
          event_type: eventType,
          original_bytes: payloadJson.length,
        }

  const { error } = await service.from('processed_webhooks').insert({
    source,
    event_id: eventId,
    event_type: eventType,
    payload: storedPayload as any,
    // result intentionally omitted — the column is nullable in 0025.
    // The row is finalized via finalizeWebhookEvent() once the handler
    // completes; transient failures release the row via
    // releaseWebhookEvent() instead.
  })
  if (error) {
    if (/duplicate key/i.test(error.message) || error.code === '23505') {
      return { claimed: false }
    }
    log.error(
      { code: 'claim_failed', msg: error.message, source, event_id: eventId },
      'claimWebhookEvent failed',
    )
    throw error
  }
  return { claimed: true, payload }
}

/** Mark a claimed event as completed with its final outcome.
 *  Called by the handler on the happy path (success) or on permanent
 *  failure (the handler decided this event will never succeed, even
 *  with retries — e.g. a permanently-bad signature or a 4xx-class
 *  validation error from the source).
 *
 *  For TRANSIENT failures (Stripe's retry will succeed), call
 *  `releaseWebhookEvent` instead — that DELETEs the row so the
 *  retry starts clean.
 *
 *  The function is idempotent: if the row doesn't exist (already
 *  released, or a race lost), it returns silently. This matters
 *  because the dispatch loop can call finalize after a switch-case
 *  early-return, and we don't want a missing row to 500 the webhook.
 */
export async function finalizeWebhookEvent(
  source: 'stripe' | 'paypal' | 'bunny',
  eventId: string,
  outcome: WebhookOutcome,
  errorMessage?: string,
): Promise<void> {
  const service = getServiceSupabase()
  const update: Record<string, unknown> = {
    result: outcome,
    processed_at: new Date().toISOString(),
  }
  if (errorMessage !== undefined) {
    // Defensive cap: error messages from Stripe can occasionally be
    // long (full request/response dumps). 2 KB is plenty for any
    // human-readable failure reason and bounds the row size.
    update.error_message = errorMessage.slice(0, 2048)
  }
  const { error } = await service
    .from('processed_webhooks')
    .update(update)
    .eq('source', source)
    .eq('event_id', eventId)

  if (error) {
    // Don't 500 the webhook on a finalize error — the event is
    // already processed from the source's perspective. Log and move on.
    // The "no row" case (already released) is the most common; the
    // RLS-denied case shouldn't happen because the service-role client
    // bypasses RLS.
    log.warn(
      {
        code: 'finalize_failed',
        msg: error.message,
        source,
        event_id: eventId,
        outcome,
      },
      'finalizeWebhookEvent failed (event already processed or row missing)',
    )
  }
}

/** Release a claimed event so a retry can reprocess. Used when the
 *  handler throws or returns a transient soft-failure — the row is
 *  removed so the next attempt starts clean. Stripe retries 5xx
 *  responses for up to 3 days; releasing the row ensures the retry
 *  isn't short-circuited by the dedup check.
 *
 *  For PERMANENT failures (the handler decided the event will never
 *  succeed), call `finalizeWebhookEvent(source, id, 'failed', msg)`
 *  instead — that keeps the row in the audit log.
 */
export async function releaseWebhookEvent(
  source: 'stripe' | 'paypal' | 'bunny',
  eventId: string,
): Promise<void> {
  const service = getServiceSupabase()
  const { error } = await service
    .from('processed_webhooks')
    .delete()
    .eq('source', source)
    .eq('event_id', eventId)

  if (error) {
    // Best-effort: if the DELETE fails (e.g. row already gone), the
    // webhook still returns 200 to the source. Stripe's retry would
    // then see the dedup row and 200 again. The audit trail is
    // incomplete for this event, but the next retry will hit a fresh
    // dedup state.
    log.warn(
      { code: 'release_failed', msg: error.message, source, event_id: eventId },
      'releaseWebhookEvent failed (row may already be gone)',
    )
  }
}
