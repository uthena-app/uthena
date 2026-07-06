// SettingsHub — /affiliate/settings page-level RSC layout.
//
// Orchestrates the two Slice 1 sections (Profile + Notifications)
// on the affiliate settings page. Future Slices 2+ will append
// Sessions, Connected accounts, Locale & region, Audit strip.
//
// **Why a thin RSC wrapper rather than rendering directly in the
//  route?** Future P13.11 Slices add more sections; centralizing
//  the layout here means the route file stays a one-liner and
//  the section ordering is co-located with the data fetch.
//
// **Auth contract:** this component trusts the route-level guard
// (requireRole(['affiliate'])). It does NOT re-check the role —
// that would be a wasted DB read. The route is the gate.

import { ProfileSection } from './ProfileSection'
import { NotificationsSection } from './NotificationsSection'
import type { AffiliateSettings } from '../queries/getMyAffiliateSettings'
import styles from './SettingsHub.module.css'

type SettingsHubProps = {
  settings: AffiliateSettings
  /** The affiliate's public handle (used in the MiniShopPreview URL
   *  + the mini-shop link in ProfileSection). Pulled separately
   *  from `settings` because the SettingsAggregator only carries
   *  the profile-shape fields needed for the editable surface. */
  handle: string
}

export function SettingsHub({ settings, handle }: SettingsHubProps) {
  return (
    <div className={styles.hub}>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>Settings</p>
        <h1 className={styles.pageTitle}>Account settings</h1>
        <p className={styles.pageLede}>
          Manage your public profile, notifications, sessions, connected
          accounts, and language & region. Edits save automatically.
        </p>
      </header>

      <div className={styles.sectionStack}>
        <ProfileSection
          initial={{
            displayName: settings.profile.displayName,
            bio: settings.profile.bio,
          }}
          handle={handle}
        />
        <NotificationsSection
          initial={{
            affiliateUpdatesOptIn: settings.prefs.affiliateUpdatesOptIn,
            commissionNotificationsOptIn: settings.prefs.commissionNotificationsOptIn,
            payoutNotificationsOptIn: settings.prefs.payoutNotificationsOptIn,
            monthlyDigestOptIn: settings.prefs.monthlyDigestOptIn,
          }}
        />
      </div>
    </div>
  )
}