// updatePlatformSettingsGeneral.ts — server action. Updates the 3
// numeric fields in `platform_settings` that PHASES.md P14.12 calls
// out: subscriber discount bps, refund window days, royalty default.
// (Resolves STUB-008 + STUB-011).
//
// Contract (mirrors updateDmcaAgent.ts pattern):
//   - Returns `{ ok: true, updatedAt: string, changed: boolean }` on
//     success.
//   - On failure: `{ ok: false, error, fieldErrors? }` with typed
//     errors:
//       - "Please fix the errors below."  — Zod parse failure
//       - "Could not read the current settings. Try again."
//       - "Could not save the settings. Try again."
//       - "You are not authorized to edit platform settings."
//   - Idempotent: a no-op save (same values as before) does NOT write
//     an audit row and does NOT bump `updated_at`. The result still
//     has `changed: false` so the form can show a "no changes" banner.
//   - One focused audit row per save with `before` / `after` JSON
//     listing the changed keys (one row per save, not one per key —
//     the spec's "OQ audit row granularity" recommended this shape
//     because a typical save changes 1-3 keys).
//   - `revalidatePath('/admin/settings')` fires on success.

'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { getServiceSupabase } from '@foundations/data/supabase'
import { UpdatePlatformSettingsGeneralInput } from '@foundations/data/schemas'
import { requireRole } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import { writePlatformSettingsAuditLog } from './writePlatformSettingsAuditLog'

const log = loggerFor({ component: 'admin.platform-settings.updateGeneral' })

export type UpdatePlatformSettingsGeneralResult =
  | { ok: true; updatedAt: string; changed: boolean }
  | {
      ok: false
      error: string
      fieldErrors?: Record<string, string>
    }

type CurrentRow = {
  default_royalty_pct_bps: number
  plr_subscriber_discount_pct_bps: number
  default_refund_window_days: number
}

type FetchResult =
  | { ok: true; row: CurrentRow }
  | { ok: false; error: string }

async function fetchCurrent(): Promise<FetchResult> {
  const supabase = getServiceSupabase()
  const { data, error } = await supabase
    .from('platform_settings')
    .select('default_royalty_pct_bps, plr_subscriber_discount_pct_bps, default_refund_window_days')
    .eq('id', 1)
    .maybeSingle()
  if (error) {
    log.warn(
      { code: 'platform_settings_read_failed', msg: error.message },
      'updatePlatformSettingsGeneral: pre-read failed',
    )
    return { ok: false, error: 'Could not read the current settings. Try again.' }
  }
  if (!data) {
    // The migration guarantees a row exists via the seed INSERT. If
    // it's gone, that's a real problem — surface a friendly error
    // instead of silently using defaults.
    return { ok: false, error: 'Could not read the current settings. Try again.' }
  }
  const d = data as unknown as Record<string, unknown>
  return {
    ok: true,
    row: {
      default_royalty_pct_bps:
        typeof d['default_royalty_pct_bps'] === 'number'
          ? (d['default_royalty_pct_bps'] as number)
          : 3000,
      plr_subscriber_discount_pct_bps:
        typeof d['plr_subscriber_discount_pct_bps'] === 'number'
          ? (d['plr_subscriber_discount_pct_bps'] as number)
          : 1500,
      default_refund_window_days:
        typeof d['default_refund_window_days'] === 'number'
          ? (d['default_refund_window_days'] as number)
          : 14,
    },
  }
}

async function readClientMeta(): Promise<{ ip: string | null; ua: string | null }> {
  try {
    const h = await headers()
    const ipRaw = h.get('x-forwarded-for') ?? h.get('x-real-ip')
    const ip = ipRaw ? ipRaw.split(',')[0]?.trim() ?? null : null
    const ua = h.get('user-agent') ?? null
    return { ip, ua }
  } catch {
    return { ip: null, ua: null }
  }
}

export async function updatePlatformSettingsGeneralAction(
  raw: FormData | Record<string, unknown>,
): Promise<UpdatePlatformSettingsGeneralResult> {
  // Accept either FormData (from a real form) or a plain object
  // (from the client island calling `action(result)` style). Form
  // inputs deliver strings — we coerce numerics for the Zod parse.
  const rawObj: Record<string, unknown> =
    raw instanceof FormData
      ? Object.fromEntries(
          [...raw.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : v.name]),
        )
      : raw

  const coerced: Record<string, unknown> = { ...rawObj }
  for (const key of [
    'default_royalty_pct_bps',
    'plr_subscriber_discount_pct_bps',
    'default_refund_window_days',
  ]) {
    const v = coerced[key]
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v)
      if (!Number.isNaN(n)) coerced[key] = n
    }
  }

  const parsed = UpdatePlatformSettingsGeneralInput.safeParse(coerced)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please fix the errors below.',
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path[0]?.toString() ?? '_', i.message]),
      ),
    }
  }

  let user: { id: string; email: string }
  try {
    const u = await requireRole(['admin', 'super_admin'])
    if (!u) {
      return {
        ok: false,
        error: 'You are not authorized to edit platform settings.',
      }
    }
    user = { id: u.id, email: u.email }
  } catch {
    return {
      ok: false,
      error: 'You are not authorized to edit platform settings.',
    }
  }

  const next = parsed.data
  const fetchResult = await fetchCurrent()
  if (!fetchResult.ok) {
    return { ok: false, error: fetchResult.error }
  }
  const current = fetchResult.row
  const isNoOp =
    current.default_royalty_pct_bps === next.default_royalty_pct_bps &&
    current.plr_subscriber_discount_pct_bps === next.plr_subscriber_discount_pct_bps &&
    current.default_refund_window_days === next.default_refund_window_days

  if (isNoOp) {
    log.info(
      { code: 'platform_settings_general_save_noop', admin_id: user.id },
      'updatePlatformSettingsGeneral: no-op save (values unchanged)',
    )
    revalidatePath('/admin/settings')
    return { ok: true, updatedAt: new Date().toISOString(), changed: false }
  }

  // Compute the focused diff for the audit row. Only changed keys
  // land in `after` — keeps the audit-log entry scannable.
  const before: Record<string, number> = {}
  const after: Record<string, number> = {}
  const changedKeys: string[] = []
  if (current.default_royalty_pct_bps !== next.default_royalty_pct_bps) {
    before['default_royalty_pct_bps'] = current.default_royalty_pct_bps
    after['default_royalty_pct_bps'] = next.default_royalty_pct_bps
    changedKeys.push('default_royalty_pct_bps')
  }
  if (current.plr_subscriber_discount_pct_bps !== next.plr_subscriber_discount_pct_bps) {
    before['plr_subscriber_discount_pct_bps'] = current.plr_subscriber_discount_pct_bps
    after['plr_subscriber_discount_pct_bps'] = next.plr_subscriber_discount_pct_bps
    changedKeys.push('plr_subscriber_discount_pct_bps')
  }
  if (current.default_refund_window_days !== next.default_refund_window_days) {
    before['default_refund_window_days'] = current.default_refund_window_days
    after['default_refund_window_days'] = next.default_refund_window_days
    changedKeys.push('default_refund_window_days')
  }

  const service = getServiceSupabase()
  const { data: updated, error: updateErr } = await service
    .from('platform_settings')
    .update({
      default_royalty_pct_bps: next.default_royalty_pct_bps,
      plr_subscriber_discount_pct_bps: next.plr_subscriber_discount_pct_bps,
      default_refund_window_days: next.default_refund_window_days,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)
    .select('updated_at')
    .single()

  if (updateErr || !updated) {
    log.warn(
      { code: 'platform_settings_general_update_failed', msg: updateErr?.message },
      'updatePlatformSettingsGeneral: update failed',
    )
    return { ok: false, error: 'Could not save the settings. Try again.' }
  }

  const updatedAt = (updated as unknown as { updated_at: string }).updated_at

  // Audit log — best-effort, focused diff. The audit row's target_id
  // is the section name (`general`); the metadata carries the
  // changed_keys list per the spec's "OQ audit row granularity"
  // recommendation.
  const { ip, ua } = await readClientMeta()
  const auditId = await writePlatformSettingsAuditLog({
    adminId: user.id,
    actorEmail: user.email,
    action: 'admin.settings_update',
    key: 'general',
    before: { ...before, _changed_keys: changedKeys } as unknown,
    after: { ...after, _changed_keys: changedKeys } as unknown,
    ipAddress: ip,
    userAgent: ua,
  })
  if (auditId == null) {
    log.warn(
      { code: 'platform_settings_general_audit_failed', admin_id: user.id },
      'updatePlatformSettingsGeneral: audit log write failed (row was updated)',
    )
  }

  revalidatePath('/admin/settings')

  log.info(
    {
      code: 'platform_settings_general_save_ok',
      admin_id: user.id,
      audit_id: auditId,
      changed_keys: changedKeys,
    },
    'updatePlatformSettingsGeneral ok',
  )
  return { ok: true, updatedAt, changed: true }
}