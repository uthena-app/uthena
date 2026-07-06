// /library/[slug] not-found page. Renders when getLibraryProduct()
// returns null — either the user doesn't own this product, the
// product is unpublished, or the slug doesn't exist. The same 404
// shape applies to all three cases (defense in depth: never leak
// product existence to non-owners).
//
// `notFound()` in the page triggers Next.js to render this component.
// We override the global 404 with a library-specific surface that
// links back to /library (the catalog of owned products) and the
// public browse (so the user can re-purchase if they got here by
// a stale link).
//
// The page also keeps the global /not-found actions in mind —
// no client JS, no data fetch, no auth gate (the page is shown to
// any visitor who hits an invalid URL pattern, including bots).

import Link from 'next/link'
import styles from './not-found.module.css'

export default function LibraryProductNotFound() {
  return (
    <main id="main" className={styles.page}>
      <div className={styles.card} role="status" aria-live="polite">
        <p className={styles.eyebrow}>404 — Not in your library</p>
        <h1 className={styles.h1}>This course isn't in your library</h1>
        <p className={styles.body}>
          Either you don't own this course, it was unpublished, or the link
          is broken. Head back to your library to see everything you own, or
          browse the catalog to add it to your collection.
        </p>
        <div className={styles.actions}>
          <Link href="/library" className={styles.primary}>
            Back to my library
          </Link>
          <Link href="/browse" className={styles.secondary}>
            Browse catalog
          </Link>
        </div>
      </div>
    </main>
  )
}