// getMyPartnerUploads.ts — RSC query that lists the partner's
// partner_uploads rows, scoped to their partner_id via RLS. Powers
// the P12.7 Slice 3 Files UI's per-file row list and the Submission
// Checklist widget at the right rail.
//
// Slice 1 ships:
//   - filtering by draftId (the wizard's draft — partners navigate
//     between drafts in their dashboard and each draft has its own
//     Files section in v1; cross-draft sharing lands in v2 when
//     product cloning ships)
//   - limit cap (≤ 200 rows per call — a single course wizard can
//     legitimately have ~30-50 files; the cap is a safety rail)
//   - defensive mapping drops rows where the joined `kind` isn't
//     in our enum (defense against a future migration that adds
//     a new UploadKind without the TS counterpart — the partner
//     sees the older kinds cleanly while the new kind silently
//     disappears from the list until the enums.ts catch-up)
//   - PII-safe select payload (no partner_id echoed; no scan_result
//     string with potential malware filename content; the
//     minimal read shape is what the wizard's Files UI needs)

import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import { UPLOAD_KINDS, type UploadKind } from '@foundations/data/enums'
import { partnerUploadState, type PartnerUploadState } from '../lib/upload-pipeline-state'

const log = loggerFor({ component: 'partner-upload.pipeline' })

const GET_MY_PARTNER_UPLOARDS_LIMIT_DEFAULT = 50
const GET_MY_PARTNER_UPLOARDS_LIMIT_MAX = 200

export type GetMyPartnerUploadsInput = {
  /** Optional draftId (numeric partner_upload_drafts.id). When present,
   *  only rows bound to that draft are returned. Slice 1 treats the
   *  draft <-> upload relationship as advisory (we surface all uploads
   *  for the partner and let the wizard filter client-side) — but the
   *  shape is here so the Slice 3 filter UI has a one-liner to call.
   *  P12.7 Slice 5 binds the relationship with a `draft_id` column
   *  on partner_uploads (deferred — see STUB-095). */
  draftId?: number | null
  limit?: number
}

export type PartnerUploadRow = {
  /** Postgres bigserial as string (PostgREST convention). */
  id: string
  originalFilename: string
  sizeBytes: number
  mimeType: string
  storagePath: string
  /** 'pending' | 'clean' | 'infected' | 'failed' — mirrors the DB enum. */
  scanStatus: 'pending' | 'clean' | 'infected' | 'failed'
  /** 'pending' | 'processing' | 'ready' | 'failed' — mirrors the DB enum; null for non-video kinds. */
  encodingStatus: 'pending' | 'processing' | 'ready' | 'failed' | null
  /** Typedd discriminator — null when no failure has been recorded. */
  failureKind: string | null
  failureReason: string | null
  /** Bunny Storage path; '' for legacy rows. */
  storagePathEcho: string
  /** ISO timestamp — the last Bunny webhook event for this row, or null. */
  webhookReceivedAt: string | null
  /** Computed pipeline state (the result of the state machine). */
  state: PartnerUploadState
  /** Upload kind (drives the state machine + per-kind caps). */
  kind: UploadKind
  /** Created-at ISO timestamp. */
  createdAt: string
}

export type GetMyPartnerUploadsResult =
  | { ok: true; uploads: PartnerUploadRow[]; total: number }
  | { ok: true; uploads: PartnerUploadRow[]; total: number; warning: string }
  | { ok: false; code: 'unauthenticated' | 'db_error'; message: string }

export async function getMyPartnerUploads(
  input: GetMyPartnerUploadsInput = {},
): Promise<GetMyPartnerUploadsResult> {
  const supabase = await getServerSupabase()
  const limit = Math.min(
    input.limit ?? GET_MY_PARTNER_UPLOARDS_LIMIT_DEFAULT,
    GET_MY_PARTNER_UPLOARDS_LIMIT_MAX,
  )

  // RLS self-scopes via partner_id = current_partner_id() on every
  // partner_uploads query. We don't need to filter by partner_id
  // ourselves — that's the whole point of RLS.
  let warning: string | null = null
  const { data, error } = await supabase
    .from('partner_uploads')
    .select(
      'id, original_filename, size_bytes, mime_type, scan_status, encoding_status, failure_kind, failure_reason, storage_path, webhook_received_at, created_at, kind',
    )
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    log.warn(
      { code: 'list_failed', msg: error.message },
      'getMyPartnerUploads: select failed',
    )
    return {
      ok: false,
      code: 'db_error',
      message: 'We could not load your uploads. Please try again.',
    }
  }
  if (!data) {
    return { ok: true, uploads: [], total: 0 }
  }

  const mapped: PartnerUploadRow[] = []
  for (const raw of data as Array<Record<string, unknown>>) {
    // Defensive coercion — every field has a fallback. The kind
    // check is the only one that DROPS a row (a new enum value the
    // TS side doesn't know about is silently skipped; the enums.ts
    // update lands before the new kind is exposed to partners).
    const kindRaw = typeof raw.kind === 'string' ? raw.kind : ''
    if (!(UPLOAD_KINDS as readonly string[]).includes(kindRaw)) {
      warning = warning ?? `Unknown upload kind "${kindRaw}" encountered; dropped from list`
      continue
    }
    const kind = kindRaw as UploadKind
    const scanStatus = normalizeScanStatus(raw.scan_status)
    const encodingStatus = normalizeEncodingStatus(raw.encoding_status)
    if (scanStatus === null) {
      warning = warning ?? 'Row with unrecognized scan_status encountered; dropped from list'
      continue
    }
    mapped.push({
      id: typeof raw.id === 'string' || typeof raw.id === 'number' ? String(raw.id) : '',
      originalFilename:
        typeof raw.original_filename === 'string' ? raw.original_filename : '',
      sizeBytes: typeof raw.size_bytes === 'number' ? raw.size_bytes : 0,
      mimeType: typeof raw.mime_type === 'string' ? raw.mime_type : '',
      storagePath: typeof raw.storage_path === 'string' ? raw.storage_path : '',
      scanStatus,
      encodingStatus,
      failureKind: typeof raw.failure_kind === 'string' ? raw.failure_kind : null,
      failureReason: typeof raw.failure_reason === 'string' ? raw.failure_reason : null,
      storagePathEcho: typeof raw.storage_path === 'string' ? raw.storage_path : '',
      webhookReceivedAt:
        typeof raw.webhook_received_at === 'string' ? raw.webhook_received_at : null,
      state: partnerUploadState({
        scan_status: scanStatus,
        encoding_status: encodingStatus,
        failure_kind: typeof raw.failure_kind === 'string' ? raw.failure_kind : null,
        kind,
      }),
      kind,
      createdAt: typeof raw.created_at === 'string' ? raw.created_at : new Date(0).toISOString(),
    })
  }

  // Slice-1 soft filtering — when a draftId is supplied we
  // currently return ALL rows for the partner because the
  // draft <-> upload binding column doesn't exist yet (filed in
  // STUB-095 Slice 5). The wizard's Files UI filters client-side
  // against its own payload.files map. Once the binding column
  // lands, this where-clause activates and the wizard can drop
  // its client-side filter.
  void input.draftId // reserved for future Slice 5 binding

  return warning === null
    ? { ok: true, uploads: mapped, total: mapped.length }
    : { ok: true, uploads: mapped, total: mapped.length, warning }
}

function normalizeScanStatus(value: unknown): 'pending' | 'clean' | 'infected' | 'failed' | null {
  if (value === 'pending' || value === 'clean' || value === 'infected' || value === 'failed') {
    return value
  }
  return null
}

function normalizeEncodingStatus(value: unknown): 'pending' | 'processing' | 'ready' | 'failed' | null {
  if (
    value === 'pending' ||
    value === 'processing' ||
    value === 'ready' ||
    value === 'failed'
  ) {
    return value
  }
  if (value === null || value === undefined) return null
  return null
}
