// app/[handle]/not-found.tsx — P13.8 public mini-shop 404 surface.
//
// Two paths arrive here:
//   1. The user navigated to a `/[handle]` that doesn't resolve to
//      an approved affiliate (invalid / pending / suspended / typo).
//   2. SomeNext.js system raised notFound() for a route we don't own.
// We render a calm, friendly 404 with two exits: back to the home
// page + browse the catalog. The "Powered by Uthena" footer keeps
// the brand consistent.

import Link from 'next/link'
import styles from './page.module.css'

export default function MiniShopNotFound() {
  return (
    <main className={styles.shell}>
      <div className={styles.topBar}>
        <Link href="/" className={styles.brand}>
          <span>Uthena</span>
        </Link>
      </div>
      <section
        style={{
          textAlign: 'center',
          padding: '64px 24px',
          margin: '24px 0',
        }}
      >
        <span
          style={{
            display: 'inline-block',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--teal)',
            marginBottom: 12,
          }}
        >
          404
        </span>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: 'var(--heading)',
            margin: '0 0 12px',
            letterSpacing: '-0.01em',
          }}
        >
          We couldn&rsquo;t find that mini-shop
        </h1>
        <p
          style={{
            fontSize: 15,
            color: 'var(--text-2)',
            margin: '0 auto 32px',
            maxWidth: 480,
            lineHeight: 1.5,
          }}
        >
          The affiliate handle may be misspelled, or this shop may be
          temporarily unavailable. The catalog is always open.
        </p>
        <div
          style={{
            display: 'inline-flex',
            gap: 12,
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Link
            href="/browse"
            style={{
              display: 'inline-flex',
              padding: '10px 18px',
              background: 'var(--orange)',
              color: '#000',
              fontWeight: 700,
              fontSize: 14,
              textDecoration: 'none',
              borderRadius: 6,
              border: '1px solid var(--orange)',
            }}
          >
            Browse the catalog
          </Link>
          <Link
            href="/"
            style={{
              display: 'inline-flex',
              padding: '10px 18px',
              background: 'var(--bg-elev-1)',
              color: 'var(--heading)',
              fontWeight: 600,
              fontSize: 14,
              textDecoration: 'none',
              borderRadius: 6,
              border: '1px solid var(--line)',
            }}
          >
            Back to home
          </Link>
        </div>
      </section>
    </main>
  )
}
