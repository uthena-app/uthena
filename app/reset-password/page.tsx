// P1.3 — `/reset-password` page. Renders the request-link form. The
// `?next=` query param is read server-side and passed down to the
// form (the form re-emits it on submit, the action embeds it in the
// reset email's `redirectTo` so the post-reset flow returns the user
// to where they originally tried to go — typically the URL they were
// sent from `/login?next=…` to access).

import type { Metadata } from 'next'
import { ResetPasswordForm } from '@features/auth/AuthForms'
import { sensitivePageMetadata } from '@foundations/metadata'
import styles from '../login/auth.module.css'

// P0.21 — `noindex` so the password-reset surface isn't indexed.
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Reset password',
  description: 'Reset your Uthena password. Enter the email on your account and we will send a link.',
  path: '/reset-password',
})

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | undefined }>
}) {
  const sp = await searchParams
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <ResetPasswordForm next={sp.next ?? undefined} />
      </div>
    </main>
  )
}
