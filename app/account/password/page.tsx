// /account/password — P1.4 — change password while logged in.
// Auth-gated by the parent `app/account/layout.tsx` (which redirects
// unauthenticated visitors to /login?next=/account).
//
// The page composes the `<ChangePasswordForm />` client island, which
// handles the three-field form (Current / New / Confirm) + live
// strength meter + rate-limit cooldown. The page itself is pure RSC
// — no data fetch needed (the layout's `getSessionUser()` already
// established that the visitor is signed in).

import type { Metadata } from 'next'
import { ChangePasswordForm } from '@features/auth/ChangePasswordForm'
import { sensitivePageMetadata } from '@foundations/metadata'
import styles from './password.module.css'

// P0.21 — `noindex` so the change-password surface isn't indexed.
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Change password',
  description: 'Change your Uthena account password.',
  path: '/account/password',
})

export default function AccountPasswordPage() {
  return (
    <div className={styles.wrap}>
      <ChangePasswordForm />
    </div>
  )
}