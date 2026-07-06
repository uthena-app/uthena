// bunny-webhook-signature.ts — HMAC-SHA256 signature verify for the
// Bunny Storage + Bunny Stream webhook bodies. Pure; no 'server-only'
// marker (the handler is server-only but the pure verify can be
// tested in isolation + unit-tested under Node).
//
// Bunny signs each webhook event using HMAC-SHA256:
//   signature = HMAC_SHA256(secret, raw_body)
//   header name = "Signature" (Storage) OR "X-Bunny-Signature"
//                  (Stream — both shapes are accepted for robustness)
//
// The header value may carry the prefix `sha256=` (Stripe-style) or
// be sent as a bare hex digest. Both forms are accepted.
//
// The verify is timing-safe — `crypto.timingSafeEqual` from node:crypto.
// Caller provides the secrets (the route handler reads both
// BUNNY_WEBHOOK_SECRET and BUNNY_VIDEO_WEBHOOK_SECRET). The pure
// function accepts a *list* of candidate secrets — the handler
// tries each because Bunny sometimes rotates secrets out of band and
// a strict "must match new secret" check could lock the webhook out
// during the rotation window.
//
// Returned reason strings are stable + PII-free — they flow into the
// audit log + the response body (handler returns 401 with the reason).

import { createHmac, timingSafeEqual } from 'node:crypto'

/** Headers Bunny actually uses. The Storage webhook sends `Signature`
 *  as a bare hex digest; the Stream webhook uses `X-Bunny-Signature`
 *  and may include the `sha256=` prefix. The Signature header from
 *  Stripe is also `Stripe-Signature`. We accept both shapes for
 *  forward-compat. */
export const BUNNY_WEBHOOK_SIGNATURE_HEADER_NAMES = ['Signature', 'X-Bunny-Signature'] as const

export type BunnySignatureVerifyReason =
  | 'missing_signature' // no recognized header on the request
  | 'malformed_signature' // header present but not valid hex / wrong length
  | 'no_secret_configured' // server has no secret in env (shouldn't happen in prod)
  | 'no_secret_match' // signature did not match any of the candidates
  | 'verified' // SUCCESS — caller treats as authoritative

export type BunnySignatureVerifyResult =
  | { ok: true; reason: 'verified' }
  | { ok: false; reason: Exclude<BunnySignatureVerifyReason, 'verified'> }

/** Read the signature from a Headers object. Handles case-insensitivity
 *  (HTTP headers are case-insensitive; Node's Headers exposes them via
 *  `.get()` which lowercases). Returns null when neither recognized
 *  header is present. */
export function readBunnySignature(headers: Headers): string | null {
  for (const name of BUNNY_WEBHOOK_SIGNATURE_HEADER_NAMES) {
    const value = headers.get(name)
    if (value) return value.trim()
  }
  return null
}

/** Normalize the header value into a bare hex string (no `sha256=`
 *  prefix). Rejects anything that isn't 64 lowercase hex chars. */
export function normalizeBunnySignature(raw: string): string | null {
  const trimmed = raw.trim()
  const withoutPrefix = trimmed.startsWith('sha256=')
    ? trimmed.slice('sha256='.length)
    : trimmed
  // Bunny signs with HMAC-SHA256 — 32 bytes / 64 hex chars.
  if (!/^[0-9a-fA-F]{64}$/.test(withoutPrefix)) return null
  return withoutPrefix.toLowerCase()
}

/** Verify the webhook signature against one or more candidate secrets.
 *  Pure; no env reads (caller provides the secret list). */
export function verifyBunnyWebhookSignature(opts: {
  rawBody: string
  signature: string | null
  secrets: readonly string[]
  /** Test-only — override for HMAC determinism. Defaults to Date.now
   *  (unused; HMAC has no time component). */
  nowMs?: number
}): BunnySignatureVerifyResult {
  if (!opts.signature) return { ok: false, reason: 'missing_signature' }

  const normalized = normalizeBunnySignature(opts.signature)
  if (!normalized) return { ok: false, reason: 'malformed_signature' }

  const signatureBuffer = Buffer.from(normalized, 'hex')
  if (signatureBuffer.length !== 32) {
    return { ok: false, reason: 'malformed_signature' }
  }

  // No candidate secret: the server isn't configured for Bunny
  // webhooks (env empty). Distinct from "signature doesn't match" —
  // the former is a configuration problem, the latter is a forged
  // request.
  if (opts.secrets.length === 0) return { ok: false, reason: 'no_secret_configured' }

  for (const secret of opts.secrets) {
    if (!secret) continue
    const computed = createHmac('sha256', secret).update(opts.rawBody, 'utf8').digest()
    if (
      computed.length === signatureBuffer.length &&
      // timingSafeEqual NEVER throws when lengths differ — guard
      // anyway for clarity.
      timingSafeEqual(computed, signatureBuffer)
    ) {
      return { ok: true, reason: 'verified' }
    }
  }

  return { ok: false, reason: 'no_secret_match' }
}
