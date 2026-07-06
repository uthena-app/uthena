// /admin/refunds loading.tsx — RSC fallback mirroring the page shape
// (header + stats row + filter form + list skeleton + pagination
// skeleton). Pure Skeleton primitives + token-only CSS.

import styles from './refunds.module.css'

export default function AdminRefundsLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <header className={styles.header}>
        <div className={styles.h1} style={{ width: 180, height: 24, background: 'var(--bg-elev-2, #1c2024)', borderRadius: 6 }} />
        <div className={styles.sub} style={{ width: 320, height: 14, background: 'var(--bg-elev-2, #1c2024)', borderRadius: 4, marginTop: 8 }} />
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{ height: 76, background: 'var(--bg-elev-1, #15181b)', border: '1px solid var(--line, #2a2f35)', borderRadius: 10 }} />
        ))}
      </div>

      <div style={{ height: 80, background: 'var(--bg-elev-1, #15181b)', border: '1px solid var(--line, #2a2f35)', borderRadius: 10, marginBottom: 16 }} />

      <div style={{ height: 360, background: 'var(--bg-elev-1, #15181b)', border: '1px solid var(--line, #2a2f35)', borderRadius: 10 }} />
    </div>
  )
}