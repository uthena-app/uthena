'use server'

import { headers } from 'next/headers'
import { z } from 'zod'
import { getServerSupabase } from '@foundations/data/supabase'
import {
  REFUND_PROOF_MAX_BYTES,
  REFUND_PROOF_MIME_TYPES,
  REFUND_PROOF_PATH_PREFIX,
  UploadNotConfiguredError,
  isRefundProofUploadConfigured,
  requestRefundProofUpload,
  sanitizeRefundProofFilename,
  type RefundProofMime,
} from '@foundations/files/refund-proof-upload'
import { loggerFor } from '@foundations/log/pino'
import { writeSelfAuditLog } from './writeSelfAuditLog'

const log = loggerFor({ component: 'account.profile.refund_proof' })

// Input schema — mime allowlist + size cap, enforced at the action
// boundary before we mint anything. Matches the spec
// (`01-specs/pages/account-refund.md` §Security line 100): jpeg/png/pdf
// only, 10MB max. The mime is narrowed to the same enum the
// foundation module uses so the server-side gate is the same
// allowlist the helper enforces (defense in depth — the helper
// double-checks).
const RequestRefundProofUploadInput = z.object({
  mime: z.enum(REFUND_PROOF_MIME_TYPES),
  size: z.number().int().min(1).max(REFUND_PROOF_MAX_BYTES),
  // The user's original filename — sanitized server-side per the
  // spec. The client passes whatever the user picked; the server
  // strips directory components + restricts to `a-zA-Z0-9._-` (the
  // `sanitizeRefundProofFilename` helper in the foundation module).
  filename: z.string().min(1).max(255),
})

export type RequestRefundProofUploadResult =
  | {
      ok: true
      uploadUrl: string
      storagePath: string
      // The server-side sanitized filename — the canonical value
      // the form should pass to `createRefundRequestAction` as
      // `proof_filename`. Returning it (rather than asking the
      // client to sanitize again) keeps the sanitization rules in
      // ONE place (the foundation module).
      sanitizedFilename: string
      expiresAt: string // ISO 8601 string for JSON serialization
    }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

/**
 * Mint a one-shot signed PUT URL for a refund-proof upload. The
 * caller is responsible for:
 *   - Validating the picked file client-side BEFORE calling this
 *     (mime allowlist + 10MB cap; client islands short-circuit on
 *     failure with an inline error so the user isn't waiting on a
 *     round-trip to find out).
 *   - Issuing a `PUT <uploadUrl>` with the file as the request body
 *     and `Content-Type: <mime>` header.
 *   - Passing the returned `storagePath` + `sanitizedFilename` to
 *     `createRefundRequestAction` as `proof_path` + `proof_filename`.
 *     The action writes them to the new `refunds` row.
 *
 * What this action does server-side:
 *   1. Auth gate: must be signed in. The proof is the user's own;
 *      it's surfaced in the admin queue (P14.9) keyed on the
 *      refund row's user_id.
 *   2. Zod-validate mime (allowlist) + size (1..10MB) + filename
 *      (1..255 chars).
 *   3. Env gate: Bunny storage must be configured. Without it, the
 *      endpoint returns a friendly error so the client can render
 *      a "temporarily unavailable" state. The form remains
 *      submittable without a proof — the proof is optional per the
 *      spec, so this gate only blocks the upload step.
 *   4. Mint the signed upload URL via `requestRefundProofUpload`.
 *   5. Write an `admin_audit_log` row with
 *      `action='refund_proof_upload_requested'`,
 *      `target_kind='refund_proofs'`, metadata
 *      `{ mime, size, storagePath, expiresAt }`. The metadata
 *      NEVER includes the email, the user id, the IP, or the user
 *      agent in plain — those are stored on the parent row
 *      (actor_id / actor_email / ip / user_agent). The IP + UA are
 *      read via Next's `headers()` for the audit row and never
 *      logged via `console.*`.
 *   6. Return `{ uploadUrl, storagePath, sanitizedFilename, expiresAt }`.
 *
 * The action NEVER auto-creates a refund. The user must click Submit
 * on the form, which runs `createRefundRequestAction` with the proof
 * metadata. This preserves the existing rate-limit + idempotency
 * gates — the upload is "staged" until the form is submitted (same
 * pattern as the avatar upload — P9.2). If the user picks a proof
 * then closes the tab, the upload URL expires in 5 minutes and
 * Bunny storage gets a janitor cleanup later.
 */
export async function requestRefundProofUploadAction(
  input: unknown,
): Promise<RequestRefundProofUploadResult> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !user.id || !user.email) {
    return { ok: false, error: 'Not signed in' }
  }

  // Zod-validate first; skip Bunny entirely if the input is bad.
  const parsed = RequestRefundProofUploadInput.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please fix the errors below.',
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path[0]?.toString() ?? '_', i.message]),
      ),
    }
  }
  const mime: RefundProofMime = parsed.data.mime
  const size = parsed.data.size
  const sanitized = sanitizeRefundProofFilename(parsed.data.filename)

  // Env gate — fail-open on Bunny-not-configured is the wrong call
  // (users would silently lose their proof). Fail closed with a
  // friendly error. The form's other fields remain editable; the
  // proof is optional.
  if (!isRefundProofUploadConfigured()) {
    log.warn(
      { code: 'refund_proof_upload_unconfigured', mime, size },
      'requestRefundProofUploadAction called but Bunny storage is not configured',
    )
    return {
      ok: false,
      error: 'Proof upload is temporarily unavailable. You can still submit without a proof.',
    }
  }

  let minted
  try {
    minted = requestRefundProofUpload({
      userId: user.id,
      mime,
      size,
    })
  } catch (err) {
    if (err instanceof UploadNotConfiguredError) {
      // Race: env was configured at the gate check but cleared on the
      // helper call. Treat it identically.
      return {
        ok: false,
        error: 'Proof upload is temporarily unavailable. You can still submit without a proof.',
      }
    }
    log.warn(
      { code: 'refund_proof_mint_failed', msg: (err as Error).message },
      'requestRefundProofUploadAction: mint failed',
    )
    return { ok: false, error: 'Could not prepare the upload. Please try again.' }
  }

  // Defensive path-prefix assertion — the storagePath from the mint
  // helper MUST start with the canonical `refund-proofs/{userId}/`
  // prefix. If it doesn't, refuse to write the audit row (the
  // surface would be broken; better to log a warning than to record
  // a poisoned path that admins can't actually retrieve later).
  const expectedPrefix = `${REFUND_PROOF_PATH_PREFIX}/${user.id}/`
  if (!minted.storagePath.startsWith(expectedPrefix)) {
    log.error(
      { code: 'refund_proof_path_prefix_mismatch', storagePath: minted.storagePath },
      'requestRefundProofUploadAction: storagePath prefix mismatch — refusing audit row',
    )
    return { ok: false, error: 'Could not prepare the upload. Please try again.' }
  }

  // Audit row. The metadata is intentionally minimal: mime + size +
  // storage path + expiresAt. No email, no IP — those columns on
  // the audit row itself carry the equivalent information for ops.
  const hdrs = await headers()
  await writeSelfAuditLog({
    userId: user.id,
    userEmail: user.email,
    action: 'refund_proof_upload_requested',
    // New target kind. The column is free text so no migration is
    // needed; the union in `writeSelfAuditLog` is extended in the
    // same PR.
    targetKind: 'refund_proofs',
    // target_id is the storagePath (string). Future audit searches
    // by storage path can index this column cheaply. NOT the
    // user.id — that's already on the parent row as `actor_id`.
    targetId: minted.storagePath,
    metadata: {
      mime,
      size,
      storagePath: minted.storagePath,
      sanitizedFilename: sanitized,
      expiresAt: minted.expiresAt.toISOString(),
    },
    ipAddress: hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: hdrs.get('user-agent') ?? null,
  })

  return {
    ok: true,
    uploadUrl: minted.uploadUrl,
    storagePath: minted.storagePath,
    sanitizedFilename: sanitized,
    expiresAt: minted.expiresAt.toISOString(),
  }
}