// upload-constants.ts — pure constants + tiny pure helpers for the
// avatar upload surface. Safe to import from both client (browser
// bundle) and server (server action) code; NEVER imports node:crypto
// or any server-only module.
//
// The `requestAvatarUpload` mint helper (which uses node:crypto)
// lives in `./upload.ts` and is server-only. Splitting the
// constants out lets the client island validate mime + size without
// pulling `node:crypto` into the browser bundle.

/** Max avatar upload size in bytes (5 MB). Server-enforced. */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024

/**
 * Mime allowlist for avatar uploads. Matches the spec
 * (`01-specs/pages/account-profile.md` §Security line 104).
 */
export const AVATAR_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export type AvatarMime = (typeof AVATAR_MIME_TYPES)[number]

/**
 * Map a mime type to a safe file extension. Unknown mimes return
 * null — the caller should reject them via `AVATAR_MIME_TYPES`
 * before reaching here. The returned extension is the on-disk
 * extension Bunny will serve; we keep it minimal (jpg, png, webp —
 * no `.jpeg` dance, no exotic `.jfif` variants).
 */
export function extForAvatarMime(mime: string): string | null {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    default:
      return null
  }
}
