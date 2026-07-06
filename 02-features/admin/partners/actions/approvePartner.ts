// approvePartner.ts — server action. Approves a pending partner
// (`status='pending' → 'approved'`) and writes one
// `admin_audit_log` row with `action='admin.partner_approved'`.
//
// Pre-conditions (per spec admin-partner-detail.md line 38 + 71):
//   - Caller is `admin` or `super_admin` (gated by `requireAdmin()`)
//   - Rate limit (20/hr/admin across approve+suspend+unsuspend) is
//     not exhausted
//   - The partner row exists
//   - The partner row's current status is `pending` (we don't
//     approve an already-approved partner — that's a no-op and the
//     modal never offers the action in that branch)
//
// Post-conditions:
//   - `partners.status` = 'approved'
//   - `partners.approved_at` = now()
//   - `partners.approved_by` = admin.id
//   - One audit row written with before/after status + the admin's
//     actor_email (PII-safe; no partner PII in the audit metadata)
//
// Why we set `approved_at` + `approved_by` on the first approval
// and preserve them on subsequent transitions: the spec line 16
// (Identity section) shows `Approved: <date>` as a column. A
// suspended→approved (unsuspend) keeps the original approval date
// so the partner's tenure is preserved.
//
// Email notification to the partner is OUT OF SCOPE for Slice 1 —
// Phase 17 (P17.x email pipeline) is the gate; STUB-119 documents.

'use server'

import { revalidatePath } from 'next/cache'
import { getServiceSupabase } from '@foundations/data/supabase'
import { ApprovePartnerInput } from '@foundations/data/schemas'
import { requireAdmin } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import { rateLimitVerdict } from './approveSuspendRateLimit'

const log = loggerFor({ component: 'admin.partners.approve' })

export type ApprovePartnerResult =
  | { ok: true; partnerId: number }
  | {
      ok: false
      error: string
      reason?:
        | 'invalid_input'
        | 'rate_limited'
        | 'not_found'
        | 'not_pending'
        | 'server_error'
      retryAfterSeconds?: number
    }

export async function approvePartnerAction(
  raw: FormData | Record<string, unknown>,
): Promise<ApprovePartnerResult> {
  const obj: Record<string, unknown> =
    raw instanceof FormData
      ? Object.fromEntries(
          [...raw.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : v.name]),
        )
      : raw

  const parsed = ApprovePartnerInput.safeParse(obj)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid request.', reason: 'invalid_input' }
  }

  const user = await requireAdmin()

  const verdict = rateLimitVerdict(user.id, Date.now())
  if (!verdict.allowed) {
    log.warn(
      { code: 'approve_partner_rate_limited', count: verdict.count },
      'approvePartnerAction: rate limited',
    )
    return {
      ok: false,
      error: 'You are doing this too quickly. Please slow down and try again.',
      reason: 'rate_limited',
      retryAfterSeconds: verdict.retryAfterSeconds,
    }
  }

  const service = getServiceSupabase()

  // Read the current row so we can capture `before` for the audit
  // log. We use maybeSingle so a non-existent partner returns null
  // (typed as `not_found`) rather than throwing.
  const { data: row, error: readErr } = await service
    .from('partners')
    .select('id, status')
    .eq('id', parsed.data.id)
    .maybeSingle()

  if (readErr) {
    log.warn(
      { code: 'approve_partner_read_failed', msg: readErr.message },
      'approvePartnerAction: read failed',
    )
    return { ok: false, error: 'Could not load partner.', reason: 'server_error' }
  }
  if (!row) {
    return { ok: false, error: 'Partner not found.', reason: 'not_found' }
  }

  const beforeStatus = (row as unknown as { status?: unknown }).status
  if (beforeStatus !== 'pending') {
    return {
      ok: false,
      error: `Cannot approve: partner is currently "${String(beforeStatus)}".`,
      reason: 'not_pending',
    }
  }

  const nowIso = new Date().toISOString()
  const { error: updateErr } = await service
    .from('partners')
    .update({
      status: 'approved',
      approved_at: nowIso,
      approved_by: user.id,
    })
    .eq('id', parsed.data.id)

  if (updateErr) {
    log.warn(
      { code: 'approve_partner_update_failed', msg: updateErr.message },
      'approvePartnerAction: update failed',
    )
    return { ok: false, error: 'Could not approve partner.', reason: 'server_error' }
  }

  // Audit row. The metadata intentionally omits the partner's email
  // / display_name / payout method — those fields are PII and the
  // audit log is read by other admins, not by the partner. The
  // status transition is the audit-worthy event.
  const { error: auditErr } = await service.from('admin_audit_log').insert({
    actor_id: user.id,
    actor_email: user.email,
    action: 'admin.partner_approved',
    target_kind: 'partners',
    target_id: String(parsed.data.id),
    metadata: {
      before_status: 'pending',
      after_status: 'approved',
      approved_at: nowIso,
    } as never,
  } as never)

  if (auditErr) {
    // Don't fail the action — the approval is committed. The audit
    // row is the trail marker; a missing audit row is a known
    // failure mode that's already logged below.
    log.warn(
      { code: 'approve_partner_audit_failed', msg: auditErr.message },
      'approvePartnerAction: audit row write failed (approval still committed)',
    )
  }

  revalidatePath('/admin/partners')
  revalidatePath(`/admin/partners/${parsed.data.id}`)

  log.info(
    { code: 'approve_partner_ok', partner_id: parsed.data.id, admin_id: user.id },
    'approvePartnerAction ok',
  )

  return { ok: true, partnerId: parsed.data.id }
}