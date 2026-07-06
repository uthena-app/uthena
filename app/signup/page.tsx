import type { Metadata } from 'next'
import { SignUpForm } from '@features/auth/AuthForms'
import { sensitivePageMetadata } from '@foundations/metadata'
import styles from '../login/auth.module.css'

// P0.21 — `noindex` so the signup surface isn't indexed.
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Create account',
  description: 'Create a Uthena account — buy courses, build your library, manage subscriptions.',
  path: '/signup',
})

// P1.1 — signup now honors the `?next=` redirect param so a buyer who
// clicked "Sign in" on a gated page (e.g. `/library?from=...`) lands
// back where they intended after they verify their email. The action
// re-validates `next` server-side (open-redirect protection).
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | undefined }>
}) {
  const sp = await searchParams
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <SignUpForm next={sp.next ?? undefined} />
      </div>
    </main>
  )
}