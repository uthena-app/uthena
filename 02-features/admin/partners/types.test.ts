// Unit tests for the pure helpers in `types.ts`.
// Covers: parsePartnerFilters + partnerFiltersToRpcPayload.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PARTNER_SORT,
  PARTNER_KYC_LABEL,
  PARTNER_SORT_LABEL,
  PARTNER_STATUS_LABEL,
  PARTNER_TAX_FORM_LABEL,
  partnerFiltersToRpcPayload,
  parsePartnerFilters,
  type ParsedPartnerFilters,
} from './types'

describe('parsePartnerFilters', () => {
  it('returns all-null when sp is null', () => {
    const out = parsePartnerFilters(null)
    expect(out).toEqual({
      status: null,
      kycStatus: null,
      taxFormStatus: null,
      appliedFrom: null,
      appliedTo: null,
      q: null,
    })
  })

  it('returns all-null when sp is undefined', () => {
    const out = parsePartnerFilters(undefined)
    expect(out.status).toBe(null)
    expect(out.q).toBe(null)
  })

  it('returns all-null when sp is empty', () => {
    const out = parsePartnerFilters({})
    expect(out.status).toBe(null)
  })

  it('parses a valid status filter', () => {
    expect(parsePartnerFilters({ status: 'pending' }).status).toBe('pending')
    expect(parsePartnerFilters({ status: 'approved' }).status).toBe('approved')
    expect(parsePartnerFilters({ status: 'suspended' }).status).toBe('suspended')
  })

  it('ignores an invalid status filter', () => {
    expect(parsePartnerFilters({ status: 'banned' }).status).toBe(null)
  })

  it('parses a valid kycStatus filter', () => {
    expect(parsePartnerFilters({ kycStatus: 'none' }).kycStatus).toBe('none')
    expect(parsePartnerFilters({ kycStatus: 'pending' }).kycStatus).toBe('pending')
    expect(parsePartnerFilters({ kycStatus: 'approved' }).kycStatus).toBe('approved')
    expect(parsePartnerFilters({ kycStatus: 'rejected' }).kycStatus).toBe('rejected')
  })

  it('ignores an invalid kycStatus filter', () => {
    expect(parsePartnerFilters({ kycStatus: 'unknown' }).kycStatus).toBe(null)
  })

  it('parses a valid taxFormStatus filter', () => {
    expect(parsePartnerFilters({ taxFormStatus: 'none' }).taxFormStatus).toBe('none')
    expect(parsePartnerFilters({ taxFormStatus: 'pending' }).taxFormStatus).toBe('pending')
    expect(parsePartnerFilters({ taxFormStatus: 'submitted' }).taxFormStatus).toBe('submitted')
    expect(parsePartnerFilters({ taxFormStatus: 'approved' }).taxFormStatus).toBe('approved')
  })

  it('ignores an invalid taxFormStatus filter', () => {
    expect(parsePartnerFilters({ taxFormStatus: 'garbage' }).taxFormStatus).toBe(null)
  })

  it('parses valid applied date filters', () => {
    const out = parsePartnerFilters({
      appliedFrom: '2026-01-01',
      appliedTo: '2026-12-31',
    })
    expect(out.appliedFrom).toBe('2026-01-01')
    expect(out.appliedTo).toBe('2026-12-31')
  })

  it('rejects malformed applied date filters', () => {
    expect(parsePartnerFilters({ appliedFrom: '2026/01/01' }).appliedFrom).toBe(null)
    expect(parsePartnerFilters({ appliedFrom: 'not-a-date' }).appliedFrom).toBe(null)
    expect(parsePartnerFilters({ appliedTo: '2026-13-01' }).appliedTo).toBe(null)
  })

  it('trims and caps search query at 100 chars', () => {
    expect(parsePartnerFilters({ q: '  hello  ' }).q).toBe('hello')
    const long = 'a'.repeat(150)
    expect(parsePartnerFilters({ q: long }).q?.length).toBe(100)
  })

  it('drops whitespace-only search queries', () => {
    expect(parsePartnerFilters({ q: '   ' }).q).toBe(null)
  })

  it('handles array-valued params by taking the first', () => {
    expect(parsePartnerFilters({ q: ['first', 'second'] }).q).toBe('first')
    expect(parsePartnerFilters({ status: ['pending', 'approved'] }).status).toBe('pending')
  })
})

describe('partnerFiltersToRpcPayload', () => {
  it('returns an empty object when all filters are null', () => {
    const empty: ParsedPartnerFilters = {
      status: null,
      kycStatus: null,
      taxFormStatus: null,
      appliedFrom: null,
      appliedTo: null,
      q: null,
    }
    expect(partnerFiltersToRpcPayload(empty)).toEqual({})
  })

  it('only includes keys with truthy values', () => {
    const filters: ParsedPartnerFilters = {
      status: 'pending',
      kycStatus: null,
      taxFormStatus: 'submitted',
      appliedFrom: '2026-01-01',
      appliedTo: null,
      q: 'partner',
    }
    expect(partnerFiltersToRpcPayload(filters)).toEqual({
      status: 'pending',
      taxFormStatus: 'submitted',
      appliedFrom: '2026-01-01',
      q: 'partner',
    })
  })
})

describe('canonical enums + labels', () => {
  it('default sort is revenue_desc', () => {
    expect(DEFAULT_PARTNER_SORT).toBe('revenue_desc')
  })

  it('PARTNER_STATUS_LABEL covers every partner status', () => {
    expect(PARTNER_STATUS_LABEL.pending).toBe('Pending')
    expect(PARTNER_STATUS_LABEL.approved).toBe('Approved')
    expect(PARTNER_STATUS_LABEL.suspended).toBe('Suspended')
  })

  it('PARTNER_KYC_LABEL covers every kyc status', () => {
    expect(PARTNER_KYC_LABEL.none).toBe('Not submitted')
    expect(PARTNER_KYC_LABEL.pending).toBe('Pending review')
    expect(PARTNER_KYC_LABEL.approved).toBe('Approved')
    expect(PARTNER_KYC_LABEL.rejected).toBe('Rejected')
  })

  it('PARTNER_TAX_FORM_LABEL covers every tax form status', () => {
    expect(PARTNER_TAX_FORM_LABEL.none).toBe('Not submitted')
    expect(PARTNER_TAX_FORM_LABEL.pending).toBe('Pending')
    expect(PARTNER_TAX_FORM_LABEL.submitted).toBe('Submitted')
    expect(PARTNER_TAX_FORM_LABEL.approved).toBe('Approved')
  })

  it('PARTNER_SORT_LABEL covers every sort key', () => {
    expect(PARTNER_SORT_LABEL.revenue_desc).toBe('Lifetime revenue (high → low)')
    expect(PARTNER_SORT_LABEL.name_asc).toBe('Name (A–Z)')
    expect(PARTNER_SORT_LABEL.activity_desc).toBe('Last active (newest first)')
  })
})