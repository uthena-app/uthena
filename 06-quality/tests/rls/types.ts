// Type definitions for the P3.2 RLS test framework.
//
// The framework has three execution modes:
//   1. `dry-run`  — validates the fixture shape + reports the policy
//                    coverage matrix. No Supabase calls. Always runs.
//   2. `live`     — issues real Supabase queries against a seeded
//                    staging DB. Needs SUPABASE_URL_FOR_RLS_TESTS +
//                    service-role key + pre-seeded test users.
//   3. `mocked`   — for unit tests. The caller wires a fake Supabase
//                    client + the runner validates the assertion logic.
//
// Every mode shares the same `RlsPolicyTest` shape; only the
// `executePolicy` function differs.
//
// **Why a separate type module?** The framework is consumed by the
// CLI script, the unit-test file, and the future live-integration
// test. All three need the same shape. A single `types.ts` is the
// contract — touching the shape is a one-file edit.

/**
 * Every distinct role the RLS policies can encounter.
 *
 * The framework treats `authenticated_*` as four distinct identities
 * (not one) because the RLS policies distinguish between them:
 *   - `authenticated_customer`       — buyer (no partner/affiliate link)
 *   - `authenticated_partner`        — partner who owns a product
 *   - `authenticated_partner_other`  — partner who does NOT own the
 *                                       product being tested
 *   - `authenticated_affiliate`      — affiliate (no partner/buyer)
 *   - `authenticated_admin`          — platform admin
 *   - `authenticated_super_admin`    — super admin (rare; same as
 *                                       admin for most policies but
 *                                       some tables reserve extra
 *                                       powers — e.g. account
 *                                       switcher, impersonation log)
 *
 * `service_role` bypasses RLS entirely. The framework's
 * `service_role` is a **negative control** — every policy should
 * allow service_role through (so the test runner's "is the policy
 * silently blocking the service role?" question is answered).
 */
export type RlsRole =
  | 'anon'
  | 'authenticated_customer'
  | 'authenticated_partner'
  | 'authenticated_partner_other'
  | 'authenticated_affiliate'
  | 'authenticated_admin'
  | 'authenticated_super_admin'
  | 'service_role'

/** The four SQL operations RLS gates. */
export type RlsOperation = 'select' | 'insert' | 'update' | 'delete'

/** Expected outcome of the operation under the given role. */
export type RlsExpect = 'allow' | 'deny'

/**
 * One row in the policy fixture.
 *
 * The framework iterates through `policies.ts` and, for each row,
 * issues the operation as the role and asserts the outcome matches
 * `expect`.
 *
 * **Why a `filter` field?** Some RLS policies are conditional
 * ("public_read_published" lets anon see published rows but not
 * drafts). The `filter` is a string that the live runner uses to
 * pick the right seed row to test against (e.g.
 * `{ status: 'published' }`). In dry-run mode the filter is
 * recorded in the report but not exercised.
 *
 * **Why a `note` field?** Documents the policy being tested. The
 * `note` is included in the report so a future reader knows which
 * migration introduced the policy.
 */
export interface RlsPolicyTest {
  /** Table the policy is attached to. Must exist in the schema. */
  readonly table: string
  /** SQL operation the policy gates. */
  readonly operation: RlsOperation
  /** The role performing the operation. */
  readonly as: RlsRole
  /** Expected RLS outcome. */
  readonly expect: RlsExpect
  /** Human-readable filter applied to the seed row (e.g.
   *  `{ status: 'published' }` or `{ user_id: '<self>' }`).
   *  Required when the policy is conditional. */
  readonly filter?: string
  /** One-line description of which policy is being tested. */
  readonly note: string
}

/**
 * The outcome of running a single policy test.
 *
 * `passed` = the operation outcome matched `expect`.
 * `failed` = the operation outcome DID NOT match `expect`. The
 *            report's `detail` field carries the actual response so
 *            the failure can be triaged.
 */
export interface RlsTestResult {
  readonly test: RlsPolicyTest
  readonly passed: boolean
  /** Human-readable detail — the Supabase response shape on success,
   *  the error message on failure, or "skipped" if the runner
   *  couldn't issue the query (e.g. live mode without a DB). */
  readonly detail: string
  /** Duration of the single test in ms. 0 in dry-run mode. */
  readonly durationMs: number
}

/** The aggregated report returned by `runRlsTests`. */
export interface RlsTestReport {
  readonly mode: 'dry-run' | 'live' | 'mocked'
  /** When the run started (ISO timestamp). */
  readonly startedAt: string
  /** When the run finished (ISO timestamp). */
  readonly finishedAt: string
  /** Number of tests that passed. */
  readonly passed: number
  /** Number of tests that failed. */
  readonly failed: number
  /** Number of tests that were skipped (e.g. live mode w/o DB). */
  readonly skipped: number
  /** Per-test results. */
  readonly results: readonly RlsTestResult[]
}

/**
 * The function the runner calls to actually issue a query against
 * the (real or mocked) Supabase client.
 *
 * The runner is policy-shape-agnostic; the executor knows how to
 * translate `(table, operation, as, filter)` into a Supabase call.
 * This indirection is what makes the framework mockable.
 *
 * `expect` is the outcome the policy fixture says should happen.
 * The executor returns the ACTUAL outcome (allow/deny/error). The
 * runner compares them and records the result.
 */
export type RlsExecutor = (test: RlsPolicyTest) => Promise<RlsExecutorOutcome>

/**
 * What the executor observed. The runner compares `outcome` to the
 * fixture's `expect` to decide pass/fail.
 *
 * `outcome` is intentionally a small union:
 *   - `'allow'`        — the query returned rows / no error
 *   - `'deny'`         — the query returned 0 rows (filter excluded
 *                        the test row) OR the policy raised an error
 *   - `'error'`        — a non-RLS error occurred (network down,
 *                        migration not applied, etc.); the runner
 *                        records the error message in `detail` and
 *                        the result is failed-with-error (NOT
 *                        counted as a policy violation)
 *   - `'skipped'`      — the executor couldn't issue the query
 *                        (e.g. live mode without a DB)
 */
export type RlsExecutorOutcome =
  | { outcome: 'allow'; detail: string }
  | { outcome: 'deny'; detail: string }
  | { outcome: 'error'; detail: string }
  | { outcome: 'skipped'; detail: string }

/** Options for `runRlsTests`. */
export interface RlsRunOptions {
  /** The executor (real or mocked). */
  readonly executor: RlsExecutor
  /** Which tests to run. Defaults to `ALL_RLS_POLICIES` from
   *  `policies.ts`. Allows the live runner to filter to a subset
   *  (e.g. just the tables touched by a migration). */
  readonly tests?: readonly RlsPolicyTest[]
  /** Mode label written into the report. The runner does NOT
   *  branch on this — the caller's executor already knows the mode
   *  (e.g. real-Supabase for `live`, throw-skip for `dry-run`). */
  readonly mode: 'dry-run' | 'live' | 'mocked'
  /** Soft cap on concurrent test execution. Default 1 (sequential).
   *  Live runs may bump to 4-8 to keep wall time reasonable. */
  readonly concurrency?: number
}
