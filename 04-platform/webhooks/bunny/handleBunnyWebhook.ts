// handleBunnyWebhook.ts — the actual webhook dispatch logic for the
// Bunny Storage scan-result + Bunny Stream transcode-result events,
// mounted at /api/webhooks/bunny. Kept in 04-platform/ so it lives
// next to the Stripe webhook handler.
//
// The route is a thin Next.js adapter at app/api/webhooks/bunny/route.ts.
// This module owns signature verification + parsing + idempotency +
// DB dispatch + audit.
//
// Bunny has two webhook surfaces (Storage + Stream). They share the
// same URL because the spec puts them at /api/webhooks/bunny; the
// handler dispatches on payload shape:
//   - scan_event / non_scan_event / unknown_event payload → Storage
//     webhook path (storage_path in payload)
//   - transcode_event payload → Stream webhook path (VideoGuid +
//     Status in payload)
//
// Step-by-step (mirrors the Stripe handler at
// handleStripeWebhook.ts:1-12):
//   1. Read the signature header. Returns 401 if missing.
//   2. Verify HMAC against the per-surface secret list. Returns 401
//      on bad signature.
//   3. Try to claim the event id (idempotency). Returns 200 on
//      duplicate (Bunny retried the delivery).
//   4. Parse the payload (split between Storage + Stream shapes).
//   5. Dispatch to the partner_uploads UPDATE.
//   6. Finalize the processed_webhooks row.

import 'server-only'

import { getServiceSupabase } from '@foundations/data/supabase'
import { getEnv } from '@foundations/env'
import { loggerFor } from '@foundations/log/pino'
import type { ScanStatus, EncodingStatus } from '@foundations/data/enums'

import {
  parseBunnyStorageEvent,
  parseBunnyStreamEvent,
} from '@features/partner-upload/lib/bunny-webhook-payload'
import {
  readBunnySignature,
  verifyBunnyWebhookSignature,
} from '@features/partner-upload/lib/bunny-webhook-signature'

import {
  claimWebhookEvent,
  finalizeWebhookEvent,
  releaseWebhookEvent,
  type WebhookOutcome,
} from '../_middleware'

const log = loggerFor({ component: 'webhooks.bunny' })

export type WebhookResponse = { status: number; body: string }

export async function handleBunnyWebhook(
  rawBody: string,
  headers: Headers,
): Promise<WebhookResponse> {
  const env = getEnv()

  // -------------------------------------------------------------
  // 1. Signature verification
  //
  // SEC-5: pick the surface-appropriate secret from WHICH header is
  // present, instead of trying both secrets against every request.
  // `X-Bunny-Signature` is the Stream (video) surface → video secret;
  // `Signature` is the Storage surface → storage secret. Trying both
  // secrets on either surface meant a leaked storage secret also
  // validated video events and vice versa — the intended secret
  // separation was nominal only. `readBunnySignature` already prefers
  // `Signature` over `X-Bunny-Signature` when both are present (see
  // its own doc comment) — we check the headers directly here (rather
  // than widening that shared helper's return shape) purely to learn
  // WHICH header supplied the value, so we can select one secret
  // instead of a list.
  // -------------------------------------------------------------
  const signature = readBunnySignature(headers)
  const isStreamSurface = headers.has('X-Bunny-Signature') && !headers.has('Signature')
  const secretForSurface = isStreamSurface ? env.BUNNY_VIDEO_WEBHOOK_SECRET : env.BUNNY_WEBHOOK_SECRET
  const verify = verifyBunnyWebhookSignature({
    rawBody,
    signature,
    secrets: secretForSurface ? [secretForSurface] : [],
  })
  if (!verify.ok) {
    log.warn({ code: verify.reason }, 'bunny webhook signature verification failed')
    return {
      status: 401,
      body: `bunny webhook signature ${verify.reason}`,
    }
  }

  // -------------------------------------------------------------
  // 2. Payload parse (Bunny sends JSON bodies)
  // -------------------------------------------------------------
  let payloadJson: unknown
  try {
    payloadJson = JSON.parse(rawBody)
  } catch {
    log.warn({ code: 'malformed_json' }, 'bunny webhook body is not valid JSON')
    return { status: 400, body: 'malformed JSON' }
  }

  // Bunny does not include an event id in the body. Synthesize one
  // from the shape + a small slice of the body so the dedup table
  // catches retries. (Bunny retries on 5xx; we want to surface
  // 200 on the retry so they stop, even though our UPDATE is
  // idempotent on its own.)
  const eventId = synthBunnyEventId(payloadJson)
  const eventType = synthBunnyEventType(payloadJson)

  // -------------------------------------------------------------
  // 3. Idempotency (claim the event id BEFORE we touch the DB)
  // -------------------------------------------------------------
  let claim
  try {
    claim = await claimWebhookEvent('bunny', eventId, eventType, payloadJson)
  } catch {
    return { status: 500, body: 'idempotency error' }
  }
  if (!claim.claimed) {
    return { status: 200, body: 'OK (duplicate)' }
  }

  // -------------------------------------------------------------
  // 4. Dispatch — try Storage shape first, then Stream shape
  // -------------------------------------------------------------
  let outcome: WebhookOutcome = 'processed'
  try {
    const storage = parseBunnyStorageEvent(payloadJson)
    if (storage.kind === 'scan_event') {
      const updateResult = await applyStorageScanUpdate(storage.storagePath, {
        scanResult: storage.scanResult,
        scanDetails: storage.scanDetails,
      })
      if (!updateResult.ok) {
        await releaseWebhookEvent('bunny', eventId)
        return updateResult.response
      }
      await writeBunnyAuditRow({
        eventName: 'FileScanCompleted',
        storagePath: storage.storagePath,
        scanStatus: storage.scanResult,
        encodingStatus: null,
      })
      return { status: 200, body: 'OK' }
    }

    const stream = parseBunnyStreamEvent(payloadJson)
    if (stream.kind === 'transcode_event') {
      const updateResult = await applyStreamTranscodeUpdate(stream.videoGuid, {
        encodingStatus: stream.status,
      })
      if (!updateResult.ok) {
        await releaseWebhookEvent('bunny', eventId)
        return updateResult.response
      }
      await writeBunnyAuditRow({
        eventName: 'VideoStatusChanged',
        storagePath: null,
        scanStatus: null,
        encodingStatus: stream.status,
        videoGuid: stream.videoGuid,
      })
      return { status: 200, body: 'OK' }
    }

    // Unknown / non-actionable event — record as skipped and 200.
    outcome = 'skipped'
    log.info(
      { code: 'webhook_skipped', event_id: eventId },
      'bunny webhook event was not actionable',
    )
    await finalizeWebhookEvent('bunny', eventId, 'skipped')
    return { status: 200, body: 'OK (skipped)' }
  } catch (err) {
    await releaseWebhookEvent('bunny', eventId)
    log.error(
      { code: 'handler_threw', err: (err as Error).message },
      'bunny webhook handler threw',
    )
    return { status: 500, body: 'handler error' }
  }
}

// ---------------------------------------------------------------------------
// Storage scan-result UPDATE — find the row by storage_path (the
// webhook's only stable identifier) and flip scan_status +
// scan_started_at / scan_completed_at + scan_result. The
// service-role client bypasses RLS so the UPDATE always finds the
// row regardless of which partner owns it (the route is admin-only
// by URL — there's no per-partner auth check here; the Bunny secret
// IS the auth).
// ---------------------------------------------------------------------------
async function applyStorageScanUpdate(
  storagePath: string,
  opts: { scanResult: ScanStatus; scanDetails: string | null },
): Promise<
  | { ok: true }
  | { ok: false; response: WebhookResponse }
> {
  const service = getServiceSupabase()
  // First: confirm the row exists (the webhook could fire for an
  // object we never registered). We log + 200 in that case (the
  // event isn't ours; Bunny may be configured for multiple zones).
  const { data: row, error: lookupError } = await service
    .from('partner_uploads')
    .select('id, scan_status')
    .eq('storage_path', storagePath)
    .maybeSingle()
  if (lookupError) {
    log.warn(
      { code: 'scan_update_lookup_failed', storage_path_hash: hash(storagePath), msg: lookupError.message },
      'scan update lookup failed',
    )
    return { ok: false, response: { status: 500, body: 'lookup error' } }
  }
  if (!row) {
    // Storage path not in our table — the webhook fired for a
    // different zone or a deleted row. 200 + log so Bunny stops
    // retrying (we have no row to update).
    log.info(
      {
        code: 'scan_update_no_row',
        storage_path_prefix: storagePath.slice(0, 32),
      },
      'scan webhook fired for unknown storage_path',
    )
    return { ok: true }
  }
  const nowIso = new Date().toISOString()
  const { error: updateError } = await service
    .from('partner_uploads')
    .update({
      scan_status: opts.scanResult,
      scan_started_at: (row as unknown as { scan_status: string }).scan_status === 'pending' ? nowIso : undefined,
      scan_completed_at: nowIso,
      scan_result: opts.scanDetails ?? null,
      webhook_received_at: nowIso,
      updated_at: nowIso,
    } as never)
    .eq('id', (row as unknown as { id: string }).id)
  if (updateError) {
    log.warn(
      {
        code: 'scan_update_failed',
        upload_id: (row as unknown as { id: string }).id,
        msg: updateError.message,
      },
      'scan update failed',
    )
    return { ok: false, response: { status: 500, body: 'update error' } }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Stream transcode-result UPDATE — locate the row by bunny_video_id
// (set by the future Slice 2 mint step that uses Bunny Stream's tus
// endpoint). Slice 1's `partner_upload.file_registered` doesn't yet
// populate bunny_video_id, so this branch is a no-op pending Slice 2.
// We log + 200 to avoid pestering Bunny with retries on a row we
// can't yet correlate.
// ---------------------------------------------------------------------------
async function applyStreamTranscodeUpdate(
  videoGuid: string,
  opts: { encodingStatus: EncodingStatus },
): Promise<
  | { ok: true }
  | { ok: false; response: WebhookResponse }
> {
  const service = getServiceSupabase()
  const { data: row, error: lookupError } = await service
    .from('partner_uploads')
    .select('id, encoding_status')
    .eq('bunny_video_id', videoGuid)
    .maybeSingle()
  if (lookupError) {
    log.warn(
      { code: 'encoding_update_lookup_failed', video_guid_hash: hash(videoGuid), msg: lookupError.message },
      'encoding update lookup failed',
    )
    return { ok: false, response: { status: 500, body: 'lookup error' } }
  }
  if (!row) {
    // Slice 2 will populate bunny_video_id; until then, the row
    // can't be correlated from a Stream event. 200 + log so Bunny
    // stops retrying.
    log.info(
      {
        code: 'encoding_update_no_row',
        video_guid_prefix: videoGuid.slice(0, 8),
      },
      'encoding webhook fired for unknown VideoGuid (Slice 2 territory)',
    )
    return { ok: true }
  }
  const nowIso = new Date().toISOString()
  const { error: updateError } = await service
    .from('partner_uploads')
    .update({
      encoding_status: opts.encodingStatus,
      webhook_received_at: nowIso,
      updated_at: nowIso,
    } as never)
    .eq('id', (row as unknown as { id: string }).id)
  if (updateError) {
    log.warn(
      {
        code: 'encoding_update_failed',
        upload_id: (row as unknown as { id: string }).id,
        msg: updateError.message,
      },
      'encoding update failed',
    )
    return { ok: false, response: { status: 500, body: 'update error' } }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Audit row writer — service-role INSERT so the bunny caller (no
// session) can still write a row. target_kind is 'partner_uploads'
// when we located a row, 'processed_webhooks' otherwise.
// ---------------------------------------------------------------------------
async function writeBunnyAuditRow(opts: {
  eventName: string
  storagePath: string | null
  scanStatus: ScanStatus | null
  encodingStatus: EncodingStatus | null
  videoGuid?: string
}): Promise<void> {
  const service = getServiceSupabase()
  const { error } = await service.from('admin_audit_log').insert({
    actor_id: null,
    actor_email: '',
    action: 'partner_upload.webhook_received',
    target_kind: 'partner_uploads',
    target_id: '0', // webhook rows don't know the row id; the storage_path or video_guid is in metadata
    metadata: {
      event_name: opts.eventName,
      storage_path_prefix: opts.storagePath?.slice(0, 32) ?? null,
      scan_status: opts.scanStatus ?? null,
      encoding_status: opts.encodingStatus ?? null,
      video_guid_prefix: opts.videoGuid?.slice(0, 8) ?? null,
    },
    ip: null,
    user_agent: null,
  } as never)
  if (error) {
    log.warn(
      { code: 'audit_write_failed', msg: error.message },
      'writeBunnyAuditRow failed',
    )
  }
}

// ---------------------------------------------------------------------------
// Helpers — pure ID synth (Bunny doesn't include an event id in the
// body, so we synthesize one from the payload shape).
// ---------------------------------------------------------------------------
function synthBunnyEventId(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return 'bunny:malformed'
  const obj = payload as Record<string, unknown>
  // For Storage: ObjectName + EventName + scan result. For Stream:
  // VideoGuid + EventName. Fall back to a hash of the JSON.
  const eventName =
    typeof obj.EventName === 'string'
      ? obj.EventName
      : typeof obj.event === 'string'
        ? obj.event
        : 'unknown'
  const objectName =
    typeof obj.ObjectName === 'string' ? obj.ObjectName : ''
  const videoGuid = typeof obj.VideoGuid === 'string' ? obj.VideoGuid : ''
  const scanResult = typeof obj.ScanResult === 'string' ? obj.ScanResult : ''
  const status = obj.Status
  return `bunny:${eventName}:${objectName || videoGuid}:${scanResult}:${String(status)}`
}

function synthBunnyEventType(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return 'unknown'
  const obj = payload as Record<string, unknown>
  if (typeof obj.EventName === 'string') return obj.EventName
  if (typeof obj.event === 'string') return obj.event
  if (typeof obj.VideoGuid === 'string') return 'stream'
  return 'storage'
}

// ---------------------------------------------------------------------------
// Tiny hash for log correlation — keeps Bunny-supplied identifiers
// (storage paths, video GUIDs) out of logs while still letting ops
// correlate rows across runs. FNV-1a 32-bit (matches the pattern used
// by P9.10 storage_usage + P12.4 dashboard).
// ---------------------------------------------------------------------------
function hash(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = (h * 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
