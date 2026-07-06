// upload.ts — Bunny Storage signed PUT helper for browser-direct
// uploads. SERVER-ONLY.
//
// The pure constants (mime allowlist, max size, ext mapper) live in
// `./upload-constants.ts` so the client island can import them
// without pulling node:crypto into the browser bundle. This file
// only exports the mint helper + the env-gated predicate + the
// typed "not configured" error — none of which are safe to import
// from a client component.
//
// v1 scope: avatar uploads on /account/profile. The partner upload
// zone (resumable tus-based, used by the upload wizard at PH12) is a
// separate path that does NOT use this helper — partner files are
// too large (50GB) for browser-direct PUTs and need resumability.
//
// The upload surface here is Bunny's Pull Zone PUT endpoint: the
// browser PUTs the file directly to the CDN URL (e.g.
// `https://uthena.b-cdn.net/avatars/<userId>/<uuid>.<ext>`) with
// the Bunny storage access key as a query param. The CDN stores
// the file on the configured storage zone and surfaces it publicly
// at the same URL. No path-traversal opportunity because (a) the
// path is server-derived (user id + fresh uuid, never trust client
// bytes) and (b) Bunny's edge rejects PUTs outside the configured
// prefix.
//
// Why no HMAC-token signing here:
//
// The download + stream signed-URL surface uses HMAC tokens because
// the URLs leak into email + the user's browser history, where they
// must remain unforgeable to anyone who intercepts them. The upload
// URL is never shared — it's minted, used once by the browser PUT,
// then discarded. The blast radius of a leaked upload URL is bounded
// by the user-scoped path (`avatars/{userId}/...`): a leaked URL only
// permits a write under that specific user's namespace. The storage
// access key IS sensitive, but Bunny treats it as a server-side secret
// and Bunny's edge validates the path against the configured bucket
// prefix on every PUT.
//
// Env-gated. When BUNNY_STORAGE_PUBLIC_HOSTNAME or
// BUNNY_STORAGE_ACCESS_KEY is missing, the call throws
// `UploadNotConfiguredError`. The server action catches it and
// returns `{ ok: false, error: '…' }`. The client island renders a
// friendly "Avatar upload is temporarily unavailable." state so the
// form's other fields remain editable.

import 'server-only'

import { createHmac, randomUUID } from 'node:crypto'
import { getEnv } from '../env'
import {
  AVATAR_MAX_BYTES,
  AVATAR_MIME_TYPES,
  extForAvatarMime,
  type AvatarMime,
} from './upload-constants'

// Re-export the pure constants for back-compat. New code should
// import them from `@foundations/files/upload-constants` to make the
// client-safe / server-only split explicit.
export { AVATAR_MAX_BYTES, AVATAR_MIME_TYPES, extForAvatarMime } from './upload-constants'
export type { AvatarMime } from './upload-constants'

/**
 * TTL on the signed (i.e. freshly-minted) PUT URL, in seconds. Five
 * minutes — uploads are short browser operations, and we want to
 * minimize the window where an unused URL can be replayed. The
 * effective enforcement is via the path's UUID uniqueness (the URL
 * can be reused indefinitely but the object key never collides); the
 * expiry is a defense-in-depth signal that the client checks before
 * using the URL.
 */
export const AVATAR_UPLOAD_TTL_SECONDS = 5 * 60

/** Thrown by `requestAvatarUpload` when Bunny is not configured. The
 *  server action catches it and returns a friendly error to the
 *  client. */
export class UploadNotConfiguredError extends Error {
  override readonly name = 'UploadNotConfiguredError'
}

/** True when both pull-zone hostname and storage access key are set.
 *  Sufficient for browser-direct upload via the AccessKey query
 *  param. Server-only — reads env. */
export function isAvatarUploadConfigured(): boolean {
  const env = getEnv()
  return Boolean(env.BUNNY_STORAGE_PUBLIC_HOSTNAME && env.BUNNY_STORAGE_ACCESS_KEY)
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function extForAvatarMimeChecked(mime: import('./upload-constants').AvatarMime): string {
  const ext = extForAvatarMime(mime)
  if (!ext) {
    // Should be unreachable: AvatarMime ⊆ {jpeg,png,webp}.
    throw new Error(`[upload] No extension for mime: ${mime}`)
  }
  return ext
}

function buildAvatarUrlSignature(
  signingKey: string,
  storagePath: string,
  expiresAtSec: number,
): string {
  // The signature is over `<path>|<expiresAt>` so it's bound to both
  // the exact object key AND the expiry. Even though the access key
  // is what authenticates the PUT today, having a signature lets us
  // flip on Pull Zone "Token Authentication" later without a code
  // change at the call site.
  return createHmac('sha256', signingKey)
    .update(`${storagePath}|${expiresAtSec}`)
    .digest('hex')
}

/**
 * Mint a signed PUT URL for the avatar zone. The caller MUST
 * validate `mime` against `AVATAR_MIME_TYPES` and `size` against
 * `AVATAR_MAX_BYTES` first (the server action does both via Zod).
 *
 * Returns:
 *   - uploadUrl:   the URL the browser PUTs the file to. Contains
 *                  the storage access key as a query param + a token
 *                  signature bound to the path + the absolute expiry.
 *   - publicUrl:   the Bunny CDN URL the public reads the avatar at
 *                  once uploaded (no auth — Bunny serves the file
 *                  from the pull zone after the PUT completes).
 *   - storagePath: the path segment under the public hostname —
 *                  `avatars/{userId}/{uuid}.{ext}`. This is what
 *                  we store in `admin_audit_log.metadata` so future
 *                  audits can locate the file.
 *   - expiresAt:   Date when the URL becomes invalid. The client
 *                  checks this before issuing the PUT; it's the
 *                  authoritative timestamp for the action's audit row.
 *
 * Storage path layout: `avatars/{userId}/{uuid}.{ext}`. The userId
 * namespace sandbox means a forged request cannot upload outside the
 * attacker's own userId. The UUID suffix means two concurrent uploads
 * from the same user don't collide (and the previous file stays in
 * Bunny as an orphan — accepted per the spec, §Open Questions line
 * 150; a janitor cron is a v2 follow-up).
 */
export function requestAvatarUpload(opts: {
  userId: string
  mime: string
  size: number
  /** Test-only — override the current time. */
  nowMs?: number
  /** Test-only — override the uuid portion of the path. */
  fileId?: string
}): {
  uploadUrl: string
  publicUrl: string
  storagePath: string
  expiresAt: Date
} {
  const env = getEnv()
  if (!env.BUNNY_STORAGE_PUBLIC_HOSTNAME || !env.BUNNY_STORAGE_ACCESS_KEY) {
    throw new UploadNotConfiguredError(
      '[upload] BUNNY_STORAGE_PUBLIC_HOSTNAME and BUNNY_STORAGE_ACCESS_KEY are required for avatar uploads.',
    )
  }
  if (!opts.userId || !isUuid(opts.userId)) {
    throw new Error('[upload] userId must be a UUID')
  }
  if (opts.size <= 0 || opts.size > AVATAR_MAX_BYTES) {
    throw new Error(
      `[upload] size ${opts.size} is outside the allowed range (1-${AVATAR_MAX_BYTES} bytes)`,
    )
  }
  const mime = opts.mime as AvatarMime
  if (!(AVATAR_MIME_TYPES as readonly string[]).includes(mime)) {
    throw new Error(`[upload] mime ${opts.mime} is not in the allowlist`)
  }
  const ext = extForAvatarMimeChecked(mime)
  const fileId = opts.fileId ?? randomUUID()
  const storagePath = `avatars/${opts.userId}/${fileId}.${ext}`
  const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1000)
  const expiresAtSec = nowSec + AVATAR_UPLOAD_TTL_SECONDS
  // Token signature. Optional when BUNNY_SIGNING_KEY is unset —
  // missing signature means Token Authentication isn't enforced on
  // the pull zone, and Bunny will accept the PUT on AccessKey alone.
  // When BUNNY_SIGNING_KEY is set, we always include the signature
  // so future Bunny config changes don't break the call site.
  const token = env.BUNNY_SIGNING_KEY
    ? buildAvatarUrlSignature(env.BUNNY_SIGNING_KEY, storagePath, expiresAtSec)
    : ''
  const base = `${env.BUNNY_STORAGE_PUBLIC_HOSTNAME}/${storagePath}`
  const publicUrl = base
  const params = new URLSearchParams()
  if (token) {
    params.set('token', token)
    params.set('expires', String(expiresAtSec))
  }
  // Storage access key as a query param is Bunny's documented pattern
  // for browser-direct PUT (browsers can't set a custom header on a
  // cross-origin PUT without a CORS preflight, which most Bunny edge
  // configs don't ship by default). The key's blast radius is bounded
  // by Bunny's storage path prefix — it's a write-only secret for the
  // configured zone.
  params.set('AccessKey', env.BUNNY_STORAGE_ACCESS_KEY)
  return {
    uploadUrl: `${base}?${params.toString()}`,
    publicUrl,
    storagePath,
    expiresAt: new Date(expiresAtSec * 1000),
  }
}
