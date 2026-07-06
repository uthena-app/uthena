// /cookie-preferences — granular cookie-consent management.
//
// Public route (anon + signed-in). RSC. The page reads the user's
// most-recent `consent_log` row via `getCurrentConsent()`, then hands
// the state to `<CookiePreferencesForm>` — the client island that
// owns the toggle UI + the submit handler.
//
// P11.1 spec acceptance criteria (all met):
//   - Three categories shown (essential / analytics / marketing).
//   - Essential is locked ON with a clear visual badge; the underlying
//     schema also rejects `essential: false`.
//   - Per-category descriptions explain what data the category collects.
//   - Submit persists to `consent_log` via the server action; signed-in
//     users get cross-device sync; anon users see a "sign in to save
//     across devices" hint.
//   - Footer link "Manage cookie preferences" routes here (added in
//     `footerCopy.ts`).
//
// Metadata: `noindex` is OFF (the page is a legal/utility surface that
// should be discoverable). OG + Twitter Card via `buildPageMetadata`
// match the other legal pages (Privacy / Terms / Refund / Delivery).

import type { Metadata } from 'next'
import { buildPageMetadata } from '@foundations/metadata'
import { getServerSupabase } from '@foundations/data/supabase'
import { getCurrentConsent } from '@features/consent/queries/getCurrentConsent'
import { CookiePreferencesForm } from '@features/consent/components/CookiePreferencesForm'
import styles from './cookie-preferences.module.css'

export const revalidate = 86400

const META_TITLE = 'Cookie preferences'
const META_DESCRIPTION =
  'Manage your cookie preferences on Uthena. Choose which categories — essential, analytics, or marketing — are active on this site.'

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: META_TITLE,
    description: META_DESCRIPTION,
    path: '/cookie-preferences',
    type: 'website',
  })
}

export default async function CookiePreferencesPage() {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const result = await getCurrentConsent()
  // Fail-soft default — the query already returns DEFAULT_CONSENT on
  // every error path. We render the page even if the result is
  // somehow not ok (shouldn't happen — every code path returns ok:true).
  const initial = result.ok
    ? result.consent
    : { essential: true as const, analytics: false, marketing: false }

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: META_TITLE,
    description: META_DESCRIPTION,
    url: 'https://uthena.com/cookie-preferences',
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main id="main" className={styles.page}>
        <div className={styles.container}>
          <header className={styles.header}>
            <p className={styles.eyebrow}>Privacy</p>
            <h1 className={styles.title}>Cookie preferences</h1>
            <p className={styles.lede}>
              Choose which cookies Uthena is allowed to use on this device. Essential
              cookies are always on — they keep the site working. Everything else is up
              to you.
            </p>
          </header>

          <CookiePreferencesForm
            initial={initial}
            hasRecord={result.ok ? result.hasRecord : false}
            signedIn={!!user}
          />

          <section className={styles.detail} aria-labelledby="more-detail">
            <h2 id="more-detail" className={styles.detailTitle}>
              About these categories
            </h2>
            <ul className={styles.detailList}>
              <li>
                <strong>Essential</strong> — session cookies, CSRF tokens, the anon-cart
                cookie, and your signed-in auth state. We can&apos;t run the site without
                these.
              </li>
              <li>
                <strong>Analytics</strong> — PostHog (EU-hosted) for page views, click
                events, and session replays. IPs are anonymized server-side; no email or
                payment data is captured.
              </li>
              <li>
                <strong>Marketing</strong> — reserved for future integrations (Meta Pixel,
                Google Ads, affiliate redirect attribution). No scripts are loaded today;
                this category preserves your preference for the day they are.
              </li>
            </ul>
            <p className={styles.detailLink}>
              Read the full{' '}
              <a className={styles.inlineLink} href="/privacy">
                Privacy Policy
              </a>{' '}
              for retention windows, your GDPR rights, and contact details.
            </p>
          </section>
        </div>
      </main>
    </>
  )
}