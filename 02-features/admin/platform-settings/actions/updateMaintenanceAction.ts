// updateMaintenanceAction.ts — server action that flips maintenance mode.
//
// P14.15 (Platform settings editor — Maintenance mode). Wired into
// the MaintenanceToggle client island on `/admin/settings → General`.
//
// Contract:
//   - Input: `{ enabled: boolean, message: string, confirm: 'CONFIRM' }`
//     (Zod-validated via `UpdateMaintenanceActionInput`).
//   - On success: returns
//     `{ ok: true, enabled, started_at, message, changed, updatedAt }`.
//   - On failure: `{ ok: false, error, fieldErrors? }` with typed
//     errors:
//       - "Please fix the errors below." (Zod parse failure)
//       - "You are not authorized to edit platform settings."
//       - "Too many maintenance toggles. Try again in {N}s." (rate-limit)
//       - "Could not read the current maintenance state. Try again."
//       - "Could not save the maintenance state. Try again."
//   - Idempotent: a no-op toggle (state already matches) does NOT
//     write an audit row, does NOT bump `maintenance_started_at`,
//     does NOT touch the cookie, and returns `{ changed: false }`.
//   - Cookie side-effect: when the toggle succeeds, the action sets
//     (or clears) the `uthena_maintenance_enabled` +
//     `uthena_maintenance_message` cookies. The middleware reads
//     these on the next request to enforce the 503 (or remove it).
//   - Audit row: every change writes one row to `admin_audit_log`
//     with `target_kind='platform_settings'`,
//     `target_id='maintenance'`, and `{ before, after }` in metadata.
//   - Rate limit: 10 toggles per admin per 24h (per spec line 126).
//
// Why the cookie side-effect: the Edge middleware can't read the DB
// without a per-request roundtrip; the cookie gives us a 60s cache
// horizon that survives requests without a DB hit (matching the spec's
// "Maintenance-mode cache invalidation: 60s cache" recommendation).

'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { getServiceSupabase } from '@foundations/data/supabase'
import { getEnv } from '@foundations/env'
import { UpdateMaintenanceActionInput } from '@foundations/data/schemas'
import { requireRole } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import {
  MAINTENANCE_COOKIE_ENABLED,
  MAINTENANCE_COOKIE_MESSAGE,
  coerceMaintenanceState,
  formatMaintenanceMessage,
  maintenanceEnabledCookieOptions,
  maintenanceMessageCookieOptions,
  normalizeMaintenanceMessage,
  signMaintenanceEnabledValue,
  type MaintenanceState,
} from '../lib/maintenance'
import { writePlatformSettingsAuditLog } from './writePlatformSettingsAuditLog'
import {
  maintenanceRateLimitVerdict,
  recordMaintenanceAttempt,
} from './maintenance.rate-limit'

const log = loggerFor({ component: 'admin.platform-settings.updateMaintenance' })

export type UpdateMaintenanceResult =
  | {
      ok: true
      enabled: boolean
      started_at: string | null
      message: string
      changed: boolean
      updatedAt: string
    }
  | {
      ok: false
      error: string
      retryAfterSeconds?: number
      fieldErrors?: Record<string, string>
    }

type FetchResult =
  | { ok: true; state: MaintenanceState }
  | { ok: false; error: string }

async function fetchCurrent(): Promise<FetchResult> {
  const supabase = getServiceSupabase()
  const { data, error } = await supabase
    .from('platform_settings')
    .select('maintenance_mode, maintenance_started_at, maintenance_message')
    .eq('id', 1)
    .maybeSingle()
  if (error) {
    log.warn(
      { code: 'maintenance_state_read_failed', msg: error.message },
      'updateMaintenanceAction: pre-read failed',
    )
    return { ok: false, error: 'Could not read the current maintenance state. Try again.' }
  }
  return { ok: true, state: coerceMaintenanceState(data) }
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

async function setMaintenanceCookies(enabled: boolean, message: string | null): Promise<void> {
  const cookieStore = await cookies()
  if (enabled) {
    // SEC-2: the cookie carries an HMAC-signed value ("1.<hmac-hex>"),
    // not the bare "1" — parseMaintenanceEnabledCookie rejects
    // anything else. AUTH_SECRET is the app's existing session-signing
    // secret (env.ts requires >= 32 chars); no new secret is introduced.
    const signedValue = await signMaintenanceEnabledValue(getEnv().AUTH_SECRET)
    cookieStore.set(MAINTENANCE_COOKIE_ENABLED, signedValue, maintenanceEnabledCookieOptions())
    if (message && message.trim() !== '') {
      cookieStore.set(
        MAINTENANCE_COOKIE_MESSAGE,
        encodeURIComponent(message),
        maintenanceMessageCookieOptions(),
      )
    } else {
      // Message is empty → clear any stale message cookie so the
      // middleware falls back to the default.
      cookieStore.set(MAINTENANCE_COOKIE_MESSAGE, '', { ...maintenanceMessageCookieOptions(), maxAge: 0 })
    }
  } else {
    // Turning OFF → clear both cookies so the middleware stops blocking.
    cookieStore.set(MAINTENANCE_COOKIE_ENABLED, '', { ...maintenanceEnabledCookieOptions(), maxAge: 0 })
    cookieStore.set(MAINTENANCE_COOKIE_MESSAGE, '', { ...maintenanceMessageCookieOptions(), maxAge: 0 })
  }
}

/**
 * Toggle maintenance mode on/off. Accepts either FormData (from a real
 * form submission) or a plain object (from the client island calling
 * `action(result)` style). FormData string-typed fields are coerced
 * for the Zod parse.
 */
export async function updateMaintenanceAction(
  raw: FormData | Record<string, unknown>,
): Promise<UpdateMaintenanceResult> {
  // 1. Coerce the input shape.
  const rawObj: Record<string, unknown> =
    raw instanceof FormData
      ? Object.fromEntries(
          [...raw.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : v.name]),
        )
      : raw

  // Coerce the `enabled` boolean from the form's "true"/"false" string.
  const coerced: Record<string, unknown> = { ...rawObj }
  if (typeof coerced['enabled'] === 'string') {
    const s = (coerced['enabled'] as string).trim().toLowerCase()
    if (s === 'true' || s === '1' || s === 'on') coerced['enabled'] = true
    else if (s === 'false' || s === '0' || s === 'off') coerced['enabled'] = false
  }

  // 2. Zod parse.
  const parsed = UpdateMaintenanceActionInput.safeParse(coerced)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please fix the errors below.',
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path[0]?.toString() ?? '_', i.message]),
      ),
    }
  }

  // 3. Auth gate.
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

  // 4. Rate limit.
  const verdict = maintenanceRateLimitVerdict(user.id)
  if (!verdict.allowed) {
    log.warn(
      {
        code: 'maintenance_toggle_rate_limited',
        admin_id: user.id,
        retry_after_seconds: verdict.retryAfterSeconds,
      },
      'updateMaintenanceAction: rate-limited',
    )
    return {
      ok: false,
      error: `Too many maintenance toggles. Try again in ${verdict.retryAfterSeconds}s.`,
      retryAfterSeconds: verdict.retryAfterSeconds,
    }
  }

  // 5. Read the current state.
  const fetchResult = await fetchCurrent()
  if (!fetchResult.ok) {
    return { ok: false, error: fetchResult.error }
  }
  const current = fetchResult.state

  const normalizedMessage = normalizeMaintenanceMessage(parsed.data.message)
  // The displayed message (used by the 503 page + the audit strip) is
  // the normalized admin message, falling back to the default for empty input.
  const displayMessage = formatMaintenanceMessage(normalizedMessage ?? '')

  const isNoOp =
    current.enabled === parsed.data.enabled &&
    // "no message stored" is treated as equivalent to "default message".
    (current.message === displayMessage ||
      (current.message.trim() === displayMessage.trim() &&
        (normalizedMessage === null || normalizedMessage === '')))

  if (isNoOp) {
    log.info(
      {
        code: 'maintenance_toggle_noop',
        admin_id: user.id,
        target_enabled: parsed.data.enabled,
      },
      'updateMaintenanceAction: no-op toggle (state already matches)',
    )
    // Re-record the attempt anyway — a "no-op toggle" is still a toggle
    // the admin intentionally performed, so it should count against the
    // 10/day cap (the spec says "toggles", not "changes").
    recordMaintenanceAttempt(user.id)
    revalidatePath('/admin/settings')
    return {
      ok: true,
      enabled: current.enabled,
      started_at: current.started_at,
      message: current.message,
      changed: false,
      updatedAt: new Date().toISOString(),
    }
  }

  // 6. Build the DB write payload.
  const nowIso = new Date().toISOString()
  const service = getServiceSupabase()
  const updatePayload: Record<string, unknown> = {
    maintenance_mode: parsed.data.enabled,
    updated_by: user.id,
    updated_at: nowIso,
  }
  if (parsed.data.enabled) {
    // Going ON: stamp the start time + write the admin's message (or
    // null when the admin left it blank, which the coercer treats as
    // "use the default").
    updatePayload['maintenance_started_at'] = nowIso
    updatePayload['maintenance_message'] = normalizedMessage
  } else {
    // Going OFF: clear the start time + clear the message.
    updatePayload['maintenance_started_at'] = null
    updatePayload['maintenance_message'] = null
  }

  const { data: updated, error: updateErr } = await service
    .from('platform_settings')
    .update(updatePayload)
    .eq('id', 1)
    .select('updated_at, maintenance_started_at, maintenance_message')
    .single()

  if (updateErr || !updated) {
    log.warn(
      {
        code: 'maintenance_state_update_failed',
        msg: updateErr?.message,
        admin_id: user.id,
      },
      'updateMaintenanceAction: DB update failed',
    )
    return { ok: false, error: 'Could not save the maintenance state. Try again.' }
  }

  const updatedAt = (updated as unknown as { updated_at: string }).updated_at
  const dbMessage = (updated as unknown as { maintenance_message: string | null }).maintenance_message
  const dbStartedAt = (updated as unknown as { maintenance_started_at: string | null }).maintenance_started_at

  // 7. Update the cookies so the middleware enforces (or stops enforcing).
  try {
    await setMaintenanceCookies(parsed.data.enabled, dbMessage)
  } catch (e) {
    // Cookie write failure is non-fatal: the DB state is canonical.
    // The middleware's 60s cache will catch up on the next request
    // (a different admin's toggle will refresh it; or the next page
    // render that reads the DB).
    log.warn(
      {
        code: 'maintenance_cookie_write_failed',
        admin_id: user.id,
        msg: (e as Error).message,
      },
      'updateMaintenanceAction: cookie write failed (DB updated)',
    )
  }

  // 8. Audit log — focused before/after diff. Best-effort; the DB
  //    row is committed even if the audit write fails.
  const { ip, ua } = await readClientMeta()
  const auditId = await writePlatformSettingsAuditLog({
    adminId: user.id,
    actorEmail: user.email,
    action: 'admin.settings_update',
    key: 'maintenance',
    before: {
      enabled: current.enabled,
      started_at: current.started_at,
      message: current.message,
    },
    after: {
      enabled: parsed.data.enabled,
      started_at: dbStartedAt,
      message: dbMessage === null ? null : formatMaintenanceMessage(dbMessage),
    },
    ipAddress: ip,
    userAgent: ua,
  })
  if (auditId == null) {
    log.warn(
      {
        code: 'maintenance_audit_failed',
        admin_id: user.id,
      },
      'updateMaintenanceAction: audit log write failed (row was updated)',
    )
  }

  // 9. Record the attempt against the rate limit.
  recordMaintenanceAttempt(user.id)

  // 10. Revalidate + log.
  revalidatePath('/admin/settings')

  log.info(
    {
      code: 'maintenance_toggle_ok',
      admin_id: user.id,
      enabled: parsed.data.enabled,
      audit_id: auditId,
    },
    'updateMaintenanceAction ok',
  )

  return {
    ok: true,
    enabled: parsed.data.enabled,
    started_at: dbStartedAt,
    message: dbMessage === null ? formatMaintenanceMessage('') : formatMaintenanceMessage(dbMessage),
    changed: true,
    updatedAt,
  }
}