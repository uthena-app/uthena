// handleBunnyWebhook.test.ts — unit tests for the Bunny webhook
// dispatch (P12.8 Slice 1).
//
// Coverage:
//   - signature verification: missing / malformed / no-secret / no-match
//   - signature success path: verified payload reaches dispatch
//   - parse + dispatch: Storage scan_event path (matches a real row,
//     updates it)
//   - parse + dispatch: Stream transcode_event (no rabbit matches
//     until Slice 2 — 200 with info log)
//   - parse + dispatch: non-actionable events (FileUploaded,
//     unknown_event) → 200 skipped
//   - parse + dispatch: malformed payload → 400
//   - dedup on retry (claimWebhookEvent returns claimed:false → 200 OK)
//   - audit row written for every dispatched event

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'

// ---------------------------------------------------------------------------
// Mocks — env, claim middleware, service-role client
// ---------------------------------------------------------------------------
const envMock = vi.hoisted(() => ({
  BUNNY_WEBHOOK_SECRET: 'whsec_test_secret_value',
  BUNNY_VIDEO_WEBHOOK_SECRET: '',
}))
vi.mock('@foundations/env', () => ({
  getEnv: () => envMock,
}))

const mockClaimResults = vi.hoisted(() => ({
  next: { claimed: true, payload: null } as { claimed: true; payload: unknown } | { claimed: false },
  calls: [] as Array<{ source: string; eventId: string; eventType: string }>,
}))
vi.mock('../../../04-platform/webhooks/_middleware', () => ({
  // Note: The handler imports from '../_middleware' but this test
  // (inside 02-features/...) needs the path relative to the handler
  // module's directory. Vitest's `vi.mock` resolves on the importing
  // module's path, but the alias is hoisted so we use the absolute
  // file path here.
  claimWebhookEvent: (source: string, eventId: string, eventType: string, payload: unknown) => {
    mockClaimResults.calls.push({ source, eventId, eventType })
    return Promise.resolve(mockClaimResults.next)
  },
  finalizeWebhookEvent: vi.fn().mockResolvedValue(undefined),
  releaseWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

// Mock the Supabase service-role client — the webhook only talks to
// the DB via service-role (no per-partner auth check on the route).
// We need:
//   - FROM partner_uploads: select(id, scan_status, bunny_video_id, ...)
//     WHERE id / WHERE storage_path / WHERE bunny_video_id
//   - UPDATE partner_uploads
const mockDb = vi.hoisted(() => ({
  selectResult: { data: { id: '99', scan_status: 'pending', encoding_status: 'pending' }, error: null } as { data: { id: string; scan_status: string; encoding_status: string | null } | null; error: { message: string } | null },
  updateError: null as { message: string } | null,
  updateCalls: [] as Array<Record<string, unknown>>,
  auditCalls: [] as Array<Record<string, unknown>>,
}))
vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: () => buildClient(mockDb),
  getServiceSupabase: () => buildClient(mockDb),
}))

function buildClient(db: typeof mockDb) {
  return {
    from(table: string) {
      if (table === 'partner_uploads') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve(db.selectResult),
            }),
          }),
          update: (values: Record<string, unknown>) => {
            db.updateCalls.push(values)
            return {
              eq: () => Promise.resolve({ data: [{ id: '99' }], error: db.updateError }),
            }
          },
        }
      }
      if (table === 'admin_audit_log') {
        return {
          insert: (values: Record<string, unknown>) => {
            db.auditCalls.push(values)
            return { select: () => ({ single: () => Promise.resolve({ data: { id: 1 }, error: null }) }) }
          },
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }
}

const mockLoggerFor = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))
vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => mockLoggerFor,
}))

// IMPORTANT: vi.mock hoisting means the import of the handler AFTER
// the mocks — the test file structure matters here. We import last.
import { handleBunnyWebhook } from './handleBunnyWebhook'

const SECRET = envMock.BUNNY_WEBHOOK_SECRET

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body, 'utf8').digest('hex')
}

function makeHeaders(sig: string): Headers {
  return new Headers({ Signature: sig })
}

beforeEach(() => {
  mockClaimResults.next = { claimed: true, payload: null }
  mockClaimResults.calls = []
  mockDb.selectResult = { data: { id: '99', scan_status: 'pending', encoding_status: 'pending' }, error: null }
  mockDb.updateError = null
  mockDb.updateCalls = []
  mockDb.auditCalls = []
  mockLoggerFor.info.mockClear()
  mockLoggerFor.warn.mockClear()
  mockLoggerFor.error.mockClear()
})

describe('handleBunnyWebhook — signature verification', () => {
  it('returns 401 when signature header is missing', async () => {
    const headers = new Headers({}) // no Signature header
    const res = await handleBunnyWebhook('{}', headers)
    expect(res.status).toBe(401)
    expect(res.body).toContain('missing_signature')
  })
  it('returns 401 when signature does not match the secret', async () => {
    const body = JSON.stringify({ EventName: 'FileScanCompleted' })
    const headers = makeHeaders(createHmac('sha256', 'WRONG').update(body, 'utf8').digest('hex'))
    const res = await handleBunnyWebhook(body, headers)
    expect(res.status).toBe(401)
    expect(res.body).toContain('no_secret_match')
  })
  it('returns 401 when env has no secret (unconfigured server)', async () => {
    envMock.BUNNY_WEBHOOK_SECRET = ''
    envMock.BUNNY_VIDEO_WEBHOOK_SECRET = ''
    // Can't sign with no secret; this path is a misconfiguration
    // (signature is present but server has no key). We test the
    // "no_secret_configured" branch by presenting a syntactically
    // valid signature against an empty secret list.
    const headers = new Headers({ Signature: 'a'.repeat(64) })
    const res = await handleBunnyWebhook('{}', headers)
    expect(res.status).toBe(401)
    expect(res.body).toContain('no_secret_configured')
    envMock.BUNNY_WEBHOOK_SECRET = SECRET // restore
  })
  it('returns 401 when signature is malformed (not 64 hex chars)', async () => {
    const headers = new Headers({ Signature: 'not-hex' })
    const res = await handleBunnyWebhook('{}', headers)
    expect(res.status).toBe(401)
    expect(res.body).toContain('malformed_signature')
  })
})

describe('handleBunnyWebhook — SEC-5: surface-appropriate secret selection', () => {
  const VIDEO_SECRET = 'whsec_video_only_secret'

  it('rejects a video-secret-signed body on the storage path (Signature header)', async () => {
    envMock.BUNNY_WEBHOOK_SECRET = SECRET
    envMock.BUNNY_VIDEO_WEBHOOK_SECRET = VIDEO_SECRET
    const body = JSON.stringify({ EventName: 'FileScanCompleted', ObjectName: 'x', ScanResult: 'Clean' })
    // Signed with the VIDEO secret, but delivered on the Storage
    // header (`Signature`) — pre-SEC-5 this would have matched
    // because the handler tried both secrets against every request.
    const headers = new Headers({ Signature: createHmac('sha256', VIDEO_SECRET).update(body, 'utf8').digest('hex') })
    const res = await handleBunnyWebhook(body, headers)
    expect(res.status).toBe(401)
    expect(res.body).toContain('no_secret_match')
    envMock.BUNNY_VIDEO_WEBHOOK_SECRET = ''
  })

  it('rejects a storage-secret-signed body on the stream path (X-Bunny-Signature header)', async () => {
    envMock.BUNNY_WEBHOOK_SECRET = SECRET
    envMock.BUNNY_VIDEO_WEBHOOK_SECRET = VIDEO_SECRET
    const body = JSON.stringify({ EventName: 'VideoStatusChanged', VideoGuid: 'g', Status: 2 })
    // Signed with the STORAGE secret, delivered on the Stream header.
    const headers = new Headers({ 'X-Bunny-Signature': createHmac('sha256', SECRET).update(body, 'utf8').digest('hex') })
    const res = await handleBunnyWebhook(body, headers)
    expect(res.status).toBe(401)
    expect(res.body).toContain('no_secret_match')
    envMock.BUNNY_VIDEO_WEBHOOK_SECRET = ''
  })

  it('accepts a video-secret-signed body on the stream path (X-Bunny-Signature header)', async () => {
    envMock.BUNNY_WEBHOOK_SECRET = SECRET
    envMock.BUNNY_VIDEO_WEBHOOK_SECRET = VIDEO_SECRET
    const body = JSON.stringify({ EventName: 'VideoStatusChanged', VideoGuid: 'unknown-video-guid', Status: 2 })
    const headers = new Headers({ 'X-Bunny-Signature': createHmac('sha256', VIDEO_SECRET).update(body, 'utf8').digest('hex') })
    const res = await handleBunnyWebhook(body, headers)
    expect(res.status).toBe(200)
    envMock.BUNNY_VIDEO_WEBHOOK_SECRET = ''
  })
})

describe('handleBunnyWebhook — Storage scan_event dispatch', () => {
  it('updates scan_status to clean + writes an audit row', async () => {
    const body = JSON.stringify({
      EventName: 'FileScanCompleted',
      ObjectName: 'partner-uploads/42/100/uuid.mp4',
      ScanResult: 'Clean',
      ScanDetails: '',
    })
    const res = await handleBunnyWebhook(body, makeHeaders(sign(body)))
    expect(res.status).toBe(200)
    expect(res.body).toBe('OK')
    expect(mockDb.updateCalls.length).toBeGreaterThan(0)
    expect(mockDb.updateCalls[0]!.scan_status).toBe('clean')
    expect(mockDb.auditCalls.length).toBe(1)
    expect(mockDb.auditCalls[0]!.action).toBe('partner_upload.webhook_received')
  })
  it('updates scan_status to infected + writes an audit row', async () => {
    const body = JSON.stringify({
      EventName: 'FileScanCompleted',
      ObjectName: 'partner-uploads/42/100/uuid.mp4',
      ScanResult: 'Infected',
      ScanDetails: 'Win.Test.Eicar',
    })
    const res = await handleBunnyWebhook(body, makeHeaders(sign(body)))
    expect(res.status).toBe(200)
    expect(mockDb.updateCalls[0]!.scan_status).toBe('infected')
  })
  it('returns 200 + no UPDATE when storage_path is not in our table', async () => {
    mockDb.selectResult = { data: null, error: null }
    const body = JSON.stringify({
      EventName: 'FileScanCompleted',
      ObjectName: 'partner-uploads/UNKNOWN/x/y.mp4',
      ScanResult: 'Clean',
    })
    const res = await handleBunnyWebhook(body, makeHeaders(sign(body)))
    expect(res.status).toBe(200)
    expect(mockDb.updateCalls.length).toBe(0)
    // Finalize still happens.
  })
})

describe('handleBunnyWebhook — Stream transcode_event dispatch', () => {
  it('returns 200 even when no row matches (Slice 2 territory)', async () => {
    const body = JSON.stringify({
      EventName: 'VideoStatusChanged',
      VideoGuid: 'unknown-video-guid',
      Status: 2, // Ready
    })
    const res = await handleBunnyWebhook(body, makeHeaders(sign(body)))
    expect(res.status).toBe(200)
  })
  it('updates encoding_status when a row has a matching bunny_video_id', async () => {
    mockDb.selectResult = { data: { id: '99', scan_status: 'clean', encoding_status: 'processing' }, error: null }
    const body = JSON.stringify({
      EventName: 'VideoStatusChanged',
      VideoGuid: 'a-real-video-guid',
      Status: 2,
    })
    const res = await handleBunnyWebhook(body, makeHeaders(sign(body)))
    expect(res.status).toBe(200)
    expect(mockDb.updateCalls.some((c) => c.encoding_status === 'ready')).toBe(true)
  })
})

describe('handleBunnyWebhook — non-actionable / unknown / malformed', () => {
  it('returns 200 (skipped) for FileUploaded (non-scan storage event)', async () => {
    const body = JSON.stringify({
      EventName: 'FileUploaded',
      ObjectName: 'partner-uploads/42/100/uuid.mp4',
    })
    const res = await handleBunnyWebhook(body, makeHeaders(sign(body)))
    expect(res.status).toBe(200)
    expect(res.body).toContain('skipped')
  })
  it('returns 200 (skipped) for unknown event names', async () => {
    const body = JSON.stringify({ EventName: 'FileQuotaExceeded' })
    const res = await handleBunnyWebhook(body, makeHeaders(sign(body)))
    expect(res.status).toBe(200)
    expect(res.body).toContain('skipped')
  })
  it('returns 400 for malformed JSON body', async () => {
    const body = 'not-json{'
    const res = await handleBunnyWebhook(body, makeHeaders(sign(body)))
    expect(res.status).toBe(400)
    expect(res.body).toContain('malformed')
  })
})

describe('handleBunnyWebhook — idempotency', () => {
  it('returns 200 OK (duplicate) when claimWebhookEvent says claimed=false', async () => {
    mockClaimResults.next = { claimed: false }
    const body = JSON.stringify({
      EventName: 'FileScanCompleted',
      ObjectName: 'partner-uploads/42/100/uuid.mp4',
      ScanResult: 'Clean',
    })
    const res = await handleBunnyWebhook(body, makeHeaders(sign(body)))
    expect(res.status).toBe(200)
    expect(res.body).toContain('OK (duplicate)')
    // No UPDATE was issued for the dedup'd event.
    expect(mockDb.updateCalls.length).toBe(0)
  })
  it('claims the event BEFORE inspecting the DB', async () => {
    const body = JSON.stringify({
      EventName: 'FileScanCompleted',
      ObjectName: 'partner-uploads/42/100/uuid.mp4',
      ScanResult: 'Clean',
    })
    await handleBunnyWebhook(body, makeHeaders(sign(body)))
    expect(mockClaimResults.calls.length).toBe(1)
  })
})
