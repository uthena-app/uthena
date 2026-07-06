// decryptPayoutMethod.ts — PURE helper that converts the raw
// `partners.payout_method` JSONB column into a typed shape with
// decrypted + masked PII fields. Used by `getMyPartnerProfile` to
// populate `PartnerProfile.payout_method` for the partner settings
// form. Lives in `queries/` (not `lib/`) because it's a data-layer
// concern: the JSONB column is the source, the typed shape is the
// consumer-facing API.
//
// Handles three shapes transparently (P6.5 Slice 1 — encryption
// rollout):
//   1. New encrypted envelope (matches the strict 3-segment base64url
//      regex from `encryption.ts`) → decrypt → mask → typed fields.
//   2. Legacy plaintext `{ paypal_email: 'alice@example.com' }` (the
//      pre-P6.5 shape that was being written directly) → pass through
//      as-is → mask → typed fields. STUB-052 covers the one-off
//      backfill that re-encrypts these rows; until then they keep
//      rendering correctly via the pass-through path.
//   3. Null / empty / non-object / unrecognized shape → all-null
//      typed fields. Never throws on a malformed row.
//
// `decryptStringOrPassThrough` is intentionally lenient (best-effort)
// for the read path: a corrupted envelope returns null instead of
// breaking the page. The write path is the strict path — `encryptString`
// throws on misconfiguration, so writes can never silently store an
// invalid envelope.

import 'server-only'

import { loggerFor } from '@foundations/log/pino'
import {
  decryptStringOrPassThrough,
  isEncryptedEnvelope,
} from '@foundations/security/encryption'
import { maskEmail } from '../format'

const log = loggerFor({ component: 'partner.payout_method' })

/**
 * Typed shape of the partner's payout method after decryption +
 * masking. The form reads `paypal_email` for the input value and
 * `paypal_email_masked` for the read-only display. `payout_method_kind`
 * is the discriminator Slice 2 will use to add bank-account support.
 */
export type PartnerPayoutMethod = {
  /** Plaintext PayPal email (for the form's input value). `null`
   *  when the partner hasn't set one OR the stored value can't be
   *  decrypted. */
  paypal_email: string | null
  /** Masked PayPal email for read-only display (e.g. `k***@example.com`).
   *  `null` when there's no email to mask. */
  paypal_email_masked: string | null
  /** Discriminator — `'paypal'` when a PayPal email is set, `null`
   *  otherwise. Slice 2 will add `'bank'` to this union. */
  payout_method_kind: 'paypal' | null
}

const EMPTY_PAYOUT_METHOD: PartnerPayoutMethod = {
  paypal_email: null,
  paypal_email_masked: null,
  payout_method_kind: null,
}

/**
 * Convert a raw `payout_method` JSONB value (the column is
 * `jsonb`, so the input can be any JSON-decoded shape — typically
 * `Record<string, unknown> | null` but PostgREST sometimes returns
 * arrays or scalars for malformed rows) into a typed
 * `PartnerPayoutMethod`.
 *
 * Defensive contract:
 *   - Never throws (a malformed envelope is logged + treated as
 *     "no payout method").
 *   - Never returns the encrypted envelope in plaintext (the
 *     `_masked` field is the only client-shipped surface for
 *     read-only display).
 *   - PII-safe logging: logs the corrupted envelope's prefix (first
 *     8 chars) so an admin can grep for it, but never the full
 *     ciphertext.
 */
export function decryptPayoutMethod(raw: unknown): PartnerPayoutMethod {
  if (raw === null || raw === undefined) return EMPTY_PAYOUT_METHOD
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    log.warn(
      { shape: Array.isArray(raw) ? 'array' : typeof raw },
      'payout_method JSONB is not an object — returning empty',
    )
    return EMPTY_PAYOUT_METHOD
  }

  const obj = raw as Record<string, unknown>

  // 1. New encrypted envelope shape: { paypal_email_encrypted: '<envelope>' }
  const encrypted = obj.paypal_email_encrypted
  if (typeof encrypted === 'string' && isEncryptedEnvelope(encrypted)) {
    const decrypted = decryptStringOrPassThrough(encrypted)
    if (decrypted) {
      return {
        paypal_email: decrypted,
        paypal_email_masked: maskEmail(decrypted),
        payout_method_kind: 'paypal',
      }
    }
    // Corrupted envelope — log + fall through to nulls.
    log.warn(
      { envelope_prefix: encrypted.slice(0, 8) },
      'payout_method envelope is corrupted — returning empty',
    )
    return EMPTY_PAYOUT_METHOD
  }
  // paypal_email_encrypted present but malformed (not a string,
  // not an envelope shape) — log + fall through. The legacy
  // plaintext branch below would still try, but if both
  // paypal_email_encrypted AND paypal_email are set we treat
  // encrypted as authoritative.
  if (typeof encrypted === 'string' && encrypted !== '') {
    log.warn(
      { envelope_prefix: encrypted.slice(0, 8) },
      'paypal_email_encrypted present but not a valid envelope shape',
    )
    return EMPTY_PAYOUT_METHOD
  }

  // 2. Legacy plaintext shape: { paypal_email: 'alice@example.com' }
  // Trimming is intentional here: pre-P6.5 the form didn't trim
  // before writing, so legacy rows may have leading/trailing
  // whitespace. The encrypted branch doesn't need it (encryption
  // is byte-perfect), but the plaintext branch is defensive.
  const plaintextRaw = obj.paypal_email
  if (typeof plaintextRaw === 'string' && plaintextRaw.trim() !== '') {
    const plaintext = plaintextRaw.trim()
    return {
      paypal_email: plaintext,
      paypal_email_masked: maskEmail(plaintext),
      payout_method_kind: 'paypal',
    }
  }

  // 3. Empty / null / unknown shape → all-nulls.
  return EMPTY_PAYOUT_METHOD
}
