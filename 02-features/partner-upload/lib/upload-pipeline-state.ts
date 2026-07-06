// upload-pipeline-state.ts — typed state-machine helpers for the
// partner upload pipeline. Pure module; no I/O; safe to import from
// anywhere (RSC, client island, server action, webhook handler).
//
// The pipeline per file (one partner_uploads row):
//   registered  — createPartnerFileUpload wrote the row
//   uploading   — client reports it has started the PUT/tus (rarely
//                 observed; the UI usually goes from `registered` to
//                 `uploaded` in one tick)
//   uploaded    — Bunny confirms the bytes arrived (the upload-completed
//                 webhook event OR a client-reported success)
//   scanning    — ClamAV is running (the scan-started webhook, if any)
//   scan_passed | scan_infected | scan_failed
//               — terminal scan outcomes from the scan-result webhook
//   encoding    — Bunny Stream transcoding (only for kind='video')
//   ready       — scan passed AND (kind != video OR encoding ready)
//   failed      — upload failed (client-reported OR server-detected)
//
// The state machine does NOT enforce the BPMN — it surfaces the current
// status to the Files UI (Step 3 of the wizard) so the Submission
// Checklist + the per-file row UI can render the right affordance
// (re-upload, scan state, encoding state, attach-to-product).
//
// Why a typed state machine in the codebase (rather than reaching
// for scan_status / encoding_status directly): the two columns do not
// tell the full story. A `scan_status='clean'` row on a video file
// with `encoding_status='processing'` is NOT ready. A `scan_status=
// 'clean'`, `encoding_status='ready'` row that hasn't been attached
// to a product yet is ready for attach but NOT ready for submit (the
// spec requires `product_file_id IS NOT NULL` for submission — though
// that's Slice 5's gate).
//
// The `partnerUploadState()` helper is the single source of truth for
// "given a row, what's its pipeline state?". The Files UI calls it
// once per file per render.

import type {
  ScanStatus,
  EncodingStatus,
  UploadKind,
} from '@foundations/data/enums'

/** Pipeline states for one partner_uploads row. Backs the Files UI's
 *  per-file badge + the Submission Checklist row. */
export type PartnerUploadState =
  | 'registered' // row exists; the client hasn't reported any progress
  | 'uploading' // client reported it started the PUT
  | 'uploaded' // Bunny accepted the bytes (upload-complete webhook)
  | 'scanning' // ClamAV scan in progress
  | 'scan_passed' // scan clean
  | 'scan_infected' // infected; quarantine
  | 'scan_failed' // scan errored (timeout, oversized zip, etc.)
  | 'encoding' // video: Bunny Stream transcoding
  | 'ready' // scan passed AND (kind != video OR encoding ready)
  | 'failed' // client- or server-reported failure

export const PARTNER_UPLOAD_STATE_LABELS: Readonly<Record<PartnerUploadState, string>> = {
  registered: 'Registered',
  uploading: 'Uploading',
  uploaded: 'Uploaded',
  scanning: 'Scanning',
  scan_passed: 'Scan passed',
  scan_infected: 'Infected — quarantined',
  scan_failed: 'Scan failed',
  encoding: 'Encoding',
  ready: 'Ready',
  failed: 'Upload failed',
} as const

export const PARTNER_UPLOAD_STATE_TONE: Readonly<
  Record<PartnerUploadState, 'muted' | 'info' | 'warn' | 'success' | 'danger'>
> = {
  registered: 'muted',
  uploading: 'info',
  uploaded: 'info',
  scanning: 'info',
  scan_passed: 'success',
  scan_infected: 'danger',
  scan_failed: 'danger',
  encoding: 'info',
  ready: 'success',
  failed: 'warn',
} as const

/** Compute the pipeline state from the row's scan/encoding columns +
 *  the row-level failure_kind presence. Pure — no DB reads. */
export function partnerUploadState(row: {
  scan_status: ScanStatus
  encoding_status: EncodingStatus | null
  failure_kind: string | null
  kind: UploadKind
}): PartnerUploadState {
  // Failed rows: failure_kind IS NOT NULL is the canonical signal
  // (set by setPartnerUploadFailed or by the webhook surface when an
  // explicit failure payload arrives). The UI renders this state
  // before scan/encoding so the partner sees the failure immediately.
  if (row.failure_kind !== null) return 'failed'

  // Scan failure takes priority over everything else — a row that
  // failed scanning can never be `ready`, even if the encoding
  // somehow completed.
  if (row.scan_status === 'failed') return 'scan_failed'
  if (row.scan_status === 'infected') return 'scan_infected'

  // Non-failure, non-scan-clean paths
  if (row.scan_status === 'pending') {
    // We don't have a "scan started" webhook in v1; the webhook
    // either fires (sets scan_status to clean/infected/failed) or
    // doesn't. So pending maps to `uploaded` until the scan result
    // lands — there's no observed `scanning` state in v1.
    return 'uploaded'
  }

  // scan_status === 'clean' from here on.
  if (row.kind === 'video') {
    if (row.encoding_status === null || row.encoding_status === 'pending') return 'encoding'
    if (row.encoding_status === 'processing') return 'encoding'
    if (row.encoding_status === 'failed') return 'scan_failed'
    // encoding_status === 'ready'
    return 'ready'
  }

  // Non-video rows are `ready` once `scan_status='clean'` lands.
  return 'ready'
}

/** True when this state can be cleared by the partner (either by
 *  re-uploading or by clicking ✕). Used by the Files UI to gate the
 *  "Replace" affordance. */
export function partnerUploadStateIsReplaceable(state: PartnerUploadState): boolean {
  return (
    state === 'scan_failed' ||
    state === 'failed' ||
    state === 'scan_infected'
  )
}

/** True when this state counts as "ready to submit for review" — the
 *  wizard's Continue button gates on this being true for every
 *  required file (P12.7 Slice 5 submit-for-review boundary; the
 *  Slice 1 helper makes the gate testable in isolation now). */
export function partnerUploadStateIsReady(state: PartnerUploadState): boolean {
  return state === 'ready'
}

/** True when this state is terminal for scan purposes — the scan
 *  outcome is locked and won't change. Used by the Files UI to
 *  decide whether to keep polling for scan status. */
export function partnerUploadStateIsScanTerminal(state: PartnerUploadState): boolean {
  return (
    state === 'scan_passed' ||
    state === 'scan_infected' ||
    state === 'scan_failed' ||
    state === 'encoding' ||
    state === 'ready' ||
    state === 'failed'
  )
}

/** True when this state is terminal for encoding purposes — the video
 *  encode outcome is locked. Used by the Files UI to stop polling
 *  for video encode status. */
export function partnerUploadStateIsEncodingTerminal(state: PartnerUploadState): boolean {
  return (
    state === 'ready' ||
    state === 'scan_failed' ||
    state === 'failed'
  )
}
