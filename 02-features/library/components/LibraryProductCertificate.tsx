// LibraryProductCertificate.tsx — Slice-1 placeholder for the
// per-product certificate status on /library/[slug]. RSC. The real
// implementation lands in Phase 15 (P15.11 auto-issue on course
// completion + P15.12 /account/certificates gallery + P15.14 branded
// PDF download). For now, this component:
//
//   1. Explains the certificate flow (complete the course → cert
//      auto-issues → appears in /account/certificates → downloadable
//      as branded PDF).
//   2. Links to /account/certificates (currently a placeholder page
//      per Phase 9 P9.15) so the user has a stable destination.
//
// Why a real component, not just inline JSX on the page:
//   - Same rationale as LibraryProductLessons: the page composes 4
//     sections. Replacing this file's body with the real cert
//     surface when Phase 15 lands is a no-op for the page route.

import Link from 'next/link'
import styles from './LibraryProductCertificate.module.css'

export function LibraryProductCertificate() {
  return (
    <section className={styles.section} aria-label="Certificate (coming soon)">
      <div className={styles.head}>
        <div>
          <h2 className={styles.h2}>Certificate</h2>
          <p className={styles.sub}>Auto-issued on course completion</p>
        </div>
        <span className={styles.badge} data-soon="true">Coming soon</span>
      </div>

      <div className={styles.body}>
        <p className={styles.copy}>
          Complete every lesson in this course and a branded certificate
          will appear in your{' '}
          <Link href="/account/certificates" className={styles.inlineLink}>
            certificate gallery
          </Link>
          . Each certificate has a public verification URL and a downloadable
          PDF.
        </p>

        <div className={styles.row}>
          <div className={styles.step}>
            <span className={styles.stepNum}>1</span>
            <span className={styles.stepText}>Finish every lesson</span>
          </div>
          <div className={styles.stepConnector} aria-hidden />
          <div className={styles.step}>
            <span className={styles.stepNum}>2</span>
            <span className={styles.stepText}>Certificate auto-issues</span>
          </div>
          <div className={styles.stepConnector} aria-hidden />
          <div className={styles.step}>
            <span className={styles.stepNum}>3</span>
            <span className={styles.stepText}>Download branded PDF</span>
          </div>
        </div>
      </div>
    </section>
  )
}