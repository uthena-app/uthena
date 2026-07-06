// approvePayoutRequest.ts — admin-only approve/deny/pay-out server actions.
//
// Status flow: pending → approved → paid (terminal happy path)
//                    ↘ denied → (writes the denial_reason; admin can re-approve)
//                    ↘ failed / canceled (terminal error)
//
// Slices 2+ (deferred — STUB-057 follow-ups):
//   - PayPal Mass Payout batch integration (gated on PAYPAL_CLIENT_ID + PAYPAL_SECRET in Doppler)
//   - Clawback support
//
// PII safety: payout_request rows only ever store the masked email
// (snapshot at request time). The plaintext lives in payout_method JSONB
// in the partners table — decryptable only via the partner_portal
// payout method helper. Admin never sees plaintext here. Audit logs
// use hashed identifiers.

'use server'

import 'server-only'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { getSessionUser } from '@foundations/auth/guards'
import { requireRole } from '@foundations/auth/guards'
import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'payouts.approvePayoutRequest' })

const ApproveSchema = z.object({
  requestId: z.number().int().positive(),
})

const DenySchema = z.object({
  requestId: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
})

const MarkPaidSchema = z.object({
  requestId: z.number().int().positive(),
  /** e.g. PayPal batch id, manual reference, etc. */
  externalReference: z.string().trim().min(1).max(200),
})

export type ApprovePayoutInput = z.infer<typeof ApproveSchema>
export type DenyPayoutInput = z.infer<typeof DenySchema>
export type MarkPaidInput = z.infer<typeof MarkPaidSchema>

export type ApprovePayoutResult =
  | { ok: true; requestId: number; status: 'approved' | 'denied' | 'paid' }
  | { ok: false; code: ApproveErrorCode; error: string }

export type ApproveErrorCode =
  | 'not_authorized'
  | 'bad_input'
  | 'not_found'
  | 'bad_state'
  | 'unknown'

/** Hash an identifier with the audit salt — matches
 *  `exportLedgerCsv.ts` + `requestPayout.ts` so cross-table queries
 *  return the same hash for the same identifier. */
function hashIdentifier(value: string): string {
  const salt = process.env.AUDIT_HASH_SALT ?? `dev-${process.pid}`
  return createHash('sha256').update(`${salt}:${value}`).digest('hex').slice(0, 32)
}

export async function approvePayoutRequestAction(
  input: ApprovePayoutInput,
): Promise<ApprovePayoutResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, code: 'not_authorized', error: 'Sign in to approve payouts.' }

  try {
    await requireRole(['admin', 'super_admin'])
  } catch {
    return { ok: false, code: 'not_authorized', error: 'Admin role required.' }
  }

  const parsed = ApproveSchema.safeParse(input)
  if (!parsed.success) {
    log.warn(
      { code: 'approve_bad_input', issues: parsed.error.issues.length },
      'approvePayoutRequest: invalid input',
    )
    return { ok: false, code: 'bad_input', error: 'Invalid request.' }
  }

  const service = getServiceSupabase()

  // Read current state for the state guard.
  const { data: current, error: readErr } = await service
    .from('payout_requests')
    .select('id, status, partner_id, amount_cents, currency')
    .eq('id', parsed.data.requestId)
    .maybeSingle()

  if (readErr || !current) {
    log.warn(
      { code: 'approve_read_failed', request_id: parsed.data.requestId, msg: readErr?.message },
      'approvePayoutRequest: lookup failed',
    )
    return { ok: false, code: 'not_found', error: 'Payout request not found.' }
  }

  const status = (current as { status: string | null }).status
  if (status !== 'pending') {
    return {
      ok: false,
      code: 'bad_state',
      error: `Cannot approve a request in status="${status}". Only "pending" requests can be approved.`,
    }
  }

  const { data: updated, error: updateErr } = await service
    .from('payout_requests')
    .update({
      status: 'approved',
      processed_at: new Date().toISOString(),
    } as never)
    .eq('id', parsed.data.requestId)
    .eq('status', 'pending') // optimistic concurrency
    .select('id')
    .maybeSingle()

  if (updateErr || !updated) {
    log.warn(
      { code: 'approve_update_failed', request_id: parsed.data.requestId, msg: updateErr?.message },
      'approvePayoutRequest: update failed (likely race with another admin)',
    )
    return { ok: false, code: 'unknown', error: 'Could not approve. Try again.' }
  }

  await writeAudit({
    user,
    action: 'payout_request_approved',
    requestId: parsed.data.requestId,
    metadata: {
      partner_id_hash: hashIdentifier(String((current as { partner_id: number }).partner_id)),
      amount_cents: (current as { amount_cents: number }).amount_cents,
      currency: (current as { currency: string }).currency,
    },
  })

  return { ok: true, requestId: parsed.data.requestId, status: 'approved' }
}

export async function denyPayoutRequestAction(
  input: DenyPayoutInput,
): Promise<ApprovePayoutResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, code: 'not_authorized', error: 'Sign in to deny payouts.' }

  try {
    await requireRole(['admin', 'super_admin'])
  } catch {
    return { ok: false, code: 'not_authorized', error: 'Admin role required.' }
  }

  const parsed = DenySchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, code: 'bad_input', error: 'Provide a denial reason (1-500 chars).' }
  }

  const service = getServiceSupabase()
  const { data: current, error: readErr } = await service
    .from('payout_requests')
    .select('id, status, partner_id, amount_cents, currency')
    .eq('id', parsed.data.requestId)
    .maybeSingle()
  if (readErr || !current) {
    return { ok: false, code: 'not_found', error: 'Payout request not found.' }
  }
  const status = (current as { status: string | null }).status
  if (status !== 'pending' && status !== 'approved') {
    return {
      ok: false,
      code: 'bad_state',
      error: `Cannot deny a request in status="${status}".`,
    }
  }

  // If we deny, release the locked ledger rows back to 'available'.
  // Atomic: single UPDATE filtered to (partner_id, status='pending_payout').
  const partnerId = (current as { partner_id: number }).partner_id
  await service
    .from('payout_ledger')
    .update({ status: 'available' } as never)
    .eq('partner_id', partnerId)
    .eq('status', 'pending_payout')

  const { data: updated, error: updateErr } = await service
    .from('payout_requests')
    .update({
      status: 'denied',
      denial_reason: parsed.data.reason,
      processed_at: new Date().toISOString(),
    } as never)
    .eq('id', parsed.data.requestId)
    .select('id')
    .maybeSingle()
  if (updateErr || !updated) {
    log.warn(
      { code: 'deny_update_failed', request_id: parsed.data.requestId, msg: updateErr?.message },
      'denyPayoutRequest: update failed',
    )
    return { ok: false, code: 'unknown', error: 'Could not deny. Try again.' }
  }
  await writeAudit({
    user,
    action: 'payout_request_denied',
    requestId: parsed.data.requestId,
    metadata: {
      partner_id_hash: hashIdentifier(String(partnerId)),
      reason: parsed.data.reason,
      amount_cents: (current as { amount_cents: number }).amount_cents,
    },
  })
  return { ok: true, requestId: parsed.data.requestId, status: 'denied' }
}

export async function markPayoutRequestPaidAction(
  input: MarkPaidInput,
): Promise<ApprovePayoutResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, code: 'not_authorized', error: 'Sign in to mark payouts paid.' }

  try {
    await requireRole(['admin', 'super_admin'])
  } catch {
    return { ok: false, code: 'not_authorized', error: 'Admin role required.' }
  }

  const parsed = MarkPaidSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, code: 'bad_input', error: 'Provide an external reference (1-200 chars).' }
  }

  const service = getServiceSupabase()
  const { data: current, error: readErr } = await service
    .from('payout_requests')
    .select('id, status, partner_id, amount_cents, currency')
    .eq('id', parsed.data.requestId)
    .maybeSingle()
  if (readErr || !current) {
    return { ok: false, code: 'not_found', error: 'Payout request not found.' }
  }
  const status = (current as { status: string | null }).status
  if (status !== 'approved') {
    return {
      ok: false,
      code: 'bad_state',
      error: `Cannot mark paid a request in status="${status}".`,
    }
  }

  // Flip the pending_payout ledger rows to paid.
  const partnerId = (current as { partner_id: number }).partner_id
  await service
    .from('payout_ledger')
    .update({
      status: 'paid',
      paypal_payout_batch_id: parsed.data.externalReference,
      paid_at: new Date().toISOString(),
    } as never)
    .eq('partner_id', partnerId)
    .eq('status', 'pending_payout')

  const { data: updated, error: updateErr } = await service
    .from('payout_requests')
    .update({
      status: 'paid',
      processed_at: new Date().toISOString(),
      metadata: {
        external_reference: parsed.data.externalReference,
        marked_paid_by: user.id,
      },
    } as never)
    .eq('id', parsed.data.requestId)
    .select('id')
    .maybeSingle()
  if (updateErr || !updated) {
    log.warn(
      { code: 'mark_paid_update_failed', request_id: parsed.data.requestId, msg: updateErr?.message },
      'markPayoutRequestPaid: update failed',
    )
    return { ok: false, code: 'unknown', error: 'Could not mark paid. Try again.' }
  }
  await writeAudit({
    user,
    userOverride: 'marked_paid_by',
    action: 'payout_request_marked_paid',
    requestId: parsed.data.requestId,
    metadata: {
      partner_id_hash: hashIdentifier(String(partnerId)),
      external_reference: parsed.data.externalReference,
      amount_cents: (current as { amount_cents: number }).amount_cents,
    },
  })
  return { ok: true, requestId: parsed.data.requestId, status: 'paid' }
}

async function writeAudit(args: {
  user: { id: string; email: string }
  action: string
  requestId: number
  metadata: Record<string, unknown>
  userOverride?: string
}): Promise<void> {
  try {
    const service = getServiceSupabase()
    await service.from('admin_audit_log').insert({
      actor_id: args.user.id,
      actor_email: `hash:${hashIdentifier(args.user.email)}@uthena.audit`,
      action: args.action,
      target_kind: 'payout_requests',
      target_id: String(args.requestId),
      metadata: args.metadata as never,
    } as never)
  } catch (err) {
    log.warn(
      { code: 'payout_request_audit_failed', err: err instanceof Error ? err.message : 'unknown' },
      'payout action: audit log insert failed (request still succeeded)',
    )
  }
}
