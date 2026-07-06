// Barrel for the RLS test framework.
//
// Consumers (the CLI script, the unit tests, the future live
// integration test) import from this module. The barrel re-exports
// the public surface and keeps the internal module structure
// hidden — a future refactor (e.g. splitting `run.ts` into
// `runner.ts` + `formatter.ts`) can land without breaking call
// sites.

export type {
  RlsRole,
  RlsOperation,
  RlsExpect,
  RlsPolicyTest,
  RlsTestResult,
  RlsTestReport,
  RlsExecutor,
  RlsExecutorOutcome,
  RlsRunOptions,
} from './types'

export { RLS_ROLES, isAuthenticatedRole, isServiceRole, roleLabel, roleLabelLong, RLS_SEED_USERS } from './roles'

export {
  ALL_RLS_POLICIES,
  tablesInFixture,
  fixtureCoverage,
  PUBLIC_READ,
  ADMIN_ONLY,
  APPEND_ONLY,
  SELF_READ,
} from './policies'

export {
  signInAs,
  isRlsStub,
  RLS_STUB_MARKER,
} from './sign-in-as'
export type { RlsSupabaseClient, SignInAsOptions } from './sign-in-as'

export { runRlsTests, formatReport, reportToJson, aggregateByTable } from './run'

export { main as runRlsCli } from './cli'
