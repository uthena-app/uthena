// Bunny.net — file storage + signing surface. The signed-URL helpers
// live in `./signed-url` (this file re-exports them for back-compat
// with the older `@foundations/files/bunny` import path). The upload
// flow (tus, scan, encode) ships in Phase 12.
//
// New code should import from `@foundations/files/signed-url` directly.

export {
  isBunnyConfigured,
  getPublicCdnUrl,
  signCdnUrl,
  verifyCdnUrl,
  SIGNED_URL_TTL_SECONDS,
  SIGNED_URL_LIMIT_PER_HOUR,
  HOUR_MS,
} from './signed-url'

export type { SignedUrlKind } from './signed-url'
