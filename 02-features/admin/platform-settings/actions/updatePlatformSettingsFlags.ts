// updatePlatformSettingsFlags.ts — server actions for the Feature flags
// tab on `/admin/settings` (P14.14).
//
// Three operations, all consolidated into one file because they share
// the same auth + audit-log + diff + persist contract:
//   - addFlag:    insert a new flag (idempotent on key collision)
//   - updateFlag: PATCH an existing flag (toggle / rollout / description)
//   - removeFlag: delete an existing flag (no-op if missing)
//
// Every successful mutation:
//   1. Re-reads the current row via service-role.
//   2. Applies the operation in-memory via the pure helper.
//   3. Computes a focused diff via `diffFlags`.
//   4. Writes one audit row with `target_id='flags'` + the diff metadata
//      (added / removed / changed) so the audit-log reader can see what
//      happened without scanning the full jsonb before/after.
//   5. Fires `revalidatePath('/admin/settings')` so the page re-renders
//      the new state on the next request.
//
// Idempotency:
//   - `addFlag` with a duplicate key returns `{ ok: true, changed: false }`
//     (the caller can render a "key already exists" hint without throwing).
//   - `updateFlag` with no actual changes returns `{ ok: true, changed: false }`
//     and does NOT bump `updated_at`.
//   - `removeFlag` on a missing key returns `{ ok: true, changed: false }`.

'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { getServiceSupabase } from '@foundations/data/supabase'
import { requireRole } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import {
  AddFeatureFlagInputSchema,
  UpdateFeatureFlagInputSchema,
  RemoveFeatureFlagInputSchema,
  applyAddFlag,
  applyRemoveFlag,
  applyUpdateFlag,
  coerceFeatureFlags,
  diffFlags,
  hasFlag,
  sortFlags,
  type FeatureFlag,
  type FeatureFlags,
} from '../lib/featureFlags'
import { writePlatformSettingsAuditLog } from './writePlatformSettingsAuditLog'

const log = loggerFor({ component: 'admin.platform-settings.updateFlags' })

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type UpdateFlagsResult =
  | {
      ok: true
      flags: FeatureFlags
      updatedAt: string
      changed: boolean
      /** Audit row id when changed=true; null when audit write failed. */
      auditId: number | null
    }
  | {
      ok: false
      error: string
      fieldErrors?: Record<string, string>
    }

// ---------------------------------------------------------------------------
// Helpers (shared auth + meta + DB plumbing)
// ---------------------------------------------------------------------------

type Admin = { id: string; email: string }

async function fetchAdmin(): Promise<Admin | null> {
  try {
    const u = await requireRole(['admin', 'super_admin'])
    if (!u) return null
    return { id: u.id, email: u.email }
  } catch {
    return null
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

type FetchResult = { ok: true; flags: FeatureFlags; updatedAt: string } | { ok: false; error: string }

async function fetchCurrentFlags(): Promise<FetchResult> {
  const supabase = getServiceSupabase()
  const { data, error } = await supabase
    .from('platform_settings')
    .select('flags, updated_at')
    .eq('id', 1)
    .maybeSingle()
  if (error) {
    log.warn(
      { code: 'platform_settings_flags_pre_read_failed', msg: error.message },
      'updatePlatformSettingsFlags: pre-read failed',
    )
    return { ok: false, error: 'Could not read the current flags. Try again.' }
  }
  if (!data) {
    return { ok: false, error: 'Could not read the current flags. Try again.' }
  }
  const flagsRaw = (data as unknown as { flags: unknown }).flags
  const updatedAt = (data as unknown as { updated_at: string }).updated_at
  return {
    ok: true,
    flags: sortFlags(coerceFeatureFlags(flagsRaw)),
    updatedAt,
  }
}

async function persistFlags(
  next: FeatureFlags,
  admin: Admin,
): Promise<{ ok: true; updatedAt: string } | { ok: false; error: string }> {
  const service = getServiceSupabase()
  const nowIso = new Date().toISOString()
  const { data, error } = await service
    .from('platform_settings')
    .update({
      flags: next as unknown as never,
      updated_by: admin.id,
      updated_at: nowIso,
    })
    .eq('id', 1)
    .select('updated_at')
    .single()
  if (error || !data) {
    log.warn(
      { code: 'platform_settings_flags_update_failed', msg: error?.message },
      'updatePlatformSettingsFlags: update failed',
    )
    return { ok: false, error: 'Could not save the flags. Try again.' }
  }
  return { ok: true, updatedAt: (data as unknown as { updated_at: string }).updated_at }
}

async function writeAudit(
  admin: Admin,
  diff: ReturnType<typeof diffFlags>,
  ip: string | null,
  ua: string | null,
): Promise<number | null> {
  if (
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.changed.length === 0
  ) {
    return null
  }
  return writePlatformSettingsAuditLog({
    adminId: admin.id,
    actorEmail: admin.email,
    action: 'admin.settings_update',
    key: 'flags',
    before: diff as unknown,
    after: { _diff_summary: true } as unknown,
    ipAddress: ip,
    userAgent: ua,
  })
}

// ---------------------------------------------------------------------------
// addFlag — Insert a new flag. Idempotent on key collision.
// ---------------------------------------------------------------------------

export async function addPlatformFlagAction(
  raw: Record<string, unknown> | FormData,
): Promise<UpdateFlagsResult> {
  const rawObj: Record<string, unknown> =
    raw instanceof FormData
      ? Object.fromEntries(
          [...raw.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : v.name]),
        )
      : raw

  const parsed = AddFeatureFlagInputSchema.safeParse(rawObj)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please fix the errors below.',
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path[0]?.toString() ?? '_', i.message]),
      ),
    }
  }

  const admin = await fetchAdmin()
  if (!admin) {
    return { ok: false, error: 'You are not authorized to edit platform settings.' }
  }

  const current = await fetchCurrentFlags()
  if (!current.ok) return { ok: false, error: current.error }

  if (hasFlag(current.flags, parsed.data.key)) {
    // Idempotent: the row already has this key. No-op.
    log.info(
      { code: 'platform_settings_flag_add_duplicate', admin_id: admin.id, key: parsed.data.key },
      'addPlatformFlag: key already exists (no-op)',
    )
    revalidatePath('/admin/settings')
    return { ok: true, flags: current.flags, updatedAt: current.updatedAt, changed: false, auditId: null }
  }

  const newFlag: FeatureFlag = {
    key: parsed.data.key,
    enabled: parsed.data.enabled,
    description: parsed.data.description,
    rollout_pct: parsed.data.rollout_pct,
  }
  const next = applyAddFlag(current.flags, newFlag)
  const diff = diffFlags(current.flags, next)

  const persist = await persistFlags(next, admin)
  if (!persist.ok) return { ok: false, error: persist.error }

  const { ip, ua } = await readClientMeta()
  const auditId = await writeAudit(admin, diff, ip, ua)
  if (auditId == null) {
    log.warn(
      { code: 'platform_settings_flag_add_audit_failed', admin_id: admin.id, key: parsed.data.key },
      'addPlatformFlag: audit log write failed (row was updated)',
    )
  }

  revalidatePath('/admin/settings')
  log.info(
    {
      code: 'platform_settings_flag_add_ok',
      admin_id: admin.id,
      key: parsed.data.key,
      audit_id: auditId,
    },
    'addPlatformFlag ok',
  )
  return { ok: true, flags: next, updatedAt: persist.updatedAt, changed: true, auditId }
}

// ---------------------------------------------------------------------------
// updateFlag — PATCH an existing flag.
// ---------------------------------------------------------------------------

export async function updatePlatformFlagAction(
  raw: Record<string, unknown> | FormData,
): Promise<UpdateFlagsResult> {
  const rawObj: Record<string, unknown> =
    raw instanceof FormData
      ? Object.fromEntries(
          [...raw.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : v.name]),
        )
      : raw

  const parsed = UpdateFeatureFlagInputSchema.safeParse(rawObj)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please fix the errors below.',
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path[0]?.toString() ?? '_', i.message]),
      ),
    }
  }

  const admin = await fetchAdmin()
  if (!admin) {
    return { ok: false, error: 'You are not authorized to edit platform settings.' }
  }

  const current = await fetchCurrentFlags()
  if (!current.ok) return { ok: false, error: current.error }

  if (!hasFlag(current.flags, parsed.data.key)) {
    return { ok: false, error: `Flag with key "${parsed.data.key}" does not exist.` }
  }

  const next = applyUpdateFlag(current.flags, parsed.data)
  const diff = diffFlags(current.flags, next)

  if (
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.changed.length === 0
  ) {
    // No-op: the PATCH didn't actually change anything (e.g. toggling
    // back to the same value).
    log.info(
      { code: 'platform_settings_flag_update_noop', admin_id: admin.id, key: parsed.data.key },
      'updatePlatformFlag: no-op (values unchanged)',
    )
    revalidatePath('/admin/settings')
    return { ok: true, flags: current.flags, updatedAt: current.updatedAt, changed: false, auditId: null }
  }

  const persist = await persistFlags(next, admin)
  if (!persist.ok) return { ok: false, error: persist.error }

  const { ip, ua } = await readClientMeta()
  const auditId = await writeAudit(admin, diff, ip, ua)
  if (auditId == null) {
    log.warn(
      { code: 'platform_settings_flag_update_audit_failed', admin_id: admin.id, key: parsed.data.key },
      'updatePlatformFlag: audit log write failed (row was updated)',
    )
  }

  revalidatePath('/admin/settings')
  log.info(
    {
      code: 'platform_settings_flag_update_ok',
      admin_id: admin.id,
      key: parsed.data.key,
      audit_id: auditId,
      changed_fields: Object.keys(diff.changed[0]?.after ?? {}),
    },
    'updatePlatformFlag ok',
  )
  return { ok: true, flags: next, updatedAt: persist.updatedAt, changed: true, auditId }
}

// ---------------------------------------------------------------------------
// removeFlag — Delete an existing flag.
// ---------------------------------------------------------------------------

export async function removePlatformFlagAction(
  raw: Record<string, unknown> | FormData,
): Promise<UpdateFlagsResult> {
  const rawObj: Record<string, unknown> =
    raw instanceof FormData
      ? Object.fromEntries(
          [...raw.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : v.name]),
        )
      : raw

  const parsed = RemoveFeatureFlagInputSchema.safeParse(rawObj)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please fix the errors below.',
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path[0]?.toString() ?? '_', i.message]),
      ),
    }
  }

  const admin = await fetchAdmin()
  if (!admin) {
    return { ok: false, error: 'You are not authorized to edit platform settings.' }
  }

  const current = await fetchCurrentFlags()
  if (!current.ok) return { ok: false, error: current.error }

  if (!hasFlag(current.flags, parsed.data.key)) {
    // Idempotent: nothing to remove.
    log.info(
      { code: 'platform_settings_flag_remove_missing', admin_id: admin.id, key: parsed.data.key },
      'removePlatformFlag: key not present (no-op)',
    )
    revalidatePath('/admin/settings')
    return { ok: true, flags: current.flags, updatedAt: current.updatedAt, changed: false, auditId: null }
  }

  const next = applyRemoveFlag(current.flags, parsed.data.key)
  const diff = diffFlags(current.flags, next)

  const persist = await persistFlags(next, admin)
  if (!persist.ok) return { ok: false, error: persist.error }

  const { ip, ua } = await readClientMeta()
  const auditId = await writeAudit(admin, diff, ip, ua)
  if (auditId == null) {
    log.warn(
      { code: 'platform_settings_flag_remove_audit_failed', admin_id: admin.id, key: parsed.data.key },
      'removePlatformFlag: audit log write failed (row was updated)',
    )
  }

  revalidatePath('/admin/settings')
  log.info(
    {
      code: 'platform_settings_flag_remove_ok',
      admin_id: admin.id,
      key: parsed.data.key,
      audit_id: auditId,
    },
    'removePlatformFlag ok',
  )
  return { ok: true, flags: next, updatedAt: persist.updatedAt, changed: true, auditId }
}