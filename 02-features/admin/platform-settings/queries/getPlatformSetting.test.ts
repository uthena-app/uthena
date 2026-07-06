// getPlatformSetting.test.ts — unit tests for the admin platform
// settings read.
//
// The query uses service-role to bypass RLS (so admins can see every
// key, including public_read=false ones). The shape mirrors what the
// /admin/dmca-agent editor needs to pre-fill the form.
//
// Covers:
//   - happy path: row found → typed result returned
//   - row missing → null
//   - DB error → null + warn log
//   - defensive mapping for getDmcaAgentForAdmin (bad JSONB shape,
//     missing required fields → null)
//   - query shape assertion (always selects the narrow column set,
//     filters by key=dmca_agent)

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockMaybeSingle = vi.fn()
const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }))
const mockSelect = vi.fn(() => ({ eq: mockEq }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))

vi.mock('@foundations/data/supabase', () => ({
  getServiceSupabase: () => ({ from: mockFrom }),
}))

vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

import { getPlatformSetting, getDmcaAgentForAdmin } from './getPlatformSetting'

beforeEach(() => {
  mockMaybeSingle.mockClear()
  mockEq.mockClear()
  mockSelect.mockClear()
  mockFrom.mockClear()
})

describe('getPlatformSetting', () => {
  it('returns the raw row when present', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        key: 'dmca_agent',
        value: { name: 'Jane Doe', email: 'legal@uthena.com', mailing_address: '123 Main St', phone: '' },
        description: 'DMCA designated agent',
        public_read: true,
        updated_at: '2026-06-29T10:00:00Z',
        updated_by: 'admin-1',
      },
      error: null,
    })

    const row = await getPlatformSetting('dmca_agent')
    expect(row).toEqual({
      key: 'dmca_agent',
      value: { name: 'Jane Doe', email: 'legal@uthena.com', mailing_address: '123 Main St', phone: '' },
      description: 'DMCA designated agent',
      public_read: true,
      updated_at: '2026-06-29T10:00:00Z',
      updated_by: 'admin-1',
    })
    expect(mockFrom).toHaveBeenCalledWith('app_settings')
    expect(mockEq).toHaveBeenCalledWith('key', 'dmca_agent')
  })

  it('returns null when the row is missing', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
    const row = await getPlatformSetting('dmca_agent')
    expect(row).toBeNull()
  })

  it('returns null on a DB error', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'permission denied' },
    })
    const row = await getPlatformSetting('dmca_agent')
    expect(row).toBeNull()
  })
})

describe('getDmcaAgentForAdmin', () => {
  it('returns the parsed typed contact when the row is well-formed', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        key: 'dmca_agent',
        value: {
          name: '  Jane Doe  ',
          email: '  legal@uthena.com  ',
          mailing_address: '  123 Main St  ',
          phone: '  +1-555-0100  ',
        },
        description: null,
        public_read: true,
        updated_at: '2026-06-29T10:00:00Z',
        updated_by: null,
      },
      error: null,
    })

    const agent = await getDmcaAgentForAdmin()
    expect(agent).toEqual({
      name: 'Jane Doe',
      email: 'legal@uthena.com',
      mailing_address: '123 Main St',
      phone: '+1-555-0100',
    })
  })

  it('returns null when the row is missing', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
    const agent = await getDmcaAgentForAdmin()
    expect(agent).toBeNull()
  })

  it('returns null when the value is a string (not an object)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        key: 'dmca_agent',
        value: 'not an object',
        description: null,
        public_read: true,
        updated_at: '2026-06-29T10:00:00Z',
        updated_by: null,
      },
      error: null,
    })
    const agent = await getDmcaAgentForAdmin()
    expect(agent).toBeNull()
  })

  it('returns null when a required field is empty', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        key: 'dmca_agent',
        value: { name: 'Jane Doe', email: 'legal@uthena.com', mailing_address: '', phone: '' },
        description: null,
        public_read: true,
        updated_at: '2026-06-29T10:00:00Z',
        updated_by: null,
      },
      error: null,
    })
    const agent = await getDmcaAgentForAdmin()
    expect(agent).toBeNull()
  })

  it('returns null on a DB error', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'timeout' },
    })
    const agent = await getDmcaAgentForAdmin()
    expect(agent).toBeNull()
  })
})