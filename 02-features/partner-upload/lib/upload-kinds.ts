// upload-kinds.ts — the per-kind mime allowlists + size caps for the
// partner upload wizard (P12.8 Slice 1; P12.7 Slice 3 consumes them).
//
// Three upload zones the spec carves out at
// `01-specs/pages/instructor-upload.md` line 18-22 + 41-43 + 84:
//   - `video`         — Bunny Stream (tus + post-upload HLS). MP4 + MOV
//                       (the only two formats Bunny Stream reliably
//                       transcodes per docs.bunny.net/docs/stream).
//                       50 GB hard cap (spec line 86).
//   - `source`        — Bunny Storage PUT. PDF / PPTX / DOCX / ZIP.
//                       Smaller cap (2 GB; source files compress +
//                       package everything clients need, they shouldn't
//                       be large).
//   - `sales_material`— Bunny Storage PUT. Marketing swipes, email
//                       templates, lead magnets. PDF / ZIP / JPEG / PNG.
//                       Tightest cap (200 MB; sales assets are static
//                       marketing collateral, not deliverable content).
//
// Caps are constants exported alongside the allowlists so the same
// numbers flow through:
//   - createPartnerFileUpload Zod schema (server-side hard cap)
//   - the P12.7 Slice 3 Files UI (client-side pre-upload preview)
//   - the spec rationale (the constant IS the rationale, in code).
//
// Pure module — safe to import from anywhere (RSC, client island, server
// action, webhook handler). NEVER 'server-only'.

import type { UploadKind } from '@foundations/data/enums'

// ---------------------------------------------------------------------------
// Per-kind mime allowlist — exhaustive tuple of accept strings used by
// the <input type="file" accept="..."> attribute on the dropzones.
// ---------------------------------------------------------------------------
export const UPLOAD_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/quicktime', // .mov
] as const

export const UPLOAD_SOURCE_MIME_TYPES = [
  'application/pdf',
  // PPTX
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // DOCX
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip',
  'application/x-zip-compressed',
] as const

export const UPLOAD_SALES_MATERIAL_MIME_TYPES = [
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'image/jpeg',
  'image/png',
] as const

// ---------------------------------------------------------------------------
// Per-kind size caps. The 50 GB course-wide cap (`spec §instructor-upload.md`
// line 86) is a HARD LIMIT but it lives on the
// partner-upload-drafts.payload aggregate, not on individual files —
// P12.8 Slice 1 enforces only the per-file caps. The aggregate cap
// is enforced at P12.7 Slice 5 (submit-for-review) where the wizard
// sums every `partner_uploads.size_bytes` for the draft.
// ---------------------------------------------------------------------------
/** 50 GB — video uploads (Bunny Stream tus). The spec's hard per-course
 *  cap is also 50 GB (line 86); for v1 we treat them as the same
 *  ceiling (one video per course is the common case). */
export const UPLOAD_VIDEO_MAX_BYTES = 50 * 1024 * 1024 * 1024
/** 2 GB — source files (PDFs, ZIPs, slide decks). Source assets compress
 *  and bundle everything; >2 GB usually means the source should be a
 *  video instead. */
export const UPLOAD_SOURCE_MAX_BYTES = 2 * 1024 * 1024 * 1024
/** 200 MB — sales materials (PDF swipes, lead magnets, marketing
 *  assets). Static collateral; should never approach the source cap. */
export const UPLOAD_SALES_MATERIAL_MAX_BYTES = 200 * 1024 * 1024

// ---------------------------------------------------------------------------
// Filename sanitization. The partner's filename flows into
// storage_path + the partner's audit log + the product_files row on
// attach — three places where a malicious extension could cause
// trouble. Server-side sanitizer is the single source of truth.
// ---------------------------------------------------------------------------
/** Maximum filename length (preserved in product_files.original_filename
 *  + the storage path). 200 chars balances real-world filenames ("Q4
 *  2026 PLR Lead Magnet — Final (v3) (do-not-redistribute).pdf") against
 *  path-length sanity (Bunny paths are 1024-char safe). */
export const UPLOAD_FILENAME_MAX_LENGTH = 200

/** Per-kind cap lookup. Pure — returns the constant for the kind,
 *  undefined for unknown kinds (callers fall back to zero / reject). */
export function maxBytesForUploadKind(kind: UploadKind): number {
  switch (kind) {
    case 'video':
      return UPLOAD_VIDEO_MAX_BYTES
    case 'source':
      return UPLOAD_SOURCE_MAX_BYTES
    case 'sales_material':
      return UPLOAD_SALES_MATERIAL_MAX_BYTES
    default: {
      // Exhaustiveness check — TS errors if a new UploadKind is added
      // without an entry here.
      const _exhaustive: never = kind
      void _exhaustive
      return 0
    }
  }
}

/** Per-kind mime allowlist lookup. Pure tuple — order matters because
 *  the UI renders `<input accept="...">` with the first-acceptable type
 *  first (browsers prefer the first match in some patterns). */
export function allowedMimesForUploadKind(kind: UploadKind): readonly string[] {
  switch (kind) {
    case 'video':
      return UPLOAD_VIDEO_MIME_TYPES
    case 'source':
      return UPLOAD_SOURCE_MIME_TYPES
    case 'sales_material':
      return UPLOAD_SALES_MATERIAL_MIME_TYPES
    default: {
      const _exhaustive: never = kind
      void _exhaustive
      return []
    }
  }
}

/** True when the (kind, mime) pair is in the allowlist. Defensive:
 *  rejects upper-case / whitespace / weird casing because the
 *  user-agent-set mime is usually canonical but server-asserted mime
 *  on multipart uploads can vary. The comparison normalizes both
 *  sides. */
export function isMimeAllowedFor(kind: UploadKind, mime: string): boolean {
  const allowlist = allowedMimesForUploadKind(kind)
  const normalized = mime.trim().toLowerCase()
  return allowlist.includes(normalized)
}

/** Sanitize a partner-supplied filename. Three rules (in order):
 *   1. Replace dangerous / non-printable characters with `_` —
 *      shell metacharacters (`;`, `|`, `` ` ``, `$`), path
 *      separators (`/`, `\`), null bytes, control chars, zero-width
 *      Unicode. Storage paths append the filename so an attacker must
 *      not be able to inject `/` or `..`. Note: we do NOT split on
 *      `\`/`/` like a path-stripping helper would — that destroys
 *      legitimate names that contain slashes (artists name files
 *      `a/b/c.mp4` or `2024\q4\launch.mp4`); substitution keeps the
 *      bytes while neutralizing the path semantics.
 *   2. Length cap (UPLOAD_FILENAME_MAX_LENGTH) — preserves a
 *      recognized extension when possible so the file still works in
 *      partner / admin tooling that uses the extension (default
 *      players dispatch on it).
 *   3. Falls back to `file-<kind>-<timestamp>.<defaultExt>` when the
 *      sanitized result is empty or just dots — defensive against a
 *      filename that's ALL unsafe characters.
 *
 *  The output never contains `..` (those characters survive, but `/`
 *  and `\` are replaced so the result can't traverse a path), NUL
 *  bytes, RTL-override chars, or shell metacharacters. The output is
 *  safe to embed in a log row, a storage path, and a UI label. */
export function sanitizePartnerFilename(
  raw: string,
  kind: UploadKind,
  nowMs: number = Date.now(),
): string {
  const defaultExt = defaultExtensionForKind(kind)
  // 1. Substitution pass — replaces (does NOT split) the dangerous
  //    character class. The class intentionally includes path
  //    separators so storage paths assembled from this value can't
  //    escape the user's namespace, plus NUL control bytes and
  //    shell metacharacters.
  const substituted = raw
    // eslint-disable-next-line no-control-regex -- intentional: control bytes must be stripped
    .replace(/[\x00-\x1f\x7f|;`$&*?<>"\n\r\t]/g, '_')
    .replace(/[\\\/]/g, '_')
    // Zero-width / RTL-override Unicode (visible only in certain
    // editors; rejected so the audit row + storage path don't carry
    // them).
    .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '_')
    .trim()

  // 2. Extension-aware length cap. Try to find a recognized
  //    extension (matches extensionFromFilename) so we can preserve
  //    it after truncation. If the extension is missing or invalid,
  //    the cap falls back to a simple slice (the file may end up
  //    extensionless, which is acceptable — Bunny + browsers don't
  //    require one).
  const lastDot = substituted.lastIndexOf('.')
  const capOnBasenameOnly = lastDot > 0 && lastDot < substituted.length - 1
  let outName: string
  if (capOnBasenameOnly) {
    const basename = substituted.slice(0, lastDot)
    const extension = substituted.slice(lastDot + 1).toLowerCase()
    const maxBasename =
      UPLOAD_FILENAME_MAX_LENGTH - extension.length - 1 /* the dot */
    outName =
      basename.length > maxBasename
        ? basename.slice(0, maxBasename) + '.' + extension
        : basename + '.' + extension
  } else {
    outName =
      substituted.length > UPLOAD_FILENAME_MAX_LENGTH
        ? substituted.slice(0, UPLOAD_FILENAME_MAX_LENGTH)
        : substituted
  }

  // 3. Defensive fallback for `''` or `'.'` or `'....'` (would be a
  //    valid filename but useless to the partner / incompatible with
  //    some image tooling).
  if (outName === '' || /^[\s.]+$/.test(outName)) {
    return `file-${kind}-${nowMs}.${defaultExt}`
  }
  return outName
}

/** Default extension when we have to synthesize a filename. Used as
 *  the fallback in the sanitizer + by the storage_path builder when
 *  the mime has no recognized extension. */
export function defaultExtensionForKind(kind: UploadKind): string {
  switch (kind) {
    case 'video':
      return 'mp4'
    case 'source':
      return 'zip'
    case 'sales_material':
      return 'pdf'
    default: {
      const _exhaustive: never = kind
      void _exhaustive
      return 'bin'
    }
  }
}

/** Build the canonical storage path for a partner upload. Mirrors the
 *  spec (§instructor-upload.md line 112):
 *    `partner-uploads/{partner_id}/{upload_id}/{file_id}.{ext}`
 *  Pure string — no DB / env reads. Caller provides the IDs (the
 *  action uses `crypto.randomUUID()` for the file portion + the
 *  Postgres bigserial for upload_id). */
export function buildPartnerStoragePath(opts: {
  partnerId: string
  uploadId: string
  fileId: string
  filename: string
  kind: UploadKind
}): string {
  const ext = extensionFromFilename(opts.filename) ?? defaultExtensionForKind(opts.kind)
  return `partner-uploads/${opts.partnerId}/${opts.uploadId}/${opts.fileId}.${ext}`
}

/** Extract the file extension (lowercased, no dot, ≤ 16 chars). Returns
 *  null when there's no recognizable extension. The 16-char cap
 *  bounds the storage path length + blocks the `file.<<exotic>>`
 *  class of input that some tooling produces. */
export function extensionFromFilename(filename: string): string | null {
  const lastDot = filename.lastIndexOf('.')
  if (lastDot < 0) return null
  const ext = filename.slice(lastDot + 1).toLowerCase()
  if (ext.length === 0 || ext.length > 16) return null
  // Letters + digits only — no spaces, no Unicode dot-equivalents,
  // no shell metacharacters.
  if (!/^[a-z0-9]+$/.test(ext)) return null
  return ext
}
