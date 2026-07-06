// Update password — when the user clicks the email link from
// "reset password", Supabase redirects them here with a code in the
// URL. The auth callback route (app/auth/callback/route.ts) exchanges
// the code for a session, then redirects here. The form updates the
// password for the current session.
//
// P1.3 — `?next=` is read from the search params and passed to the
// form (the form re-emits it on submit, the action redirects to
// `safeNext(next) ?? '/library'`). The `?next=` was embedded in the
// email link's `redirectTo` by the request action, survived the auth
// callback's redirect round-trip, and is read here.
//
// P1.3 — the "expired" state renders when the reset-token session
// is no longer valid (expired token / already used / never existed).
// All three cases render the same UI per the spec's enumeration
// protection requirement — no oracle for "this token was wrong
// vs expired vs used".

import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@foundations/ui/primitives/Button'
import { getSessionUser } from '@foundations/auth/guards'
import { UpdatePasswordForm } from '@features/auth/UpdatePasswordForm'
import { safeNext } from '@foundations/auth/safe-next'
import { sensitivePageMetadata } from '@foundations/metadata'
import styles from '../login/auth.module.css'

// P0.21 — `noindex` so the set-new-password surface isn't indexed.
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Set a new password',
  description: 'Set a new password for your Uthena account.',
  path: '/update-password',
})

export default async function UpdatePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | undefined }>
}) {
  const sp = await searchParams
  const user = await getSessionUser()
  if (!user) {
    // No valid reset-token session — the link has expired, was
    // already used, or never existed. Render the same UI for all
    // three cases (enumeration defense). The "Request a new reset
    // link" CTA preserves `?next=` so the user lands back at the
    // same destination after the fresh flow.
    const retryHref = sp.next
      ? `/reset-password?next=${encodeURIComponent(safeNext(sp.next) ?? '')}`
      : '/reset-password'
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              padding: 16,
              textAlign: 'center',
            }}
          >
            <h1
              style={{
                fontSize: 24,
                color: 'var(--heading)',
                fontWeight: 700,
                margin: 0,
              }}
            >
              This reset link has expired or already been used
            </h1>
            <p
              style={{
                color: 'var(--text-2)',
                fontSize: 14,
                lineHeight: 1.6,
                margin: 0,
              }}
            >
              Reset links are valid for 1 hour and can be used only once. Request a new
              link and we&apos;ll send another email.
            </p>
            <Link href={retryHref} style={{ textDecoration: 'none' }}>
              <Button fullWidth>Request a new reset link</Button>
            </Link>
            <p style={{ color: 'var(--text-3)', fontSize: 13, margin: 0 }}>
              <Link
                href={sp.next ? `/login?next=${encodeURIComponent(safeNext(sp.next) ?? '')}` : '/login'}
                style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}
              >
                Back to sign in
              </Link>
            </p>
          </div>
        </div>
      </main>
    )
  }
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <UpdatePasswordForm next={sp.next ?? undefined} />
      </div>
    </main>
  )
}
