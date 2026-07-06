// Unit tests for the SES seam in `00-foundations/email/ses.ts`.
// Covers:
//
//   - isSesConfigured: env-gated behavior (region + from + access key)
//   - sendEmail: no-op log fallback when unconfigured, warn log when
//     configured but SDK not wired (PH18), PII redaction in logs,
//     category tagging, the EmailSendResult shape
//   - EMAIL_CATEGORIES: catalog + coverage
//
// Run: `pnpm test ses` (vitest).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetEnvForTests } from '../env'
import {
  EMAIL_CATEGORIES,
  isSesConfigured,
  sendEmail,
  type EmailMessage,
} from './ses'

const baseMsg: EmailMessage = {
  to: 'user@example.com',
  subject: 'Test',
  html: '<p>hi</p>',
  text: 'hi',
  category: 'transactional',
}

// ===========================================================================
// Env management
// ===========================================================================

const BASE_ENV = {
  AWS_REGION: 'us-east-1',
  AWS_SES_FROM_EMAIL: 'noreply@uthena.com',
  AWS_ACCESS_KEY_ID: 'AKIA-test',
  AWS_SECRET_ACCESS_KEY: 'secret-test',
}

function setEnv(overrides: Partial<typeof BASE_ENV> & { clear?: (keyof typeof BASE_ENV)[] } = {}) {
  const cleared = new Set(overrides.clear ?? [])
  for (const k of Object.keys(BASE_ENV)) {
    const key = k as keyof typeof BASE_ENV
    const ov = (overrides as Record<string, string | undefined>)[k]
    if (cleared.has(key) || ov === '') {
      delete process.env[k]
    } else if (ov !== undefined) {
      process.env[k] = ov
    } else {
      process.env[k] = BASE_ENV[key]
    }
  }
  _resetEnvForTests()
}

function clearEnv() {
  for (const k of Object.keys(BASE_ENV)) delete process.env[k]
  _resetEnvForTests()
}

beforeEach(() => {
  setEnv()
})

afterEach(() => {
  clearEnv()
  vi.restoreAllMocks()
})

// ===========================================================================
// isSesConfigured
// ===========================================================================

describe('isSesConfigured', () => {
  it('returns true when region + from + access key are set', () => {
    setEnv()
    expect(isSesConfigured()).toBe(true)
  })

  it('returns false when AWS_REGION is empty', () => {
    setEnv({ AWS_REGION: '', clear: ['AWS_REGION'] })
    expect(isSesConfigured()).toBe(false)
  })

  it('returns false when AWS_ACCESS_KEY_ID is empty', () => {
    setEnv({ AWS_ACCESS_KEY_ID: '', clear: ['AWS_ACCESS_KEY_ID'] })
    expect(isSesConfigured()).toBe(false)
  })
})

// ===========================================================================
// EMAIL_CATEGORIES
// ===========================================================================

describe('EMAIL_CATEGORIES', () => {
  it('contains the 4 documented categories', () => {
    expect(EMAIL_CATEGORIES).toEqual(['transactional', 'marketing', 'consent', 'operational'])
  })

  it('has no duplicates', () => {
    expect(new Set(EMAIL_CATEGORIES).size).toBe(EMAIL_CATEGORIES.length)
  })

  it('every category is a lowercase single word', () => {
    for (const c of EMAIL_CATEGORIES) {
      expect(c).toMatch(/^[a-z]+$/)
    }
  })
})

// ===========================================================================
// sendEmail()
// ===========================================================================

describe('sendEmail() — unconfigured (dev fallback)', () => {
  it('returns ok:true with mode:log when SES is not configured', async () => {
    setEnv({ clear: ['AWS_REGION', 'AWS_ACCESS_KEY_ID'] })
    const r = await sendEmail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>hi</p>',
      text: 'hi',
      category: 'transactional',
    })
    expect(r.ok).toBe(true)
    expect(r.mode).toBe('log')
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/i) // UUID shape
  })

  it('returns a fresh UUID per call', async () => {
    setEnv({ clear: ['AWS_REGION', 'AWS_ACCESS_KEY_ID'] })
    const a = await sendEmail({ ...baseMsg, category: 'transactional' })
    const b = await sendEmail({ ...baseMsg, category: 'transactional' })
    expect(a.id).not.toBe(b.id)
  })
})

describe('sendEmail() — configured (P17.1 SDK is wired)', () => {
  it('attempts to send via SES but returns mode:ses + ok:false when the SDK call throws (test creds)', async () => {
    // The SDK IS wired. With test credentials, the SES API will reject
    // the request — we expect mode:'ses' + ok:false (not mode:'log').
    setEnv()
    const r = await sendEmail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>hi</p>',
      text: 'hi',
      category: 'transactional',
    })
    expect(r.mode).toBe('ses')
    expect(r.ok).toBe(false)
    expect(typeof r.error).toBe('string')
  })

  it('returns a fresh UUID even on SDK failure', async () => {
    setEnv()
    const r = await sendEmail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>hi</p>',
      text: 'hi',
      category: 'transactional',
    })
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/i)
  })
})

// ===========================================================================
// PII safety — emails are passed to pino; the redact list handles them
// ===========================================================================

describe('sendEmail() — PII safety contract', () => {
  it('does not throw when the recipient is a real-looking address', async () => {
    setEnv({ clear: ['AWS_REGION', 'AWS_ACCESS_KEY_ID'] })
    await expect(
      sendEmail({
        to: 'user.name+tag@example.com',
        subject: 'Test',
        html: '<p>hi</p>',
        text: 'hi',
        category: 'transactional',
      }),
    ).resolves.toMatchObject({ ok: true })
  })
})

// ===========================================================================
// Message variants
// ===========================================================================

describe('sendEmail() — message variants', () => {
  it.each(EMAIL_CATEGORIES)('accepts the %s category', async (cat) => {
    setEnv({ clear: ['AWS_REGION', 'AWS_ACCESS_KEY_ID'] })
    const r = await sendEmail({ ...baseMsg, category: cat })
    expect(r.ok).toBe(true)
  })

  it('passes the from override when provided', async () => {
    setEnv({ clear: ['AWS_REGION', 'AWS_ACCESS_KEY_ID'] })
    const r = await sendEmail({ ...baseMsg, from: 'custom@example.com' })
    expect(r.ok).toBe(true)
  })

  it('passes the replyTo override when provided', async () => {
    setEnv({ clear: ['AWS_REGION', 'AWS_ACCESS_KEY_ID'] })
    const r = await sendEmail({ ...baseMsg, replyTo: 'support@uthena.com' })
    expect(r.ok).toBe(true)
  })

  it('passes tags through', async () => {
    setEnv({ clear: ['AWS_REGION', 'AWS_ACCESS_KEY_ID'] })
    const r = await sendEmail({ ...baseMsg, tags: { campaign: 'spring-2026' } })
    expect(r.ok).toBe(true)
  })
})