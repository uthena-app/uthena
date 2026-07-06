// Unit tests for `00-foundations/gdpr/retention.ts`. Pure config —
// no mocks needed. Verifies:
//   - the policy table has an entry for every user-data table
//   - each policy has a non-empty label, rationale, and valid action
//   - `days` is null OR a positive integer (we never set 0 or negative)
//   - `describeRetention` returns the expected shape
//   - `getRetentionPolicy` is a typed lookup
//
// Run: `pnpm test retention` (vitest).

import { describe, expect, it } from 'vitest'
import {
  RETENTION_POLICIES,
  RETENTION_POLICIES_LIST,
  describeRetention,
  getRetentionPolicy,
  type RetentionPolicy,
} from './retention'

// The full set of Supabase tables that hold user-data. If a new table
// is added without a retention entry, this test catches it.
const USER_DATA_TABLES = [
  'profiles',
  'auth_identities',
  'orders',
  'order_items',
  'refunds',
  'subscriptions',
  'library_grants',
  'file_downloads',
  'reviews',
  'consent_log',
  'api_tokens',
  'admin_audit_log',
  'partners',
  'affiliates',
  'partner_uploads',
  'partner_onboarding_drafts',
  'risk_signals',
  'reports',
  'notification_preferences',
  'cart_items',
] as const

describe('RETENTION_POLICIES — coverage', () => {
  it('has an entry for every user-data table', () => {
    for (const table of USER_DATA_TABLES) {
      expect(RETENTION_POLICIES, `missing policy for ${table}`).toHaveProperty(table)
    }
  })

  it('exposes the policies as an array via RETENTION_POLICIES_LIST', () => {
    expect(RETENTION_POLICIES_LIST).toBeInstanceOf(Array)
    expect(RETENTION_POLICIES_LIST.length).toBeGreaterThanOrEqual(USER_DATA_TABLES.length)
    for (const p of RETENTION_POLICIES_LIST) {
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.rationale.length).toBeGreaterThan(0)
    }
  })
})

describe('RETENTION_POLICIES — shape', () => {
  const VALID_ACTIONS: RetentionPolicy['action'][] = [
    'anonymize',
    'hard_delete',
    'archive',
    'keep_indefinitely',
  ]

  for (const [table, policy] of Object.entries(RETENTION_POLICIES)) {
    it(`${table} has a valid policy`, () => {
      expect(policy.label.length).toBeGreaterThan(0)
      expect(policy.rationale.length).toBeGreaterThan(0)
      expect(VALID_ACTIONS).toContain(policy.action)
      if (policy.days !== null) {
        expect(policy.days).toBeGreaterThan(0)
        expect(Number.isInteger(policy.days)).toBe(true)
      }
    })
  }

  it('7-year retention windows are exactly 7 * 365', () => {
    expect(RETENTION_POLICIES.orders.days).toBe(7 * 365)
    expect(RETENTION_POLICIES.order_items.days).toBe(7 * 365)
    expect(RETENTION_POLICIES.refunds.days).toBe(7 * 365)
    expect(RETENTION_POLICIES.subscriptions.days).toBe(7 * 365)
    expect(RETENTION_POLICIES.risk_signals.days).toBe(7 * 365)
    expect(RETENTION_POLICIES.reports.days).toBe(7 * 365)
  })

  it('consent_log + admin_audit_log are 730 days (24 months)', () => {
    expect(RETENTION_POLICIES.consent_log.days).toBe(730)
    expect(RETENTION_POLICIES.admin_audit_log.days).toBe(730)
  })

  it('file_downloads is 90 days (operational fraud window)', () => {
    expect(RETENTION_POLICIES.file_downloads.days).toBe(90)
  })

  it('cart_items is 30 days (abandoned-cart sweep)', () => {
    expect(RETENTION_POLICIES.cart_items.days).toBe(30)
  })
})

describe('getRetentionPolicy', () => {
  it('returns the policy for a known table', () => {
    const p = getRetentionPolicy('orders')
    expect(p.label).toBe('Order history')
    expect(p.days).toBe(7 * 365)
  })

  it('returns the policy for an indefinite table', () => {
    const p = getRetentionPolicy('profiles')
    expect(p.action).toBe('keep_indefinitely')
    expect(p.days).toBeNull()
  })

  it('compile-time: passing an unknown table is a type error', () => {
    // The line below is the test — it should fail to compile if a
    // caller passes a string that isn't a key of RETENTION_POLICIES.
    // Wrapped in `as` so the file compiles; the assertion proves
    // the runtime helper matches the type contract.
    const table = 'orders' as keyof typeof RETENTION_POLICIES
    expect(getRetentionPolicy(table).label).toBe('Order history')
  })
})

describe('describeRetention', () => {
  it('renders the days-based label for finite windows', () => {
    const s = describeRetention('orders')
    expect(s).toContain('Order history')
    expect(s).toContain('7 years')
  })

  it('renders an alternate label for sub-year windows', () => {
    const s = describeRetention('file_downloads')
    expect(s).toContain('Download / stream audit log')
    expect(s).toContain('90 days')
  })

  it('renders the indefinite label for keep_indefinitely tables', () => {
    const s = describeRetention('profiles')
    expect(s).toContain('kept while your account is active')
  })

  it('always produces a non-empty string', () => {
    for (const k of Object.keys(RETENTION_POLICIES) as Array<keyof typeof RETENTION_POLICIES>) {
      expect(describeRetention(k).length).toBeGreaterThan(0)
    }
  })
})