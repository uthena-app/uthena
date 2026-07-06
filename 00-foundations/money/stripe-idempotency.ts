// stripe-idempotency.ts — canonical idempotency-key helper for Stripe.
//
// Stripe accepts an `idempotencyKey` on every write call. Same key +
// same params → Stripe returns the cached response from the first call.
// Same key + different params → Stripe returns 400 (conflict). Different
// key → normal processing.
//
// This helper builds the keys we use. The shape is:
//   `<scope>:<fingerprint>`
// where `<scope>` is a short human-readable string (e.g. `checkout_session`,
// `sub_cancel`) and `<fingerprint>` is a SHA-256 hash of the request
// parts, truncated to fit Stripe's 255-char limit.
//
// Per Stripe docs:
//   https://docs.stripe.com/api/idempotent_requests
// "We recommend using a v4 UUID or similar random string with enough
//  entropy ... For example, if you are creating a charge for a particular
//  customer, using their internal customer ID as the idempotency key
//  ensures the charge is only ever created once."
//
// Our pattern:
//   - For state-changing actions (cancel/resume a subscription), the
//     key is stable per (resource, action) — the same cancel call
//     twice returns the cached first response.
//   - For session-creation actions (checkout, billing portal), the
//     key includes a caller-supplied unique-id (e.g. `order.id`) so
//     each session is created exactly once per DB row.
//   - For "single-shot" actions where retries shouldn't dedupe to the
//     same response (rare — usually there's no retry), pass a per-
//     attempt UUID via `randomSuffix`.

import { createHash } from 'node:crypto'

/**
 * Stripe's documented maximum idempotency-key length.
 * https://docs.stripe.com/api/idempotent_requests
 */
export const STRIPE_IDEMPOTENCY_KEY_MAX_LENGTH = 255

/**
 * Length of the SHA-256 hex prefix we use. 32 hex chars = 128 bits,
 * which is well above Stripe's "enough entropy" recommendation and
 * fits comfortably under the 255-char cap after the scope prefix.
 */
const HASH_PREFIX_LENGTH = 32

/**
 * Build a Stripe idempotency key.
 *
 * @param scope Short stable identifier for the kind of call (e.g.
 *   `'checkout_session'`, `'sub_cancel'`, `'sub_resume'`,
 *   `'sub_session'`, `'billing_portal'`). Becomes the human-readable
 *   prefix; never changes per call.
 * @param parts Deterministic request inputs. Joined with `|` then
 *   hashed so the key length is bounded regardless of input size.
 *   Examples:
 *     - `idempotencyKey('checkout_session', order.id)`
 *     - `idempotencyKey('sub_cancel', sub.id)`
 *     - `idempotencyKey('sub_session', user.id, priceId, bucket)`
 * @param opts.randomSuffix Optional. When set, appended to the hash
 *   input so each call gets a fresh key. Use this only when retries
 *   should NOT dedupe (almost never — every Stripe call site we have
 *   is either stable per resource or per unique DB row).
 * @returns Key of shape `<scope>:<hex>` (or `<scope>:<hex>:<suffix>`).
 *   Total length is at most `STRIPE_IDEMPOTENCY_KEY_MAX_LENGTH`.
 */
export function idempotencyKey(
  scope: string,
  ...parts: Array<string | number | bigint>
): string {
  const raw = parts.map(String).join('|')
  const hash = createHash('sha256').update(raw).digest('hex').slice(0, HASH_PREFIX_LENGTH)
  const base = `${scope}:${hash}`
  return base.length > STRIPE_IDEMPOTENCY_KEY_MAX_LENGTH
    ? base.slice(0, STRIPE_IDEMPOTENCY_KEY_MAX_LENGTH)
    : base
}

/**
 * Convenience for session-creation sites that bucket by time. Same
 * (user, price) within the same bucket returns the same key, which
 * is what you want for "user clicked Subscribe twice quickly."
 *
 * @param bucketSeconds Bucket size in seconds. 30s matches the prompt
 *   the user sees after clicking Pay; longer buckets mean more
 *   retries dedupe to the same response.
 */
export function bucketedIdempotencyKey(
  scope: string,
  bucketSeconds: number,
  ...parts: Array<string | number | bigint>
): string {
  if (bucketSeconds <= 0) {
    throw new Error(`bucketedIdempotencyKey: bucketSeconds must be > 0, got ${bucketSeconds}`)
  }
  const bucket = Math.floor(Date.now() / 1000 / bucketSeconds)
  return idempotencyKey(scope, ...parts, bucket)
}