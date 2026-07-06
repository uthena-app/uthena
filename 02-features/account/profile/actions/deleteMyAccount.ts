'use server'

import { cookies } from 'next/headers'
import { createServerClient, type CookieOptionsWithName } from '@supabase/ssr'
import { getEnv } from '@foundations/env'
import { getServerSupabase } from '@foundations/data/supabase'
import { deleteMyAccountCascade, type DeleteMyAccountOutcome } from '@foundations/gdpr/delete-cascade'

export type DeleteMyAccountResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: 'cancel_subscriptions_first' | 'resolve_payouts_first' | 'wrong_email' | 'unknown' }

/** Right-to-deletion (GDPR Art. 17). The page route calls this from
 *  the confirmation modal after the user has typed their email.
 *  The action:
 *    1. Re-verifies the typed email matches the session email.
 *    2. Writes the audit row BEFORE the cascade (so we have a
 *       record of the request even if the cascade fails partway).
 *    3. Invokes the cascade via `deleteMyAccountCascade` (the
 *       service-role + RPC call + result mapping is now in the
 *       foundations wrapper — `00-foundations/gdpr/delete-cascade.ts`).
 *    4. Signs the user out by clearing the auth cookies (only when
 *       the cascade returned `anonymized` or `already_deleted`).
 *    5. Returns a redirect target — the page route does the actual
 *       navigation AFTER the action returns.
 *
 *  Active-subscription + pending-payout gates are enforced INSIDE
 *  the RPC and surfaced as typed errors via the cascade outcome. */
export async function deleteMyAccountAction(input: {
  confirmEmail: string
}): Promise<DeleteMyAccountResult> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !user.email) return { ok: false, error: 'unknown' }

  // 1. Email match (case-insensitive, trimmed).
  if (input.confirmEmail.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
    return { ok: false, error: 'wrong_email' }
  }

  // 2. Audit row — written BEFORE the cascade so the request is recorded
  //    even if the cascade fails. metadata never contains the password.
  //    We use a dynamic import to avoid a server-only file in this
  //    server action's import graph (writeSelfAuditLog uses pino).
  const { writeSelfAuditLog } = await import('./writeSelfAuditLog')
  await writeSelfAuditLog({
    userId: user.id,
    userEmail: user.email,
    action: 'account_self_delete',
    targetKind: 'profiles',
    targetId: user.id,
    metadata: {
      email: user.email,
      requested_at: new Date().toISOString(),
      anonymized: true,
    },
  })

  // 3. Invoke the cascade via the foundations wrapper. The wrapper
  //    owns the service-role client + RPC call + string-to-typed
  //    outcome mapping + PII-safe logging.
  const outcome: DeleteMyAccountOutcome = await deleteMyAccountCascade(user.id)

  if (outcome === 'cancel_subscriptions_first') {
    return { ok: false, error: 'cancel_subscriptions_first' }
  }
  if (outcome === 'resolve_payouts_first') {
    return { ok: false, error: 'resolve_payouts_first' }
  }
  if (outcome !== 'anonymized' && outcome !== 'already_deleted') {
    return { ok: false, error: 'unknown' }
  }

  // 4. Sign the user out. We do this by clearing the auth cookies
  //    via a fresh server client (the auth-js signOut requires
  //    cookie write access that RSC blocks). The page route then
  //    redirects to `/`.
  const env = getEnv()
  const cookieStore = await cookies()
  const tmp = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptionsWithName }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // ignore — best effort
        }
      },
    },
  })
  await tmp.auth.signOut()

  return { ok: true, redirectTo: '/' }
}