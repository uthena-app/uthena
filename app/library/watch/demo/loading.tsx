// /library/watch/demo/loading.tsx — Suspense fallback for the demo
// route. Mirrors the page shape (header skeleton + a large player
// skeleton + the help section skeleton) so the layout doesn't shift
// while the player hydrates.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './page.module.css'

export default function Loading() {
  return (
    <div className={styles.page} aria-busy="true" aria-label="Loading…">
      <header className={styles.header}>
        <Skeleton variant="text" width={120} />
        <Skeleton variant="text" width="60%" height={36} />
        <Skeleton variant="text" count={2} />
      </header>

      <section className={styles.playerSection} aria-label="Loading player">
        <Skeleton variant="rect" width="100%" height={540} />
      </section>

      <section className={styles.help} aria-label="Loading shortcuts">
        <Skeleton variant="text" width={180} />
        <Skeleton variant="text" count={7} />
      </section>
    </div>
  )
}