// Unit tests for the RLS role enumeration + helpers in `roles.ts`.
//
// Pure tests, no fixtures, no DB. Run: `pnpm test rls-roles`.

import { describe, expect, it } from 'vitest'
import {
  RLS_ROLES,
  isAuthenticatedRole,
  isServiceRole,
  roleLabel,
  roleLabelLong,
  RLS_SEED_USERS,
} from './roles'
import type { RlsRole } from './types'

describe('RLS_ROLES', () => {
  it('contains exactly the eight canonical roles', () => {
    expect(RLS_ROLES).toHaveLength(8)
    expect(new Set(RLS_ROLES).size).toBe(8)
  })

  it('is in the expected source order', () => {
    expect(RLS_ROLES).toEqual([
      'anon',
      'authenticated_customer',
      'authenticated_partner',
      'authenticated_partner_other',
      'authenticated_affiliate',
      'authenticated_admin',
      'authenticated_super_admin',
      'service_role',
    ])
  })
})

describe('isAuthenticatedRole', () => {
  it.each([
    ['anon', false],
    ['authenticated_customer', true],
    ['authenticated_partner', true],
    ['authenticated_partner_other', true],
    ['authenticated_affiliate', true],
    ['authenticated_admin', true],
    ['authenticated_super_admin', true],
    ['service_role', false],
  ] as const satisfies ReadonlyArray<[RlsRole, boolean]>)(
    'returns %s for %s',
    (role, expected) => {
      expect(isAuthenticatedRole(role)).toBe(expected)
    },
  )
})

describe('isServiceRole', () => {
  it('returns true only for service_role', () => {
    expect(isServiceRole('service_role')).toBe(true)
    for (const role of RLS_ROLES) {
      if (role === 'service_role') continue
      expect(isServiceRole(role)).toBe(false)
    }
  })
})

describe('roleLabel', () => {
  it('returns the role value as-is (the canonical short form)', () => {
    for (const role of RLS_ROLES) {
      expect(roleLabel(role)).toBe(role)
    }
  })
})

describe('roleLabelLong', () => {
  it('returns a human-readable label for every role', () => {
    for (const role of RLS_ROLES) {
      const label = roleLabelLong(role)
      expect(typeof label).toBe('string')
      expect(label.length).toBeGreaterThan(0)
    }
  })

  it('uses distinct labels (no collisions)', () => {
    const labels = RLS_ROLES.map((r) => roleLabelLong(r))
    expect(new Set(labels).size).toBe(labels.length)
  })
})

describe('RLS_SEED_USERS', () => {
  it('has a slot for every RlsRole', () => {
    for (const role of RLS_ROLES) {
      expect(RLS_SEED_USERS).toHaveProperty(role)
    }
  })

  it('has empty email for anon and service_role (no seed needed)', () => {
    expect(RLS_SEED_USERS.anon).toBe('')
    expect(RLS_SEED_USERS.service_role).toBe('')
  })

  it('has a real-looking email for every authenticated role', () => {
    const authenticatedRoles = RLS_ROLES.filter(
      (r) => r !== 'anon' && r !== 'service_role',
    )
    for (const role of authenticatedRoles) {
      const email = RLS_SEED_USERS[role]
      expect(email).toMatch(/@uthena\.test$/)
    }
  })
})
