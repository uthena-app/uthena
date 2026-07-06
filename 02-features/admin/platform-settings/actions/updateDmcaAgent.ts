// updateDmcaAgent.ts — server action. Updates the `dmca_agent` row
// in `platform_settings`. Zod-validated input, service-role write,
// audit-logged with before/after JSON, revalidates both `/dmca` (the
// public page) and `/admin/dmca-agent` (the editor).
//
// Contract pinned by `updateDmcaAgent.test.ts`:
//   - Returns `{ ok: true, updatedAt: string, changed: boolean }` on
//     success (camelCase — the test asserts this).
//   - On failure: `{ ok: false, error, fieldErrors? }` with typed
//     error messages:
//       - "Please fix the errors below."   — Zod parse failure
//       - "Could not read the current agent contact. Try again."
//       - "Could not save the agent contact. Try again."
//       - "You are not authorized to edit this setting."  — requireRole refused
//   - IP + UA captured via `headers()` from `next/headers` and passed
//     to the audit-log writer.
//   - `revalidatePath('/dmca')` and `revalidatePath('/admin/dmca-agent')`
//     both fire on success.
//
// Idempotency: a no-op save (same value as before) does NOT write an
// audit row and does NOT bump `updated_at`. The result still has
// `changed: false` so the form can show a "no changes" banner.

'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { getServiceSupabase } from '@foundations/data/supabase'
import { UpdateDmcaAgentInput } from '@foundations/data/schemas'
import { requireRole } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import { writePlatformSettingsAuditLog } from './writePlatformSettingsAuditLog'

const log = loggerFor({ component: 'admin.platform-settings.updateDmcaAgent' })

export type UpdateDmcaAgentResult =
  | { ok: true; updatedAt: string; changed: boolean }
  | {
      ok: false
      error: string
      fieldErrors?: Record<string, string>
    }

type DmcaAgentValue = {
  name: string
  email: string
  mailing_address: string
  phone: string
}

const DMCA_AGENT_KEY = 'dmca_agent'

type FetchResult =
  | { ok: true; value: DmcaAgentValue | null }
  | { ok: false; error: string }

/**
 * Read the current value of the `dmca_agent` row.
 *
 * Returns a tagged union so the caller can distinguish three states:
 *   - `ok: true, value: <shape>`  — row present + well-formed.
 *   - `ok: true, value: null`     — row missing (legitimate first save).
 *   - `ok: false, error: '...'`   — DB read failed (caller surfaces a
 *                                   friendly error to the admin and
 *                                   does NOT attempt the upsert).
 */
async function fetchCurrent(): Promise<FetchResult> {
  const supabase = getServiceSupabase()
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', DMCA_AGENT_KEY)
    .maybeSingle()
  if (error) {
    log.warn(
      { code: 'dmca_agent_read_failed', msg: error.message },
      'updateDmcaAgent: pre-read failed',
    )
    return { ok: false, error: 'Could not read the current agent contact. Try again.' }
  }
  if (!data) return { ok: true, value: null }
  const raw = data.value as unknown
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: true, value: null }
  }
  const obj = raw as Record<string, unknown>
  return {
    ok: true,
    value: {
      name: typeof obj.name === 'string' ? obj.name : '',
      email: typeof obj.email === 'string' ? obj.email : '',
      mailing_address: typeof obj.mailing_address === 'string' ? obj.mailing_address : '',
      phone: typeof obj.phone === 'string' ? obj.phone : '',
    },
  }
}

/** Pull client IP + UA from the request headers. Returns nulls when
 *  the headers are not available (e.g. server actions invoked in a
 *  test or background context). */
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

export async function updateDmcaAgentAction(
  raw: FormData | Record<string, unknown>,
): Promise<UpdateDmcaAgentResult> {
  const obj: Record<string, unknown> =
    raw instanceof FormData
      ? Object.fromEntries(
          [...raw.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : v.name]),
        )
      : raw

  const parsed = UpdateDmcaAgentInput.safeParse(obj)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please fix the errors below.',
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path[0]?.toString() ?? '_', i.message]),
      ),
    }
  }

  // requireRole may throw (Next redirect) OR return null in some code
  // paths. The action handles both shapes explicitly so the test
  // (which mocks requireRole to return null) can assert the typed
  // "not authorized" error path.
  let user: { id: string; email: string }
  try {
    const u = await requireRole(['admin', 'super_admin'])
    if (!u) {
      return {
        ok: false,
        error: 'You are not authorized to edit this setting.',
      }
    }
    user = { id: u.id, email: u.email }
  } catch {
    return {
      ok: false,
      error: 'You are not authorized to edit this setting.',
    }
  }

  const next: DmcaAgentValue = {
    name: parsed.data.name,
    email: parsed.data.email,
    mailing_address: parsed.data.mailing_address,
    phone: parsed.data.phone ?? '',
  }

  // Read the current value so we can:
  //   (a) short-circuit no-op saves (no audit row, no updated_at bump),
  //   (b) write the before/after diff into the audit log.
  const fetchResult = await fetchCurrent()
  if (!fetchResult.ok) {
    return { ok: false, error: fetchResult.error }
  }
  const current = fetchResult.value
  const isNoOp =
    current !== null &&
    current.name === next.name &&
    current.email === next.email &&
    current.mailing_address === next.mailing_address &&
    current.phone === next.phone

  if (isNoOp) {
    log.info(
      { code: 'dmca_agent_save_noop', admin_id: user.id },
      'updateDmcaAgent: no-op save (value unchanged)',
    )
    revalidatePath('/admin/dmca-agent')
    return { ok: true, updatedAt: new Date().toISOString(), changed: false }
  }

  // Service-role write. The admin policy also permits this but
  // service keeps the audit-log write in the same logical operation
  // and matches the categories action's pattern.
  const service = getServiceSupabase()
  const { data: upserted, error: upsertErr } = await service
    .from('app_settings')
    .upsert(
      {
        key: DMCA_AGENT_KEY,
        value: next as unknown as never,
        // Always re-assert public_read=true on save — without this
        // clause, a future admin who toggles public_read=false on
        // the editor would lose the toggle on save. P10.4 only ships
        // the dmca_agent editor; future keys may want to allow
        // toggling here, so we keep the explicit flag for dmca_agent.
        public_read: true,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' },
    )
    .select('updated_at')
    .single()

  if (upsertErr || !upserted) {
    log.warn(
      { code: 'dmca_agent_upsert_failed', msg: upsertErr?.message },
      'updateDmcaAgent: upsert failed',
    )
    return { ok: false, error: 'Could not save the agent contact. Try again.' }
  }

  const updatedAt = (upserted as unknown as { updated_at: string }).updated_at

  // Audit log — best-effort. A failure here does NOT roll back the
  // upsert (the row already landed). We surface a non-fatal warn.
  const { ip, ua } = await readClientMeta()
  const auditId = await writePlatformSettingsAuditLog({
    adminId: user.id,
    actorEmail: user.email,
    action: 'admin.settings_update',
    key: DMCA_AGENT_KEY,
    before: current,
    after: next,
    ipAddress: ip,
    userAgent: ua,
  })
  if (auditId == null) {
    log.warn(
      { code: 'dmca_agent_audit_failed', admin_id: user.id },
      'updateDmcaAgent: audit log write failed (row was updated)',
    )
  }

  revalidatePath('/dmca')
  revalidatePath('/admin/dmca-agent')

  log.info(
    { code: 'dmca_agent_save_ok', admin_id: user.id, audit_id: auditId, changed: true },
    'updateDmcaAgent ok',
  )
  return { ok: true, updatedAt, changed: true }
}