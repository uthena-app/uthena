// cron-partition-rollforward.ts — maintenance cron: extend monthly
// partitions for the 3 partitioned tables so they never run out of
//   - admin_audit_log (P3.3)
//   - order_items + payout_ledger (P3.5)
//   - processed_webhooks (not partitioned yet; skipped if the function
//     does not exist)
//
// Idempotent: the underlying SECURITY DEFINER functions
//   (create_admin_audit_log_partitions / create_order_items_partitions /
//    create_payout_ledger_partitions)
// are CREATE OR REPLACE + ON CONFLICT DO NOTHING so a re-run is safe.

import 'server-only'
import { getServiceSupabase } from '@foundations/data/supabase'

const MONTHS_AHEAD = 3

async function callRpc(name: string): Promise<{ ok: boolean; error?: string }> {
  const service = getServiceSupabase()
  try {
    const { error } = await service.rpc(name, { months_ahead: MONTHS_AHEAD })
    if (error) {
      return { ok: false, error: `${name}: ${error.message}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: `${name}: ${err instanceof Error ? err.message : 'unknown'}` }
  }
}

async function main() {
  const calls = [
    'create_admin_audit_log_partitions',
    'create_order_items_partitions',
    'create_payout_ledger_partitions',
    'cleanup_old_admin_audit_log',
    'cleanup_old_order_items',
    'cleanup_old_payout_ledger',
  ]
  const results: Record<string, { ok: boolean; error?: string }> = {}
  for (const name of calls) {
    results[name] = await callRpc(name)
  }
  console.log(JSON.stringify({ ok: true, months_ahead: MONTHS_AHEAD, results }))
  const failed = Object.values(results).filter((r) => !r.ok)
  if (failed.length > 0) {
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      ok: false,
      code: 'partition_rollforward_unhandled_error',
      msg: err instanceof Error ? err.message : 'unknown',
    }),
  )
  process.exitCode = 2
})
