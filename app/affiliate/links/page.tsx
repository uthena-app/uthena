// /affiliate/links — P13.5 link-generator page route (Slice 1).
//
// RSC, role-gated via the AffiliateShell wrapper. Composes:
//   - <LinksStatsRow>      — 4-card performance totals
//   - <DefaultLinkHero>    — the ONE default global link (v1 has
//                            exactly one row). When the row doesn't
//                            exist yet (legacy data), the hero
//                            renders an empty state with a Refresh
//                            button that calls
//                            `ensureDefaultLinkAction`.
//   - <AllLinksTable>      — full table view of every active link.
//
// **Auth + role**: AffiliateShell's `requireAffiliate` gates the
// route. The page itself never has to do another role check — the
// shell either renders the children (passed through) or redirects
// to /login (anon) or /403 (wrong role).
//
// **Render strategy**: RSC + `force-dynamic`. The page reads
// affiliate-scoped data every request; never cache.
//
// **Metadata**: `sensitivePageMetadata` (P0.21 — `noindex`) — the
// link manager is authenticated + affiliate-specific.
//
// **Data**: a single `getMyAffiliateLinks()` call (already
// implemented in
// `02-features/affiliate-portal/queries/getMyAffiliateLinks.ts`).
// The query reads the affiliate row + their affiliate_links +
// per-link metrics in a single Promise.all RT.

import type { Metadata } from 'next'

import { sensitivePageMetadata } from '@foundations/metadata'
import {
  AffiliateShell,
  AllLinksTable,
  DefaultLinkHero,
  LinkAnalyticsPanel,
  LinksStatsRow,
  getMyAffiliateLinks,
} from '@features/affiliate-portal'
import styles from './page.module.css'

export const metadata: Metadata = sensitivePageMetadata({
  title: 'Affiliate links',
  description:
    'Your Uthena affiliate links — shareable URLs, copy and QR actions, and per-link click + conversion metrics.',
  path: '/affiliate/links',
})

export const dynamic = 'force-dynamic'

export default async function AffiliateLinksPage() {
  const data = await getMyAffiliateLinks()
  if (!data) {
    // Shell-level requireAffiliate already redirected anon / wrong-role
    // users, so reaching this branch means: logged-in affiliate with no
    // `affiliates` row (e.g. admin-just-deleted-the-row, or a new
    // signup that hasn't completed onboarding). Render a friendly
    // setup-incomplete surface — same copy shape as the dashboard's
    // "No affiliate record found" branch for consistency.
    return (
      <AffiliateShell>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Affiliate portal</p>
          <h1 className={styles.h1}>Affiliate links</h1>
        </header>
        <section className={styles.placeholder} aria-label="No affiliate record">
          <p className={styles.placeholderEyebrow}>Setup incomplete</p>
          <h2 className={styles.placeholderH}>No affiliate record found</h2>
          <p className={styles.placeholderBody}>
            We couldn&apos;t find an affiliate record for your account. If you
            recently had your affiliate access removed, re-apply from the
            onboarding flow.
          </p>
          <a href="/affiliate/onboarding" className={styles.placeholderLink}>
            Start the onboarding flow →
          </a>
        </section>
      </AffiliateShell>
    )
  }

  // In v1 the affiliate has exactly ONE active link — the default
  // global one. The slice is forward-compatible: v2 multi-link
  // simply enables more links in `getMyAffiliateLinks`'s return.
  const defaultLink: import('@features/affiliate-portal').AffiliateLinkRow | null =
    data.links.length > 0 ? data.links[0] ?? null : null

  return (
    <AffiliateShell>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Affiliate portal</p>
        <h1 className={styles.h1}>Affiliate links</h1>
        <p className={styles.lede}>
          Manage your shareable URL, copy it to your clipboard, and see which
          links are driving the most conversions.
        </p>
      </header>

      <LinksStatsRow stats={data.stats} />
      <DefaultLinkHero link={defaultLink} />
      <LinkAnalyticsPanel />
      <AllLinksTable links={data.links} />
    </AffiliateShell>
  )
}
