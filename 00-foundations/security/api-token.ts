// 00-foundations/security/api-token.ts — HMAC-SHA256 hashing helper
// for partner API tokens at rest.
//
// P12.19 ships the partner-facing `/partner/settings/api` page. The
// `api_tokens` table stores only the hash (per `_data-model.md` line
// 1003 + the Open Q §"Token hashing approach" Option B choice: HMAC
// with a server pepper). Plaintext is shown to the user EXACTLY ONCE
// on creation and never persisted anywhere.
//
// Why HMAC-SHA256 + env pepper (Option B):
//   - Plain SHA-256 is fast and dictionary-attackable (a DB leak
//     exposes hashes an attacker can brute-force offline if a
//     plaintext wordlist matches the prefix `uth_pat_`).
//   - Per-token salts defeat rainbow tables but a DB leak still gives
//     salts+hashes; per-row brute-force is still possible.
//   - HMAC with a server pepper means the DB never has enough info to
//     brute-force any single token — the attacker needs the env too.
//     Trade-off: rotating the pepper invalidates every token; that's
//     acceptable in v1 (few partners).
//
// Why a separate module from `encryption.ts`: encryption.ts is the
// AES-256-GCM envelope for partner PII (PayPal email, bank, tax_id).
// Hashing is a different primitive (one-way, deterministic). Two
// different concerns; two different keys (`UTHENA_API_TOKEN_PEPPER`
// vs `PARTNER_PAYOUT_ENCRYPTION_KEY`).
//
// Failure mode: if `UTHENA_API_TOKEN_PEPPER` is empty (dev/test only),
// the helper falls back to plain SHA-256 so local development works.
// The `hashApiToken` function NEVER throws — it returns a hex string
// deterministically. Plaintext is the responsibility of the caller.

import { createHmac, randomBytes } from 'crypto'
import { getEnv } from '../env'

/** Plaintext token prefix the user sees. The token string starts with
 *  this prefix so the user can recognize "this is a Uthena partner
 *  token". Per the spec at `01-specs/pages/partner-settings-api.md`
 *  line 71: "Token format: 32 random bytes, base64url-encoded, with a
 *  prefix `uth_pat_` (Partner Access Token); final length ~43 chars". */
export const API_TOKEN_PLAINTEXT_PREFIX = 'uth_pat_'

/** Display prefix length — the first N characters of the plaintext
 *  (after the `uth_pat_` prefix) that we show in the UI so the user
 *  can recognize "which token is this in my other tools". The spec
 *  says 8 chars + `***` at line 73 (the rendered UI string). */
export const API_TOKEN_DISPLAY_PREFIX_CHARS = 8

/**
 * Generate a new partner API token plaintext. Returns the full string
 * (prefix + 32 base64url-encoded bytes = ~43 chars total). NEVER log
 * the return value; pass it to the create action's response body only.
 *
 * Uses `crypto.randomBytes(32)` — 256 bits of entropy. Unguessable.
 *
 * PII-safety: this is the ONE function in the codebase whose return
 * value MUST NEVER appear in a log, an audit row, a cookie, a query
 * param, or any other persisted state. It is the user's secret.
 */
export function generateApiTokenPlaintext(): string {
  // 32 bytes -> base64url encoding -> ~43 chars. base64url alphabet is
  // [A-Za-z0-9_-] so the token URL-safe and copy-paste-friendly.
  const random = randomBytes(32).toString('base64url')
  return `${API_TOKEN_PLAINTEXT_PREFIX}${random}`
}

/**
 * Build the displayable token prefix shown in the UI (e.g.
 * `uth_pat_a1b2c3d4***`). Returns null if the plaintext is malformed
 * (defensive — caller can fall back to "untitled" copy).
 *
 * The rendered string never contains the secret portion of the token.
 * Only the first 8 base64url chars after the prefix are exposed (per
 * the spec line 73 "Token format" + line 12 `token_prefix` column).
 */
export function buildApiTokenDisplayPrefix(plaintext: string): string | null {
  if (typeof plaintext !== 'string') return null
  if (!plaintext.startsWith(API_TOKEN_PLAINTEXT_PREFIX)) return null
  const rest = plaintext.slice(API_TOKEN_PLAINTEXT_PREFIX.length)
  if (rest.length < API_TOKEN_DISPLAY_PREFIX_CHARS) return null
  return `${API_TOKEN_PLAINTEXT_PREFIX}${rest.slice(0, API_TOKEN_DISPLAY_PREFIX_CHARS)}***`
}

/**
 * Hash a plaintext token for storage. HMAC-SHA256(pepper, plaintext).
 *
 * Returns the lowercase hex-encoded hash (64 chars for SHA-256). The
 * DB column `api_tokens.token_hash` is `text unique`; the hash is the
 * lookup key for API request authentication.
 *
 * Falls back to plain SHA-256 (no pepper) when `UTHENA_API_TOKEN_PEPPER`
 * is empty so dev/test still works. The `isApiTokenPepperConfigured()`
 * helper exposes the gate so a production deploy can verify the env is
 * wired before serving traffic.
 *
 * Never throws. Same input → same output (deterministic).
 */
export function hashApiToken(plaintext: string): string {
  const pepper = getEnv().UTHENA_API_TOKEN_PEPPER
  if (typeof plaintext !== 'string' || plaintext === '') {
    // Defensive: caller bug. Return a 64-char placeholder so the DB
    // unique-index constraint still gets a valid hex string. The
    // plaintext was never going to authenticate anyway.
    return '0'.repeat(64)
  }
  if (pepper) {
    return createHmac('sha256', pepper).update(plaintext, 'utf8').digest('hex')
  }
  // Fallback for dev/test only — see module header.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('crypto') as typeof import('crypto')
  return crypto.createHash('sha256').update(plaintext, 'utf8').digest('hex')
}

/**
 * Is the API token pepper configured? Used by ops + boot smoke to
 * confirm the production posture. Mirrors the `isAvatarUploadConfigured()`
 * pattern in `00-foundations/files/upload.ts`.
 */
export function isApiTokenPepperConfigured(): boolean {
  return getEnv().UTHENA_API_TOKEN_PEPPER !== ''
}