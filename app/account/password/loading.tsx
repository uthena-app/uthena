// /account/password loading — RSC. Mirrors the form's outer shape:
// a centered 460px card with a header + 3 input skeletons (current,
// new, confirm) + a submit-button skeleton. Token-only, zero client
// JS, follows the P0.24 Slice 2 convention for auth-gated routes.

import styles from './loading.module.css'

export default function Loading() {
  return (
    <div className={styles.wrap} aria-busy="true" aria-label="Loading…">
      <div className={styles.header}>
        <div className={styles.title} />
        <div className={styles.lede} />
      </div>
      <div className={styles.field} />
      <div className={styles.field} />
      <div className={styles.field} />
      <div className={styles.button} />
    </div>
  )
}