// The canonical RLS role enumeration + helpers.
//
// Kept in its own file so `policies.ts`, `sign-in-as.ts`, and the
// future `live` executor can all import the same union without
// creating a circular dependency on `types.ts`.

import type { RlsRole } from './types'

/**
 * The exhaustive list of RLS roles, in source order.
 *
 * **Why a const array and not just the union?** The framework
 * sometimes needs to iterate every role (e.g. "for every role,
 * run the smoke test that the Supabase client instantiates
 * without throwing"). `Object.keys(RLS_ROLES)` would also work
 * but loses the explicit source order, which is the order the
 * report prints the coverage matrix in.
 */
export const RLS_ROLES: readonly RlsRole[] = [
  'anon',
  'authenticated_customer',
  'authenticated_partner',
  'authenticated_partner_other',
  'authenticated_affiliate',
  'authenticated_admin',
  'authenticated_super_admin',
  'service_role',
] as const

/**
 * Is this role authenticated? (i.e. has a session)
 *
 * Used by the sign-in helper to decide whether to mint a fresh
 * session via `signInWithPassword` or to return the unauthenticated
 * anon client.
 */
export function isAuthenticatedRole(role: RlsRole): boolean {
  return role !== 'anon' && role !== 'service_role'
}

/**
 * Is this the service-role client? (bypasses RLS)
 *
 * The service role is the framework's negative control — every
 * policy should allow it through. If a policy silently blocks the
 * service role, that's a bug worth flagging.
 */
export function isServiceRole(role: RlsRole): boolean {
  return role === 'service_role'
}

/**
 * Stable identifier for the role, suitable for log lines + report
 * headers. The `RlsRole` union values are already safe (no PII, no
 * whitespace, no special chars), so this is the identity function
 * — but having a named helper means the call sites read
 * `roleLabel(role)` instead of `role`, and the function can be
 * swapped later if the label needs to differ from the enum value
 * (e.g. for the human-readable "Authenticated Customer" form).
 */
export function roleLabel(role: RlsRole): string {
  return role
}

/**
 * Human-readable label for the role, suitable for the report's
 * coverage matrix header. Two forms: short (default — the enum
 * value) or long (the title-cased form for the report's "Role"
 * column when the report is rendered as a human-facing table).
 */
export function roleLabelLong(role: RlsRole): string {
  switch (role) {
    case 'anon':
      return 'Anonymous (no session)'
    case 'authenticated_customer':
      return 'Customer (authenticated, no partner/affiliate link)'
    case 'authenticated_partner':
      return 'Partner (owning the seed product)'
    case 'authenticated_partner_other':
      return 'Partner (NOT owning the seed product)'
    case 'authenticated_affiliate':
      return 'Affiliate (authenticated, no partner/buyer)'
    case 'authenticated_admin':
      return 'Admin'
    case 'authenticated_super_admin':
      return 'Super admin'
    case 'service_role':
      return 'Service role (bypasses RLS)'
  }
}

/**
 * The seed user emails the live runner expects to find in the
 * staging DB. Documented here (not in a `policies.ts` data row)
 * because they're cross-cutting — every live test needs them.
 *
 * The live runner's setup step is responsible for creating these
 * users in the staging project (via `supabase.auth.admin.createUser`
 * + a profile row + a partners row for the partner identities).
 * See `06-quality/tests/rls/README.md` for the seed recipe.
 */
export const RLS_SEED_USERS: Readonly<Record<RlsRole, string>> = {
  anon: '',
  authenticated_customer: 'rls-test-customer@uthena.test',
  authenticated_partner: 'rls-test-partner-own@uthena.test',
  authenticated_partner_other: 'rls-test-partner-other@uthena.test',
  authenticated_affiliate: 'rls-test-affiliate@uthena.test',
  authenticated_admin: 'rls-test-admin@uthena.test',
  authenticated_super_admin: 'rls-test-super-admin@uthena.test',
  service_role: '',
} as const
