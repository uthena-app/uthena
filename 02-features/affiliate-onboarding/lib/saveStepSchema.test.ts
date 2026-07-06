// saveStepSchema.test.ts — unit tests for the per-step Zod schemas.
//
// P13.1 Slice 1 — covers every per-step payload shape (happy path +
// every documented failure mode), the wire schema, and the
// `payloadForStep()` lookup helper.

import { describe, expect, it } from 'vitest'

const {
  HandleBioPayload,
  PayoutPayload,
  PromoMethodsPayload,
  AgreementPayload,
  SaveStepInput,
  payloadForStep,
  PAYLOAD_SCHEMAS,
} = await import('./saveStepSchema')

// =====================================================================
// HandleBioPayload
// =====================================================================

describe('HandleBioPayload', () => {
  it('accepts a canonical lowercase handle + bio', () => {
    const result = HandleBioPayload.safeParse({
      handle: 'alice',
      bio: 'Cool affiliate.',
    })
    expect(result.success).toBe(true)
  })

  it('accepts the boundary lengths (3 + 30 chars)', () => {
    expect(HandleBioPayload.safeParse({ handle: 'abc' }).success).toBe(true)
    expect(HandleBioPayload.safeParse({ handle: 'a'.repeat(30) }).success).toBe(true)
  })

  it('rejects handles shorter than 3 chars', () => {
    expect(HandleBioPayload.safeParse({ handle: 'ab' }).success).toBe(false)
    expect(HandleBioPayload.safeParse({ handle: 'a' }).success).toBe(false)
    expect(HandleBioPayload.safeParse({ handle: '' }).success).toBe(false)
  })

  it('rejects handles longer than 30 chars', () => {
    expect(HandleBioPayload.safeParse({ handle: 'a'.repeat(31) }).success).toBe(false)
  })

  it('rejects uppercase handles', () => {
    expect(HandleBioPayload.safeParse({ handle: 'Alice' }).success).toBe(false)
    expect(HandleBioPayload.safeParse({ handle: 'ALICE' }).success).toBe(false)
  })

  it('rejects handles with special characters', () => {
    expect(HandleBioPayload.safeParse({ handle: 'ali_ce' }).success).toBe(false)
    expect(HandleBioPayload.safeParse({ handle: 'ali.ce' }).success).toBe(false)
    expect(HandleBioPayload.safeParse({ handle: 'ali ce' }).success).toBe(false)
    expect(HandleBioPayload.safeParse({ handle: 'ali@ce' }).success).toBe(false)
  })

  it('rejects leading or trailing hyphens', () => {
    expect(HandleBioPayload.safeParse({ handle: '-alice' }).success).toBe(false)
    expect(HandleBioPayload.safeParse({ handle: 'alice-' }).success).toBe(false)
  })

  it('rejects bios longer than 280 chars', () => {
    const result = HandleBioPayload.safeParse({
      handle: 'alice',
      bio: 'a'.repeat(281),
    })
    expect(result.success).toBe(false)
  })

  it('accepts bio up to 280 chars (boundary)', () => {
    const result = HandleBioPayload.safeParse({
      handle: 'alice',
      bio: 'a'.repeat(280),
    })
    expect(result.success).toBe(true)
  })

  it('accepts a missing bio (optional)', () => {
    const result = HandleBioPayload.safeParse({ handle: 'alice' })
    expect(result.success).toBe(true)
  })

  it('accepts an avatar_storage_path (deferred surface)', () => {
    const result = HandleBioPayload.safeParse({
      handle: 'alice',
      avatar_storage_path: 'onboarding/affiliate/uuid/avatar/uuid.png',
    })
    expect(result.success).toBe(true)
  })

  it('rejects unknown top-level keys (.strict())', () => {
    const result = HandleBioPayload.safeParse({
      handle: 'alice',
      evildata: 'XSS',
    })
    expect(result.success).toBe(false)
  })
})

// =====================================================================
// PayoutPayload
// =====================================================================

describe('PayoutPayload', () => {
  it('accepts matching PayPal emails', () => {
    const result = PayoutPayload.safeParse({
      paypal_email: 'alice@example.com',
      paypal_email_confirm: 'alice@example.com',
    })
    expect(result.success).toBe(true)
  })

  it('accepts matching emails with different casing (case-insensitive match)', () => {
    const result = PayoutPayload.safeParse({
      paypal_email: 'Alice@Example.com',
      paypal_email_confirm: 'alice@example.com',
    })
    expect(result.success).toBe(true)
  })

  it('rejects mismatched PayPal emails', () => {
    const result = PayoutPayload.safeParse({
      paypal_email: 'alice@example.com',
      paypal_email_confirm: 'bob@example.com',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      // The refine puts the error on `paypal_email_confirm`.
      const path = result.error.issues[0]?.path.join('.')
      expect(path).toBe('paypal_email_confirm')
    }
  })

  it('rejects malformed PayPal emails', () => {
    expect(
      PayoutPayload.safeParse({
        paypal_email: 'not-an-email',
        paypal_email_confirm: 'not-an-email',
      }).success,
    ).toBe(false)
  })

  it('rejects missing paypal_email', () => {
    expect(
      PayoutPayload.safeParse({ paypal_email_confirm: 'alice@example.com' }).success,
    ).toBe(false)
  })

  it('rejects missing paypal_email_confirm', () => {
    expect(
      PayoutPayload.safeParse({ paypal_email: 'alice@example.com' }).success,
    ).toBe(false)
  })

  it('rejects unknown top-level keys (.strict())', () => {
    const result = PayoutPayload.safeParse({
      paypal_email: 'alice@example.com',
      paypal_email_confirm: 'alice@example.com',
      evildata: 'XSS',
    })
    expect(result.success).toBe(false)
  })
})

// =====================================================================
// PromoMethodsPayload
// =====================================================================

describe('PromoMethodsPayload', () => {
  it('accepts the spec-allowed methods', () => {
    const result = PromoMethodsPayload.safeParse({
      methods: ['twitter', 'youtube', 'blog', 'email_list', 'tiktok', 'linkedin', 'other'],
    })
    expect(result.success).toBe(true)
  })

  it('defaults methods to [] (informational only — no enforcement)', () => {
    const result = PromoMethodsPayload.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.methods).toEqual([])
    }
  })

  it('accepts an empty methods array', () => {
    const result = PromoMethodsPayload.safeParse({ methods: [] })
    expect(result.success).toBe(true)
  })

  it('rejects unknown method values', () => {
    const result = PromoMethodsPayload.safeParse({
      methods: ['twitter', 'unknown-channel'],
    })
    expect(result.success).toBe(false)
  })

  it('rejects > 7 methods', () => {
    const result = PromoMethodsPayload.safeParse({
      methods: ['twitter', 'youtube', 'blog', 'email_list', 'tiktok', 'linkedin', 'other', 'twitter'],
    })
    expect(result.success).toBe(false)
  })

  it('accepts other_text up to 200 chars', () => {
    const result = PromoMethodsPayload.safeParse({
      methods: ['other'],
      other_text: 'a'.repeat(200),
    })
    expect(result.success).toBe(true)
  })

  it('rejects other_text > 200 chars', () => {
    const result = PromoMethodsPayload.safeParse({
      methods: ['other'],
      other_text: 'a'.repeat(201),
    })
    expect(result.success).toBe(false)
  })

  it('rejects unknown top-level keys (.strict())', () => {
    const result = PromoMethodsPayload.safeParse({
      methods: ['twitter'],
      evildata: 'XSS',
    })
    expect(result.success).toBe(false)
  })
})

// =====================================================================
// AgreementPayload
// =====================================================================

describe('AgreementPayload', () => {
  it('accepts when both checkboxes are true', () => {
    const result = AgreementPayload.safeParse({
      affiliate_terms_accepted: true,
      tos_accepted: true,
    })
    expect(result.success).toBe(true)
  })

  it('accepts an optional accepted_at timestamp', () => {
    const result = AgreementPayload.safeParse({
      affiliate_terms_accepted: true,
      tos_accepted: true,
      accepted_at: '2026-06-29T15:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })

  it('rejects when affiliate_terms_accepted is false', () => {
    const result = AgreementPayload.safeParse({
      affiliate_terms_accepted: false,
      tos_accepted: true,
    })
    expect(result.success).toBe(false)
  })

  it('rejects when tos_accepted is false', () => {
    const result = AgreementPayload.safeParse({
      affiliate_terms_accepted: true,
      tos_accepted: false,
    })
    expect(result.success).toBe(false)
  })

  it('rejects when both are false', () => {
    const result = AgreementPayload.safeParse({
      affiliate_terms_accepted: false,
      tos_accepted: false,
    })
    expect(result.success).toBe(false)
  })

  it('rejects when both are missing', () => {
    const result = AgreementPayload.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects a non-boolean value (e.g. string "true")', () => {
    const result = AgreementPayload.safeParse({
      affiliate_terms_accepted: 'true' as unknown as boolean,
      tos_accepted: true,
    })
    expect(result.success).toBe(false)
  })

  it('rejects malformed accepted_at (not a datetime)', () => {
    const result = AgreementPayload.safeParse({
      affiliate_terms_accepted: true,
      tos_accepted: true,
      accepted_at: 'not-a-date',
    })
    expect(result.success).toBe(false)
  })

  it('rejects unknown top-level keys (.strict())', () => {
    const result = AgreementPayload.safeParse({
      affiliate_terms_accepted: true,
      tos_accepted: true,
      evildata: 'XSS',
    })
    expect(result.success).toBe(false)
  })
})

// =====================================================================
// SaveStepInput (wire schema)
// =====================================================================

describe('SaveStepInput', () => {
  it('accepts a valid step', () => {
    expect(SaveStepInput.safeParse({ step: 'welcome' }).success).toBe(true)
    expect(SaveStepInput.safeParse({ step: 'handle_bio' }).success).toBe(true)
    expect(SaveStepInput.safeParse({ step: 'payout' }).success).toBe(true)
    expect(SaveStepInput.safeParse({ step: 'promo_methods' }).success).toBe(true)
    expect(SaveStepInput.safeParse({ step: 'agreement' }).success).toBe(true)
    expect(SaveStepInput.safeParse({ step: 'submit' }).success).toBe(true)
  })

  it('rejects an unknown step name', () => {
    expect(SaveStepInput.safeParse({ step: 'unknown-step' }).success).toBe(false)
  })

  it('accepts a missing payload (steps without payloads)', () => {
    expect(SaveStepInput.safeParse({ step: 'welcome' }).success).toBe(true)
    expect(SaveStepInput.safeParse({ step: 'submit' }).success).toBe(true)
  })

  it('accepts a payload when present', () => {
    expect(
      SaveStepInput.safeParse({
        step: 'handle_bio',
        payload: { handle: 'alice' },
      }).success,
    ).toBe(true)
  })

  it('rejects a missing step', () => {
    expect(SaveStepInput.safeParse({}).success).toBe(false)
    expect(SaveStepInput.safeParse({ payload: {} }).success).toBe(false)
  })

  it('rejects a non-string step', () => {
    expect(SaveStepInput.safeParse({ step: 1 }).success).toBe(false)
    expect(SaveStepInput.safeParse({ step: null }).success).toBe(false)
  })
})

// =====================================================================
// payloadForStep — lookup helper
// =====================================================================

describe('payloadForStep', () => {
  it('returns the right schema for each step', () => {
    expect(payloadForStep('welcome')).toBe(PAYLOAD_SCHEMAS.welcome)
    expect(payloadForStep('handle_bio')).toBe(PAYLOAD_SCHEMAS.handle_bio)
    expect(payloadForStep('payout')).toBe(PAYLOAD_SCHEMAS.payout)
    expect(payloadForStep('promo_methods')).toBe(PAYLOAD_SCHEMAS.promo_methods)
    expect(payloadForStep('agreement')).toBe(PAYLOAD_SCHEMAS.agreement)
    expect(payloadForStep('submit')).toBe(PAYLOAD_SCHEMAS.submit)
  })

  it('PAYLOAD_SCHEMAS has exactly 6 keys', () => {
    expect(Object.keys(PAYLOAD_SCHEMAS)).toHaveLength(6)
  })
})