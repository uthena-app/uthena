// parseStep.test.ts — unit tests for the URL-step parser.
//
// P13.1 Slice 1 — covers the happy paths + every defensive branch
// (unknown step names, control characters, Unicode confusables,
// CRLF, RTL-override, zero-width, length guard, etc.).

import { describe, expect, it } from 'vitest'

const { parseStepValue, parseRequestedStep } = await import('./parseStep')
const { FIRST_STEP, STEP_WELCOME } = await import('../queries/getMyOnboardingDraft')

describe('parseStepValue', () => {
  it('returns the named step for every valid enum value', () => {
    expect(parseStepValue('welcome')).toBe('welcome')
    expect(parseStepValue('handle_bio')).toBe('handle_bio')
    expect(parseStepValue('payout')).toBe('payout')
    expect(parseStepValue('promo_methods')).toBe('promo_methods')
    expect(parseStepValue('agreement')).toBe('agreement')
    expect(parseStepValue('submit')).toBe('submit')
  })

  it('returns null for an unknown step name', () => {
    expect(parseStepValue('foo')).toBeNull()
    expect(parseStepValue('welcome_step')).toBeNull() // close-but-wrong
    expect(parseStepValue('admin')).toBeNull()
    expect(parseStepValue('profile')).toBeNull() // partner step name
  })

  it('returns null for empty / null / undefined input', () => {
    expect(parseStepValue('')).toBeNull()
    expect(parseStepValue(null)).toBeNull()
    expect(parseStepValue(undefined)).toBeNull()
  })

  it('returns null for uppercase variants (case-sensitive enum)', () => {
    expect(parseStepValue('WELCOME')).toBeNull()
    expect(parseStepValue('Welcome')).toBeNull()
    expect(parseStepValue('Handle_Bio')).toBeNull()
  })

  it('returns null for whitespace around the name', () => {
    expect(parseStepValue(' welcome')).toBeNull()
    expect(parseStepValue('welcome ')).toBeNull()
    expect(parseStepValue('  welcome  ')).toBeNull()
    expect(parseStepValue('\twelcome\n')).toBeNull()
  })

  it('returns null for CRLF injection', () => {
    expect(parseStepValue('welcome\r\nLocation: x')).toBeNull()
    expect(parseStepValue('welcome\nfoo')).toBeNull()
    expect(parseStepValue('welcome\rfoo')).toBeNull()
  })

  it('returns null for path traversal attempts', () => {
    expect(parseStepValue('../admin')).toBeNull()
    expect(parseStepValue('../../etc/passwd')).toBeNull()
    expect(parseStepValue('./welcome')).toBeNull()
  })

  it('returns null for protocol / shell tricks', () => {
    expect(parseStepValue('javascript:alert(1)')).toBeNull()
    expect(parseStepValue('data:text/html,foo')).toBeNull()
    expect(parseStepValue('vbscript:msgbox')).toBeNull()
  })

  it('returns null for SQL/shell injection strings', () => {
    expect(parseStepValue("welcome' OR 1=1 --")).toBeNull()
    expect(parseStepValue('welcome; DROP TABLE x')).toBeNull()
    expect(parseStepValue('welcome$(rm -rf /)')).toBeNull()
  })

  it('returns null for Unicode confusables (Cyrillic о vs Latin o)', () => {
    expect(parseStepValue('welc\u043Eme')).toBeNull() // Cyrillic о
    expect(parseStepValue('рayout')).toBeNull() // Cyrillic р
  })

  it('returns null for RTL-override + zero-width tricks', () => {
    expect(parseStepValue('welcome\u202E')).toBeNull() // RTL override
    expect(parseStepValue('wel\u200Bcome')).toBeNull() // zero-width space
    expect(parseStepValue('welcome\uFEFF')).toBeNull() // zero-width no-break
  })

  it('returns null for length > 32 chars', () => {
    expect(parseStepValue('a'.repeat(33))).toBeNull()
    expect(parseStepValue('a'.repeat(100))).toBeNull()
  })

  it('returns null for empty string of just underscores', () => {
    expect(parseStepValue('___')).toBeNull() // valid charset but not in enum
  })

  it('returns null for digit-only strings (defensive against old int-spec callers)', () => {
    expect(parseStepValue('1')).toBeNull()
    expect(parseStepValue('6')).toBeNull()
  })
})

describe('parseRequestedStep', () => {
  it('returns the URL param when valid', () => {
    expect(
      parseRequestedStep('handle_bio', { exists: false }),
    ).toBe('handle_bio')
    expect(
      parseRequestedStep('payout', { exists: false }),
    ).toBe('payout')
  })

  it('falls back to the draft\'s currentStep when the URL param is invalid', () => {
    expect(
      parseRequestedStep('foo', {
        exists: true,
        currentStep: 'agreement',
        handleBio: {},
        payout: {},
        promoMethods: {},
        agreement: {},
        submittedAt: null,
        createdAt: '2026-06-29T00:00:00Z',
        updatedAt: '2026-06-29T00:00:00Z',
      }),
    ).toBe('agreement')
  })

  it('falls back to the draft\'s currentStep when the URL param is absent', () => {
    expect(
      parseRequestedStep(undefined, {
        exists: true,
        currentStep: 'payout',
        handleBio: {},
        payout: {},
        promoMethods: {},
        agreement: {},
        submittedAt: null,
        createdAt: '2026-06-29T00:00:00Z',
        updatedAt: '2026-06-29T00:00:00Z',
      }),
    ).toBe('payout')
  })

  it('falls back to FIRST_STEP when no URL param AND no draft', () => {
    expect(parseRequestedStep(undefined, { exists: false })).toBe(FIRST_STEP)
    expect(parseRequestedStep('', { exists: false })).toBe(FIRST_STEP)
  })

  it('URL param always wins over draft (even if draft is further along)', () => {
    // The wizard allows free navigation within the 6-step sequence.
    // Trust the URL when it's valid.
    expect(
      parseRequestedStep('welcome', {
        exists: true,
        currentStep: 'submit', // draft is at the end
        handleBio: {},
        payout: {},
        promoMethods: {},
        agreement: {},
        submittedAt: null,
        createdAt: '2026-06-29T00:00:00Z',
        updatedAt: '2026-06-29T00:00:00Z',
      }),
    ).toBe('welcome')
  })

  it('STEP_WELCOME is exported as "welcome" (single source of truth)', () => {
    expect(STEP_WELCOME).toBe('welcome')
    expect(FIRST_STEP).toBe('welcome')
  })
})