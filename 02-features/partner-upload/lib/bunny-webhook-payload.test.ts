// bunny-webhook-payload.test.ts — unit tests for the Bunny Storage
// scan-result + Bunny Stream transcode-result payload parsers.

import { describe, expect, it } from 'vitest'
import {
  BUNNY_STREAM_HANDLED_EVENT_LABELS,
  BUNNY_STREAM_STATUS_FAILED,
  BUNNY_STREAM_STATUS_PROCESSING,
  BUNNY_STREAM_STATUS_READY,
  BUNNY_STREAM_STATUS_UPLOAD_FAILED,
  parseBunnyStorageEvent,
  parseBunnyStorageScanResult,
  parseBunnyStreamEvent,
  parseBunnyStreamStatus,
} from './bunny-webhook-payload'

describe('parseBunnyStorageScanResult', () => {
  it("'Clean' → scan_status='clean'", () => {
    expect(parseBunnyStorageScanResult('Clean')).toBe('clean')
  })
  it("'Infected' → scan_status='infected'", () => {
    expect(parseBunnyStorageScanResult('Infected')).toBe('infected')
  })
  it("'Error' → scan_status='failed'", () => {
    expect(parseBunnyStorageScanResult('Error')).toBe('failed')
  })
  it("'Failed' → scan_status='failed' (defensive against historical alias)", () => {
    expect(parseBunnyStorageScanResult('Failed')).toBe('failed')
  })
  it('trims whitespace', () => {
    expect(parseBunnyStorageScanResult('  Clean  ')).toBe('clean')
  })
  it('returns null for unknown values', () => {
    expect(parseBunnyStorageScanResult('Quarantined')).toBeNull()
    expect(parseBunnyStorageScanResult('')).toBeNull()
  })
  it('returns null for non-string types', () => {
    expect(parseBunnyStorageScanResult(null)).toBeNull()
    expect(parseBunnyStorageScanResult(undefined)).toBeNull()
    expect(parseBunnyStorageScanResult(0)).toBeNull()
  })
})

describe('parseBunnyStorageEvent — happy paths', () => {
  it('parses a FileScanCompleted:Clean event into scan_event', () => {
    const payload = {
      EventName: 'FileScanCompleted',
      ObjectName: 'partner-uploads/42/12345/uuid.mp4',
      ScanResult: 'Clean',
      ScanDetails: '',
    }
    const outcome = parseBunnyStorageEvent(payload)
    expect(outcome).toEqual({
      kind: 'scan_event',
      eventName: 'FileScanCompleted',
      storagePath: 'partner-uploads/42/12345/uuid.mp4',
      scanResult: 'clean',
      scanDetails: null,
    })
  })
  it('captures ScanDetails when non-empty', () => {
    const payload = {
      EventName: 'FileScanCompleted',
      ObjectName: 'partner-uploads/42/12345/uuid.mp4',
      ScanResult: 'Infected',
      ScanDetails: 'Win.Test.Eicar FOUND',
    }
    const outcome = parseBunnyStorageEvent(payload)
    if (outcome.kind !== 'scan_event') throw new Error('expected scan_event')
    expect(outcome.scanDetails).toBe('Win.Test.Eicar FOUND')
    expect(outcome.scanResult).toBe('infected')
  })
  it('caps ScanDetails at 2000 chars (defensive against huge payloads)', () => {
    const huge = 'x'.repeat(5000)
    const payload = {
      EventName: 'FileScanCompleted',
      ObjectName: 'partner-uploads/42/12345/uuid.mp4',
      ScanResult: 'Clean',
      ScanDetails: huge,
    }
    const outcome = parseBunnyStorageEvent(payload)
    if (outcome.kind !== 'scan_event') throw new Error('expected scan_event')
    expect(outcome.scanDetails?.length).toBe(2000)
  })
  it('routes FileUploaded to non_scan_event', () => {
    const outcome = parseBunnyStorageEvent({
      EventName: 'FileUploaded',
      ObjectName: 'partner-uploads/42/12345/uuid.mp4',
    })
    expect(outcome.kind).toBe('non_scan_event')
    if (outcome.kind === 'non_scan_event') {
      expect(outcome.eventName).toBe('FileUploaded')
    }
  })
  it('routes FileReplaced to non_scan_event', () => {
    const outcome = parseBunnyStorageEvent({ EventName: 'FileReplaced' })
    expect(outcome.kind).toBe('non_scan_event')
  })
  it('routes FileDeleted to non_scan_event', () => {
    const outcome = parseBunnyStorageEvent({ EventName: 'FileDeleted' })
    expect(outcome.kind).toBe('non_scan_event')
  })
})

describe('parseBunnyStorageEvent — failure paths', () => {
  it('returns unknown_event for unknown EventName', () => {
    const outcome = parseBunnyStorageEvent({ EventName: 'FileQuotaExceeded' })
    expect(outcome.kind).toBe('unknown_event')
    if (outcome.kind === 'unknown_event') {
      expect(outcome.eventName).toBe('FileQuotaExceeded')
    }
  })
  it('returns malformed when EventName is missing (structural anomaly)', () => {
    const outcome = parseBunnyStorageEvent({ ObjectName: 'x' })
    expect(outcome.kind).toBe('malformed')
  })
  it('returns malformed when payload is not an object', () => {
    expect(parseBunnyStorageEvent(null).kind).toBe('malformed')
    expect(parseBunnyStorageEvent('string').kind).toBe('malformed')
    expect(parseBunnyStorageEvent(0).kind).toBe('malformed')
    expect(parseBunnyStorageEvent({}).kind).toBe('malformed')
  })
  it('returns malformed when FileScanCompleted has no ObjectName', () => {
    const outcome = parseBunnyStorageEvent({
      EventName: 'FileScanCompleted',
      ScanResult: 'Clean',
    })
    expect(outcome.kind).toBe('malformed')
  })
  it('returns malformed when ScanResult is unrecognized', () => {
    const outcome = parseBunnyStorageEvent({
      EventName: 'FileScanCompleted',
      ObjectName: 'partner-uploads/x/y/z.pdf',
      ScanResult: 'Quarantined',
    })
    expect(outcome.kind).toBe('malformed')
  })
})

describe('parseBunnyStreamStatus', () => {
  it('maps Status=0 / 1 to encoding_status=processing', () => {
    expect(parseBunnyStreamStatus(0)).toBe('processing')
    expect(parseBunnyStreamStatus(1)).toBe('processing')
  })
  it('maps Status=2 to encoding_status=ready', () => {
    expect(parseBunnyStreamStatus(BUNNY_STREAM_STATUS_READY)).toBe('ready')
  })
  it('maps Status=3 / 4 / 5 to encoding_status=failed', () => {
    expect(parseBunnyStreamStatus(BUNNY_STREAM_STATUS_FAILED)).toBe('failed')
    expect(parseBunnyStreamStatus(BUNNY_STREAM_STATUS_UPLOAD_FAILED)).toBe('failed')
    expect(parseBunnyStreamStatus(5)).toBe('failed')
  })
  it('returns null for unknown statuses', () => {
    expect(parseBunnyStreamStatus(99)).toBeNull()
    expect(parseBunnyStreamStatus(-1)).toBeNull()
  })
  it('returns null for non-integer types', () => {
    expect(parseBunnyStreamStatus('1')).toBeNull()
    expect(parseBunnyStreamStatus(1.5)).toBeNull()
    expect(parseBunnyStreamStatus(null)).toBeNull()
    expect(parseBunnyStreamStatus(undefined)).toBeNull()
  })
})

describe('parseBunnyStreamEvent — recognized event labels', () => {
  it('accepts VideoStatusChanged', () => {
    const outcome = parseBunnyStreamEvent({
      EventName: 'VideoStatusChanged',
      VideoGuid: 'abc-123',
      Status: BUNNY_STREAM_STATUS_PROCESSING,
    })
    expect(outcome.kind).toBe('transcode_event')
  })
  it('accepts VideoEncoded (older webhook name)', () => {
    const outcome = parseBunnyStreamEvent({
      EventName: 'VideoEncoded',
      VideoGuid: 'abc-123',
      Status: 0,
    })
    expect(outcome.kind).toBe('transcode_event')
  })
  it('accepts VideoUploaded', () => {
    expect(
      parseBunnyStreamEvent({
        EventName: 'VideoUploaded',
        VideoGuid: 'abc-123',
        Status: 0,
      }).kind,
    ).toBe('transcode_event')
  })
  it('accepts VideoError', () => {
    expect(
      parseBunnyStreamEvent({
        EventName: 'VideoError',
        VideoGuid: 'abc-123',
        Status: BUNNY_STREAM_STATUS_FAILED,
      }).kind,
    ).toBe('transcode_event')
  })
  it('case-insensitive event name (toLowerCase applied)', () => {
    const outcome = parseBunnyStreamEvent({
      EventName: 'VIDEOSTATUSCHANGED',
      VideoGuid: 'abc-123',
      Status: 0,
    })
    expect(outcome.kind).toBe('transcode_event')
  })
})

describe('parseBunnyStreamEvent — fields', () => {
  it('captures Resolutions when non-empty', () => {
    const outcome = parseBunnyStreamEvent({
      EventName: 'VideoStatusChanged',
      VideoGuid: 'abc-123',
      Status: BUNNY_STREAM_STATUS_READY,
      Resolutions: '240p,360p,720p,1080p',
    })
    if (outcome.kind !== 'transcode_event') throw new Error('expected transcode_event')
    expect(outcome.resolutions).toBe('240p,360p,720p,1080p')
  })
  it('caps Resolutions at 256 chars', () => {
    const huge = 'x'.repeat(1000)
    const outcome = parseBunnyStreamEvent({
      EventName: 'VideoStatusChanged',
      VideoGuid: 'abc-123',
      Status: 2,
      Resolutions: huge,
    })
    if (outcome.kind !== 'transcode_event') throw new Error('expected transcode_event')
    expect(outcome.resolutions?.length).toBe(256)
  })
  it('captures ErrorMessage on failure paths', () => {
    const outcome = parseBunnyStreamEvent({
      EventName: 'VideoError',
      VideoGuid: 'abc-123',
      Status: BUNNY_STREAM_STATUS_FAILED,
      ErrorMessage: 'codec not supported',
    })
    if (outcome.kind !== 'transcode_event') throw new Error('expected transcode_event')
    expect(outcome.errorMessage).toBe('codec not supported')
  })
})

describe('parseBunnyStreamEvent — failure paths', () => {
  it('returns unknown_event for unhandled event names', () => {
    expect(
      parseBunnyStreamEvent({
        EventName: 'VideoDeleted',
        Status: BUNNY_STREAM_STATUS_PROCESSING,
      }).kind,
    ).toBe('unknown_event')
  })
  it('returns malformed when VideoGuid is missing', () => {
    expect(
      parseBunnyStreamEvent({
        EventName: 'VideoStatusChanged',
        Status: 2,
      }).kind,
    ).toBe('malformed')
  })
  it('returns malformed when Status is out-of-range', () => {
    expect(
      parseBunnyStreamEvent({
        EventName: 'VideoStatusChanged',
        VideoGuid: 'abc',
        Status: 99,
      }).kind,
    ).toBe('malformed')
  })
  it('returns malformed for non-object payloads', () => {
    expect(parseBunnyStreamEvent(null).kind).toBe('malformed')
    expect(parseBunnyStreamEvent('payload').kind).toBe('malformed')
    expect(parseBunnyStreamEvent({}).kind).toBe('malformed')
  })
})

describe('BUNNY_STREAM_HANDLED_EVENT_LABELS', () => {
  it('includes the 4 recognized labels', () => {
    expect([...BUNNY_STREAM_HANDLED_EVENT_LABELS].sort()).toEqual(
      ['videoencoded', 'videoerror', 'videostatuschanged', 'videouploaded'].sort(),
    )
  })
})
