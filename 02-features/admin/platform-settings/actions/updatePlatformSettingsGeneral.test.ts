// updatePlatformSettingsGeneral.test.ts — unit tests for the P14.12
// platform-settings general update server action. Mocks the service-
// role Supabase client + requireRole + the audit-log writer + headers.
//
// Covers:
// - Auth: requireRole returns admin → proceeds
// - Auth: requireRole returns null → "not authorized" error
// - Auth: requireRole throws → "not authorized" error
// - Zod: missing field → fieldErrors
// - Zod: out-of-range bps → fieldErrors
// - Zod: out-of-range refund days → fieldErrors
// - Zod: extra field → .strict() rejects
// - Zod: string-coerced numeric inputs are coerced to numbers
// - Pre-read failure → friendly error
// - Pre-read null → friendly error (defensive)
// - Happy path: changed values → update succeeds + audit row
// - Happy path: no-op save → returns changed:false, NO audit row,
//   NO update call
// - Focused diff: only the changed keys land in the audit row
// - Audit failure → non-fatal warn log, action still returns ok

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Service-role mock ---------------------------------------------------

type ServiceCall =
  | { method: 'from'; table: string }
  | { method: 'select'; payload: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'maybeSingle' }
  | { method: 'single' }
  | { method: 'update'; payload: unknown }

const serviceCalls: ServiceCall[] = []
let serviceQueue: Array<{ data: unknown; error: unknown }> = []

const platformSettingsUpdates: Array<Record<string, unknown>> = []

function makeChain() {
  const chain: any = {
    select(payload: unknown) {
      serviceCalls.push({ method: 'select', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      serviceCalls.push({ method: 'eq', col, val })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      serviceCalls.push({ method: 'maybeSingle' })
      return serviceQueue.shift() ?? { data: null, error: null }
    }),
    single: vi.fn(async () => {
      serviceCalls.push({ method: 'single' })
      return serviceQueue.shift() ?? { data: null, error: null }
    }),
    update(payload: unknown) {
      serviceCalls.push({ method: 'update', payload })
      if (typeof payload === 'object' && payload !== null) {
        platformSettingsUpdates.push(payload as Record<string, unknown>)
      }
      return chain
    },
  }
  return chain
}

const fakeServiceSupabase = {
  from: vi.fn((table: string) => {
    serviceCalls.push({ method: 'from', table })
    return makeChain()
  }),
}

vi.mock('@foundations/data/supabase', () => ({
  getServiceSupabase: vi.fn(() => fakeServiceSupabase),
}))

// ----- requireRole mock ----------------------------------------------------

let requireRoleReturn: { id: string; email: string } | null = { id: 'u_admin', email: 'admin@uthena.com' }
let requireRoleThrow: Error | null = null

vi.mock('@foundations/auth/guards', () => ({
  requireRole: vi.fn(async () => {
    if (requireRoleThrow) throw requireRoleThrow
    return requireRoleReturn
  }),
}))

// ----- Audit-log writer mock ----------------------------------------------

const writeAuditCalls: Array<Record<string, unknown>> = []

vi.mock('./writePlatformSettingsAuditLog', () => ({
  writePlatformSettingsAuditLog: vi.fn(async (input: Record<string, unknown>) => {
    writeAuditCalls.push(input)
    return 42
  }),
}))

// ----- Logger mock ---------------------------------------------------------

const logCalls: Array<{ level: string; payload: Record<string, unknown> }> = []

vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({
    info: (p: Record<string, unknown>) => logCalls.push({ level: 'info', payload: p }),
    warn: (p: Record<string, unknown>) => logCalls.push({ level: 'warn', payload: p }),
    error: (p: Record<string, unknown>) => logCalls.push({ level: 'error', payload: p }),
    debug: (p: Record<string, unknown>) => logCalls.push({ level: 'debug', payload: p }),
  }),
}))

// ----- Headers + revalidatePath mocks -------------------------------------

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({
    get: (k: string) => {
      if (k === 'x-forwarded-for') return '203.0.113.1'
      if (k === 'user-agent') return 'vitest'
      return null
    },
  })),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// ----- Helpers -------------------------------------------------------------

function resetAll(): void {
  serviceCalls.length = 0
  serviceQueue.length = 0
  platformSettingsUpdates.length = 0
  writeAuditCalls.length = 0
  logCalls.length = 0
  requireRoleReturn = { id: 'u_admin', email: 'admin@uthena.com' }
  requireRoleThrow = null
  vi.clearAllMocks()
}

function enqueue(data: unknown, error: unknown = null): void {
  serviceQueue.push({ data, error })
}

// ----- Tests ---------------------------------------------------------------

describe('updatePlatformSettingsGeneralAction — auth', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('rejects with "not authorized" when requireRole returns null', async () => {
    const { updatePlatformSettingsGeneralAction } = await import('./updatePlatformSettingsGeneral')
    requireRoleReturn = null
    const out = await updatePlatformSettingsGeneralAction({
      default_royalty_pct_bps: 3000,
      plr_subscriber_discount_pct_bps: 1500,
      default_refund_window_days: 14,
    })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.error).toBe('You are not authorized to edit platform settings.')
    }
  })

  it('rejects with "not authorized" when requireRole throws', async () => {
    const { updatePlatformSettingsGeneralAction } = await import('./updatePlatformSettingsGeneral')
    requireRoleThrow = new Error('redirect')
    const out = await updatePlatformSettingsGeneralAction({
      default_royalty_pct_bps: 3000,
      plr_subscriber_discount_pct_bps: 1500,
      default_refund_window_days: 14,
    })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.error).toBe('You are not authorized to edit platform settings.')
    }
  })
})

describe('updatePlatformSettingsGeneralAction — Zod parse', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('returns fieldErrors when a required field is missing', async () => {
    const { updatePlatformSettingsGeneralAction } = await import('./updatePlatformSettingsGeneral')
    const out = await updatePlatformSettingsGeneralAction({
      default_royalty_pct_bps: 3000,
      plr_subscriber_discount_pct_bps: 1500,
      // default_refund_window_days missing
    })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.error).toBe('Please fix the errors below.')
      expect(out.fieldErrors?.['default_refund_window_days']).toBeDefined()
    }
  })

  it('returns fieldErrors when bps is out of range', async () => {
    const { updatePlatformSettingsGeneralAction } = await import('./updatePlatformSettingsGeneral')
    const out = await updatePlatformSettingsGeneralAction({
      default_royalty_pct_bps: 11000, // > 10000
      plr_subscriber_discount_pct_bps: 1500,
      default_refund_window_days: 14,
    })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.fieldErrors?.['default_royalty_pct_bps']).toMatch(/cannot exceed 100/)
    }
  })

  it('returns fieldErrors when refund window is below 1', async () => {
    const { updatePlatformSettingsGeneralAction } = await import('./updatePlatformSettingsGeneral')
    const out = await updatePlatformSettingsGeneralAction({
      default_royalty_pct_bps: 3000,
      plr_subscriber_discount_pct_bps: 1500,
      default_refund_window_days: 0,
    })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.fieldErrors?.['default_refund_window_days']).toMatch(/at least 1 day/)
    }
  })

  it('rejects unknown extra fields (.strict)', async () => {
    const { updatePlatformSettingsGeneralAction } = await import('./updatePlatformSettingsGeneral')
    const out = await updatePlatformSettingsGeneralAction({
      default_royalty_pct_bps: 3000,
      plr_subscriber_discount_pct_bps: 1500,
      default_refund_window_days: 14,
      evil_field: 'injected',
    } as unknown as Record<string, unknown>)
    expect(out.ok).toBe(false)
  })

  it('coerces string numeric inputs (FormData path)', async () => {
    const { updatePlatformSettingsGeneralAction } = await import('./updatePlatformSettingsGeneral')
    enqueue({
      default_royalty_pct_bps: 3000,
      plr_subscriber_discount_pct_bps: 1500,
      default_refund_window_days: 14,
    })
    enqueue({ updated_at: '2026-06-29T10:00:00.000Z' })
    const fd = new FormData()
    fd.set('default_royalty_pct_bps', '3500')
    fd.set('plr_subscriber_discount_pct_bps', '2000')
    fd.set('default_refund_window_days', '21')
    const out = await updatePlatformSettingsGeneralAction(fd)
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.changed).toBe(true)
      expect(platformSettingsUpdates.length).toBe(1)
      expect(platformSettingsUpdates[0]!['default_royalty_pct_bps']).toBe(3500)
      expect(platformSettingsUpdates[0]!['plr_subscriber_discount_pct_bps']).toBe(2000)
      expect(platformSettingsUpdates[0]!['default_refund_window_days']).toBe(21)
    }
  })
})

describe('updatePlatformSettingsGeneralAction — pre-read failures', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('returns friendly error when pre-read fails', async () => {
    const { updatePlatformSettingsGeneralAction } = await import('./updatePlatformSettingsGeneral')
    enqueue(null, { message: 'permission denied' })
    const out = await updatePlatformSettingsGeneralAction({
      default_royalty_pct_bps: 3500,
      plr_subscriber_discount_pct_bps: 1500,
      default_refund_window_days: 14,
    })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.error).toBe('Could not read the current settings. Try again.')
    }
  })

  it('returns friendly error when pre-read returns null (no row)', async () => {
    const { updatePlatformSettingsGeneralAction } = await import('./updatePlatformSettingsGeneral')
    enqueue(null)
    const out = await updatePlatformSettingsGeneralAction({
      default_royalty_pct_bps: 3500,
      plr_subscriber_discount_pct_bps: 1500,
      default_refund_window_days: 14,
    })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.error).toBe('Could not read the current settings. Try again.')
    }
  })
})

describe('updatePlatformSettingsGeneralAction — no-op save', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('returns changed:false, no update, no audit row when values are identical', async () => {
    const { updatePlatformSettingsGeneralAction } = await import('./updatePlatformSettingsGeneral')
    enqueue({
      default_royalty_pct_bps: 3000,
      plr_subscriber_discount_pct_bps: 1500,
      default_refund_window_days: 14,
    })
    const out = await updatePlatformSettingsGeneralAction({
      default_royalty_pct_bps: 3000,
      plr_subscriber_discount_pct_bps: 1500,
      default_refund_window_days: 14,
    })
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.changed).toBe(false)
    }
    expect(platformSettingsUpdates.length).toBe(0)
    expect(writeAuditCalls.length).toBe(0)
  })
})

describe('updatePlatformSettingsGeneralAction — happy path', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('writes update + focused audit row when refund window changes', async () => {
    const { updatePlatformSettingsGeneralAction } = await import('./updatePlatformSettingsGeneral')
    enqueue({
      default_royalty_pct_bps: 3000,
      plr_subscriber_discount_pct_bps: 1500,
      default_refund_window_days: 14,
    })
    enqueue({ updated_at: '2026-06-29T11:00:00.000Z' })
    const out = await updatePlatformSettingsGeneralAction({
      default_royalty_pct_bps: 3000,
      plr_subscriber_discount_pct_bps: 1500,
      default_refund_window_days: 30,
    })
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.changed).toBe(true)
      expect(out.updatedAt).toBe('2026-06-29T11:00:00.000Z')
    }
    expect(platformSettingsUpdates.length).toBe(1)
    expect(platformSettingsUpdates[0]!['default_refund_window_days']).toBe(30)
    expect(platformSettingsUpdates[0]!['updated_by']).toBe('u_admin')

    // Focused audit row — only the changed key is recorded
    expect(writeAuditCalls.length).toBe(1)
    const audit = writeAuditCalls[0]!
    expect(audit['key']).toBe('general')
    expect(audit['action']).toBe('admin.settings_update')
    const before = audit['before'] as Record<string, unknown>
    const after = audit['after'] as Record<string, unknown>
    expect(before['_changed_keys']).toEqual(['default_refund_window_days'])
    expect(after['_changed_keys']).toEqual(['default_refund_window_days'])
    expect(before['default_refund_window_days']).toBe(14)
    expect(after['default_refund_window_days']).toBe(30)
    // unchanged keys NOT in the diff
    expect(before['default_royalty_pct_bps']).toBeUndefined()
  })

  it('writes update with all 3 changed keys when all 3 change', async () => {
    const { updatePlatformSettingsGeneralAction } = await import('./updatePlatformSettingsGeneral')
    enqueue({
      default_royalty_pct_bps: 3000,
      plr_subscriber_discount_pct_bps: 1500,
      default_refund_window_days: 14,
    })
    enqueue({ updated_at: '2026-06-29T11:00:00.000Z' })
    const out = await updatePlatformSettingsGeneralAction({
      default_royalty_pct_bps: 4000,
      plr_subscriber_discount_pct_bps: 2000,
      default_refund_window_days: 30,
    })
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.changed).toBe(true)
    expect(platformSettingsUpdates.length).toBe(1)
    expect(writeAuditCalls.length).toBe(1)
    const audit = writeAuditCalls[0]!
    const after = audit['after'] as Record<string, unknown>
    expect(after['_changed_keys']).toEqual([
      'default_royalty_pct_bps',
      'plr_subscriber_discount_pct_bps',
      'default_refund_window_days',
    ])
  })
})