// /account/certificates — RSC. Placeholder page (P9.15); the
// `certificates` table is planned for Phase 15 LMS (P15.1 + P15.11 +
// P15.12). When that migration lands, the query + card list +
// year-filter chips + signed-PDF download swap in for the
// placeholder body below — see `01-specs/pages/account-certificates.md`
// for the eventual contract.
import type { Metadata } from 'next'
import Link from 'next/link'
import { requireUser } from '@foundations/auth/guards'
import { sensitivePageMetadata } from '@foundations/metadata'
import styles from './certificates.module.css'

// P0.21 — `noindex` so the certificates gallery isn't indexed.
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Certificates',
  description: 'Your Uthena course completion certificates.',
  path: '/account/certificates',
})

// Per `01-specs/pages/account-certificates.md` Performance section:
// "Cache: none on this page — user-specific." Belt-and-suspenders next
// to the layout's redirect — `requireUser` short-circuits before any
// downstream render. The placeholder itself renders nothing user-
// specific, but the eventual gallery will (per-row issued_at +
// certificate_code), so the directive belongs here for the swap.
export const dynamic = 'force-dynamic'

export default async function AccountCertificatesPage() {
  // Belt-and-suspenders auth gate. The /account layout already
  // redirects unauth users to /login?next=/account; this page-level
  // `requireUser` matches every other /account/* sibling and would
  // redirect to /login?next=/account/certificates if the layout
  // guard were ever loosened (e.g. moved into a middleware).
  await requireUser('/account/certificates')

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.h1}>Certificates</h1>
        <p className={styles.lede}>
          Earn a certificate for every course you complete. Each certificate has a public
          verification code.
        </p>
      </header>

      <div className={styles.placeholder}>
        <p className={styles.placeholderTitle}>Complete a course to earn your first certificate</p>
        <p className={styles.placeholderBody}>
          Finish all lessons in any course in your{' '}
          <Link href="/library" className={styles.placeholderLink}>
            library
          </Link>
          {' '}and a certificate will appear here automatically. Each certificate gets a
          short verification code you can share.
        </p>
      </div>
    </div>
  )
}
