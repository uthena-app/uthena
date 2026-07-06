// LibraryNav.tsx — left sidebar for the /library page. Filters
// (status / view) are URL-driven; v1 just renders the static links.

import Link from 'next/link'
import styles from './page.module.css'

export function LibraryNav() {
  return (
    <nav className={styles.nav} aria-label="Library sections">
      <Link href="/library" className={styles.navLink}>All content</Link>
      <Link href="/library/downloads" className={styles.navLink}>Downloads</Link>
      <Link href="/account/orders" className={styles.navLink}>Orders</Link>
      <Link href="/account/subscriptions" className={styles.navLink}>Personal Access</Link>
    </nav>
  )
}
