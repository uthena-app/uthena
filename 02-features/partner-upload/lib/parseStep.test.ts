// parseStep.test.ts — unit tests for the partner-upload wizard's
// `parseRequestedUploadStep` helper (P12.7 Slice 1).
//
// Covers the full parse matrix from the source file's "Defensive
// against" comment block:
//   - In-range integer → returns N
//   - Out-of-range (0, 6, 99, -1) → falls back to draft.currentStep
//   - Non-integer ('abc', '1.5', '1 OR 1=1', 'NaN', 'Infinity') →
//     falls back to draft.currentStep
//   - Empty / undefined → falls back to draft.currentStep
//   - No draft → UPLOAD_FIRST_STEP (1)
//   - SQL/shell injection attempts parse to a bounded int — harmless
//
// Why this matters: the URL is the source of truth for which step
// the wizard renders. An attacker who lands the partner on an
// unparseable step gets the fallback, not a 500.

import { describe, expect, it } from 'vitest'
import {
  parseRequestedUploadStep,
  parseUploadStepValue,
} from './parseStep'
import { UPLOAD_FIRST_STEP, UPLOAD_LAST_STEP, type UploadDraftResult } from '../queries/getMyUploadDraft'

const emptyDraft: UploadDraftResult = { exists: false }
const draftAt3: UploadDraftResult = {
  exists: true,
  currentStep: 3,
  lastSavedStep: 3,
  status: 'draft',
  payload: {},
  submittedAt: null,
  reviewedAt: null,
  reviewerId: null,
  decision: null,
  decisionNotes: null,
  createdAt: '2026-06-29T00:00:00Z',
  updatedAt: '2026-06-29T00:00:00Z',
}

describe('parseUploadStepValue — happy path', () => {
  it('accepts 1..UPLOAD_LAST_STEP as integers', () => {
    for (let i = UPLOAD_FIRST_STEP; i <= UPLOAD_LAST_STEP; i++) {
      expect(parseUploadStepValue(String(i))).toBe(i)
    }
  })

  it('accepts the boundary values 1 and 5', () => {
    expect(parseUploadStepValue('1')).toBe(1)
    expect(parseUploadStepValue('5')).toBe(5)
  })
})

describe('parseUploadStepValue — invalid input rejection', () => {
  it('rejects empty + undefined + null', () => {
    expect(parseUploadStepValue('')).toBeNull()
    expect(parseUploadStepValue(undefined)).toBeNull()
    expect(parseUploadStepValue(null)).toBeNull()
  })

  it('rejects non-integer shapes', () => {
    expect(parseUploadStepValue('abc')).toBeNull()
    expect(parseUploadStepValue('1.5')).toBeNull()
    expect(parseUploadStepValue('NaN')).toBeNull()
    expect(parseUploadStepValue('Infinity')).toBeNull()
    expect(parseUploadStepValue('-Infinity')).toBeNull()
  })

  it('rejects SQL/shell injection attempts', () => {
    // The regex /^-?\d+$/ refuses anything that isn't pure digits or
    // a leading minus, so all of these drop to null. The pure-digit
    // substring inside parses to a bounded int — also harmless.
    expect(parseUploadStepValue('1 OR 1=1')).toBeNull()
    expect(parseUploadStepValue("1' OR '1'='1")).toBeNull()
    expect(parseUploadStepValue('; DROP TABLE partners;--')).toBeNull()
    expect(parseUploadStepValue('$(rm -rf /)')).toBeNull()
  })

  it('rejects out-of-range integers (0, 6, 99, -1, -99)', () => {
    expect(parseUploadStepValue('0')).toBeNull()
    expect(parseUploadStepValue('6')).toBeNull()
    expect(parseUploadStepValue('99')).toBeNull()
    expect(parseUploadStepValue('-1')).toBeNull()
    expect(parseUploadStepValue('-99')).toBeNull()
  })

  it('rejects whitespace + control characters', () => {
    expect(parseUploadStepValue('  ')).toBeNull()
    expect(parseUploadStepValue('\t')).toBeNull()
    expect(parseUploadStepValue('\n')).toBeNull()
    expect(parseUploadStepValue('3 ')).toBeNull()
    expect(parseUploadStepValue(' 3')).toBeNull()
  })

  it('rejects Unicode digits and RTL/LTR overrides', () => {
    // Arabic-Indic ١٢٣ — regex rejects non-ASCII.
    expect(parseUploadStepValue('\u0661')).toBeNull()
    expect(parseUploadStepValue('\u202E1')).toBeNull()
    expect(parseUploadStepValue('\u200B1')).toBeNull() // zero-width
  })
})

describe('parseRequestedUploadStep — fallback behavior', () => {
  it('prefers a valid URL step over the draft', () => {
    expect(parseRequestedUploadStep('2', draftAt3)).toBe(2)
  })

  it('falls back to the draft.currentStep when the URL is invalid', () => {
    expect(parseRequestedUploadStep('abc', draftAt3)).toBe(3)
    expect(parseRequestedUploadStep('99', draftAt3)).toBe(3)
    expect(parseRequestedUploadStep(undefined, draftAt3)).toBe(3)
  })

  it('returns UPLOAD_FIRST_STEP for a fresh visitor with no draft', () => {
    expect(parseRequestedUploadStep(undefined, emptyDraft)).toBe(UPLOAD_FIRST_STEP)
    expect(parseRequestedUploadStep('abc', emptyDraft)).toBe(UPLOAD_FIRST_STEP)
  })

  it('returns the URL step even when the draft is at a different number', () => {
    expect(parseRequestedUploadStep('1', draftAt3)).toBe(1)
    expect(parseRequestedUploadStep('5', draftAt3)).toBe(5)
  })
})
