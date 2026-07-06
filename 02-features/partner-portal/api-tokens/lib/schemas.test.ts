// Unit tests for `02-features/partner-portal/api-tokens/lib/schemas.ts`.
//
// Coverage:
//   - CreateApiTokenInputSchema — happy path; name length bounds;
//     scopes min/max; expirationDays union; missing/extra
//     `acknowledgedOneTimeShow` is rejected
//   - RevokeApiTokenInputSchema — happy path; confirmation must equal
//     the literal string "REVOKE"; tokenId must be numeric; extra
//     fields rejected (.strict())
//   - ApiTokenEntitySchema — happy path; missing fields rejected
//   - The derived `status` field is part of the shape and is
//     typed as the union (so the page's status pill switch is
//     exhaustive)

import { describe, expect, it } from 'vitest'
import {
  ApiTokenEntitySchema,
  CreateApiTokenInputSchema,
  RevokeApiTokenInputSchema,
} from './schemas'

describe('CreateApiTokenInputSchema', () => {
  it('parses a minimal valid input', () => {
    const out = CreateApiTokenInputSchema.parse({
      name: 'Zapier integration',
      scopes: ['read_sales'],
      expirationDays: 90,
      acknowledgedOneTimeShow: true,
    })
    expect(out.name).toBe('Zapier integration')
    expect(out.scopes).toEqual(['read_sales'])
    expect(out.expirationDays).toBe(90)
    expect(out.acknowledgedOneTimeShow).toBe(true)
  })

  it('accepts a "never expires" expiration (null)', () => {
    const out = CreateApiTokenInputSchema.parse({
      name: 'Long-term',
      scopes: ['read_payouts'],
      expirationDays: null,
      acknowledgedOneTimeShow: true,
    })
    expect(out.expirationDays).toBeNull()
  })

  it('accepts all three scopes together', () => {
    const out = CreateApiTokenInputSchema.parse({
      name: 'All-access',
      scopes: ['read_sales', 'read_payouts', 'read_products'],
      expirationDays: 365,
      acknowledgedOneTimeShow: true,
    })
    expect(out.scopes).toHaveLength(3)
  })

  it('rejects an empty name', () => {
    const res = CreateApiTokenInputSchema.safeParse({
      name: '',
      scopes: ['read_sales'],
      expirationDays: 90,
      acknowledgedOneTimeShow: true,
    })
    expect(res.success).toBe(false)
  })

  it('rejects a name longer than 80 chars', () => {
    const res = CreateApiTokenInputSchema.safeParse({
      name: 'a'.repeat(81),
      scopes: ['read_sales'],
      expirationDays: 90,
      acknowledgedOneTimeShow: true,
    })
    expect(res.success).toBe(false)
  })

  it('accepts a name at exactly 80 chars', () => {
    const res = CreateApiTokenInputSchema.safeParse({
      name: 'a'.repeat(80),
      scopes: ['read_sales'],
      expirationDays: 90,
      acknowledgedOneTimeShow: true,
    })
    expect(res.success).toBe(true)
  })

  it('rejects zero scopes', () => {
    const res = CreateApiTokenInputSchema.safeParse({
      name: 'Zero',
      scopes: [],
      expirationDays: 90,
      acknowledgedOneTimeShow: true,
    })
    expect(res.success).toBe(false)
  })

  it('rejects an unknown scope value', () => {
    const res = CreateApiTokenInputSchema.safeParse({
      name: 'Bad scope',
      scopes: ['write_everything'],
      expirationDays: 90,
      acknowledgedOneTimeShow: true,
    })
    expect(res.success).toBe(false)
  })

  it('rejects an unknown expirationDays literal', () => {
    const res = CreateApiTokenInputSchema.safeParse({
      name: 'Bad expiration',
      scopes: ['read_sales'],
      expirationDays: 7, // not in the union
      acknowledgedOneTimeShow: true,
    })
    expect(res.success).toBe(false)
  })

  it('rejects when acknowledgedOneTimeShow is false (the contract says literal(true))', () => {
    const res = CreateApiTokenInputSchema.safeParse({
      name: 'No ack',
      scopes: ['read_sales'],
      expirationDays: 90,
      acknowledgedOneTimeShow: false,
    })
    expect(res.success).toBe(false)
  })

  it('rejects when acknowledgedOneTimeShow is missing', () => {
    const res = CreateApiTokenInputSchema.safeParse({
      name: 'No ack key',
      scopes: ['read_sales'],
      expirationDays: 90,
    })
    expect(res.success).toBe(false)
  })

  it('rejects unknown extra fields (.strict())', () => {
    const res = CreateApiTokenInputSchema.safeParse({
      name: 'x',
      scopes: ['read_sales'],
      expirationDays: 90,
      acknowledgedOneTimeShow: true,
      plaintext: 'should-never-be-accepted-from-client',
    })
    expect(res.success).toBe(false)
  })

  it('trims whitespace from the name', () => {
    const out = CreateApiTokenInputSchema.parse({
      name: '   padded name   ',
      scopes: ['read_sales'],
      expirationDays: 90,
      acknowledgedOneTimeShow: true,
    })
    expect(out.name).toBe('padded name')
  })
})

describe('RevokeApiTokenInputSchema', () => {
  it('parses a valid input (string id → number transform)', () => {
    const out = RevokeApiTokenInputSchema.parse({
      tokenId: '42',
      confirmation: 'REVOKE',
    })
    expect(out.tokenId).toBe(42)
    expect(out.confirmation).toBe('REVOKE')
  })

  it('rejects a non-numeric token id', () => {
    const res = RevokeApiTokenInputSchema.safeParse({
      tokenId: 'abc',
      confirmation: 'REVOKE',
    })
    expect(res.success).toBe(false)
  })

  it('rejects a negative token id', () => {
    const res = RevokeApiTokenInputSchema.safeParse({
      tokenId: '-1',
      confirmation: 'REVOKE',
    })
    expect(res.success).toBe(false)
  })

  it('rejects a floating-point token id', () => {
    const res = RevokeApiTokenInputSchema.safeParse({
      tokenId: '1.5',
      confirmation: 'REVOKE',
    })
    expect(res.success).toBe(false)
  })

  it('rejects a wrong-case confirmation', () => {
    const res = RevokeApiTokenInputSchema.safeParse({
      tokenId: '42',
      confirmation: 'revoke',
    })
    expect(res.success).toBe(false)
  })

  it('rejects empty confirmation', () => {
    const res = RevokeApiTokenInputSchema.safeParse({
      tokenId: '42',
      confirmation: '',
    })
    expect(res.success).toBe(false)
  })

  it('rejects an extra confirmation-keyed field (.strict())', () => {
    const res = RevokeApiTokenInputSchema.safeParse({
      tokenId: '42',
      confirmation: 'REVOKE',
      reason: 'leaked',
    })
    expect(res.success).toBe(false)
  })
})

describe('ApiTokenEntitySchema', () => {
  const validRow = {
    id: 1,
    name: 'Demo',
    scopes: ['read_sales' as const],
    tokenPrefix: 'uth_pat_a1b2c3d4***',
    createdAt: '2026-06-30T00:00:00.000Z',
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    status: 'active' as const,
  }

  it('parses a complete active row', () => {
    const out = ApiTokenEntitySchema.parse(validRow)
    expect(out.id).toBe(1)
    expect(out.status).toBe('active')
  })

  it('accepts every status union member', () => {
    expect(ApiTokenEntitySchema.parse({ ...validRow, status: 'active' }).status).toBe('active')
    expect(ApiTokenEntitySchema.parse({ ...validRow, status: 'revoked' }).status).toBe('revoked')
    expect(ApiTokenEntitySchema.parse({ ...validRow, status: 'expired' }).status).toBe('expired')
  })

  it('rejects an unknown status', () => {
    const res = ApiTokenEntitySchema.safeParse({ ...validRow, status: 'archived' })
    expect(res.success).toBe(false)
  })

  it('rejects a row missing the tokenPrefix', () => {
    const { tokenPrefix: _omit, ...rest } = validRow
    void _omit
    expect(ApiTokenEntitySchema.safeParse(rest).success).toBe(false)
  })

  it('rejects a row missing the derived status', () => {
    const { status: _omit, ...rest } = validRow
    void _omit
    expect(ApiTokenEntitySchema.safeParse(rest).success).toBe(false)
  })

  it('rejects a negative id', () => {
    expect(ApiTokenEntitySchema.safeParse({ ...validRow, id: -1 }).success).toBe(false)
  })

  it('rejects a non-array scopes field', () => {
    expect(
      ApiTokenEntitySchema.safeParse({ ...validRow, scopes: 'read_sales' }).success,
    ).toBe(false)
  })
})