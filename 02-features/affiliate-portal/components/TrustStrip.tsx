// TrustStrip — P13.8 public mini-shop trust signals.
//
// Renders a 4-cell strip of hard-coded trust statements: "14-day
// return rights", "Instant download", "Secure checkout", "PLR
// license included". Per the spec at affiliate-minishop.md:15 —
// these are platform-wide promises that apply to every shop on
// the marketplace, not per-affiliate customization.
//
// RSC, zero client JS. Renders inline SVG glyphs (no icon-font
// dependency, no third-party script).

import styles from './TrustStrip.module.css'

const ITEMS: ReadonlyArray<{ label: string; glyph: 'returns' | 'download' | 'lock' | 'license' }> = [
  { label: '14-day return rights', glyph: 'returns' },
  { label: 'Instant download', glyph: 'download' },
  { label: 'Secure checkout', glyph: 'lock' },
  { label: 'PLR license included', glyph: 'license' },
]

export function TrustStrip() {
  return (
    <ul
      className={styles.strip}
      aria-label="What you get with every purchase"
    >
      {ITEMS.map(({ label, glyph }) => (
        <li key={glyph} className={styles.cell}>
          <Glyph name={glyph} />
          <span className={styles.label}>{label}</span>
        </li>
      ))}
    </ul>
  )
}

function Glyph({ name }: { name: 'returns' | 'download' | 'lock' | 'license' }) {
  if (name === 'returns') {
    return (
      <svg viewBox="0 0 16 16" className={styles.glyph} aria-hidden focusable="false">
        <path
          d="M3 8a5 5 0 0 1 8.5-3.5L13 3v4H9l1.6-1.6A3.5 3.5 0 0 0 4.5 8H3zm10 0a5 5 0 0 1-8.5 3.5L3 13V9h4l-1.6 1.6A3.5 3.5 0 0 0 11.5 8H13z"
          fill="currentColor"
        />
      </svg>
    )
  }
  if (name === 'download') {
    return (
      <svg viewBox="0 0 16 16" className={styles.glyph} aria-hidden focusable="false">
        <path
          d="M8 1v8.6l3.3-3.3 1.1 1.1L8 11.8 3.6 7.4l1.1-1.1L8 9.6V1zm-6 12h12v2H2v-2z"
          fill="currentColor"
        />
      </svg>
    )
  }
  if (name === 'lock') {
    return (
      <svg viewBox="0 0 16 16" className={styles.glyph} aria-hidden focusable="false">
        <path
          d="M8 1a3 3 0 0 0-3 3v3H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-1V4a3 3 0 0 0-3-3zm0 2a1 1 0 0 1 1 1v3H7V4a1 1 0 0 1 1-1z"
          fill="currentColor"
        />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 16 16" className={styles.glyph} aria-hidden focusable="false">
      <path
        d="M8 1l1.7 3.4 3.7.5-2.7 2.6.6 3.7L8 9.6 4.7 11.2l.6-3.7L2.6 4.9l3.7-.5L8 1z"
        fill="currentColor"
      />
    </svg>
  )
}
