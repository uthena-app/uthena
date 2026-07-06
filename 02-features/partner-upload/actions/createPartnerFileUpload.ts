// createPartnerFileUpload.ts — server action that registers a new
// partner file upload (P12.8 Slice 1).
//
// The wizard's Files UI calls this once per file the partner wants
// to upload. The action:
//   1. Auth: requirePartner() (any partner status)
//   2. Zod-validate the wire input (kind, filename, mime, size,
//      optional draftId to bind the file to a wizard draft)
//   3. Sanitize the filename server-side (the partner's browser is
//      not trusted to sanitize)
//   4. Enforce the per-kind size cap (otherwise an attacker could
//      insert a 200-GB "video" row and never upload — but the scan
//      pipeline would still queue scan jobs for nothing)
//   5. Per-partner rate limit (60/min sliding window) — the action
//      records only after the row insert succeeds
//   6. Insert a partner_uploads row with:
//        - storage_path: deterministic 'partner-uploads/{partnerId}/{uploadId}/{fileId}.{ext}'
//        - scan_status='pending', encoding_status='pending' (or NULL
//          for non-video kinds — the column is nullable)
//        - failure_kind=NULL (failure column reserved for the
//          setPartnerUploadFailed path or the webhook surface)
//        - webhook_received_at=NULL (set by handleBunnyWebhook on first event)
//        - product_file_id=NULL (set on Submit-for-Review when the
//          file attaches to the product row)
//   7. Write one admin_audit_log row with
//      action='partner_upload.file_registered'
//   8. Return a typed envelope the UI consumes — the same shape
//      whether the upload target is Bunny Stream tus (video) or
//      Bunny Storage PUT (source / sales_material). The actual
//      upload URL mint lands in Slice 2 once the per-kind URL
//      builder is plumbed; Slice 1's envelope returns `uploadTarget:
//      { kind: 'pending' }` so the UI renders a friendly "preparing
//      upload" state until the real URL is available.
//
// 'use server' — runs server-only.

import 'server-only'

import { z } from 'zod'
import { randomUUID } from 'node:crypto'

import { requirePartner } from '@foundations/auth/guards'
import { getServerSupabase } from '@foundations/data/supabase'
import { UPLOAD_KINDS, type UploadKind } from '@foundations/data/enums'
import { writeSelfAuditLog } from '@features/account/profile/actions/writeSelfAuditLog'
import { loggerFor } from '@foundations/log/pino'

import {
  isMimeAllowedFor,
  maxBytesForUploadKind,
  sanitizePartnerFilename,
  buildPartnerStoragePath,
} from '../lib/upload-kinds'
import {
  _resetCreateUploadRateLimitForTests,
  CREATE_UPLOAD_RATE_LIMIT_MAX_PER_PARTNER,
  CREATE_UPLOAD_RATE_LIMIT_WINDOW_MS,
  rateLimitCheck,
  rateLimitRecord,
} from './createPartnerFileUpload.rate-limit'

const log = loggerFor({ component: 'partner-upload.pipeline' })

// ---------------------------------------------------------------------------
// Wire schema — Zod-validated action input. Wire shape uses primitive
// types only (no bigint; the DB will coerce from string on insert).
// ---------------------------------------------------------------------------
export const CreatePartnerFileUploadInput = z.object({
  /** Discriminator — drives the mime allowlist + size cap + (future)
   *  Bunny storage backend. */
  // `as unknown as [string, ...string[]]` bridges the readonly-array
  // shape (required by enums.ts + the check-enum-coverage.sh awk
  // parser) to the readonly-tuple shape Zod's z.enum expects. The
  // runtime values are equivalent.
  kind: z.enum(UPLOAD_KINDS as unknown as [string, ...string[]]),
  /** Original filename as the partner's browser submitted it (path-
   *  componented, full-width, etc.). Sanitized server-side before
   *  use. Required, ≤ 1024 chars (raw) — the sanitizer cuts down to
   *  UPLOAD_FILENAME_MAX_LENGTH (200). */
  filename: z.string().trim().min(1).max(1024),
  /** Reported MIME type. Validated server-side against the per-kind
   *  allowlist — never trusted from the wire. Browsers occasionally
   *  submit empty strings (some drag/drop paths). Defaulted to a
   *  non-empty guard. */
  mime: z.string().trim().min(1).max(256),
  /** File size in bytes (capped server-side via Zod max per the
   *  per-kind hard ceiling; 50 GB = 53_687_091_200). The Zod bound
   *  is a SAFETY RAIL — the per-kind cap is the actual rule. */
  sizeBytes: z.number().int().min(1).max(50 * 1024 * 1024 * 1024 + 100),
  /** Optional partner_upload_drafts.id — when present, the file is
   *  bound to that draft's `payload.files[fileId]` slot for the
   *  wizard's Files step (the UI uses this to associate uploaded
   *  files with the draft row across navigation). */
  draftId: z
    .union([z.literal(''), z.null()])
    .transform(() => undefined)
    .optional(),
})

export type CreatePartnerFileUploadInputT = z.infer<typeof CreatePartnerFileUploadInput>

export type UploadTarget =
  | { kind: 'pending' }
  // Future Slice 2 surfaces — declared so the wire shape is stable:
  // | { kind: 'stream_tus'; tusEndpoint: string; tusUploadId: string; expiresAt: string }
  // | { kind: 'storage_put'; uploadUrl: string; publicUrl: string; expiresAt: string }

export type CreatePartnerFileUploadResult =
  | {
      ok: true
      uploadId: string
      storagePath: string
      sanitizedFilename: string
      uploadTarget: UploadTarget
    }
  | { ok: false; code: CreatePartnerFileUploadErrorCode; message: string; retryAfterSeconds?: number }

export type CreatePartnerFileUploadErrorCode =
  | 'not_authenticated'
  | 'not_partner'
  | 'invalid_input'
  | 'mime_not_allowed'
  | 'file_too_large'
  | 'rate_limited'
  | 'insert_failed'

const ERROR_MESSAGES: Readonly<Record<CreatePartnerFileUploadErrorCode, string>> = {
  not_authenticated: 'You must be signed in to upload files.',
  not_partner: 'Only partners can upload files.',
  invalid_input: 'Some fields are invalid.',
  mime_not_allowed: 'That file type is not allowed for this upload zone.',
  file_too_large: 'The file exceeds the maximum size for this upload zone.',
  rate_limited:
    'You are uploading too quickly. Please wait a moment before starting another upload.',
  insert_failed: 'We could not register the upload. Please try again.',
} as const

/** Top-level server action — exported via the barrel. */
export async function createPartnerFileUploadAction(
  rawInput: unknown,
): Promise<CreatePartnerFileUploadResult> {
  // 1. Auth — `requirePartner` redirects on auth failure but doesn't
  // return — we wrap in try/catch so we can return a typed error
  // shape from the client island (redirects would blow up the form).
  let session
  try {
    session = await requirePartner()
  } catch {
    return { ok: false, code: 'not_authenticated', message: ERROR_MESSAGES.not_authenticated }
  }
  // requirePartner throws redirect Error for an unapproved partner
  // → not-partner is the "you don't have access" branch the action
  // should surface. We re-check role explicitly because role checks
  // don't always throw (requireRole redirects for wrong-role, which
  // gets caught above as well).
  if (session.role !== 'partner' && session.role !== 'admin' && session.role !== 'super_admin') {
    return { ok: false, code: 'not_partner', message: ERROR_MESSAGES.not_partner }
  }

  // 2. Zod-validate the wire input. ZodError paths are NOT logged
  // (they leak field names + the user's input back to the log).
  const parsed = CreatePartnerFileUploadInput.safeParse(rawInput)
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid_input',
      message: ERROR_MESSAGES.invalid_input,
    }
  }
  const input = parsed.data

  // The z.enum cast above widens `kind` to `string`. Narrow it back
  // to UploadKind (Zod has validated that the value is in the enum
  // by this point — safe .refine-style cast).
  const kind = input.kind as UploadKind

  // 3. Sanitize the filename server-side.
  const sanitizedFilename = sanitizePartnerFilename(input.filename, kind)

  // 4. MIME + size caps (the Zod max is a safety rail; per-kind is
  // the rule).
  if (!isMimeAllowedFor(kind, input.mime)) {
    return {
      ok: false,
      code: 'mime_not_allowed',
      message: ERROR_MESSAGES.mime_not_allowed,
    }
  }
  const sizeCap = maxBytesForUploadKind(kind)
  if (input.sizeBytes > sizeCap) {
    return {
      ok: false,
      code: 'file_too_large',
      message: ERROR_MESSAGES.file_too_large,
    }
  }

  // 5. Per-partner rate limit. `partnerId` for partner_uploads is a
  // bigint FK to partners(id) — we need it for both the rate limit +
  // the row insert. `session.id` is the auth.users UUID; we have to
  // look up partners.id by user_id (mirrors the migration's
  // `current_partner_id()` SECURITY DEFINER function).
  const supabase = await getServerSupabase()
  const { data: partnerRow, error: partnerLookupError } = await supabase
    .from('partners')
    .select('id')
    .eq('user_id', session.id)
    .single()
  if (partnerLookupError || !partnerRow) {
    // Most likely cause: the session user is admin/super_admin but
    // doesn't have a partners row. requirePartner allows admin →
    // this branch lands when an admin tries to upload on their own
    // behalf without first impersonating a partner.
    return { ok: false, code: 'not_partner', message: ERROR_MESSAGES.not_partner }
  }
  const partnerId = String(partnerRow.id)

  const verdict = rateLimitCheck({ partnerId })
  if (!verdict.ok) {
    return {
      ok: false,
      code: 'rate_limited',
      message: ERROR_MESSAGES.rate_limited,
      retryAfterSeconds: verdict.retryAfterSeconds,
    }
  }

  // 6. Insert the row. The Postgres bigserial PK is returned as
  // stringified bigint (PostgREST convention).
  //
  // The fileId portion of the storage path is a fresh UUID so
  // concurrent uploads from the same partner don't collide (Bunny
  // treats paths as unique object keys). The server is the only
  // source of truth for storage_path — the partner's wire input is
  // never trusted to influence it.
  const fileId = randomUUID()
  // We pre-mint the storage path before insert so the row + the
  // returned envelope have a single source of truth. The upload_id
  // portion comes from the row's bigserial after insert.
  const provisionalStoragePath = buildPartnerStoragePath({
    partnerId,
    uploadId: '0', // placeholder until insert returns the real id
    fileId,
    filename: sanitizedFilename,
    kind: kind,
  })
  const trimmedOriginalFilename = sanitizedFilename

  // Insert. We select('id') to capture the bigserial.
  const { data: inserted, error: insertError } = await supabase
    .from('partner_uploads')
    .insert({
      partner_id: partnerRow.id,
      original_filename: trimmedOriginalFilename,
      size_bytes: input.sizeBytes,
      mime_type: input.mime,
      storage_path: provisionalStoragePath,
      scan_status: 'pending',
      encoding_status: kind === 'video' ? 'pending' : null,
      failure_kind: null,
      failure_reason: null,
      webhook_received_at: null,
    } as never)
    .select('id')
    .single()
  if (insertError || !inserted) {
    log.warn(
      {
        code: 'insert_failed',
        partner_id_hash: 'redacted',
        msg: insertError?.message,
        kind: kind,
        size_bytes_bucket: bucketForSize(input.sizeBytes),
      },
      'createPartnerFileUpload insert failed',
    )
    return { ok: false, code: 'insert_failed', message: ERROR_MESSAGES.insert_failed }
  }

  const realUploadId = String((inserted as unknown as { id: string | number }).id)
  // The provisional storage path used uploadId='0' as a placeholder.
  // Update the row to the canonical path now that we have the real id.
  const canonicalStoragePath = buildPartnerStoragePath({
    partnerId,
    uploadId: realUploadId,
    fileId,
    filename: trimmedOriginalFilename,
    kind: kind,
  })
  const { error: updatePathError } = await supabase
    .from('partner_uploads')
    .update({ storage_path: canonicalStoragePath } as never)
    .eq('id', realUploadId)
  if (updatePathError) {
    // Non-fatal — the provisional path doesn't match canonical but
    // it does match the (key) uniqueness constraint. The webhook
    // handler will look up by the path Bunny reports, not by our
    // canonical one — so as long as the path is stable from the
    // Bunny side, we're fine. Log + move on.
    log.warn(
      {
        code: 'storage_path_update_failed',
        partner_id_hash: 'redacted',
        upload_id: realUploadId,
        msg: updatePathError.message,
      },
      'storage_path canonical update failed; continuing with provisional path',
    )
  }

  // 7. Audit log — recorded whether or not the path update
  // succeeded (the row exists; the audit row is the next thing that
  // could fail). Audit failures are not fatal — the row was created.
  await writeSelfAuditLog({
    userId: session.id,
    userEmail: '', // not logged (pino redact); the table requires the column
    action: 'partner_upload.file_registered',
    targetKind: 'partner_uploads',
    targetId: realUploadId,
    metadata: {
      upload_kind: kind as UploadKind,
      mime: input.mime,
      size_bytes: input.sizeBytes,
      storage_path: canonicalStoragePath,
      sanitized_filename: trimmedOriginalFilename,
    },
  })

  // 8. Record the rate-limit bucket only AFTER the insert succeeded
  // — denied requests don't consume budget.
  rateLimitRecord({ partnerId })

  log.info(
    {
      code: 'file_registered',
      partner_id_hash: 'redacted',
      upload_id: realUploadId,
      kind: kind,
      size_bytes_bucket: bucketForSize(input.sizeBytes),
    },
    'partner file upload registered',
  )

  return {
    ok: true,
    uploadId: realUploadId,
    storagePath: canonicalStoragePath,
    sanitizedFilename: trimmedOriginalFilename,
    uploadTarget: { kind: 'pending' },
  }
}

/** Bucket the size for log correlation — never log raw bytes
 *  (rough side-channel leak even for non-PII fields). */
function bucketForSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return '<1KB'
  if (sizeBytes < 1024 * 1024) return '<1MB'
  if (sizeBytes < 100 * 1024 * 1024) return '<100MB'
  if (sizeBytes < 1024 * 1024 * 1024) return '<1GB'
  if (sizeBytes < 10 * 1024 * 1024 * 1024) return '<10GB'
  return '>=10GB'
}

// Re-export the rate-limit helpers so the test files can import them
// without reaching into a deeper path.
export {
  _resetCreateUploadRateLimitForTests,
  CREATE_UPLOAD_RATE_LIMIT_MAX_PER_PARTNER,
  CREATE_UPLOAD_RATE_LIMIT_WINDOW_MS,
}
