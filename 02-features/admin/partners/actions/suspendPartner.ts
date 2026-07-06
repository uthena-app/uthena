// suspendPartner.ts — server action. Suspends an approved partner
// (`status='approved' → 'suspended'`) and writes one
// `admin_audit_log` row with `action='admin.partner_suspended'`.
//
// Pre-conditions (per spec admin-partner-detail.md line 39 + 71 +
// 99):
//   - Caller is `admin` or `super_admin` (gated by `requireAdmin()`)
//   - Rate limit (20/hr/admin across approve+suspend+unsuspend) is
//     not exhausted
//   - The partner row exists
//   - The partner row's current status is `approved` (we don't
//     re-suspend a suspended partner — that's a no-op)
//   - The typed confirmation string matches the spec constant
//     'SUSPEND' (enforced by Zod, the modal sends the literal
//     client-side)
//   - The reason textarea is non-empty (1-500 chars after trim;
//     enforced by Zod)
//
// Post-conditions:
//   - `partners.status` = 'suspended'
//   - `approved_at` / `approved_by` are PRESERVED (the partner's
//     original approval record stays — a future unsuspend puts them
//     back to 'approved' without losing the original date)
//   - One audit row written with before/after status + the typed
//     reason in `metadata.reason`
//
// Email notification is OUT OF SCOPE for Slice 1 (Phase 17 gate;
// STUB-119).
//
// PII safety: the reason field is the admin's own text — they
// typed it — so storing it in the audit row's metadata is fine.
// The audit row's other fields (actor_email, target_id) follow
// the canonical pattern.

'use server'

import { revalidatePath } from 'next/cache'
import { getServiceSupabase } from '@foundations/data/supabase'
import { SuspendPartnerInput } from '@foundations/data/schemas'
import { requireAdmin } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import { rateLimitVerdict } from './approveSuspendRateLimit'

const log = loggerFor({ component: 'admin.partners.suspend' })

export type SuspendPartnerResult =
  | { ok: true; partnerId: number }
  | {
      ok: false
      error: string
      reason?:
        | 'invalid_input'
        | 'rate_limited'
        | 'not_found'
        | 'not_approved'
        | 'server_error'
      retryAfterSeconds?: number
    }

export async function suspendPartnerAction(
  raw: FormData | Record<string, unknown>,
): Promise<SuspendPartnerResult> {
  const obj: Record<string, unknown> =
    raw instanceof FormData
      ? Object.fromEntries(
          [...raw.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : v.name]),
        )
      : raw

  const parsed = SuspendPartnerInput.safeParse(obj)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid request.', reason: 'invalid_input' }
  }

  const user = await requireAdmin()

  const verdict = rateLimitVerdict(user.id, Date.now())
  if (!verdict.allowed) {
    log.warn(
      { code: 'suspend_partner_rate_limited', count: verdict.count },
      'suspendPartnerAction: rate limited',
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
  // log and validate the current status. maybeSingle so a
  // non-existent partner returns null (typed as `not_found`).
  const { data: row, error: readErr } = await service
    .from('partners')
    .select('id, status')
    .eq('id', parsed.data.id)
    .maybeSingle()

  if (readErr) {
    log.warn(
      { code: 'suspend_partner_read_failed', msg: readErr.message },
      'suspendPartnerAction: read failed',
    )
    return { ok: false, error: 'Could not load partner.', reason: 'server_error' }
  }
  if (!row) {
    return { ok: false, error: 'Partner not found.', reason: 'not_found' }
  }

  const beforeStatus = (row as unknown as { status?: unknown }).status
  if (beforeStatus !== 'approved') {
    return {
      ok: false,
      error: `Cannot suspend: partner is currently "${String(beforeStatus)}".`,
      reason: 'not_approved',
    }
  }

  // Update. approved_at / approved_by are intentionally NOT touched
  // — a future unsuspend preserves the original approval record.
  const { error: updateErr } = await service
    .from('partners')
    .update({
      status: 'suspended',
    })
    .eq('id', parsed.data.id)

  if (updateErr) {
    log.warn(
      { code: 'suspend_partner_update_failed', msg: updateErr.message },
      'suspendPartnerAction: update failed',
    )
    return { ok: false, error: 'Could not suspend partner.', reason: 'server_error' }
  }

  // Audit row. The reason is the admin's own text (they typed it
  // in the modal); storing it in metadata.reason is the durable
  // trail.
  const { error: auditErr } = await service.from('admin_audit_log').insert({
    actor_id: user.id,
    actor_email: user.email,
    action: 'admin.partner_suspended',
    target_kind: 'partners',
    target_id: String(parsed.data.id),
    metadata: {
      before_status: 'approved',
      after_status: 'suspended',
      reason: parsed.data.reason,
    } as never,
  } as never)

  if (auditErr) {
    log.warn(
      { code: 'suspend_partner_audit_failed', msg: auditErr.message },
      'suspendPartnerAction: audit row write failed (suspension still committed)',
    )
  }

  revalidatePath('/admin/partners')
  revalidatePath(`/admin/partners/${parsed.data.id}`)

  log.info(
    { code: 'suspend_partner_ok', partner_id: parsed.data.id, admin_id: user.id },
    'suspendPartnerAction ok',
  )

  return { ok: true, partnerId: parsed.data.id }
}