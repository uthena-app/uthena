// app/[handle]/loading.tsx — P13.8 public mini-shop skeleton.
//
// RSC fallback mirroring the page shape. The 3 sections show
// neutral pulse blocks (Token-only colors; no animation library).
// Next.js will swap this in when the data read takes > 100ms
// (the threshold for showing the skeleton instead of an empty
// white flash).

import styles from './page.module.css'

export default function MiniShopLoading() {
  return (
    <main className={styles.shell} aria-busy="true" aria-label="Loading mini-shop">
      <div className={styles.topBar}>
        <span className={styles.brand}>
          <span className={styles.brandHandle}>@handle</span>
        </span>
      </div>
      <div
        style={{
          height: '220px',
          background: 'var(--bg-elev-1)',
          border: '1px solid var(--line)',
          borderRadius: '14px',
          marginBottom: '24px',
        }}
      />
      <div
        style={{
          height: '72px',
          background: 'var(--bg-elev-1)',
          border: '1px solid var(--line)',
          borderRadius: '10px',
          marginBottom: '40px',
        }}
      />
      <div
        style={{
          height: '320px',
          background: 'var(--bg-elev-1)',
          border: '1px solid var(--line)',
          borderRadius: '14px',
          marginBottom: '40px',
        }}
      />
      <div
        style={{
          height: '180px',
          background: 'var(--bg-elev-1)',
          border: '1px solid var(--line)',
          borderRadius: '12px',
        }}
      />
    </main>
  )
}
