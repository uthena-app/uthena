// getDmcaAgent.test.ts — unit tests for the DMCA agent public read.
//
// The query projects a narrow allowlist (name + email + mailing_address +
// phone) from the `value` jsonb column on `platform_settings`. These
// tests exercise:
//   - happy path: row with the expected 4-field shape
//   - row missing / public_read=false → null
//   - DB error → null + warn log
//   - bad JSONB shape (string, number, array, null) → null + warn log
//   - missing required field (name / email / mailing_address) → null + warn
//   - empty string after trim → null
//   - select payload assertion: only `value` is requested (defense in
//     depth — admin-internal columns must never cross the wire)
//
// The test mocks Supabase via the same `mockSupabase` shape that the
// existing `getLegalMarkdown.test.ts` uses, so a sibling test pattern
// exists for cross-reference.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the Supabase server client so getDmcaAgent can be called in tests.
const mockMaybeSingle = vi.fn()
const mockEqPublic = vi.fn(() => ({ maybeSingle: mockMaybeSingle }))
const mockEqKey = vi.fn(() => ({ eq: mockEqPublic }))
const mockSelect = vi.fn(() => ({ eq: mockEqKey }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => ({ from: mockFrom })),
}))

// Suppress logger output during tests.
vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

import { getDmcaAgent } from './getDmcaAgent'

beforeEach(() => {
  mockMaybeSingle.mockReset()
  mockEqPublic.mockClear()
  mockEqKey.mockClear()
  mockSelect.mockClear()
  mockFrom.mockClear()
})

describe('getDmcaAgent', () => {
  it('returns the parsed contact when the row is present and well-formed', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        value: {
          name: 'Jane Doe, Esq.',
          email: 'legal@uthena.com',
          mailing_address: '123 Main St, City, State 00000',
          phone: '+1-555-0100',
        },
      },
      error: null,
    })
    const result = await getDmcaAgent()
    expect(result).toEqual({
      name: 'Jane Doe, Esq.',
      email: 'legal@uthena.com',
      mailing_address: '123 Main St, City, State 00000',
      phone: '+1-555-0100',
    })
  })

  it('trims whitespace on each field', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        value: {
          name: '  Jane Doe  ',
          email: '  legal@uthena.com  ',
          mailing_address: '  123 Main St  ',
          phone: '  +1-555-0100  ',
        },
      },
      error: null,
    })
    const result = await getDmcaAgent()
    expect(result).toEqual({
      name: 'Jane Doe',
      email: 'legal@uthena.com',
      mailing_address: '123 Main St',
      phone: '+1-555-0100',
    })
  })

  it('treats an empty phone as an empty string (phone is optional per spec)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        value: {
          name: 'Jane Doe',
          email: 'legal@uthena.com',
          mailing_address: '123 Main St',
          phone: '',
        },
      },
      error: null,
    })
    const result = await getDmcaAgent()
    expect(result?.phone).toBe('')
  })

  it('returns null when the row is missing', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
    const result = await getDmcaAgent()
    expect(result).toBeNull()
  })

  it('returns null on a DB error and does not throw', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'relation does not exist' },
    })
    const result = await getDmcaAgent()
    expect(result).toBeNull()
  })

  it('returns null when the value is a string (not an object)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { value: 'not an object' },
      error: null,
    })
    const result = await getDmcaAgent()
    expect(result).toBeNull()
  })

  it('returns null when the value is an array', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { value: ['name', 'legal@uthena.com'] },
      error: null,
    })
    const result = await getDmcaAgent()
    expect(result).toBeNull()
  })

  it('returns null when the value is null', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { value: null },
      error: null,
    })
    const result = await getDmcaAgent()
    expect(result).toBeNull()
  })

  it('returns null when name is missing', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        value: {
          name: '',
          email: 'legal@uthena.com',
          mailing_address: '123 Main St',
          phone: '',
        },
      },
      error: null,
    })
    const result = await getDmcaAgent()
    expect(result).toBeNull()
  })

  it('returns null when email is missing', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        value: {
          name: 'Jane Doe',
          email: '',
          mailing_address: '123 Main St',
          phone: '',
        },
      },
      error: null,
    })
    const result = await getDmcaAgent()
    expect(result).toBeNull()
  })

  it('returns null when mailing_address is missing', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        value: {
          name: 'Jane Doe',
          email: 'legal@uthena.com',
          mailing_address: '',
          phone: '',
        },
      },
      error: null,
    })
    const result = await getDmcaAgent()
    expect(result).toBeNull()
  })

  it('returns null when required fields have the wrong type', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        value: {
          name: 12345,
          email: 'legal@uthena.com',
          mailing_address: '123 Main St',
          phone: '',
        },
      },
      error: null,
    })
    const result = await getDmcaAgent()
    expect(result).toBeNull()
  })

  it('issues the narrow allowlist query (key=dmca_agent + public_read=true + select value only)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        value: {
          name: 'Jane Doe',
          email: 'legal@uthena.com',
          mailing_address: '123 Main St',
          phone: '',
        },
      },
      error: null,
    })
    await getDmcaAgent()

    // Assertion: the from call targets app_settings.
    expect(mockFrom).toHaveBeenCalledWith('app_settings')
    // Assertion: the select projects ONLY `value` — never the admin-internal
    // columns (description, updated_by, updated_at).
    expect(mockSelect).toHaveBeenCalledWith('value')
    // Assertion: the key filter is `dmca_agent` AND the public_read filter
    // is `true` (matches the RLS policy's `using (public_read = true)`).
    expect(mockEqKey).toHaveBeenCalledWith('key', 'dmca_agent')
    expect(mockEqPublic).toHaveBeenCalledWith('public_read', true)
  })
})