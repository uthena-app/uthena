// getAdminPartnerPayouts.ts — admin's full payouts view for a
// single partner. Service-role read because the admin sees every
// partner's rows (RLS for `partner_read_own` would block the
// cross-partner read; `payout_requests_admin_read` lets the admin
// see all rows via their RLS client but we use service-role for
// parity with `getAdminLedger` + `getAdminPayoutRequests`).
//
// P6.8 Slice 1 — the read-only per-partner view the admin needs
// before any write actions land. Composes data from three tables:
//   - `partners` (status + public_slug + royalty_pct_bps + lifecycle)
//   - `profiles` (display_name — joined via partner.user_id; NEVER
//     selects email / ip / user_agent)
//   - `payout_ledger` (full history for this partner, with summary
//     aggregates)
//   - `payout_requests` (full request history for this partner)
//
// Auth: requireRole(['admin', 'super_admin']). The query short-
// circuits on anon / non-admin to a null result + warn log so a
// future caller can't accidentally expose a partner's data.
//
// Query plan (3 sequential rounds, 1 RT each):
//   - Round 1: partners row by id. The page renders notFound() when
//     this returns 0 rows — same shape as P6.4's "404 doesn't leak
//     existence" pattern.
//   - Round 2: 8 reads in parallel — profile (by partner.user_id)
//     + 4 ledger summary aggregates (available / locked / paid /
//     pending) + 1 next-release lookup + ledger entries (limit)
//     + payout_requests (limit).
//   - Round 3: no further reads; mapping happens in JS.
//
// Slices 2+ (deferred to STUB-058):
//   - Per-entry force-adjust server action (insert `adjustment` row
//     with reason; never UPDATE the original row, per the ledger
//     append-only invariant).
//   - Per-entry clawback server action (insert negative `clawback`
//     row + set the source to `void` if appropriate).
//   - Audit-logged write actions (mirror P6.6's pattern).
//
// PII safety:
//   - We select only `display_name`, `role`, `status`, `timezone`,
//     `avatar_url` from `profiles` — NEVER `email`, `ip`,
//     `user_agent`.
//   - We select only `id, user_id, status, public_slug,
//     royalty_pct_bps, approved_at, created_at, updated_at` from
//     `partners` — NEVER the encrypted `payout_method` JSONB (the
//     admin can read it through the partner settings surface when
//     needed; P6.8 Slice 1 keeps this page focused on payouts).
//   - The masked PayPal snapshot we display is the one already on
//     `payout_requests.payout_method_target_masked` — set at
//     request time, plaintext never hits the row.
//   - Log payloads use a 32-bit FNV-1a hash of partner_id for
//     debug (matches the P6.3 + P6.6 pattern; no raw partner_id
//     / user_id / email in any log payload).

import 'server-only'
import { z } from 'zod'
import { getServiceSupabase } from '@foundations/data/supabase'
import { getSessionUser, requireRole } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import { PAYOUT_REQUEST_STATUS_VALUES } from '../request-options'
import type { LedgerEntry, LedgerSummary } from './getPartnerLedger'
import type { AdminPayoutRequest } from './getAdminPayoutRequests'

const log = loggerFor({ component: 'payouts.getAdminPartnerPayouts' })

// ----- Input validation -----------------------------------------------------

const IdSchema = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? v : Number(v)))
  .pipe(z.number().int().positive())

export const GetAdminPartnerPayoutsOptionsSchema = z.object({
  /** Partner id from the URL (`/admin/payouts/partner/[id]`). The
   *  page passes the raw string so an invalid id (e.g. `/abc`)
   *  fails Zod validation BEFORE hitting Supabase. */
  partnerId: IdSchema,
  /** Ledger entries page size. Capped at 200 — admin views can show
   *  more than a partner's view but we don't want a runaway page. */
  ledgerLimit: z.number().int().min(1).max(200).default(50),
  /** Payout requests page size. Same cap as the ledger. */
  requestsLimit: z.number().int().min(1).max(200).default(50),
})
export type GetAdminPartnerPayoutsOptions = z.input<typeof GetAdminPartnerPayoutsOptionsSchema>

// ----- Output shape --------------------------------------------------------

export type AdminPartnerInfo = {
  id: number
  user_id: string
  /** Display name from the partner's `profiles.display_name`. Falls
   *  back to the public_slug, then `Partner #<id>`. Never the
   *  plaintext email. */
  display_name: string
  status: 'pending' | 'approved' | 'suspended'
  public_slug: string | null
  royalty_pct_bps: number | null
  approved_at: string | null
  created_at: string
}

export type AdminPartnerPayoutsResult = {
  partner: AdminPartnerInfo
  ledger: {
    entries: LedgerEntry[]
    summary: LedgerSummary
  }
  payoutRequests: AdminPayoutRequest[]
}

// ----- 32-bit FNV-1a hash for log payloads ---------------------------------

function fnv1aHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

// ----- Main query -----------------------------------------------------------

/**
 * Read the admin's per-partner payouts overview.
 *
 * Returns `null` when:
 *   - The id is invalid (Zod failure on `partnerId`)
 *   - No session user
 *   - Non-admin role
 *   - Partner row not found (0 rows from service-role)
 *
 * The page renders `notFound()` when this returns `null`.
 */
export async function getAdminPartnerPayouts(
  rawOpts: GetAdminPartnerPayoutsOptions,
): Promise<AdminPartnerPayoutsResult | null> {
  // ----- Zod validate -------------------------------------------------------
  const parsed = GetAdminPartnerPayoutsOptionsSchema.safeParse(rawOpts)
  if (!parsed.success) {
    log.warn(
      {
        code: 'admin_partner_payouts_bad_opts',
        issues: parsed.error.issues.length,
      },
      'getAdminPartnerPayouts: invalid opts',
    )
    return null
  }
  const opts = parsed.data
  const partnerId = opts.partnerId

  // ----- Auth gate ----------------------------------------------------------
  const user = await getSessionUser()
  if (!user) {
    log.warn(
      { code: 'admin_partner_payouts_no_session' },
      'getAdminPartnerPayouts: no session',
    )
    return null
  }
  try {
    await requireRole(['admin', 'super_admin'])
  } catch {
    log.warn(
      {
        code: 'admin_partner_payouts_forbidden',
        actor_hash: fnv1aHash(user.id),
      },
      'getAdminPartnerPayouts: forbidden role',
    )
    return null
  }

  const service = getServiceSupabase()
  const partnerHash = fnv1aHash(String(partnerId))

  // ----- Round 1: partner row by id -----------------------------------------
  // The partner read drives the 404: if it returns 0 rows, the partner
  // doesn't exist (or was hard-deleted) and the page renders notFound().
  const { data: partnerData, error: partnerError } = await service
    .from('partners')
    .select(
      'id, user_id, status, public_slug, royalty_pct_bps, approved_at, created_at, updated_at',
    )
    .eq('id', partnerId)
    .maybeSingle()
  if (partnerError) {
    log.warn(
      {
        code: 'admin_partner_payouts_partner_read_failed',
        partner_hash: partnerHash,
        msg: partnerError.message,
      },
      'getAdminPartnerPayouts: partner row read failed',
    )
    return null
  }
  if (!partnerData) {
    log.info(
      { code: 'admin_partner_payouts_partner_not_found', partner_hash: partnerHash },
      'getAdminPartnerPayouts: partner not found',
    )
    return null
  }
  const partnerRow = partnerData as {
    id: number
    user_id: string
    status: 'pending' | 'approved' | 'suspended'
    public_slug: string | null
    royalty_pct_bps: number | null
    approved_at: string | null
    created_at: string
  }

  // ----- Round 2: profile + summary aggregates + ledger + requests ---------
  // 8 reads in parallel. Each summary aggregate hits a (partner_id,
  // status) partial index from migration 0024. Ledger + requests
  // hit (partner_id, created_at desc) indexes.
  const [
    profileRes,
    availableRes,
    lockedRes,
    paidRes,
    nextReleaseRes,
    pendingRes,
    ledgerRes,
    requestsRes,
  ] = await Promise.all([
    service
      .from('profiles')
      // PII safety: only the safe columns. NEVER email / ip / user_agent.
      .select('user_id, display_name, role, status, timezone, avatar_url')
      .eq('user_id', partnerRow.user_id)
      .maybeSingle(),
    service
      .from('payout_ledger')
      .select('amount_cents')
      .eq('partner_id', partnerId)
      .eq('status', 'available'),
    service
      .from('payout_ledger')
      .select('amount_cents')
      .eq('partner_id', partnerId)
      .eq('status', 'locked'),
    service
      .from('payout_ledger')
      .select('amount_cents')
      .eq('partner_id', partnerId)
      .eq('status', 'paid'),
    service
      .from('payout_ledger')
      .select('available_at')
      .eq('partner_id', partnerId)
      .eq('status', 'locked')
      .gt('available_at', new Date().toISOString())
      .order('available_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    service
      .from('payout_ledger')
      .select('amount_cents')
      .eq('partner_id', partnerId)
      .eq('status', 'pending_payout'),
    service
      .from('payout_ledger')
      .select(
        'id, created_at, kind, status, amount_cents, currency, description, order_id, order_item_id, refund_id, royalty_pct_bps, locked_until, available_at, paid_at, paypal_payout_batch_id, stripe_transfer_id',
      )
      .eq('partner_id', partnerId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(opts.ledgerLimit),
    service
      .from('payout_requests')
      .select(
        'id, partner_id, amount_cents, currency, status, payout_method_kind, payout_method_target_masked, denial_reason, processed_at, created_at, updated_at',
      )
      .eq('partner_id', partnerId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(opts.requestsLimit),
  ])

  // ----- Build partner display name (display_name → public_slug → fallback)
  const profileRow = (profileRes.data ?? null) as
    | { display_name: string | null }
    | null
  if (profileRes.error) {
    log.warn(
      {
        code: 'admin_partner_payouts_profile_read_failed',
        partner_hash: partnerHash,
        msg: profileRes.error.message,
      },
      'getAdminPartnerPayouts: profile read failed (continuing without display_name)',
    )
  }
  const displayName = (() => {
    if (profileRow?.display_name && profileRow.display_name.length > 0) {
      return profileRow.display_name
    }
    if (partnerRow.public_slug && partnerRow.public_slug.length > 0) {
      return partnerRow.public_slug
    }
    return `Partner #${partnerRow.id}`
  })()

  const partner: AdminPartnerInfo = {
    id: partnerRow.id,
    user_id: partnerRow.user_id,
    display_name: displayName,
    status: partnerRow.status,
    public_slug: partnerRow.public_slug,
    royalty_pct_bps: partnerRow.royalty_pct_bps,
    approved_at: partnerRow.approved_at,
    created_at: partnerRow.created_at,
  }

  // ----- Ledger entries mapping -------------------------------------------
  let ledgerEntries: LedgerEntry[] = []
  if (ledgerRes.error) {
    log.warn(
      {
        code: 'admin_partner_payouts_ledger_read_failed',
        partner_hash: partnerHash,
        msg: ledgerRes.error.message,
      },
      'getAdminPartnerPayouts: ledger read failed (returning empty entries)',
    )
  } else {
    ledgerEntries = (ledgerRes.data ?? []).flatMap((row): LedgerEntry[] => {
      const r = row as {
        id: number
        created_at: string
        kind: string
        status: string
        amount_cents: number | null
        currency: string | null
        description: string | null
        order_id: number | null
        order_item_id: number | null
        refund_id: number | null
        royalty_pct_bps: number | null
        locked_until: string | null
        available_at: string | null
        paid_at: string | null
        paypal_payout_batch_id: string | null
        stripe_transfer_id: string | null
      }
      // Defensive mapping: every required field must be the right
      // type. We drop rows that don't conform — same pattern as
      // getAdminPayoutRequests / getPartnerLedger.
      if (
        typeof r.amount_cents !== 'number' ||
        typeof r.currency !== 'string' ||
        typeof r.kind !== 'string' ||
        typeof r.status !== 'string'
      ) {
        log.warn(
          {
            code: 'admin_partner_payouts_ledger_row_dropped',
            partner_hash: partnerHash,
            ledger_id: r.id,
            reason: 'bad_field_types',
          },
          'getAdminPartnerPayouts: dropping ledger row (bad field types)',
        )
        return []
      }
      return [
        {
          id: r.id,
          created_at: r.created_at,
          kind: r.kind as LedgerEntry['kind'],
          status: r.status as LedgerEntry['status'],
          amount_cents: r.amount_cents,
          currency: r.currency,
          description: r.description,
          order_id: r.order_id,
          order_item_id: r.order_item_id,
          refund_id: r.refund_id,
          royalty_pct_bps: r.royalty_pct_bps,
          locked_until: r.locked_until,
          available_at: r.available_at,
          paid_at: r.paid_at,
          paypal_payout_batch_id: r.paypal_payout_batch_id,
          stripe_transfer_id: r.stripe_transfer_id,
        },
      ]
    })
  }

  // ----- Summary aggregates ------------------------------------------------
  const sum = (rows: { amount_cents: number | null }[] | null) =>
    (rows ?? []).reduce((s, r) => s + (r.amount_cents ?? 0), 0)
  const available = sum(availableRes.data)
  const locked = sum(lockedRes.data)
  const paid = sum(paidRes.data)
  const pending = sum(pendingRes.data)
  const nextRelease =
    (nextReleaseRes.data as { available_at: string | null } | null)?.available_at ?? null
  const summary: LedgerSummary = {
    available_cents: available,
    locked_cents: locked,
    paid_cents: paid,
    lifetime_earned_cents: available + locked + paid,
    next_release_at: nextRelease,
    pending_payout_cents: pending,
  }
  // If the aggregate reads errored, warn once. The page can still
  // render with the ledger entries; the summary cards would show 0.
  if (availableRes.error || lockedRes.error || paidRes.error || pendingRes.error) {
    log.warn(
      {
        code: 'admin_partner_payouts_summary_read_partial_fail',
        partner_hash: partnerHash,
        available_err: availableRes.error?.message ?? null,
        locked_err: lockedRes.error?.message ?? null,
        paid_err: paidRes.error?.message ?? null,
        pending_err: pendingRes.error?.message ?? null,
      },
      'getAdminPartnerPayouts: one or more summary aggregate reads failed',
    )
  }

  // ----- Payout requests mapping ------------------------------------------
  let payoutRequests: AdminPayoutRequest[] = []
  if (requestsRes.error) {
    log.warn(
      {
        code: 'admin_partner_payouts_requests_read_failed',
        partner_hash: partnerHash,
        msg: requestsRes.error.message,
      },
      'getAdminPartnerPayouts: payout_requests read failed (returning empty list)',
    )
  } else {
    payoutRequests = (requestsRes.data ?? []).flatMap((row): AdminPayoutRequest[] => {
      const r = row as {
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
      // Defensive mapping — drop corrupted rows.
      if (
        typeof r.amount_cents !== 'number' ||
        typeof r.currency !== 'string' ||
        typeof r.status !== 'string' ||
        !(PAYOUT_REQUEST_STATUS_VALUES as readonly string[]).includes(r.status) ||
        r.payout_method_kind !== 'paypal' ||
        typeof r.payout_method_target_masked !== 'string'
      ) {
        log.warn(
          {
            code: 'admin_partner_payouts_requests_row_dropped',
            partner_hash: partnerHash,
            request_id: r.id,
            reason: 'bad_field_types',
          },
          'getAdminPartnerPayouts: dropping payout_request row (bad field types)',
        )
        return []
      }
      return [
        {
          id: r.id,
          partner_id: r.partner_id,
          partner_name: partner.public_slug,
          amount_cents: r.amount_cents,
          currency: r.currency,
          status: r.status as AdminPayoutRequest['status'],
          payout_method_kind: 'paypal',
          payout_method_target_masked: r.payout_method_target_masked,
          denial_reason: r.denial_reason,
          processed_at: r.processed_at,
          created_at: r.created_at,
          updated_at: r.updated_at,
        },
      ]
    })
  }

  return {
    partner,
    ledger: { entries: ledgerEntries, summary },
    payoutRequests,
  }
}