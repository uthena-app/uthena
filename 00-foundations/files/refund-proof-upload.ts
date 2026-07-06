// refund-proof-upload.ts — Bunny Storage signed PUT helper for the
// user-initiated refund-proof upload on
// `/account/orders/[id]/refund`. SERVER-ONLY.
//
// The pure constants (mime allowlist, max size, ext mapper,
// filename sanitizer) live in `./refund-proof-upload-constants.ts`
// so the client island can import them without pulling
// `node:crypto` into the browser bundle. This file only exports
// the mint helper + the env-gated predicate — neither is safe to
// import from a client component.
//
// v1 scope: refund-proof uploads for the user-side refund form
// (P9.12). The mint surface mirrors the avatar upload (P9.2) but
// the storage path prefix differs (`refund-proofs/` vs `avatars/`)
// and the cap is larger (10 MiB vs 5 MiB) per spec.
//
// Env-gated. When BUNNY_STORAGE_PUBLIC_HOSTNAME or
// BUNNY_STORAGE_ACCESS_KEY is missing, the call throws
// `UploadNotConfiguredError`. The server action catches it and
// returns `{ ok: false, error: '…' }`. The client island renders a
// friendly "Proof upload is temporarily unavailable." state so the
// form's other fields remain editable — the proof is optional per
// the spec, so the form must still submittable without it.

import 'server-only'

import { createHmac, randomUUID } from 'node:crypto'
import { getEnv } from '../env'
import {
  REFUND_PROOF_MAX_BYTES,
  REFUND_PROOF_MIME_TYPES,
  REFUND_PROOF_PATH_PREFIX,
  extForRefundProofMime,
  type RefundProofMime,
} from './refund-proof-upload-constants'

// Re-export the pure constants for back-compat. New code should
// import them from `@foundations/files/refund-proof-upload-constants`
// to make the client-safe / server-only split explicit.
export {
  REFUND_PROOF_MAX_BYTES,
  REFUND_PROOF_MIME_TYPES,
  REFUND_PROOF_PATH_PREFIX,
  extForRefundProofMime,
  sanitizeRefundProofFilename,
} from './refund-proof-upload-constants'
export type { RefundProofMime } from './refund-proof-upload-constants'

// Reuse the avatar surface's `UploadNotConfiguredError` — same
// shape, same env gate, same friendly error message on the client.
// The error class is the contract; the action's `instanceof` check
// is the safety net.
import { UploadNotConfiguredError } from './upload'
export { UploadNotConfiguredError }

/**
 * TTL on the signed (i.e. freshly-minted) PUT URL, in seconds. Five
 * minutes — uploads are short browser operations, and we want to
 * minimize the window where an unused URL can be replayed. Matches
 * the avatar surface (P9.2) — same blast-radius analysis applies.
 */
export const REFUND_PROOF_UPLOAD_TTL_SECONDS = 5 * 60

/**
 * True when both pull-zone hostname and storage access key are set.
 * Sufficient for browser-direct upload via the AccessKey query
 * param. Server-only — reads env.
 */
export function isRefundProofUploadConfigured(): boolean {
  const env = getEnv()
  return Boolean(env.BUNNY_STORAGE_PUBLIC_HOSTNAME && env.BUNNY_STORAGE_ACCESS_KEY)
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function extForRefundProofMimeChecked(
  mime: import('./refund-proof-upload-constants').RefundProofMime,
): string {
  const ext = extForRefundProofMime(mime)
  if (!ext) {
    // Should be unreachable: RefundProofMime ⊆ {jpeg, png, pdf}.
    throw new Error(`[refund-proof-upload] No extension for mime: ${mime}`)
  }
  return ext
}

function buildProofUrlSignature(
  signingKey: string,
  storagePath: string,
  expiresAtSec: number,
): string {
  // Same signature shape as the avatar surface — over
  // `<path>|<expiresAt>`. Lets us flip on Pull Zone "Token
  // Authentication" later without a call-site change.
  return createHmac('sha256', signingKey)
    .update(`${storagePath}|${expiresAtSec}`)
    .digest('hex')
}

/**
 * Mint a signed PUT URL for the refund-proof zone. The caller MUST
 * validate `mime` against `REFUND_PROOF_MIME_TYPES` and `size`
 * against `REFUND_PROOF_MAX_BYTES` first (the server action does
 * both via Zod).
 *
 * Returns:
 *   - uploadUrl:   the URL the browser PUTs the file to. Contains
 *                  the storage access key as a query param + a
 *                  token signature bound to the path + the absolute
 *                  expiry.
 *   - storagePath: the path segment under the public hostname —
 *                  `refund-proofs/{userId}/{uuid}.{ext}`. This is
 *                  what we store in `refunds.proof_path` so future
 *                  admins can locate the file (via a signed-URL
 *                  download helper that runs the same prefix check).
 *   - expiresAt:   Date when the URL becomes invalid. The client
 *                  checks this before issuing the PUT; it's the
 *                  authoritative timestamp for the action's audit row.
 *
 * Storage path layout: `refund-proofs/{userId}/{uuid}.{ext}`. The
 * userId namespace sandbox means a forged request cannot upload
 * outside the attacker's own userId. The UUID suffix means two
 * concurrent uploads from the same user don't collide (and the
 * previous file stays in Bunny as an orphan — accepted per the
 * avatar pattern; a janitor cron is a v2 follow-up).
 *
 * Notable differences from the avatar surface:
 *   - Storage path prefix: `refund-proofs/` (not `avatars/`).
 *   - The userId IS part of the path (same as avatars) — admins
 *     see refunds in a "by user" hierarchy that's already implicit
 *     in the refunds table itself.
 *   - No `publicUrl` is returned: refund proofs are PRIVATE (the
 *     spec explicitly calls this out — admins view them via a
 *     signed URL generated by the admin app, logged to
 *     `file_downloads` with `target='refund_proof'`). The action
 *     returns only the `uploadUrl` and `storagePath`; the client
 *     never needs a public read URL.
 */
export function requestRefundProofUpload(opts: {
  userId: string
  mime: string
  size: number
  /** Test-only — override the current time. */
  nowMs?: number
  /** Test-only — override the uuid portion of the path. */
  fileId?: string
}): {
  uploadUrl: string
  storagePath: string
  expiresAt: Date
} {
  const env = getEnv()
  if (!env.BUNNY_STORAGE_PUBLIC_HOSTNAME || !env.BUNNY_STORAGE_ACCESS_KEY) {
    throw new UploadNotConfiguredError(
      '[refund-proof-upload] BUNNY_STORAGE_PUBLIC_HOSTNAME and BUNNY_STORAGE_ACCESS_KEY are required for refund-proof uploads.',
    )
  }
  if (!opts.userId || !isUuid(opts.userId)) {
    throw new Error('[refund-proof-upload] userId must be a UUID')
  }
  if (opts.size <= 0 || opts.size > REFUND_PROOF_MAX_BYTES) {
    throw new Error(
      `[refund-proof-upload] size ${opts.size} is outside the allowed range (1-${REFUND_PROOF_MAX_BYTES} bytes)`,
    )
  }
  const mime = opts.mime as RefundProofMime
  if (!(REFUND_PROOF_MIME_TYPES as readonly string[]).includes(mime)) {
    throw new Error(`[refund-proof-upload] mime ${opts.mime} is not in the allowlist`)
  }
  const ext = extForRefundProofMimeChecked(mime)
  const fileId = opts.fileId ?? randomUUID()
  const storagePath = `${REFUND_PROOF_PATH_PREFIX}/${opts.userId}/${fileId}.${ext}`
  const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1000)
  const expiresAtSec = nowSec + REFUND_PROOF_UPLOAD_TTL_SECONDS
  const token = env.BUNNY_SIGNING_KEY
    ? buildProofUrlSignature(env.BUNNY_SIGNING_KEY, storagePath, expiresAtSec)
    : ''
  const base = `${env.BUNNY_STORAGE_PUBLIC_HOSTNAME}/${storagePath}`
  const params = new URLSearchParams()
  if (token) {
    params.set('token', token)
    params.set('expires', String(expiresAtSec))
  }
  params.set('AccessKey', env.BUNNY_STORAGE_ACCESS_KEY)
  return {
    uploadUrl: `${base}?${params.toString()}`,
    storagePath,
    expiresAt: new Date(expiresAtSec * 1000),
  }
}