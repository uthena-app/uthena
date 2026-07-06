// upload-pipeline-state.test.ts — unit tests for the pure pipeline
// state machine (P12.8 Slice 1).

import { describe, expect, it } from 'vitest'
import {
  partnerUploadState,
  partnerUploadStateIsEncodingTerminal,
  partnerUploadStateIsReady,
  partnerUploadStateIsReplaceable,
  partnerUploadStateIsScanTerminal,
  PARTNER_UPLOAD_STATE_LABELS,
  type PartnerUploadState,
} from './upload-pipeline-state'

describe('partnerUploadState — pure state machine', () => {
  describe('terminal states (failure paths take priority)', () => {
    it('failed: any failure_kind present regardless of scan/encoding', () => {
      expect(
        partnerUploadState({
          scan_status: 'clean',
          encoding_status: 'ready',
          failure_kind: 'network',
          kind: 'video',
        }),
      ).toBe('failed')
    })
    it('failed: failure_kind wins even when scan_status is pending', () => {
      expect(
        partnerUploadState({
          scan_status: 'pending',
          encoding_status: null,
          failure_kind: 'aborted',
          kind: 'source',
        }),
      ).toBe('failed')
    })
  })

  describe('scan-failure terminals', () => {
    it("scan_status='infected' → scan_infected", () => {
      expect(
        partnerUploadState({
          scan_status: 'infected',
          encoding_status: null,
          failure_kind: null,
          kind: 'source',
        }),
      ).toBe('scan_infected')
    })
    it("scan_status='failed' → scan_failed", () => {
      expect(
        partnerUploadState({
          scan_status: 'failed',
          encoding_status: null,
          failure_kind: null,
          kind: 'source',
        }),
      ).toBe('scan_failed')
    })
  })

  describe("scan_status='pending' (upload landed, scan hasn't fired)", () => {
    it('maps to uploaded (v1 has no scan-started event)', () => {
      expect(
        partnerUploadState({
          scan_status: 'pending',
          encoding_status: null,
          failure_kind: null,
          kind: 'source',
        }),
      ).toBe('uploaded')
    })
    it('maps to uploaded even for video (encoding not started until scan clean)', () => {
      expect(
        partnerUploadState({
          scan_status: 'pending',
          encoding_status: 'pending',
          failure_kind: null,
          kind: 'video',
        }),
      ).toBe('uploaded')
    })
  })

  describe("scan_status='clean' — video path", () => {
    it('encoding null → encoding (not yet started)', () => {
      expect(
        partnerUploadState({
          scan_status: 'clean',
          encoding_status: null,
          failure_kind: null,
          kind: 'video',
        }),
      ).toBe('encoding')
    })
    it("encoding 'pending' → encoding", () => {
      expect(
        partnerUploadState({
          scan_status: 'clean',
          encoding_status: 'pending',
          failure_kind: null,
          kind: 'video',
        }),
      ).toBe('encoding')
    })
    it("encoding 'processing' → encoding", () => {
      expect(
        partnerUploadState({
          scan_status: 'clean',
          encoding_status: 'processing',
          failure_kind: null,
          kind: 'video',
        }),
      ).toBe('encoding')
    })
    it("encoding 'ready' → ready", () => {
      expect(
        partnerUploadState({
          scan_status: 'clean',
          encoding_status: 'ready',
          failure_kind: null,
          kind: 'video',
        }),
      ).toBe('ready')
    })
    it("encoding 'failed' → scan_failed (terminal)", () => {
      expect(
        partnerUploadState({
          scan_status: 'clean',
          encoding_status: 'failed',
          failure_kind: null,
          kind: 'video',
        }),
      ).toBe('scan_failed')
    })
  })

  describe("scan_status='clean' — non-video path", () => {
    it("source + scan clean → ready regardless of encoding_status (encoding only applies to video)", () => {
      expect(
        partnerUploadState({
          scan_status: 'clean',
          encoding_status: null,
          failure_kind: null,
          kind: 'source',
        }),
      ).toBe('ready')
    })
    it("sales_material + scan clean → ready", () => {
      expect(
        partnerUploadState({
          scan_status: 'clean',
          encoding_status: null,
          failure_kind: null,
          kind: 'sales_material',
        }),
      ).toBe('ready')
    })
  })
})

describe('partnerUploadStateIsReplaceable', () => {
  it('true for scan_failed / scan_infected / failed', () => {
    expect(partnerUploadStateIsReplaceable('scan_failed')).toBe(true)
    expect(partnerUploadStateIsReplaceable('scan_infected')).toBe(true)
    expect(partnerUploadStateIsReplaceable('failed')).toBe(true)
  })
  it('false for ready / encoding / scan_passed / uploading', () => {
    expect(partnerUploadStateIsReplaceable('ready')).toBe(false)
    expect(partnerUploadStateIsReplaceable('encoding')).toBe(false)
    expect(partnerUploadStateIsReplaceable('scan_passed')).toBe(false)
    expect(partnerUploadStateIsReplaceable('uploading')).toBe(false)
    expect(partnerUploadStateIsReplaceable('uploaded')).toBe(false)
    expect(partnerUploadStateIsReplaceable('registered')).toBe(false)
    expect(partnerUploadStateIsReplaceable('scanning')).toBe(false)
  })
})

describe('partnerUploadStateIsReady', () => {
  it('true only when state is ready', () => {
    expect(partnerUploadStateIsReady('ready')).toBe(true)
  })
  it('false for every other state', () => {
    const nonReady: PartnerUploadState[] = [
      'registered',
      'uploading',
      'uploaded',
      'scanning',
      'scan_passed',
      'scan_infected',
      'scan_failed',
      'encoding',
      'failed',
    ]
    for (const s of nonReady) {
      expect(partnerUploadStateIsReady(s)).toBe(false)
    }
  })
})

describe('partnerUploadStateIsScanTerminal', () => {
  it('true for scan_passed / scan_infected / scan_failed / encoding / ready / failed', () => {
    for (const s of [
      'scan_passed',
      'scan_infected',
      'scan_failed',
      'encoding',
      'ready',
      'failed',
    ] as const) {
      expect(partnerUploadStateIsScanTerminal(s)).toBe(true)
    }
  })
  it('false for pre-scan states', () => {
    for (const s of ['registered', 'uploading', 'uploaded', 'scanning'] as const) {
      expect(partnerUploadStateIsScanTerminal(s)).toBe(false)
    }
  })
})

describe('partnerUploadStateIsEncodingTerminal', () => {
  it('true for ready / scan_failed / failed', () => {
    for (const s of ['ready', 'scan_failed', 'failed'] as const) {
      expect(partnerUploadStateIsEncodingTerminal(s)).toBe(true)
    }
  })
  it('false for other states', () => {
    for (const s of [
      'registered',
      'uploading',
      'uploaded',
      'scanning',
      'scan_passed',
      'scan_infected',
      'encoding',
    ] as const) {
      expect(partnerUploadStateIsEncodingTerminal(s)).toBe(false)
    }
  })
})

describe('PARTNER_UPLOAD_STATE_LABELS', () => {
  it('has a label for every PartnerUploadState', () => {
    const states: PartnerUploadState[] = [
      'registered',
      'uploading',
      'uploaded',
      'scanning',
      'scan_passed',
      'scan_infected',
      'scan_failed',
      'encoding',
      'ready',
      'failed',
    ]
    for (const s of states) {
      expect(PARTNER_UPLOAD_STATE_LABELS[s]).toBeTruthy()
      expect(typeof PARTNER_UPLOAD_STATE_LABELS[s]).toBe('string')
    }
  })
})
