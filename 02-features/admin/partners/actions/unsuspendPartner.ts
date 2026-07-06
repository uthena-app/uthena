// unsuspendPartner.ts — server action. Unsuspends a suspended
// partner (`status='suspended' → 'approved'`) and writes one
// `admin_audit_log` row with `action='admin.partner_unsuspended'`.
//
// Pre-conditions (per spec admin-partner-detail.md line 40):
//   - Caller is `admin` or `super_admin` (gated by `requireAdmin()`)
//   - Rate limit (20/hr/admin across approve+suspend+unsuspend) is
//     not exhausted
//   - The partner row exists
//   - The partner row's current status is `suspended` (we don't
//     unsuspend an approved or pending partner — that's a no-op)
//   - The typed confirmation string matches the spec constant
//     'UNSUSPEND' (enforced by Zod)
//
// Post-conditions:
//   - `partners.status` = 'approved'
//   - `approved_at` / `approved_by` are PRESERVED (the partner's
//     original approval record stays — they were approved before
//     being suspended, and they're approved again now)
//   - One audit row written with before/after status
//
// Email notification is OUT OF SCOPE for Slice 1 (Phase 17 gate;
// STUB-119).
//
// Why unsuspend sets status back to 'approved' (not 'pending'):
// the partner was approved before they were suspended. The
// suspension is a pause, not a revocation. Putting them back to
// 'pending' would force them through the full onboarding wizard
// again, which is wrong — they're still a known partner whose
// first approval is intact.

'use server'

import { revalidatePath } from 'next/cache'
import { getServiceSupabase } from '@foundations/data/supabase'
import { UnsuspendPartnerInput } from '@foundations/data/schemas'
import { requireAdmin } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import { rateLimitVerdict } from './approveSuspendRateLimit'

const log = loggerFor({ component: 'admin.partners.unsuspend' })

export type UnsuspendPartnerResult =
  | { ok: true; partnerId: number }
  | {
      ok: false
      error: string
      reason?:
        | 'invalid_input'
        | 'rate_limited'
        | 'not_found'
        | 'not_suspended'
        | 'server_error'
      retryAfterSeconds?: number
    }

export async function unsuspendPartnerAction(
  raw: FormData | Record<string, unknown>,
): Promise<UnsuspendPartnerResult> {
  const obj: Record<string, unknown> =
    raw instanceof FormData
      ? Object.fromEntries(
          [...raw.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : v.name]),
        )
      : raw

  const parsed = UnsuspendPartnerInput.safeParse(obj)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid request.', reason: 'invalid_input' }
  }

  const user = await requireAdmin()

  const verdict = rateLimitVerdict(user.id, Date.now())
  if (!verdict.allowed) {
    log.warn(
      { code: 'unsuspend_partner_rate_limited', count: verdict.count },
      'unsuspendPartnerAction: rate limited',
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
  // log and validate the current status.
  const { data: row, error: readErr } = await service
    .from('partners')
    .select('id, status')
    .eq('id', parsed.data.id)
    .maybeSingle()

  if (readErr) {
    log.warn(
      { code: 'unsuspend_partner_read_failed', msg: readErr.message },
      'unsuspendPartnerAction: read failed',
    )
    return { ok: false, error: 'Could not load partner.', reason: 'server_error' }
  }
  if (!row) {
    return { ok: false, error: 'Partner not found.', reason: 'not_found' }
  }

  const beforeStatus = (row as unknown as { status?: unknown }).status
  if (beforeStatus !== 'suspended') {
    return {
      ok: false,
      error: `Cannot unsuspend: partner is currently "${String(beforeStatus)}".`,
      reason: 'not_suspended',
    }
  }

  // Update. approved_at / approved_by are intentionally NOT touched
  // — they were set on the original approval (before the
  // suspension) and survive the round-trip.
  const { error: updateErr } = await service
    .from('partners')
    .update({
      status: 'approved',
    })
    .eq('id', parsed.data.id)

  if (updateErr) {
    log.warn(
      { code: 'unsuspend_partner_update_failed', msg: updateErr.message },
      'unsuspendPartnerAction: update failed',
    )
    return { ok: false, error: 'Could not unsuspend partner.', reason: 'server_error' }
  }

  // Audit row.
  const { error: auditErr } = await service.from('admin_audit_log').insert({
    actor_id: user.id,
    actor_email: user.email,
    action: 'admin.partner_unsuspended',
    target_kind: 'partners',
    target_id: String(parsed.data.id),
    metadata: {
      before_status: 'suspended',
      after_status: 'approved',
    } as never,
  } as never)

  if (auditErr) {
    log.warn(
      { code: 'unsuspend_partner_audit_failed', msg: auditErr.message },
      'unsuspendPartnerAction: audit row write failed (unsuspension still committed)',
    )
  }

  revalidatePath('/admin/partners')
  revalidatePath(`/admin/partners/${parsed.data.id}`)

  log.info(
    { code: 'unsuspend_partner_ok', partner_id: parsed.data.id, admin_id: user.id },
    'unsuspendPartnerAction ok',
  )

  return { ok: true, partnerId: parsed.data.id }
}