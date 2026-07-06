// setPartnerUploadFailed.ts — server action that records a client-
// reported failure on an existing partner_uploads row (P12.8 Slice
// 1). The wizard's Files UI calls this when a fetch / tus /
// XMLHttpRequest errors out, when the user clicks the ✕ button on a
// file row, when the file exceeds the per-kind size cap on the
// browser side, or when Bunny rejects the upload mid-stream.
//
// The action:
//   1. Auth: requirePartner
//   2. Zod-validate (uploadId is a bigint-as-string per PostgREST
//      convention; failure_kind from the typed FailureKind enum;
//      failure_reason free-text ≤ 200 chars; clientReportedAt as an
//      ISO timestamp from the browser clock — used only to keep the
//      audit row close in time, NOT trusted for ordering)
//   3. Look up the row (RLS self-scoped via partner_id =
//      current_partner_id())
//   4. Refuse failures on rows owned by another partner (defense in
//      depth — RLS already prevents this)
//   5. UPDATE partner_uploads SET failure_kind=$1, failure_reason=$2,
//      updated_at=now() WHERE id=$3 AND failure_kind IS NULL
//      (idempotent — re-clicking ✕ on a failed row is a no-op; the
//      row's failure_kind has already been set)
//   6. Write one admin_audit_log row with
//      action='partner_upload.file_failed'
//   7. Return the typed failure status to the UI so the file row can
//      flip to the failed state

import 'server-only'

import { z } from 'zod'

import { requirePartner } from '@foundations/auth/guards'
import { getServerSupabase } from '@foundations/data/supabase'
import { FAILURE_KINDS, type FailureKind } from '@foundations/data/enums'
import { writeSelfAuditLog } from '@features/account/profile/actions/writeSelfAuditLog'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'partner-upload.pipeline' })

// ---------------------------------------------------------------------------
// Wire schema
// ---------------------------------------------------------------------------
export const SetPartnerUploadFailedInput = z.object({
  /** The partner_uploads.id (bigserial, postgREST returns as string). */
  uploadId: z
    .string()
    .trim()
    .regex(/^[0-9]+$/, 'uploadId must be a numeric id')
    .min(1)
    .max(20),
  /** Typed failure discriminator. Server-side validated against the
   *  FailureKind union so a misbehaving client can't inject an
   *  arbitrary label. */
  /** Typed failure discriminator. Server-side validated against the
   *  FailureKind union so a misbehaving client can't inject an
   *  arbitrary label.
   *  Cast bridges readonly-array shape (the enums.ts form) to Zod's
   *  readonly-tuple shape. */
  failureKind: z.enum(FAILURE_KINDS as unknown as [string, ...string[]]),
  /** Optional human-readable detail. ≤ 200 chars (the column cap
   *  in the DB is 1000; the action narrows to 200 because the
   *  audit row carries the same string and we don't want huge
   *  blobs in either place). */
  failureReason: z.string().trim().max(200).optional(),
  /** ISO 8601 client time. Used only in the audit row's metadata
   *  for human-correlation — never trusted for ordering. */
  clientReportedAt: z.string().trim().min(20).max(40).optional(),
})

export type SetPartnerUploadFailedInputT = z.infer<typeof SetPartnerUploadFailedInput>

export type SetPartnerUploadFailedResult =
  | { ok: true; uploadId: string; previousState: { failureKind: FailureKind | null; failureReason: string | null } }
  | { ok: false; code: SetPartnerUploadFailedErrorCode; message: string }

export type SetPartnerUploadFailedErrorCode =
  | 'not_authenticated'
  | 'not_partner'
  | 'invalid_input'
  | 'not_found'
  | 'update_failed'

const ERROR_MESSAGES: Readonly<Record<SetPartnerUploadFailedErrorCode, string>> = {
  not_authenticated: 'You must be signed in.',
  not_partner: 'Only partners can update file status.',
  invalid_input: 'Some fields are invalid.',
  not_found: 'We could not find that upload.',
  update_failed: 'We could not save the failure. Please try again.',
} as const

export async function setPartnerUploadFailedAction(
  rawInput: unknown,
): Promise<SetPartnerUploadFailedResult> {
  let session
  try {
    session = await requirePartner()
  } catch {
    return { ok: false, code: 'not_authenticated', message: ERROR_MESSAGES.not_authenticated }
  }
  if (session.role !== 'partner' && session.role !== 'admin' && session.role !== 'super_admin') {
    return { ok: false, code: 'not_partner', message: ERROR_MESSAGES.not_partner }
  }

  const parsed = SetPartnerUploadFailedInput.safeParse(rawInput)
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid_input',
      message: ERROR_MESSAGES.invalid_input,
    }
  }
  const input = parsed.data

  const supabase = await getServerSupabase()

  // Read the existing row — RLS self-scopes via partner_id =
  // current_partner_id(), so a partner reading another partner's
  // row id will see null here (defense-in-depth — even if RLS
  // were misconfigured, the partner wouldn't learn about another
  // partner's files). The select payload is intentionally minimal:
  // id, partner_id, failure_kind, failure_reason. PII-safe.
  const { data: existing, error: readError } = await supabase
    .from('partner_uploads')
    .select('id, partner_id, failure_kind, failure_reason')
    .eq('id', input.uploadId)
    .maybeSingle()
  if (readError) {
    log.warn(
      {
        code: 'read_failed',
        partner_id_hash: 'redacted',
        upload_id: input.uploadId,
        msg: readError.message,
      },
      'setPartnerUploadFailed read failed',
    )
    return { ok: false, code: 'update_failed', message: ERROR_MESSAGES.update_failed }
  }
  if (!existing) {
    return { ok: false, code: 'not_found', message: ERROR_MESSAGES.not_found }
  }

  // Idempotent: if the row already has a failure_kind set, this
  // call is a no-op (a refresh / retry from the UI). We surface
  // previousState so the UI can sync its badge.
  const previousFailureKind = (existing as unknown as { failure_kind: FailureKind | null })
    .failure_kind
  const previousReason = (existing as unknown as { failure_reason: string | null })
    .failure_reason

  if (previousFailureKind !== null) {
    return {
      ok: true,
      uploadId: input.uploadId,
      previousState: {
        failureKind: previousFailureKind,
        failureReason: previousReason,
      },
    }
  }

  // UPDATE — using a WHERE on (id, failure_kind IS NULL) makes this
  // race-safe across two concurrent tab-failures. The win-condition
  // is "first writer wins; second writer's UPDATE affects 0 rows".
  // We don't re-read the row to confirm — the audit log is the
  // authoritative log either way.
  const { error: updateError, data: updated } = await supabase
    .from('partner_uploads')
    .update({
      failure_kind: input.failureKind,
      failure_reason: input.failureReason ?? null,
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', input.uploadId)
    .is('failure_kind', null)
    .select('id')
  if (updateError) {
    log.warn(
      {
        code: 'update_failed',
        partner_id_hash: 'redacted',
        upload_id: input.uploadId,
        msg: updateError.message,
      },
      'setPartnerUploadFailed update failed',
    )
    return { ok: false, code: 'update_failed', message: ERROR_MESSAGES.update_failed }
  }
  // 0 rows updated = concurrent setter beat us; the previous
  // failure is what the partner sees.
  if (!updated || (Array.isArray(updated) && updated.length === 0)) {
    return {
      ok: true,
      uploadId: input.uploadId,
      previousState: {
        failureKind: previousFailureKind,
        failureReason: previousReason,
      },
    }
  }

  // Audit log — best-effort (failures here are warn-logged; the
  // partner_uploads row is already updated).
  const auditOk = await writeSelfAuditLog({
    userId: session.id,
    userEmail: '',
    action: 'partner_upload.file_failed',
    targetKind: 'partner_uploads',
    targetId: input.uploadId,
    metadata: {
      failure_kind: input.failureKind as FailureKind,
      failure_reason: input.failureReason ?? null,
      client_reported_at: input.clientReportedAt ?? null,
    },
  })
  if (auditOk === null) {
    log.warn(
      { code: 'audit_write_failed', upload_id: input.uploadId },
      'setPartnerUploadFailed: audit row write failed; the failure is recorded on the partner_uploads row',
    )
  }

  return {
    ok: true,
    uploadId: input.uploadId,
    previousState: {
      // Narrow back to FailureKind (Zod already validated the enum
      // membership by this point).
      failureKind: input.failureKind as FailureKind,
      failureReason: input.failureReason ?? null,
    },
  }
}
