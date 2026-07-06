// /account/profile — RSC. Composes the form + security card +
// danger zone.
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireUser } from '@foundations/auth/guards'
import { getMyProfile } from '@features/account/profile/queries/getMyProfile'
import { getMemberSince } from '@features/account/profile/queries/getMemberSince'
import { ProfileForm } from '@features/account/profile/components/ProfileForm'
import { AuditStrip } from '@features/account/profile/components/AuditStrip'
import { sensitivePageMetadata } from '@foundations/metadata'
import { DangerZoneClient } from './DangerZoneClient'
import styles from './profile.module.css'

// P0.21 — `noindex` so the profile surface isn't indexed.
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Profile',
  description: 'Your Uthena profile — display name, bio, social links.',
  path: '/account/profile',
})

export default async function AccountProfilePage() {
  const user = await requireUser('/account/profile')
  const [profile, memberSince] = await Promise.all([
    getMyProfile(),
    getMemberSince(user.id),
  ])

  if (!profile) {
    // No profile row — the auth user exists but the trigger hasn't
    // created a profile yet. Send to /account/overview which renders
    // a friendly state.
    redirect('/account')
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.h1}>Profile</h1>
        <p className={styles.lede}>{memberSince}</p>
      </header>

      <ProfileForm profile={profile} />

      {/* P1.4 — security card with the "Change password" CTA.
          Lives ABOVE the danger zone (a normal-action surface,
          not destructive). The link routes to /account/password,
          which requires the user to verify their current password
          before rotating the secret. */}
      <section className={styles.security} aria-labelledby="security_h">
        <h2 id="security_h" className={styles.securityH}>
          Security
        </h2>
        <p className={styles.securityLede}>
          Manage how you sign in to your Uthena account.
        </p>
        <Link href="/account/password" className={styles.securityLink}>
          Change password
        </Link>
      </section>

      <AuditStrip updatedAt={profile.updated_at} />

      <section className={styles.danger} aria-labelledby="danger_h" id="danger">
        <h2 id="danger_h" className={styles.dangerH}>
          Danger zone
        </h2>
        <p className={styles.dangerLede}>
          Permanently delete your account and anonymize your financial records. This action is
          irreversible from your side.
        </p>
        <DangerZoneClient email={profile.email} />
      </section>
    </div>
  )
}
