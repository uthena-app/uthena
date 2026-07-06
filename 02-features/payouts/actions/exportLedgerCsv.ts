// exportLedgerCsv.ts — server action. Returns the partner's own
// ledger (filtered by the same URL-driven filter shape the page
// uses) as a CSV string for the client to trigger a download.
//
// Spec (`01-specs/pages/instructor-payouts.md`) acceptance criteria:
//   - CSV export includes all filtered rows (not just the visible page)
//   - CSV export is logged in `admin_audit_log`
//   - CSV export has rate limiting: 10/hour per partner
//
// PII safety: the CSV contains the partner's own data (RLS gates
// the read), so no third-party PII leaks. The action NEVER logs the
// raw partner id, raw user id, raw email, or any row content. The
// audit log row stores `target_id = partner_id` (stringified) for
// admin lookup — no email, no token, no description in metadata.
//
// Rate limit: in-process Map (10/hr/partner) — lives in
// `exportLedgerCsv.rate-limit.ts` because `'use server'` files in
// Next.js can only export async functions. STUB-012 covers the
// move to a Supabase-backed `rate_limit_events` table in PH19 for
// multi-instance deployments. v1 is single-instance, the in-process
// Map is correct + simple.
//
// Auth: `getSessionUser()` + role check (partner / admin / super_admin)
// — matches `requirePartner()` semantics. Server actions can't
// redirect (they return JSON), so the inline check is the right
// shape. RLS on `payout_ledger` (`payout_ledger_partner_read_own`)
// is the secondary gate; even if the role check regresses, the read
// can't escape the partner's own rows.

'use server'

import 'server-only'
import { z } from 'zod'
import { headers } from 'next/headers'
import { createHash } from 'node:crypto'
import { getSessionUser } from '@foundations/auth/guards'
import { getServerSupabase, getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import {
  LEDGER_STATUS_VALUES,
  LEDGER_KIND_VALUES,
  LEDGER_SORT_VALUES,
} from '../filter-options'
import {
  buildLedgerCsv,
  MAX_EXPORT_ROWS,
  type LedgerCsvRow,
} from './exportLedgerCsv.format'
import { rateLimitVerdict } from './exportLedgerCsv.rate-limit'

const log = loggerFor({ component: 'payouts.exportLedgerCsv' })

// Mirror the LedgerFilterSchema in getPartnerLedger.ts without
// pulling in the limit (the export uses MAX_EXPORT_ROWS instead).
// We re-validate here as the single source of truth for the
// server-action contract; the query's schema is the read-side
// mirror. If the two ever drift, the test in
// `exportLedgerCsv.test.ts` flags it.
const ExportFilterSchema = z.object({
  status: z.enum(LEDGER_STATUS_VALUES).optional(),
  kind: z.enum(LEDGER_KIND_VALUES).optional(),
  sort: z.enum(LEDGER_SORT_VALUES).default('date'),
})

export type ExportLedgerCsvInput = z.input<typeof ExportFilterSchema>

export type ExportLedgerCsvResult =
  | {
      ok: true
      csv: string
      filename: string
      rowCount: number
    }
  | {
      ok: false
      code: 'not_authorized' | 'rate_limited' | 'invalid_input' | 'unknown'
      error: string
      retryAfterSeconds?: number
    }

/** Build a deterministic filename for the download. Pattern:
 *  `uthena-payouts-<partnerId>-<ISO-date>.csv`. The partner id
 *  is the partner's own id — no leak risk (the partner already
 *  knows it). The date is the UTC day so two exports on the same
 *  day don't collide. */
function csvFilename(partnerId: number): string {
  const day = new Date().toISOString().slice(0, 10)
  return `uthena-payouts-${partnerId}-${day}.csv`
}

/** Hash an identifier with the audit salt — matches the
 *  `00-foundations/auth/rate-limit.ts` pattern so cross-table
 *  queries return the same hash for the same identifier. */
function hashIdentifier(value: string): string {
  const salt = process.env.AUDIT_HASH_SALT ?? `dev-${process.pid}`
  return createHash('sha256').update(`${salt}:${value}`).digest('hex').slice(0, 32)
}

export async function exportLedgerCsvAction(
  rawFilters: ExportLedgerCsvInput = {},
): Promise<ExportLedgerCsvResult> {
  // 1. Validate filter shape.
  const parsed = ExportFilterSchema.safeParse(rawFilters)
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid_input',
      error: parsed.error.issues[0]?.message ?? 'Invalid filter.',
    }
  }
  const filters = parsed.data

  // 2. Auth: server actions can't redirect (they return JSON to the
  //    client), so we use `getSessionUser()` and gate inline. Mirrors
  //    the `startImpersonation.ts` pattern. RLS on `payout_ledger`
  //    (`payout_ledger_partner_read_own`) is the secondary gate —
  //    even if the role check regresses, the read can't escape the
  //    partner's own rows.
  const user = await getSessionUser()
  if (!user || (user.role !== 'partner' && user.role !== 'admin' && user.role !== 'super_admin')) {
    return { ok: false, code: 'not_authorized', error: 'You are not a partner.' }
  }

  // 3. Resolve the partner row. RLS-aware read; the partner row
  //    is keyed off the user's id. Mirrors getPartnerLedger.
  const supabase = await getServerSupabase()
  const { data: partner, error: partnerError } = await supabase
    .from('partners')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (partnerError || !partner) {
    log.warn(
      { code: 'export_partner_lookup_failed', msg: partnerError?.message },
      'exportLedgerCsv: partner lookup failed',
    )
    return { ok: false, code: 'not_authorized', error: 'Partner profile not found.' }
  }
  const partnerId = (partner as { id: number }).id

  // 4. Rate limit. In-process Map — single-instance v1.
  const rl = rateLimitVerdict(partnerId, Date.now())
  if (!rl.allowed) {
    return {
      ok: false,
      code: 'rate_limited',
      error: `You've reached the export limit (10/hour). Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minutes.`,
      retryAfterSeconds: rl.retryAfterSeconds,
    }
  }

  // 5. Build the entries query. Same filter shape as the page;
  //    same sort orderings. NO limit / beforeId — the export
  //    returns the FULL filtered set (spec criterion: "all
  //    filtered rows, not just the visible page"). The
  //    MAX_EXPORT_ROWS cap is a safety net for runaway queries;
  //    the audit log records the row count + the cap-hit flag so
  //    ops can detect a partner outgrowing v1.
  let q = supabase
    .from('payout_ledger')
    .select('id, created_at, kind, status, amount_cents, currency, description, order_id, order_item_id, refund_id, royalty_pct_bps, locked_until, available_at, paid_at, paypal_payout_batch_id, stripe_transfer_id')
    .eq('partner_id', partnerId)
  if (filters.status) q = q.eq('status', filters.status)
  if (filters.kind) q = q.eq('kind', filters.kind)
  if (filters.sort === 'amount') {
    q = q.order('amount_cents', { ascending: false }).order('id', { ascending: false })
  } else if (filters.sort === 'kind') {
    q = q.order('kind', { ascending: true }).order('created_at', { ascending: false }).order('id', { ascending: false })
  } else {
    q = q.order('created_at', { ascending: false }).order('id', { ascending: false })
  }
  q = q.limit(MAX_EXPORT_ROWS)
  const { data: rows, error: rowsError } = await q
  if (rowsError) {
    log.warn(
      { code: 'export_rows_failed', msg: rowsError.message },
      'exportLedgerCsv: ledger read failed',
    )
    return { ok: false, code: 'unknown', error: 'Could not read your ledger. Please try again.' }
  }
  const entries = (rows ?? []) as unknown as LedgerCsvRow[]

  // 6. Build the CSV.
  const csv = buildLedgerCsv(entries)

  // 7. Audit log. Writes via the service-role client — admin_audit_log
  //    has no INSERT policy for non-service-role callers. Stores the
  //    partner id (stringified) as target_id + the filter echo +
  //    row count + rate-limit counter. PII safety: NEVER includes
  //    the email, raw user_id, or row content. The partner id is
  //    the partner's own numeric id — not PII (the partner already
  //    knows it; admins need it to look the partner up).
  try {
    const hdrs = await headers()
    const ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
    const userAgent = hdrs.get('user-agent')?.slice(0, 256) ?? null
    const serviceSupabase = getServiceSupabase()
    await serviceSupabase.from('admin_audit_log').insert({
      actor_id: user.id,
      actor_email: `hash:${hashIdentifier(user.email)}@uthena.audit`,
      action: 'ledger_csv_exported',
      target_kind: 'payout_ledger',
      target_id: String(partnerId),
      metadata: {
        row_count: entries.length,
        capped: entries.length >= MAX_EXPORT_ROWS,
        filters: {
          status: filters.status ?? null,
          kind: filters.kind ?? null,
          sort: filters.sort,
        },
        rate_limit_count: rl.count,
      } as never,
      ip: ip ? hashIdentifier(ip) : null,
      user_agent: userAgent,
    } as never)
  } catch (err) {
    // Audit log failure is NOT a hard error for the export — the
    // user already waited for the CSV. Log + continue. Ops will see
    // the gap in the audit log volume metrics (STUB-012 follow-up
    // covers an alert on rate-limit-write-failed volume).
    log.warn(
      { code: 'export_audit_failed', msg: (err as Error).message },
      'exportLedgerCsv: audit log write failed (export still returned to user)',
    )
  }

  return {
    ok: true,
    csv,
    filename: csvFilename(partnerId),
    rowCount: entries.length,
  }
}