// EmptyLibraryState.tsx — shown when the user has no grants.

import Link from 'next/link'
import styles from './EmptyLibraryState.module.css'

export function EmptyLibraryState() {
  return (
    <div className={styles.wrap}>
      <h2 className={styles.h2}>Your library is empty</h2>
      <p className={styles.p}>
        Once you buy a course or start a Personal Access subscription, it'll show up here.
      </p>
      <div className={styles.actions}>
        <Link href="/browse" className={styles.primary}>
          Browse catalog
        </Link>
        <Link href="/account/subscriptions" className={styles.secondary}>
          Personal Access subscription
        </Link>
      </div>
    </div>
  )
}
