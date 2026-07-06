// /affiliate/onboarding — loading skeleton.
//
// P13.1 Slice 1 — RSC fallback for the wizard route. Mirrors the
// partner onboarding loading surface's structure (header + stepper
// row + body card + toolbar) so the perceived load time is the same
// on both wizards.

import styles from './onboarding.module.css'

export default function AffiliateOnboardingLoading() {
  return (
    <main className={styles.page}>
      <div
        style={{
          maxWidth: 960,
          margin: '0 auto',
          padding: '32px 20px 60px',
          display: 'flex',
          flexDirection: 'column',
          gap: 32,
        }}
        aria-busy="true"
        aria-label="Loading affiliate onboarding"
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div
            style={{
              height: 11,
              width: 120,
              borderRadius: 4,
              background: 'var(--bg-elev-2)',
            }}
          />
          <div
            style={{
              height: 28,
              width: 360,
              borderRadius: 6,
              background: 'var(--bg-elev-2)',
            }}
          />
          <div
            style={{
              height: 16,
              width: 480,
              borderRadius: 4,
              background: 'var(--bg-elev-2)',
            }}
          />
        </div>

        <div
          style={{
            height: 64,
            borderRadius: 8,
            background: 'var(--bg-elev-2)',
          }}
        />

        <div
          style={{
            minHeight: 360,
            borderRadius: 12,
            background: 'var(--bg-elev-2)',
          }}
        />
      </div>
    </main>
  )
}