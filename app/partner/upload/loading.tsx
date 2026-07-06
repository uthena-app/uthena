// /partner/upload — loading skeleton.
//
// Mirrors the page's max-width + spacing. Renders while the RSC's
// Promise<{ step }> resolves + while the partner_upload_drafts read
// fires. Token-only, no inline colors.

import styles from './loading.module.css'

export default function PartnerUploadLoading() {
  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <div className={styles.skelEyebrow} aria-hidden="true" />
        <div className={styles.skelTitle} aria-hidden="true" />
        <div className={styles.skelLede} aria-hidden="true" />
      </div>
      <p className={styles.srOnly}>Loading upload wizard…</p>
    </main>
  )
}
