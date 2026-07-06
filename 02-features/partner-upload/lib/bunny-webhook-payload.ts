// bunny-webhook-payload.ts — pure parsers for the Bunny Storage scan
// + Bunny Stream transcode webhook payloads. The handleBunnyWebhook
// dispatch loops over these and figures out what to update.
//
// Bunny's actual payload shape (verified against
// docs.bunny.net/docs/stream-webhooks at 2026-06-30 — Bunny does
// not publish a strict schema, so the parser is intentionally
// tolerant: unknown event types + missing fields land in
// parseOutcome as 'unknown_event' or 'malformed' rather than throwing):
//
// Storage scan-result (Bunny Storage webhook):
//   {
//     "EventName": "FileUploaded" | "FileScanCompleted" | ...,
//     "StorageZoneName": "...",
//     "ObjectName": "partner-uploads/<partner_id>/<upload_id>/<file_id>.<ext>",
//     "FileSize": 12345,
//     "ScanResult": "Clean" | "Infected" | "Error",
//     "ScanDetails": "<clamav raw output, may be empty>"
//   }
//
// Stream transcode-result (Bunny Stream webhook):
//   {
//     "VideoLibraryId": 12345,
//     "VideoGuid": "<bunny video id, 36 chars>",
//     "Status": 0 | 1 | 2 | 3 | 4 | 5,
//     "Resolutions": "240p,360p,480p,720p,1080p",  // comma-separated, present on success
//     "EncodeProgress": 0..100,
//     "ErrorMessage": null | "string"
//   }
//
// Status codes per Bunny Stream docs:
//   0 = Created
//   1 = Processing (Uploaded + encoding)
//   2 = Ready (encoded + playable)
//   3 = Failed (transcoding error)
//   4 = Upload failed
//   5 = Presigned upload URL expired
//
// The parsers normalize to internal types:
//   - Storage scan → scanStatusEvent (mapping ScanResult string to
//     our scan_status enum)
//   - Stream status → encodingStatusEvent (mapping Status int to
//     our encoding_status enum)
//
// Pure; no env/DB reads. Safe to import from anywhere.

import type { ScanStatus, EncodingStatus } from '@foundations/data/enums'

// ---------------------------------------------------------------------------
// Storage scan-result shape
// ---------------------------------------------------------------------------

/** Canonical event names the parser is willing to handle for Storage
 *  webhooks. Anything else → parseOutcome='unknown_event'. */
export const BUNNY_STORAGE_HANDLED_EVENTS = [
  'FileUploaded',
  'FileScanCompleted',
  'FileReplaced',
  'FileDeleted',
] as const

export type BunnyStorageHandledEvent = (typeof BUNNY_STORAGE_HANDLED_EVENTS)[number]

/** Canonical scan outcomes the parser maps from ScanResult. The
 *  actual ClamAV scan — separate from the upload state — can land in
 *  three values: clean, infected, error. The translation table is:
 *    'Clean'    → scan_status='clean'
 *    'Infected' → scan_status='infected'
 *    'Error'    → scan_status='failed'
 *    anything else (missing / unknown) → scanStatusEvent=null
 *    (the handler treats null as "couldn't determine; do not update"). */
export function parseBunnyStorageScanResult(value: unknown): ScanStatus | null {
  if (typeof value !== 'string') return null
  switch (value.trim()) {
    case 'Clean':
      return 'clean'
    case 'Infected':
      return 'infected'
    case 'Error':
    case 'Failed': // defensive — Bunny has used both historically
      return 'failed'
    default:
      return null
  }
}

export type BunnyStorageParseOutcome =
  | { kind: 'unknown_event'; eventName: string }
  | { kind: 'non_scan_event'; eventName: BunnyStorageHandledEvent }
  | { kind: 'scan_event'; eventName: 'FileScanCompleted'; storagePath: string; scanResult: ScanStatus; scanDetails: string | null }
  | { kind: 'malformed'; reason: string }

/** Parse a Bunny Storage webhook body into a typed outcome. The
 *  handler uses the kind discriminator to decide what to update on
 *  the partner_uploads row. */
export function parseBunnyStorageEvent(payload: unknown): BunnyStorageParseOutcome {
  if (!payload || typeof payload !== 'object') {
    return { kind: 'malformed', reason: 'payload not an object' }
  }
  const obj = payload as Record<string, unknown>
  const eventName = typeof obj.EventName === 'string' ? obj.EventName : ''
  // Bunny has never sent an empty EventName — a blank value means a
  // structural anomaly (transit corruption, misconfigured client,
  // etc.). Surface as malformed so the handler logs a warning instead
  // of accepting a "we'll ignore this" outcome for a bad payload.
  if (eventName === '') {
    return { kind: 'malformed', reason: 'Storage payload missing EventName field' }
  }
  if (!BUNNY_STORAGE_HANDLED_EVENTS.includes(eventName as BunnyStorageHandledEvent)) {
    return { kind: 'unknown_event', eventName }
  }

  // Non-scan events are routed to `non_scan_event` so the handler
  // can still record an audit row but doesn't try to flip scan_status.
  if (eventName !== 'FileScanCompleted') {
    return {
      kind: 'non_scan_event',
      eventName: eventName as BunnyStorageHandledEvent,
    }
  }

  const objectName = typeof obj.ObjectName === 'string' ? obj.ObjectName : ''
  if (!objectName) {
    return { kind: 'malformed', reason: 'FileScanCompleted payload missing ObjectName' }
  }

  const scanResult = parseBunnyStorageScanResult(obj.ScanResult)
  if (scanResult === null) {
    return {
      kind: 'malformed',
      reason: `FileScanCompleted with unrecognized ScanResult: ${JSON.stringify(obj.ScanResult)}`,
    }
  }

  const scanDetails =
    typeof obj.ScanDetails === 'string' && obj.ScanDetails.length > 0
      ? obj.ScanDetails.slice(0, 2000) // bounded — audit + log safety
      : null

  return {
    kind: 'scan_event',
    eventName: 'FileScanCompleted',
    storagePath: objectName,
    scanResult,
    scanDetails,
  }
}

// ---------------------------------------------------------------------------
// Bunny Stream transcode-result shape
// ---------------------------------------------------------------------------

/** Canonical status codes per Bunny Stream docs (2026-06-30). */
export const BUNNY_STREAM_STATUS_CREATED = 0
export const BUNNY_STREAM_STATUS_PROCESSING = 1
export const BUNNY_STREAM_STATUS_READY = 2
export const BUNNY_STREAM_STATUS_FAILED = 3
export const BUNNY_STREAM_STATUS_UPLOAD_FAILED = 4
export const BUNNY_STREAM_STATUS_PRESIGN_EXPIRED = 5

export function parseBunnyStreamStatus(value: unknown): EncodingStatus | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  switch (value) {
    case BUNNY_STREAM_STATUS_CREATED:
    case BUNNY_STREAM_STATUS_PROCESSING:
      return 'processing'
    case BUNNY_STREAM_STATUS_READY:
      return 'ready'
    case BUNNY_STREAM_STATUS_FAILED:
    case BUNNY_STREAM_STATUS_UPLOAD_FAILED:
    case BUNNY_STREAM_STATUS_PRESIGN_EXPIRED:
      return 'failed'
    default:
      return null
  }
}

export type BunnyStreamParseOutcome =
  | { kind: 'unknown_event'; eventName: string }
  | { kind: 'transcode_event'; videoGuid: string; status: EncodingStatus; resolutions: string | null; errorMessage: string | null }
  | { kind: 'malformed'; reason: string }

/** Lowercase + trimmed label for the Bunny Stream event types we
 *  recognize. Bunny's stream webhook payload carries
 *  EventName-ish fields inconsistently across account ages — the
 *  parser key is the lowercase of whatever string the body exposes. */
export const BUNNY_STREAM_HANDLED_EVENT_LABELS = [
  'videostatuschanged',
  'videoencoded',
  'videouploaded',
  'videoerror',
] as const

export function parseBunnyStreamEvent(payload: unknown): BunnyStreamParseOutcome {
  if (!payload || typeof payload !== 'object') {
    return { kind: 'malformed', reason: 'payload not an object' }
  }
  const obj = payload as Record<string, unknown>

  // Resolve the event label from any of the fields Bunny has used
  // over time. For unknown payloads we still surface the raw label
  // so the audit log can correlate.
  const rawEvent =
    typeof obj.EventName === 'string'
      ? obj.EventName
      : typeof obj.event === 'string'
        ? obj.event
        : ''
  // Bunny Stream has never sent a payload without an event field —
  // a blank value is a structural anomaly. Surface as malformed so
  // the handler logs a warning rather than silently accepting a bad
  // payload as 'unknown_event' (which would be discarded without
  // surfacing the problem).
  if (rawEvent === '') {
    return { kind: 'malformed', reason: 'Stream payload missing EventName/event field' }
  }
  const normalizedEvent = rawEvent.toLowerCase()

  // Bunny Stream fires VideoStatusChanged (or VideoEncoded for the
  // older webhook format) on every status transition, including
  // 'Ready' and 'Failed'. We dispatch on the Status code in the
  // payload — the event label is informational only.
  if (!BUNNY_STREAM_HANDLED_EVENT_LABELS.includes(normalizedEvent as (typeof BUNNY_STREAM_HANDLED_EVENT_LABELS)[number])) {
    return { kind: 'unknown_event', eventName: rawEvent }
  }

  const videoGuid = typeof obj.VideoGuid === 'string' ? obj.VideoGuid : ''
  if (!videoGuid) {
    return { kind: 'malformed', reason: 'stream payload missing VideoGuid' }
  }

  const status = parseBunnyStreamStatus(obj.Status)
  if (status === null) {
    return {
      kind: 'malformed',
      reason: `stream payload Status not in {{0,1,2,3,4,5}}: ${JSON.stringify(obj.Status)}`,
    }
  }

  const resolutions =
    typeof obj.Resolutions === 'string' && obj.Resolutions.length > 0
      ? obj.Resolutions.slice(0, 256)
      : null
  const errorMessage =
    typeof obj.ErrorMessage === 'string' && obj.ErrorMessage.length > 0
      ? obj.ErrorMessage.slice(0, 1000)
      : null

  return {
    kind: 'transcode_event',
    videoGuid,
    status,
    resolutions,
    errorMessage,
  }
}
