// Right-to-deletion (GDPR Art. 17) cascade — TypeScript wrapper around
// the `delete_my_account` Postgres RPC.
//
// The actual cascade logic lives in SQL
// (`04-platform/migrations/0010_delete_my_account_rpc.sql`) for three
// reasons:
//   1. It runs in one Postgres transaction — we set SERIALIZABLE
//      isolation so a concurrent Stripe webhook can't produce a
//      phantom row during the cascade window.
//   2. It crosses RLS boundaries the application is not authorized to
//      write through; `security definer` is the cleanest mechanism.
//   3. The cascade touches 4 tables (orders, partners, payout_ledger,
//      profiles); one atomic SQL transaction is simpler than four
//      application-level statements that could half-succeed.
//
// This module is the typed seam between that SQL function and the
// server action that invokes it. It:
//   - Owns the service-role client (uses `getServiceSupabase()` so the
//     singleton + env-fail-closed behavior are shared with the rest
//     of the codebase).
//   - Translates the 4 RPC return values into a typed `DeleteMyAccountOutcome`
//     union. The action layer pattern-matches on this — no string
//     comparison lives outside this module.
//   - Logs PII-safely: the outcome code is logged; the userId is NEVER
//     logged (it's not needed to diagnose a failure and it leaks identity
//     in the log aggregator).
//
// Per AGENTS.md §Security: every call site for a function that bypasses
// RLS must have a documented reason. This module is one of those — the
// cascade SQL is `security definer` and requires the service role.
//
// Spec: PHASES.md §P2.6.

import 'server-only'

import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'gdpr.delete_cascade' })

/**
 * The five possible outcomes of the `delete_my_account` RPC.
 *
 * - `anonymized` — happy path; the user's PII has been anonymized and
 *   the profile is gone.
 * - `already_deleted` — the profile was already gone before this call
 *   (e.g. a re-run from a retry). The caller should still sign the
 *   user out + redirect home; the data is already in the desired state.
 * - `cancel_subscriptions_first` — the user has active or trialing
 *   subscriptions; the action layer routes them to /account/billing
 *   to cancel before retrying.
 * - `resolve_payouts_first` — the user (as a partner) has pending
 *   payout_ledger rows; the action layer routes them to a page that
 *   explains the partner-side settlement process.
 * - `unknown` — the RPC failed or returned an unexpected string. The
 *   action layer surfaces a generic error to the user; the log carries
 *   the diagnostic code.
 */
export type DeleteMyAccountOutcome =
  | 'anonymized'
  | 'already_deleted'
  | 'cancel_subscriptions_first'
  | 'resolve_payouts_first'
  | 'unknown'

/**
 * Invoke the GDPR Art. 17 cascade. Returns the typed outcome. The
 * caller (typically `deleteMyAccountAction`) is responsible for:
 *   - verifying the user is authenticated
 *   - matching the typed confirmation email
 *   - writing the self-audit row BEFORE calling this
 *   - signing the user out + redirecting AFTER a successful outcome
 *
 * This function does NOT touch the session — it is a pure DB call.
 */
export async function deleteMyAccountCascade(
  userId: string,
): Promise<DeleteMyAccountOutcome> {
  const supabase = getServiceSupabase()
  const { data, error } = await supabase.rpc('delete_my_account', {
    p_user_id: userId,
  })

  if (error) {
    // PII-safe: we never log userId (it's identity). Pino's redact list
    // also covers `*.user_id` paths if any context object carries one.
    log.error({ code: 'delete_rpc_failed', msg: error.message }, 'delete_my_account RPC failed')
    return 'unknown'
  }

  const result = String(data ?? '')
  switch (result) {
    case 'anonymized':
      return 'anonymized'
    case 'already_deleted':
      return 'already_deleted'
    case 'cancel_subscriptions_first':
      return 'cancel_subscriptions_first'
    case 'resolve_payouts_first':
      return 'resolve_payouts_first'
    default:
      log.warn({ code: 'delete_unexpected_result', result }, 'unexpected RPC result')
      return 'unknown'
  }
}