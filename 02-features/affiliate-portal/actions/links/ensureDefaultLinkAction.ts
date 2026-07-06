// ensureDefaultLinkAction.ts — P13.5 page action that idempotently
// creates the affiliate's default global link.
//
// Two-call sites:
//   1. The /affiliate dashboard calls the underlying RPC
//      `ensure_default_affiliate_link(p_affiliate_id)` inline in
//      `getAffiliateDashboard` — that path is the "happy path" that
//      every approved affiliate hits first.
//   2. The /affiliate/links "Refresh" button calls this server
//      action when the page is read with 0 link rows (legacy data,
//      first-visit race window, etc.). This is the data-integrity
//      safety net for spec acceptance #2.
//
// **Auth + RLS**:
//   - `requireRole(['affiliate'])` — non-affiliates don't have an
//     `affiliates` row to look up; refusing at the action layer
//     matches the page-level gate.
//   - The underlying RPC is `SECURITY DEFINER` + `set search_path = ''` +
//     `REVOKE from PUBLIC` + `GRANT to authenticated` + idempotent
//     (catches the 23505 unique violation on the `code` UNIQUE
//     index per the migration header).
//
// **Rate limit**: 5/min/user per the spec. Per-user in-process
// sliding-window via the pure helper `rateLimitVerdict` in
// `ensureDefaultLinkAction.rate-limit.ts`. Lives in a separate file
// because Next.js `'use server'` files may only export async
// functions.
//
// **Result shape**: discriminated union so the client can branch
// without inspecting `error.message`. `revalidatePath` is called
// on the success path so the next page render surfaces the new
// row in the hero card.
'use server'

import { revalidatePath } from 'next/cache'
import { requireAffiliate } from '@foundations/auth/guards'
import { getServerSupabase } from '@foundations/data/supabase'
import { rateLimitVerdict } from './ensureDefaultLinkAction.rate-limit'

/** Discriminated union — client branches on `ok`. */
export type EnsureDefaultLinkResult =
  | {
      ok: true
      /** The newly-created (or pre-existing) link row. */
      link: { id: number; code: string; destinationPath: string }
    }
  | {
      ok: false
      code:
        | 'rate_limited'
        | 'unauthenticated'
        | 'no_affiliate_row'
        | 'rpc_error'
        | 'unknown'
      message: string
    }

const RATE_LIMIT_MS = 60_000
const RATE_LIMIT_MAX = 5

/** The public action. Idempotent — safe to spam-click. */
export async function ensureDefaultLinkAction(): Promise<EnsureDefaultLinkResult> {
  // Auth gate. `requireAffiliate` accepts affiliate + admin +
  // super_admin (matches the AffiliateShell's role list). Throws/
  // redirects on unauthenticated OR non-affiliate — we wrap in
  // try/catch and translate to a typed result so the client can
  // surface a friendly message instead of a crash.
  let user: { id: string }
  try {
    const authed = await requireAffiliate()
    user = { id: authed.id }
  } catch {
    return { ok: false, code: 'unauthenticated', message: 'Please sign in.' }
  }

  // Rate limit — per-user 5/min sliding window. Maps to the spec's
  // "ensureDefaultLink — idempotent, 5/min/user".
  const verdict = rateLimitVerdict({
    userId: user.id,
    windowMs: RATE_LIMIT_MS,
    max: RATE_LIMIT_MAX,
    now: Date.now(),
  })
  if (!verdict.allowed) {
    return {
      ok: false,
      code: 'rate_limited',
      message: 'Too many refresh attempts — please try again in a few minutes.',
    }
  }

  // Look up the affiliate id for this user (the RPC needs the id,
  // not the auth user id). RLS-scoped — `affiliates_self_read`
  // means a user can only see their own affiliate row.
  const supabase = await getServerSupabase()
  const { data: affiliate, error: affErr } = await supabase
    .from('affiliates')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (affErr || !affiliate?.id) {
    return {
      ok: false,
      code: 'no_affiliate_row',
      message:
        'No affiliate record found. Visit /affiliate/onboarding to apply.',
    }
  }

  // Idempotent RPC. Catches 23505 internally (per the migration
  // header) so concurrent refresh clicks always return the
  // (single) canonical row.
  const { data: rpcRows, error: rpcErr } = await supabase.rpc(
    'ensure_default_affiliate_link',
    { p_affiliate_id: affiliate.id },
  )

  if (rpcErr) {
    return {
      ok: false,
      code: 'rpc_error',
      message:
        'Could not generate the link right now. Please try again in a few seconds.',
    }
  }

  // RPC returns a JSONB row. PostgREST wraps single-row results as
  // an array of length 1 (or sometimes as the object directly —
  // be defensive).
  const raw =
    Array.isArray(rpcRows)
      ? (rpcRows[0] as Record<string, unknown> | undefined)
      : (rpcRows as Record<string, unknown> | null | undefined)

  if (!raw) {
    return { ok: false, code: 'unknown', message: 'Unexpected empty response.' }
  }

  const id = typeof raw.id === 'number' ? raw.id : Number(raw.id)
  const code = typeof raw.code === 'string' ? raw.code : ''
  const destinationPath =
    typeof raw.destination_path === 'string' && raw.destination_path.length > 0
      ? raw.destination_path
      : '/'

  if (!Number.isFinite(id) || id <= 0 || !code) {
    return { ok: false, code: 'unknown', message: 'Malformed link row.' }
  }

  // Revalidate so the next render of /affiliate/links shows the
  // hero card instead of the empty state.
  revalidatePath('/affiliate/links')

  return {
    ok: true,
    link: { id, code, destinationPath },
  }
}
