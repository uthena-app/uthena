// /account/settings — RSC. Composes the settings form + sessions.
import type { Metadata } from 'next'
import { requireUser } from '@foundations/auth/guards'
import { getMySettings } from '@features/account/profile/queries/getMySettings'
import { getMySessions } from '@features/account/profile/queries/getMySessions'
import { SettingsForm } from '@features/account/profile/components/SettingsForm'
import { SessionsSection } from '@features/account/profile/components/SessionsSection'
import { sensitivePageMetadata } from '@foundations/metadata'
import styles from './settings.module.css'

// P0.21 — `noindex` so the settings surface isn't indexed.
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Settings',
  description: 'Your Uthena account settings.',
  path: '/account/settings',
})

export default async function AccountSettingsPage() {
  const user = await requireUser('/account/settings')
  const [settings, sessionInfo] = await Promise.all([getMySettings(), getMySessions()])

  if (!settings) {
    // Defensive — `requireUser` redirected if no session, so this is
    // only reachable if the settings row is missing entirely. Land the
    // user back on the account home where they can re-trigger the
    // default upsert.
    return null
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.h1}>Settings</h1>
        <p className={styles.lede}>
          Control how we communicate with you and which account features are enabled.
        </p>
      </header>
      <SettingsForm
        initial={{
          email_digest_freq: settings.email_digest_freq,
          marketing_opt_in: settings.marketing_opt_in,
          newsletter_opt_in: settings.newsletter_opt_in,
          partner_updates_opt_in: settings.partner_updates_opt_in,
          affiliate_updates_opt_in: settings.affiliate_updates_opt_in,
          locale: settings.locale,
          timezone: settings.timezone,
        }}
      />
      <SessionsSection
        sessions={sessionInfo.sessions}
        currentSessionId={sessionInfo.currentSessionId}
        currentEmail={user.email}
      />
    </div>
  )
}