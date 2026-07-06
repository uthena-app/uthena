'use server'

import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'account.profile.resend' })

export type ResendResult = { ok: boolean; message?: string }

/** Resend the Supabase Auth verification email. The browser-side
 *  `supabase.auth.resend` would force a client-side init of the
 *  Supabase client (which keeps `next/headers` out of the client
 *  bundle easier). Routing through a server action keeps the
 *  service surface tight. */
export async function resendVerificationEmailAction(): Promise<ResendResult> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return { ok: false, message: 'No email on file.' }
  if (user.email_confirmed_at) return { ok: true, message: 'Your email is already verified.' }

  const { error } = await supabase.auth.resend({ type: 'signup', email: user.email })
  if (error) {
    log.warn({ code: 'resend_failed', msg: error.message }, 'resend verification failed')
    return { ok: false, message: 'Could not resend right now. Please try again in a minute.' }
  }
  return { ok: true, message: 'Check your inbox for the verification link.' }
}
