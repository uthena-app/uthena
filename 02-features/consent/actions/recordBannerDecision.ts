// recordBannerDecision.ts — server action backing the P11.2
// cookie-consent banner. Persists the visitor's decision (Accept
// all / Decline non-essential / Save custom preferences) into
// `consent_log` with the diagnostic metadata the banner needs to
// stay GDPR-correct.
//
// Differences from `updateConsent.ts` (the /cookie-preferences action):
//   - This action accepts an explicit `source` field (which banner
//     CTA was clicked). The page-level action always writes
//     `source='page_save_preferences'`; the banner writes one of the
//     three CTA-specific sources so the analytics path can answer
//     "do users prefer accept-all or manage-preferences?".
//   - This action reads the geo + GPC headers at decision time and
//     persists them in the new `consent_log.country` / `.gpc` columns,
//     giving downstream analytics the "decision context" that
//     GDPR regulators ask for ("we have evidence of consent").
//   - This action maintains the `uthena_anon_id` cookie so the
//     visitor's decision is durable across revisits.
//
// Both anon and signed-in visitors can call this action. Anon writes
// carry `user_id = NULL` + a hashed IP + the anon_id; signed-in
// writes carry the user's UUID + the same diagnostic metadata.

'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { RecordBannerDecisionInput } from '@foundations/data/schemas'
import { loggerFor } from '@foundations/log/pino'
import { getServerSupabase } from '@foundations/data/supabase'
import { recordConsent, type ConsentSource } from '@foundations/gdpr/consent'
import { isGpcEnabled, readCountryFromHeaders } from '@foundations/gdpr/geo'
import { ensureAnonId, mintAnonId, writeAnonId } from '@foundations/gdpr/anon-id'

const log = loggerFor({ component: 'consent.banner' })

export type RecordBannerDecisionResult =
  | { ok: true; decision: { essential: true; analytics: boolean; marketing: boolean } }
  | { ok: false; error: 'invalid_input' | 'unknown'; fieldErrors?: Record<string, string> }

/** Best-effort extraction of the request IP from common proxy headers.
 *  Same logic as `updateConsent.ts` — duplicated here because the
 *  foundation helpers don't export it (each action owns its own
 *  extraction so the audit log can capture both values verbatim).
 *  Falls back to '0.0.0.0' when no header is present (the hash that
 *  gets stored is unique per real header; the fallback sentinel
 *  collapses all "unknown" requests into one bucket). */
function readRequestIp(headersList: Headers): string {
  const fwd = headersList.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  const real = headersList.get('x-real-ip')
  if (real) return real.trim()
  return '0.0.0.0'
}

/** Persist a banner-driven consent decision. Validates the input,
 *  ensures an anon-id cookie (so future visits see the decision),
 *  records the row, and revalidates the layout so any next-RSC
 *  consumer reflects the new state. */
export async function recordBannerDecisionAction(
  input: unknown,
): Promise<RecordBannerDecisionResult> {
  const parsed = RecordBannerDecisionInput.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path[0]?.toString() ?? '_', i.message]),
      ),
    }
  }

  let headersList: Headers
  try {
    headersList = await headers()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    log.warn({ code: 'banner_action_headers_failed', msg }, 'headers unavailable for banner action')
    headersList = new Headers()
  }

  const ip = readRequestIp(headersList)
  const ua = headersList.get('user-agent') ?? 'unknown'
  const country = readCountryFromHeaders(headersList)
  const gpc = isGpcEnabled(headersList)
  const source: ConsentSource = parsed.data.source

  // Ensure we have an anon id (best-effort; the cookie store may
  // reject — that's fine for the in-memory write, the row still
  // records the IP hash + country).
  let anonId: string | null = null
  try {
    anonId = await ensureAnonId()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    log.warn({ code: 'banner_anon_id_failed', msg }, 'anon id init failed; recording without')
    // Use a fresh but unwritten value so the row carries something
    // distinct from the IP hash — better than collapsing all anon
    // rows on the same IP.
    try {
      anonId = mintAnonId()
    } catch {
      anonId = null
    }
  }

  // Belt + suspenders: when the cookie store was writable enough for
  // ensureAnonId to return a value but the cookie was never set (some
  // serverless cookie-store failures present that way), try again.
  if (anonId) {
    try {
      await writeAnonId(anonId)
    } catch {
      // Best-effort.
    }
  }

  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const userId = user?.id ?? null

  const nextState = {
    essential: true as const,
    analytics: parsed.data.analytics,
    marketing: parsed.data.marketing,
  }

  const result = await recordConsent(userId, nextState, ip, ua, {
    country: country ?? null,
    gpc,
    source,
    anonId,
  })

  if (!result.ok) {
    return { ok: false, error: 'unknown' }
  }

  revalidatePath('/', 'layout')
  return { ok: true, decision: nextState }
}
