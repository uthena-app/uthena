// getAdminPayoutRequests.ts — admin's read of the payout_requests
// queue. Service-role because the admin sees every partner's rows
// (RLS would limit the read via the partner_read_own policy).
//
// P6.7 Slice 1 — READ-ONLY admin queue list. The first thing the
// admin needs after a partner clicks "Request payout" is to see the
// request in their queue. This query is that read.
//
// Slices 2+ (deferred — see STUB-057):
//   - Approve / deny server actions (write-side of this read)
//   - PayPal Mass Payout batch integration (gated on creds)
//   - Refund queue surface (crosses into P14.9)
//
// PII safety: we select the MASKED PayPal email (snapshot from
// request time) — never the plaintext. The partner's `public_slug`
// is the display name fallback (matches `getAdminLedger`'s pattern).
// The `partners.user_id` join is OPTIONAL — we don't load it by
// default; the admin can drill down to the partner via P14.4 if
// needed. We never select email / IP / user_agent on the user row.

import 'server-only'
import { z } from 'zod'
import { getServiceSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { requireRole } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import { PAYOUT_REQUEST_STATUS_VALUES } from '../request-options'

const log = loggerFor({ component: 'payouts.getAdminPayoutRequests' })

const StatusFilterSchema = z.enum(PAYOUT_REQUEST_STATUS_VALUES)

export const AdminPayoutRequestsOptionsSchema = z.object({
  /** Optional status filter. Whitelist-only; unknown values fall back to no filter. */
  status: StatusFilterSchema.optional(),
  /** Page size. Capped at 200 (admin sees all partners; 5000+ possible in v2). */
  limit: z.number().int().min(1).max(200).default(50),
  /** Cursor: pagination via `id < beforeId` keyset (matches P6.3's pattern). */
  beforeId: z.number().int().positive().optional(),
})
export type AdminPayoutRequestsOptions = z.infer<typeof AdminPayoutRequestsOptionsSchema>

export type AdminPayoutRequest = {
  id: number
  partner_id: number
  partner_name: string | null
  amount_cents: number
  currency: string
  status: (typeof PAYOUT_REQUEST_STATUS_VALUES)[number]
  payout_method_kind: 'paypal'
  payout_method_target_masked: string
  denial_reason: string | null
  processed_at: string | null
  created_at: string
  updated_at: string
}

export type AdminPayoutRequestsResult = {
  requests: AdminPayoutRequest[]
  /** Counts by status, computed over the unfiltered set. */
  counts: {
    pending: number
    approved: number
    denied: number
    paid: number
    failed: number
    canceled: number
    total: number
  }
  /** Echoed parsed filter state for the page to render chip active state. */
  filters: {
    status: (typeof PAYOUT_REQUEST_STATUS_VALUES)[number] | null
    limit: number
  }
}

/**
 * Read the admin's payout_requests queue. Service-role read with
 * a single JOIN on partners (for the public_slug display name).
 *
 * Returns `{ requests: [], counts: zeroCounts(), filters }` for:
 *   - anon (no session)
 *   - non-admin (requireRole short-circuits — the page never calls
 *     this without first passing the layout-level auth gate)
 *   - DB error (fail-soft; the page renders the empty state)
 *
 * The counts are computed over the FULL set (no filter applied) so
 * the chip strip always shows the true totals — matches the P6.3
 * partner-aggregate pattern (summary aggregates stay global).
 */
export async function getAdminPayoutRequests(
  rawOpts: Partial<AdminPayoutRequestsOptions> = {},
): Promise<AdminPayoutRequestsResult> {
  // Auth gate. requireRole throws on miss in admin context; the
  // page-level layout already calls it, so this is belt-and-
  // suspenders for any future caller.
  const user = await getSessionUser()
  if (!user) return emptyResult(rawOpts)
  try {
    await requireRole(['admin', 'super_admin'])
  } catch {
    return emptyResult(rawOpts)
  }

  // Parse + coerce opts. On bad opts we fall back to the Zod defaults
  // (limit=50, no status filter) — this is the canonical "page always
  // renders something useful" pattern. We log a warn so ops sees a
  // bad-call site, but we never throw.
  const parsed = AdminPayoutRequestsOptionsSchema.safeParse(rawOpts)
  let opts: AdminPayoutRequestsOptions
  if (!parsed.success) {
    log.warn(
      { code: 'admin_requests_bad_opts', issues: parsed.error.issues.length },
      'getAdminPayoutRequests: invalid opts — using defaults',
    )
    opts = { limit: 50 }
  } else {
    opts = parsed.data
  }

  const service = getServiceSupabase()

  // Round 1: full counts (6 small queries in parallel — the per-status
  // index makes each a cheap partial-index scan; we never SELECT all
  // rows, just COUNT(*) via PostgREST head:true).
  const [
    pendingCountRes,
    approvedCountRes,
    deniedCountRes,
    paidCountRes,
    failedCountRes,
    canceledCountRes,
  ] = await Promise.all([
    service.from('payout_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    service.from('payout_requests').select('*', { count: 'exact', head: true }).eq('status', 'approved'),
    service.from('payout_requests').select('*', { count: 'exact', head: true }).eq('status', 'denied'),
    service.from('payout_requests').select('*', { count: 'exact', head: true }).eq('status', 'paid'),
    service.from('payout_requests').select('*', { count: 'exact', head: true }).eq('status', 'failed'),
    service.from('payout_requests').select('*', { count: 'exact', head: true }).eq('status', 'canceled'),
  ])
  const counts = {
    pending: pendingCountRes.count ?? 0,
    approved: approvedCountRes.count ?? 0,
    denied: deniedCountRes.count ?? 0,
    paid: paidCountRes.count ?? 0,
    failed: failedCountRes.count ?? 0,
    canceled: canceledCountRes.count ?? 0,
    total: 0,
  }
  counts.total =
    counts.pending + counts.approved + counts.denied + counts.paid + counts.failed + counts.canceled

  // Round 2: the actual list (status-filtered + keyset-paginated).
  let query = service
    .from('payout_requests')
    .select(
      'id, partner_id, amount_cents, currency, status, payout_method_kind, payout_method_target_masked, denial_reason, processed_at, created_at, updated_at',
    )
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(opts.limit)
  if (opts.status) query = query.eq('status', opts.status)
  if (opts.beforeId) query = query.lt('id', opts.beforeId)
  const { data: rows, error } = await query

  if (error) {
    log.warn(
      { code: 'admin_requests_read_failed', msg: error.message, status: opts.status ?? null },
      'admin payout requests read failed',
    )
    return emptyResult(rawOpts, counts)
  }

  // Round 3: partner display names for the rows we actually fetched.
  // One small read keyed off the unique partner_ids in the result
  // set; fall back to `Partner #<id>` when missing (same pattern as
  // getAdminLedger).
  const partnerIds = [...new Set((rows ?? []).map((r) => (r as { partner_id: number }).partner_id))]
  const partnerName = new Map<number, string | null>()
  if (partnerIds.length > 0) {
    const { data: partners, error: partnersErr } = await service
      .from('partners')
      .select('id, public_slug')
      .in('id', partnerIds)
    if (partnersErr) {
      log.warn(
        { code: 'admin_requests_partner_lookup_failed', msg: partnersErr.message },
        'admin payout requests partner lookup failed (continuing without names)',
      )
    } else if (partners) {
      for (const p of partners as Array<{ id: number; public_slug: string | null }>) {
        partnerName.set(p.id, p.public_slug ?? null)
      }
    }
  }

  const requests: AdminPayoutRequest[] = (rows ?? []).map((r) => {
    const row = r as {
      id: number
      partner_id: number
      amount_cents: number | null
      currency: string | null
      status: string | null
      payout_method_kind: string | null
      payout_method_target_masked: string | null
      denial_reason: string | null
      processed_at: string | null
      created_at: string
      updated_at: string
    }
    // Defensive mapping: every field except amount_cents / created_at
    // / updated_at has a CHECK constraint or nullable default. We
    // fail closed (skip the row) on a corrupted read rather than
    // handing the UI a half-mapped shape.
    if (
      typeof row.amount_cents !== 'number' ||
      typeof row.currency !== 'string' ||
      typeof row.status !== 'string' ||
      !(PAYOUT_REQUEST_STATUS_VALUES as readonly string[]).includes(row.status) ||
      row.payout_method_kind !== 'paypal' ||
      typeof row.payout_method_target_masked !== 'string'
    ) {
      return null
    }
    return {
      id: row.id,
      partner_id: row.partner_id,
      partner_name: partnerName.get(row.partner_id) ?? null,
      amount_cents: row.amount_cents,
      currency: row.currency,
      status: row.status as (typeof PAYOUT_REQUEST_STATUS_VALUES)[number],
      payout_method_kind: 'paypal',
      payout_method_target_masked: row.payout_method_target_masked,
      denial_reason: row.denial_reason,
      processed_at: row.processed_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  }).filter((r): r is AdminPayoutRequest => r !== null)

  return {
    requests,
    counts,
    filters: {
      status: opts.status ?? null,
      limit: opts.limit,
    },
  }
}

function emptyResult(
  rawOpts: Partial<AdminPayoutRequestsOptions>,
  partialCounts?: AdminPayoutRequestsResult['counts'],
): AdminPayoutRequestsResult {
  return {
    requests: [],
    counts: partialCounts ?? {
      pending: 0,
      approved: 0,
      denied: 0,
      paid: 0,
      failed: 0,
      canceled: 0,
      total: 0,
    },
    filters: {
      status: rawOpts.status ?? null,
      limit: rawOpts.limit ?? 50,
    },
  }
}