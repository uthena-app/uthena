// reencrypt-legacy-payout-methods.test.ts — unit tests for the
// STUB-052 fix: the background cron that re-encrypts legacy plaintext
// `partners.payout_method` rows
// (04-platform/ci/scripts/cron/reencrypt-legacy-payout-methods.ts).
//
// Covers:
//   - **needsReencryption**: true for a plain-string paypal_email that
//     is NOT an encrypted envelope; false for an already-encrypted
//     envelope, a missing/empty email, or a missing payout_method.
//   - **maskEmailForAudit**: masks the local part, preserves the
//     domain (same shape as the partner-portal maskEmail helper).
//   - **reencryptOnePartner — encrypt→decrypt round trip**: the row's
//     plaintext email, once run through `reencryptOnePartner`,
//     produces a `payout_method.paypal_email_encrypted` envelope that
//     `decryptStringOrPassThrough` (the SAME helper the live read path
//     uses) decrypts back to the original plaintext. The legacy
//     `paypal_email` key is removed from the write payload.
//   - **reencryptOnePartner — reads decrypt transparently after the
//     cron runs**: simulates the full write → re-read → decrypt cycle
//     that `decryptPayoutMethod.ts` performs on every partner-settings
//     page load, proving the re-encrypted row renders identically to
//     how the legacy plaintext row rendered.
//   - **reencryptOnePartner — race guard**: if the fresh re-read shows
//     the row was already encrypted (concurrent partner self-edit),
//     the function is a no-op success and does NOT write.
//   - **reencryptOnePartner — encrypt failure**: a broken encryption
//     key surfaces as `{ ok: false }`, not a silent success.
//   - **reencryptOnePartner — update failure**: a DB write error
//     surfaces as `{ ok: false }`.
//   - **reencryptOnePartner — audit log best-effort**: an audit-insert
//     throw does not fail the row (the encryption + write already
//     succeeded).
//
// Strategy: real `encryptString` / `decryptStringOrPassThrough` (no
// mock — this is the exact round-trip the test needs to prove), a
// deterministic dev encryption key via env, and a chainable fake
// Supabase service client.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetEnvForTests } from '@foundations/env'

const ORIGINAL_ENV = { ...process.env }

function setEnv(overrides: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

beforeEach(() => {
  setEnv({
    NODE_ENV: 'development',
    PARTNER_PAYOUT_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  })
  _resetEnvForTests()
})

afterEach(() => {
  setEnv(ORIGINAL_ENV)
  _resetEnvForTests()
  vi.clearAllMocks()
})

describe('needsReencryption', () => {
  it('is true for a plaintext paypal_email', async () => {
    const { needsReencryption } = await import('./reencrypt-legacy-payout-methods')
    expect(needsReencryption({ id: 1, payout_method: { paypal_email: 'alice@example.com' } })).toBe(true)
  })

  it('is false when the email is already an encrypted envelope', async () => {
    const { needsReencryption } = await import('./reencrypt-legacy-payout-methods')
    const { encryptString } = await import('@foundations/security/encryption')
    const envelope = encryptString('alice@example.com')
    expect(needsReencryption({ id: 1, payout_method: { paypal_email: envelope } })).toBe(false)
  })

  it('is false when payout_method is null', async () => {
    const { needsReencryption } = await import('./reencrypt-legacy-payout-methods')
    expect(needsReencryption({ id: 1, payout_method: null })).toBe(false)
  })

  it('is false when paypal_email is missing or empty', async () => {
    const { needsReencryption } = await import('./reencrypt-legacy-payout-methods')
    expect(needsReencryption({ id: 1, payout_method: {} })).toBe(false)
    expect(needsReencryption({ id: 1, payout_method: { paypal_email: '' } })).toBe(false)
    expect(needsReencryption({ id: 1, payout_method: { paypal_email: '   ' } })).toBe(false)
  })
})

describe('maskEmailForAudit', () => {
  it('masks the local part and preserves the domain', async () => {
    const { maskEmailForAudit } = await import('./reencrypt-legacy-payout-methods')
    expect(maskEmailForAudit('alice@example.com')).toBe('a***@example.com')
  })

  it('falls back to *** for a degenerate address', async () => {
    const { maskEmailForAudit } = await import('./reencrypt-legacy-payout-methods')
    expect(maskEmailForAudit('@example.com')).toBe('***')
  })
})

// ----- reencryptOnePartner --------------------------------------------------

type QueueEntry = { data: unknown; error: unknown }

function makeFakeService() {
  let selectQueue: QueueEntry[] = []
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = []
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = []
  let updateResult: QueueEntry = { data: null, error: null }

  const chain: any = {
    select() {
      return chain
    },
    eq() {
      return chain
    },
    maybeSingle: vi.fn(async () => selectQueue.shift() ?? { data: null, error: null }),
    update(payload: Record<string, unknown>) {
      updates.push({ table: currentTable, payload })
      return {
        eq: () => Promise.resolve(updateResult),
      }
    },
    insert(payload: Record<string, unknown>) {
      inserts.push({ table: currentTable, payload })
      return Promise.resolve({ data: null, error: null })
    },
  }

  let currentTable = ''
  const service = {
    from: vi.fn((table: string) => {
      currentTable = table
      return chain
    }),
  }

  return {
    service,
    enqueueSelect(entry: QueueEntry) {
      selectQueue.push(entry)
    },
    setUpdateResult(entry: QueueEntry) {
      updateResult = entry
    },
    updates,
    inserts,
  }
}

describe('reencryptOnePartner', () => {
  it('encrypt→decrypt round trip: writes an envelope that decrypts back to the original plaintext', async () => {
    const { reencryptOnePartner } = await import('./reencrypt-legacy-payout-methods')
    const { decryptStringOrPassThrough } = await import('@foundations/security/encryption')

    const fake = makeFakeService()
    // Fresh re-read returns the same legacy row.
    fake.enqueueSelect({
      data: { id: 10, payout_method: { paypal_email: 'partner@example.com', payout_method_kind: 'paypal' } },
      error: null,
    })
    fake.setUpdateResult({ data: null, error: null })

    const result = await reencryptOnePartner(fake.service as never, {
      id: 10,
      payout_method: { paypal_email: 'partner@example.com' },
    })

    expect(result.ok).toBe(true)
    expect(fake.updates).toHaveLength(1)
    const written = fake.updates[0]!.payload.payout_method as Record<string, unknown>
    // Legacy plaintext key removed.
    expect(written.paypal_email).toBeUndefined()
    // Encrypted envelope present and round-trips to the original value.
    expect(typeof written.paypal_email_encrypted).toBe('string')
    expect(decryptStringOrPassThrough(written.paypal_email_encrypted)).toBe('partner@example.com')
    // Unrelated keys preserved.
    expect(written.payout_method_kind).toBe('paypal')
  })

  it('reads decrypt transparently after the cron runs (write → re-read → decrypt cycle)', async () => {
    const { reencryptOnePartner } = await import('./reencrypt-legacy-payout-methods')
    // The REAL app-level read helper — same function
    // `getMyPartnerProfile` uses to render the partner settings page.
    // Proves the cron's write shape is exactly what the live read
    // path expects, not just what this test's assumptions expect.
    const { decryptPayoutMethod } = await import('@features/partner-portal/queries/decryptPayoutMethod')

    const fake = makeFakeService()
    fake.enqueueSelect({
      data: { id: 11, payout_method: { paypal_email: 'reader@example.com' } },
      error: null,
    })
    fake.setUpdateResult({ data: null, error: null })

    await reencryptOnePartner(fake.service as never, {
      id: 11,
      payout_method: { paypal_email: 'reader@example.com' },
    })

    const writtenPayoutMethod = fake.updates[0]!.payload.payout_method
    const typed = decryptPayoutMethod(writtenPayoutMethod)
    expect(typed.paypal_email).toBe('reader@example.com')
    expect(typed.payout_method_kind).toBe('paypal')
  })

  it('is a no-op success when the fresh re-read shows the row was already encrypted (race guard)', async () => {
    const { reencryptOnePartner } = await import('./reencrypt-legacy-payout-methods')
    const { encryptString } = await import('@foundations/security/encryption')

    const fake = makeFakeService()
    const envelope = encryptString('already-done@example.com')
    // Fresh re-read shows a concurrent write already encrypted it.
    fake.enqueueSelect({
      data: { id: 12, payout_method: { paypal_email_encrypted: envelope } },
      error: null,
    })

    const result = await reencryptOnePartner(fake.service as never, {
      id: 12,
      payout_method: { paypal_email: 'already-done@example.com' },
    })

    expect(result.ok).toBe(true)
    expect(fake.updates).toHaveLength(0)
  })

  it('returns ok:false when the encryption key is misconfigured (production, missing key)', async () => {
    // The env validator requires a few other vars in production mode
    // (mirrors 00-foundations/security/encryption.test.ts
    // "production fail-closed" PROD_ENV_BASE) — satisfy them with
    // placeholders so the validator passes and we reach the
    // encryption-helper's own fail-closed check.
    setEnv({
      NODE_ENV: 'production',
      NEXT_PUBLIC_APP_URL: 'https://uthena.com',
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-placeholder-key-12345',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-placeholder-key-12345',
      AUTH_SECRET: 'x'.repeat(32),
      ALLOWED_ORIGINS: 'https://uthena.com',
      PARTNER_PAYOUT_ENCRYPTION_KEY: undefined,
    })
    _resetEnvForTests()

    const { reencryptOnePartner } = await import('./reencrypt-legacy-payout-methods')
    const fake = makeFakeService()
    fake.enqueueSelect({
      data: { id: 13, payout_method: { paypal_email: 'prodfail@example.com' } },
      error: null,
    })

    const result = await reencryptOnePartner(fake.service as never, {
      id: 13,
      payout_method: { paypal_email: 'prodfail@example.com' },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('encrypt failed')
  })

  it('returns ok:false when the UPDATE fails', async () => {
    const { reencryptOnePartner } = await import('./reencrypt-legacy-payout-methods')
    const fake = makeFakeService()
    fake.enqueueSelect({
      data: { id: 14, payout_method: { paypal_email: 'writefail@example.com' } },
      error: null,
    })
    fake.setUpdateResult({ data: null, error: { message: 'db write failed' } })

    const result = await reencryptOnePartner(fake.service as never, {
      id: 14,
      payout_method: { paypal_email: 'writefail@example.com' },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('db write failed')
  })

  it('does not fail the row when the audit log insert throws (write already succeeded)', async () => {
    const { reencryptOnePartner } = await import('./reencrypt-legacy-payout-methods')
    const fake = makeFakeService()
    fake.enqueueSelect({
      data: { id: 15, payout_method: { paypal_email: 'auditfail@example.com' } },
      error: null,
    })
    fake.setUpdateResult({ data: null, error: null })
    // Force admin_audit_log insert to throw.
    const originalFrom = fake.service.from
    fake.service.from = vi.fn((table: string) => {
      if (table === 'admin_audit_log') {
        return {
          insert: () => {
            throw new Error('audit db unreachable')
          },
        }
      }
      return originalFrom(table)
    }) as never

    const result = await reencryptOnePartner(fake.service as never, {
      id: 15,
      payout_method: { paypal_email: 'auditfail@example.com' },
    })

    expect(result.ok).toBe(true)
  })
})
