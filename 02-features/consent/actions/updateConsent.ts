// updateConsent.ts — server action backing the `/cookie-preferences`
// page. Records the user's per-category cookie consent decision.
//
// P11.1 spec: essential cookies are always on (locked at the UI + the
// schema + this action). analytics + marketing are user-editable. The
// action:
//   1. Reads the session user (if any) — anon writes go through too
//      but use a null `user_id` + hashed IP (the helper does that).
//   2. Validates the input via the shared `ConsentStateInput` Zod schema.
//   3. Reads the previous consent row (for an audit-log diff that only
//      records what actually changed).
//   4. Calls `recordConsent(...)` — the foundations helper that owns
//      the service-role client + the IP hash + the row insert.
//   5. Writes a focused before/after audit log row (only changed fields,
//      no PII).
//   6. Revalidates `/cookie-preferences` so the page re-renders with
//      the new state.
//
// The action lives in this file (separate from `getCurrentConsent.ts`
// which is also marked `'use server'`) because Next.js's `'use server'`
// files can only export async functions — splitting lets each module
// own its own surface cleanly.

'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { getServerSupabase } from '@foundations/data/supabase'
import { ConsentStateInput } from '@foundations/data/schemas'
import { loggerFor } from '@foundations/log/pino'
import { recordConsent } from '@foundations/gdpr/consent'
import { DEFAULT_CONSENT } from '@foundations/gdpr/consent.types'
import { writeSelfAuditLog } from '@features/account/profile/actions/writeSelfAuditLog'

const log = loggerFor({ component: 'consent.update' })

export type UpdateConsentResult =
  | { ok: true; consent: { essential: true; analytics: boolean; marketing: boolean } }
  | { ok: false; error: 'invalid_input' | 'unknown'; fieldErrors?: Record<string, string> }

const FIELD_LABELS: Record<'analytics' | 'marketing', string> = {
  analytics: 'Analytics cookies',
  marketing: 'Marketing cookies',
}

/** Best-effort extraction of the request IP from common proxy headers.
 *  Falls back to '0.0.0.0' when no header is present (e.g. local dev,
 *  direct curl). The hash is what gets stored — the raw value never
 *  lands in the DB. */
function readRequestIp(headersList: Headers): string {
  const fwd = headersList.get('x-forwarded-for')
  if (fwd) {
    // x-forwarded-for is comma-separated; the FIRST entry is the
    // originating client (later entries are intermediate proxies).
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  const real = headersList.get('x-real-ip')
  if (real) return real.trim()
  return '0.0.0.0'
}

/** Read the most recent consent row for the signed-in user. Returns
 *  `null` for anon users (no prior record concept for anon — see
 *  `getCurrentConsent.ts` file header). Used only for the audit-log
 *  before/after diff. */
async function readPreviousConsent(
  userId: string | null,
): Promise<{ analytics: boolean; marketing: boolean } | null> {
  if (!userId) return null
  const supabase = await getServerSupabase()
  const { data, error } = await supabase
    .from('consent_log')
    .select('analytics, marketing')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  const analytics = typeof data.analytics === 'boolean' ? data.analytics : DEFAULT_CONSENT.analytics
  const marketing = typeof data.marketing === 'boolean' ? data.marketing : DEFAULT_CONSENT.marketing
  return { analytics, marketing }
}

/** Apply a cookie-consent decision. Validates the input, persists the
 *  row, writes a focused audit log entry, and revalidates the page.
 *  Both signed-in and anon visitors can call this action; anon writes
 *  are persisted server-side with `user_id = NULL` + a hashed IP so
 *  the consent_log has a durable record (the consent banner in P11.2
 *  will rely on this). */
export async function updateConsentAction(input: unknown): Promise<UpdateConsentResult> {
  const parsed = ConsentStateInput.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path[0]?.toString() ?? '_', i.message]),
      ),
    }
  }

  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const userId = user?.id ?? null
  const userEmail = user?.email ?? ''

  const headersList = await headers()
  const ip = readRequestIp(headersList)
  const ua = headersList.get('user-agent') ?? 'unknown'

  // Build the full state shape (essential is locked on — the schema
  // doesn't carry it, the canonical shape does). This is what
  // `recordConsent` writes.
  const nextState = {
    essential: true as const,
    analytics: parsed.data.analytics,
    marketing: parsed.data.marketing,
  }

  // Read previous state for an audit-log diff (signed-in users only).
  const prev = await readPreviousConsent(userId)

  // P11.2: recordConsent returns { ok: boolean } (fail-soft helper).
  const writeResult = await recordConsent(userId, nextState, ip, ua, {
    source: 'page_save_preferences',
  })
  if (!writeResult.ok) {
    log.warn({ code: 'consent_write_failed' }, 'consent write failed')
    return { ok: false, error: 'unknown' }
  }

  // Focused audit log entry — only when a field actually changed.
  // We never log the IP / user-agent here (those are admin-internal;
  // the IP is already hashed before it hits the consent_log row).
  if (userId) {
    const diff: { before: Record<string, unknown>; after: Record<string, unknown> } = {
      before: {},
      after: {},
    }
    for (const k of ['analytics', 'marketing'] as const) {
      const prevValue = prev?.[k]
      if (prevValue !== nextState[k]) {
        diff.before[FIELD_LABELS[k]] = prevValue ?? null
        diff.after[FIELD_LABELS[k]] = nextState[k]
      }
    }
    if (Object.keys(diff.after).length > 0) {
      try {
        await writeSelfAuditLog({
          userId,
          userEmail,
          action: 'consent_self_update',
          targetKind: 'consent_log',
          targetId: userId,
          metadata: { ...diff, target_table: 'consent_log' },
        })
      } catch (err) {
        // Audit log write is non-fatal for the user-facing action.
        // The consent row is the source of truth; the audit row is a
        // derived signal. Log a warn and continue.
        const message = err instanceof Error ? err.message : 'unknown'
        log.warn({ code: 'consent_audit_failed', msg: message }, 'consent audit log failed')
      }
    }
  }

  revalidatePath('/cookie-preferences')
  return { ok: true, consent: nextState }
}