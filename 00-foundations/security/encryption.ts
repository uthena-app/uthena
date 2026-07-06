// Symmetric encryption for partner PII (PayPal email, tax id, future
// bank details). Single source of truth for the AES-256-GCM envelope
// shape + key handling. Server-only — never imported from a client
// component (the key would leak via the bundle).
//
// Algorithm: AES-256-GCM (Node's `crypto.createCipheriv`).
// - 256-bit key from `PARTNER_PAYOUT_ENCRYPTION_KEY` (base64-encoded).
// - 12-byte random IV per encryption (NIST SP 800-38D §8.2 recommendation).
// - 16-byte auth tag (the GCM default).
//
// Envelope shape (URL-safe, no JSON, no JSON-escape gotchas):
//
//   <iv_b64url>.<tag_b64url>.<ciphertext_b64url>
//
// Three dot-separated base64url segments. The first segment is exactly
// 16 base64url chars (12 bytes), the second is exactly 22 base64url
// chars (16 bytes). The third segment is variable length. Pure-string
// format — no JSON parse cost, no JSON-escape issues with arbitrary
// characters in the plaintext, no version negotiation needed (the
// shape itself is versioned by its 3-segment length). Future
// migrations to a different algorithm or envelope would write a new
// helper rather than reusing this one.
//
// Detection helper (`isEncryptedEnvelope`) is strict on segment
// lengths so we can distinguish an encrypted envelope from a
// legitimate plaintext email string that happens to contain dots.
// This matters because pre-P6.5 partner rows stored PayPal email
// as PLAINTEXT (`{ paypal_email: 'alice@example.com' }`). The
// `decryptStringOrPassThrough` helper handles both shapes
// transparently during the rollout — old rows continue to render,
// new writes overwrite plaintext with the encrypted envelope. A
// future backfill job (STUB-052) re-encrypts the legacy rows in
// place.
//
// Key handling:
// - Production (`NODE_ENV=production`): throws if
//   `PARTNER_PAYOUT_ENCRYPTION_KEY` is missing OR not a valid
//   base64-encoded 32-byte key. Fail-closed — never silently write
//   plaintext because the env was misconfigured.
// - Dev / test: derives a deterministic key from `AUTH_SECRET` (the
//   auth secret is required by env validation, so this is always
//   available). Dev data is ephemeral; the symmetric dev key is
//   NOT a security boundary in dev.
//
// Cross-references:
// - Spec: 01-specs/pages/partner-settings.md §"Security" + §"PII
//   encryption approach" open question.
// - First consumer: 02-features/partner-portal/actions/updatePartnerSettings.ts
//   (encrypts `paypal_email` before writing `partners.payout_method`).
// - Migration of legacy plaintext rows: STUB-052.

import 'server-only'

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'
import { getEnv } from '@foundations/env'

const ALGO = 'aes-256-gcm' as const
const IV_BYTES = 12 // 96-bit IV per NIST SP 800-38D §8.2.1
const TAG_BYTES = 16 // 128-bit auth tag (GCM default, max strength)
const KEY_BYTES = 32 // 256-bit key

/** Strict regex: 3 dot-separated base64url segments, exact segment
 *  lengths for the fixed-size parts. Defensive against "is this
 *  plaintext or encrypted?" ambiguity — a normal email address
 *  won't match (it has 0 or 1 dots, not 2 with base64url chars). */
const ENVELOPE_RE = /^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]*$/

/** Production-only guard. Throws if NODE_ENV=production and the key
 *  is missing/invalid. Returns the 32-byte Buffer in dev/test. */
function getEncryptionKey(): Buffer {
  const env = getEnv()
  const raw = (env.PARTNER_PAYOUT_ENCRYPTION_KEY ?? '').trim()

  if (raw) {
    let key: Buffer
    try {
      key = Buffer.from(raw, 'base64')
    } catch {
      throw new Error('[encryption] PARTNER_PAYOUT_ENCRYPTION_KEY is not valid base64')
    }
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `[encryption] PARTNER_PAYOUT_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}). Generate one with: \`openssl rand -base64 32\``,
      )
    }
    return key
  }

  // No key in env. Fail-closed in production.
  if (env.NODE_ENV === 'production') {
    throw new Error(
      '[encryption] PARTNER_PAYOUT_ENCRYPTION_KEY is required in production. Generate one with: `openssl rand -base64 32` and wire it via Doppler / Coolify env.',
    )
  }

  // Dev / test fallback: derive a deterministic 32-byte key from
  // AUTH_SECRET (always present — env validation requires it). NOT a
  // security boundary in dev (dev data is ephemeral). Deterministic
  // so test snapshots are stable across runs.
  return createHash('sha256').update(`uthena-encryption-dev:${env.AUTH_SECRET}`).digest()
}

/**
 * Encrypt a UTF-8 string with the partner-PII key. Returns the
 * `<iv>.<tag>.<ciphertext>` envelope.
 *
 * Throws if the key is missing in production, the key is malformed,
 * or the runtime crypto primitive fails. Never throws on a normal
 * plaintext input — emails, tax IDs, routing numbers all encrypt
 * cleanly.
 */
export function encryptString(plaintext: string): string {
  if (typeof plaintext !== 'string') {
    throw new TypeError(`[encryption] plaintext must be a string, got ${typeof plaintext}`)
  }
  const key = getEncryptionKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_BYTES })
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`
}

/**
 * Decrypt an envelope produced by `encryptString`. Returns the
 * original UTF-8 string.
 *
 * Throws if:
 * - The envelope is not a string
 * - The envelope doesn't match the strict 3-segment base64url shape
 * - The auth tag verification fails (tampered ciphertext, wrong key,
 *   IV rotated, etc.)
 *
 * Always throws — never returns a best-effort guess. Callers that
 * want graceful fallback (e.g. legacy plaintext rows during the
 * rollout) should use `decryptStringOrPassThrough` instead.
 */
export function decryptString(envelope: string): string {
  if (typeof envelope !== 'string') {
    throw new TypeError(`[encryption] envelope must be a string, got ${typeof envelope}`)
  }
  if (!ENVELOPE_RE.test(envelope)) {
    throw new Error('[encryption] envelope does not match the expected `<iv>.<tag>.<ct>` shape')
  }
  const [iv_b64, tag_b64, ct_b64] = envelope.split('.')
  // Empty plaintext encrypts to an empty ciphertext segment — valid
  // by the regex (now `*`-terminated) but produces an empty string
  // from `.split('.')` for ct. Allow it.
  if (!iv_b64 || !tag_b64) {
    throw new Error('[encryption] envelope is missing one of the three required segments')
  }
  const key = getEncryptionKey()
  const iv = Buffer.from(iv_b64, 'base64url')
  const tag = Buffer.from(tag_b64, 'base64url')
  const ciphertext = Buffer.from(ct_b64 ?? '', 'base64url')
  const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_BYTES })
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plaintext.toString('utf8')
}

/**
 * Pure detection: returns true iff `value` matches the strict
 * encrypted-envelope shape. Used by read paths to decide whether
 * to attempt decryption or pass the value through as plaintext.
 *
 * Defensive: returns false for non-strings, empty strings, and
 * any value that doesn't pass the 3-segment base64url regex. The
 * regex is intentionally strict on the fixed-length segments so
 * real plaintext emails (which have at most one dot) never
 * match.
 */
export function isEncryptedEnvelope(value: unknown): value is string {
  return typeof value === 'string' && ENVELOPE_RE.test(value)
}

/**
 * Defensive read helper. Handles three input shapes during the
 * STUB-052 plaintext→encrypted rollout:
 *
 *   1. Encrypted envelope (regex match) → returns the decrypted
 *      plaintext.
 *   2. Plaintext string (legacy or never-encrypted) → returns the
 *      string as-is. No decryption attempted.
 *   3. Anything else (null, undefined, number, object, empty
 *      string) → returns null.
 *
 * Does NOT throw. The decrypt path is best-effort — a corrupted
 * envelope falls through to null rather than breaking the page
 * (a corrupted envelope is an admin-debug situation, not a
 * user-facing failure).
 */
export function decryptStringOrPassThrough(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null
  if (!isEncryptedEnvelope(value)) return value
  try {
    return decryptString(value)
  } catch {
    return null
  }
}