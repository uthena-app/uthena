// refund-proof-upload-constants.ts — pure constants + tiny pure helpers
// for the refund-proof upload surface. Safe to import from both
// client (browser bundle) and server (server action) code; NEVER
// imports node:crypto or any server-only module.
//
// The `requestRefundProofUpload` mint helper (which uses node:crypto)
// lives in `./refund-proof-upload.ts` and is server-only. Splitting
// the constants out lets the client island validate mime + size
// without pulling `node:crypto` into the browser bundle.
//
// v1 scope: the user-initiated refund-proof upload on
// `/account/orders/[id]/refund` (P9.12). The proof is the user's
// evidence for the refund request (screenshot, receipt, broken-link
// capture) and is delivered to admins via the P14.9 admin queue.
//
// The proof surface here is the same Bunny Storage Pull Zone
// browser-direct-PUT pattern as the avatar surface (P9.2). One
// difference: the storage path is server-derived
// (`refund-proofs/{userId}/{uuid}.{ext}`) and never trusts the
// client. The userId namespace sandbox bounds a forged request's
// write surface (a leaked upload URL only permits a write under
// the attacker's own userId). The UUID suffix means concurrent
// uploads from the same user don't collide (the previous file stays
// in Bunny as an orphan — janitor cleanup is a v2 follow-up, same
// as avatars per spec §Open Questions P9.2 line 150).

/**
 * Max refund-proof upload size in bytes (10 MB). Server-enforced
 * inside the action and the mint helper. The 10 MiB cap matches the
 * spec (`01-specs/pages/account-refund.md` §Security line 100) — it
 * accommodates the largest legitimate evidence (a multi-page PDF
 * receipt or a long screenshot) while still bounding the abuse
 * surface (a malicious "proof" stays under the size where the admin
 * scanner would even bother opening it).
 */
export const REFUND_PROOF_MAX_BYTES = 10 * 1024 * 1024

/**
 * Mime allowlist for refund-proof uploads. Matches the spec
 * (`account-refund.md` §Data line 25):
 *   - `image/jpeg` — screenshot of the issue
 *   - `image/png`  — screenshot of the issue (lossless)
 *   - `application/pdf` — multi-page document evidence (receipt, error report)
 *
 * No exotic formats — Word docs, Excel, HEIC, ZIP all rejected. The
 * spec explicitly enumerates these three as the legal set.
 */
export const REFUND_PROOF_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
] as const

export type RefundProofMime = (typeof REFUND_PROOF_MIME_TYPES)[number]

/**
 * Map a mime type to a safe file extension. Unknown mimes return
 * null — the caller should reject them via `REFUND_PROOF_MIME_TYPES`
 * before reaching here.
 *
 * `application/pdf` is intentionally NOT renamed to `.pdf.gz` or
 * similar — Bunny serves the bytes as-is and admins need to open the
 * file in their browser/PDF viewer, not decompress it.
 */
export function extForRefundProofMime(mime: string): string | null {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'application/pdf':
      return 'pdf'
    default:
      return null
  }
}

/**
 * Storage-path prefix for refund-proof uploads. The full path is
 * `${REFUND_PROOF_PATH_PREFIX}/{userId}/{uuid}.{ext}`. Kept as a
 * constant so the upload surface (mint helper), the admin
 * download surface (signed-URL proxy), and the audit log row can
 * all reference the same string without drift.
 */
export const REFUND_PROOF_PATH_PREFIX = 'refund-proofs'

/**
 * Sanitize a user-supplied filename before storing it in
 * `refunds.proof_filename`. Per the spec
 * (`account-refund.md` §Security line 100): "filename sanitized
 * (no path traversal — strip directory components, restrict to
 * `a-zA-Z0-9._-`)".
 *
 * Strategy:
 *   - Take only the basename (no directory components).
 *   - Replace every character outside `[A-Za-z0-9._-]` with `_`.
 *   - Collapse runs of underscores into one `_`.
 *   - Strip leading/trailing dots and underscores (Windows refuses
 *     trailing dots; *nix tolerates them but they're visual noise
 *     in the admin queue).
 *   - If the cleaned result is empty (the user gave us a name
 *     composed entirely of disallowed chars), return `'unnamed'`
 *     (with the extension preserved if one survived — admins see
 *     `unnamed.pdf` rather than a bare `pdf` which would be
 *     meaningless in the queue).
 *   - If only the extension survived (e.g. user named a file
 *     `🎉🎉.pdf` → cleanup leaves `pdf`), prefix with `'unnamed.'`
 *     so admins see the extension in context.
 *   - Cap at 120 chars.
 *   - Preserve case for readability in the admin queue.
 */
export function sanitizeRefundProofFilename(raw: string | null | undefined): string {
  if (!raw) return 'unnamed'
  // Strip directory components — both `/` and `\` (Windows).
  const base = raw.split(/[\\/]/).pop() ?? ''
  // Replace every disallowed char with an underscore.
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_')
  // Collapse runs of underscores (a name like `my..file___name.pdf`
  // is unwieldy in the admin UI; `_` runs become a single `_`).
  // Note: we deliberately do NOT collapse `..` because dots are
  // part of valid filename structure (extension separator, version
  // numbers like `myapp.v2.pdf`).
  const collapsed = cleaned.replace(/_+/g, '_')
  // Strip leading/trailing dots and underscores (Windows refuses
  // trailing dots; *nix tolerates them but they're visual noise in
  // the admin queue).
  const trimmed = collapsed.replace(/^[._-]+|[._-]+$/g, '')
  // Empty after sanitization → 'unnamed'.
  if (!trimmed) return 'unnamed'
  // "Only the extension survived" detection — a 1-4 char result
  // matching the common extension shape (`pdf`, `png`, `jpg`, etc.)
  // is meaningless without context. Prefix with `unnamed.` so admins
  // see the extension in the right context.
  const isBareExtension = /^[A-Za-z0-9]{1,4}$/.test(trimmed)
  const finalName = isBareExtension ? `unnamed.${trimmed}` : trimmed
  // Cap length.
  return finalName.length > 120 ? finalName.slice(0, 120) : finalName
}